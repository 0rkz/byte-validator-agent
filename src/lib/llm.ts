// LLM client for anomaly detection. Strategy switching:
//   - "claude"  : always Claude (falls through to Ollama if key missing)
//   - "ollama"  : always Ollama
//   - "hybrid"  : Ollama first, Claude as fallback only when Ollama fails
//
// 2026-05-15 — flipped hybrid semantics per Mark's local-first directive.
// Previously hybrid was "Claude for production publishers, Ollama for known-bad."
// New: hybrid is "Ollama for everyone, Claude only as failover." Both keeps
// Anthropic spend off the hot path AND routes work to Zazu so the local
// training-capture pipeline gets the data.

import type { Config } from "./config.js";

export type LLMStrategy = "claude" | "ollama" | "hybrid";

export interface LLMResult {
  score: number; // BPS [0, 10000] — 10000 = clean / no anomalies
  reasoning: string; // short justification, for logging/audit
  provider: "claude" | "ollama"; // which actually ran
  latencyMs: number;
}

const ANOMALY_PROMPT_PREFIX = `You evaluate whether a sequence of data payloads from a publisher is internally consistent + within reasonable bounds.

You return strictly a JSON object with two fields:
  "score" — integer in [0, 10000]. 10000 = clean, no anomalies detected. 0 = severely anomalous (likely fabricated, contradictory, or out-of-bounds).
  "reasoning" — at most one sentence explaining your score.

Score rubric:
  9000-10000: payloads look real, internally consistent, freshness reasonable
  7000-8999: minor inconsistencies (small price drift across samples, slightly stale)
  4000-6999: notable anomalies (impossible values, contradictions across samples)
  1000-3999: severe issues (fabricated-looking, repeated identical payloads, out-of-bounds)
  0-999: clearly garbage / non-sensical

Output ONLY the JSON. No prose. No code fences.

Payloads (most-recent-first, JSON-serialized):
`;

export interface AnomalyInput {
  publisher: `0x${string}`;
  publisherRole: string | null; // human-readable name if known (e.g., "btc-metrics")
  payloads: unknown[]; // most-recent first, parsed JSON
  isLowPqsKnown: boolean; // true for known-bad publishers (test-agent) — routes to Ollama in hybrid mode
}

export class LLMClient {
  constructor(private cfg: Config) {}

  async analyzeAnomaly(input: AnomalyInput): Promise<LLMResult> {
    const prompt = ANOMALY_PROMPT_PREFIX + JSON.stringify(input.payloads, null, 2);
    const order = this.providerOrder();

    let lastErr: Error | null = null;
    let lastTried: "claude" | "ollama" = order[0];

    for (const provider of order) {
      const t0 = Date.now();
      lastTried = provider;
      try {
        const raw = provider === "claude"
          ? await this.callClaude(prompt)
          : await this.callOllama(prompt);
        const parsed = parseScoreJson(raw);
        return {
          score: clamp(parsed.score, 0, 10000),
          reasoning: parsed.reasoning,
          provider,
          latencyMs: Date.now() - t0,
        };
      } catch (err) {
        lastErr = err as Error;
        // Try next provider in chain. Logged at info level so we know when
        // Ollama is silently degrading and Claude is picking up.
        console.warn(
          `[llm] ${provider} failed (${lastErr.message.slice(0, 100)}); trying next provider`
        );
      }
    }

    // Everything failed — return neutral mid-score so we don't dominate the composite.
    return {
      score: 5000,
      reasoning: `All LLM providers failed: ${lastErr?.message.slice(0, 100) ?? "unknown"}`,
      provider: lastTried,
      latencyMs: 0,
    };
  }

  /**
   * Provider order to try, in sequence. First success wins; later ones run
   * only on failure of all earlier ones.
   *
   * "hybrid" is the canonical setting per the 2026-05-15 local-first
   * directive: Ollama first, Claude only as failover when local errors.
   */
  private providerOrder(): ("claude" | "ollama")[] {
    const s = this.cfg.llmStrategy;
    if (s === "claude") return this.cfg.anthropicApiKey ? ["claude"] : ["ollama"];
    if (s === "ollama") return ["ollama"];
    // hybrid: Ollama first, Claude fallback (only if key configured).
    return this.cfg.anthropicApiKey ? ["ollama", "claude"] : ["ollama"];
  }

  private async callClaude(prompt: string): Promise<string> {
    if (!this.cfg.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY not set");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.cfg.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Claude HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;
    const text = data?.content?.[0]?.text;
    if (typeof text !== "string") throw new Error("Claude returned unexpected shape");
    return text;
  }

  private async callOllama(prompt: string): Promise<string> {
    const model = process.env.OLLAMA_MODEL ?? "deepseek-r1:14b";
    const res = await fetch(`${this.cfg.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        // 1024 gives reasoning models (deepseek-r1) room for <think> tokens
        // before the final JSON answer. Plain models stop short of this cap.
        options: { temperature: 0.1, num_predict: 1024 },
      }),
      signal: AbortSignal.timeout(120_000), // accommodate first-call model load
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;
    const text = data?.response;
    if (typeof text !== "string") throw new Error("Ollama returned unexpected shape");
    // Strip reasoning-model <think>...</think> blocks before downstream JSON parse.
    return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
  }
}

function parseScoreJson(raw: string): { score: number; reasoning: string } {
  // Strip markdown code fences if any model wrapped the JSON anyway
  const cleaned = raw
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  // Find the first { … } block
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON object in LLM response");
  const obj = JSON.parse(m[0]) as { score: unknown; reasoning: unknown };
  const score = typeof obj.score === "number" ? obj.score : parseInt(String(obj.score), 10);
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";
  if (!Number.isFinite(score)) throw new Error("LLM returned non-numeric score");
  return { score, reasoning };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
