// LLM client for anomaly detection. Strategy switching: Claude (high quality, costs $),
// Ollama (free, local, lower quality), or hybrid (Claude for production publishers,
// Ollama for known-low-PQS publishers like test-agent — per DECISION_LOG 2026-05-13).

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
    const provider = this.choose(input);
    const t0 = Date.now();
    const prompt = ANOMALY_PROMPT_PREFIX + JSON.stringify(input.payloads, null, 2);

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
      // On LLM failure, return a "neutral" mid-score so we don't dominate the composite.
      // Real failure investigation happens via logs.
      return {
        score: 5000,
        reasoning: `LLM error (${provider}): ${(err as Error).message.slice(0, 100)}`,
        provider,
        latencyMs: Date.now() - t0,
      };
    }
  }

  private choose(input: AnomalyInput): "claude" | "ollama" {
    const s = this.cfg.llmStrategy;
    if (s === "claude") return this.cfg.anthropicApiKey ? "claude" : "ollama";
    if (s === "ollama") return "ollama";
    // hybrid: Ollama for known-low-PQS, Claude for everyone else (if key available)
    if (input.isLowPqsKnown) return "ollama";
    return this.cfg.anthropicApiKey ? "claude" : "ollama";
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
    const model = process.env.OLLAMA_MODEL ?? "qwen3-coder:30b";
    const res = await fetch(`${this.cfg.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 200 },
      }),
      signal: AbortSignal.timeout(60_000), // Ollama can be slow on first call
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;
    const text = data?.response;
    if (typeof text !== "string") throw new Error("Ollama returned unexpected shape");
    return text;
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
