// Scoring engine — the 5-component PQS formula committed to in DECISION_LOG 2026-05-13.
//
//   composite = 0.30 * Cadence
//             + 0.25 * Freshness
//             + 0.20 * AnomalyAbsence  ← LLM-augmented (Claude/Ollama hybrid)
//             + 0.15 * VolumeStability
//             + 0.10 * DiversityScore
//
// All components are BPS [0, 10000]. The composite is then mapped to the 4 inputs
// PQSVerifier.submitScore() accepts (disputeScore, retentionScore, freshnessScore,
// revenueQuality) — see ContractInputs below.
//
// Design principle: deterministic components (Cadence, Freshness, VolumeStability,
// DiversityScore) are pure functions of state + recent payloads. The LLM-augmented
// component (AnomalyAbsence) provides the diversity vs other validators — different
// LLMs / prompts / samples → different anomaly signals → genuine independent scoring.

import type { PublisherSnapshot } from "./state.js";
import type { LLMClient, LLMResult } from "./llm.js";
import type { PayloadArchive, ArchivedPayload } from "./archive.js";

// Address → human-friendly publisher name. Used for LLM prompt context.
// Mirror of the mapping in byte-quickstart. test-agent is flagged low-PQS for
// hybrid routing (Ollama instead of Claude — don't burn $ on a known-bad publisher).
export const PUBLISHER_REGISTRY: Record<string, { name: string; lowPqs: boolean }> = {
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": { name: "protocol-status", lowPqs: false },
  "0x07b8c1d531958a3193ea527aea52a9f26bcfe91b": { name: "btc-metrics", lowPqs: false },
  "0xa4ab2d0211e8daa17fc746dfa35bff64559a5884": { name: "crypto-top100", lowPqs: false },
  "0x3f65b5d54772f0fffc180b9c143faa939c6e529e": { name: "defi-yields", lowPqs: false },
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": { name: "test-agent", lowPqs: true },
  // Multi-agent Mercat seed (2026-05-15) — LLM-powered publishers
  "0x821cefaff67247a91ea3975cb0f53ba79d3d35a5": { name: "fact-oracle", lowPqs: false },
  "0x551a4ed7f4a8cf5170a5efc5a5d1266386962e73": { name: "news-feed", lowPqs: false },
  "0x15bfc9492940ff2620118f4611eaed949a8415db": { name: "code-pulse", lowPqs: false },
};

export interface ScoreBreakdown {
  cadence: number;
  freshness: number;
  anomalyAbsence: number;
  volumeStability: number;
  diversityScore: number;
  composite: number;
  llm: LLMResult | null;
  // recent-payload count actually used in this scoring pass (for audit)
  payloadsAnalyzed: number;
}

export interface ContractInputs {
  publisher: `0x${string}`;
  disputeScore: number; // BPS, 10000 = no disputes
  retentionScore: number; // BPS, subscriber retention signal
  freshnessScore: number; // BPS, time-decay since last broadcast
  revenueQuality: number; // BPS, weighted quality composite (the 4 non-freshness components reweighted)
}

const WEIGHTS = {
  cadence: 0.3,
  freshness: 0.25,
  anomalyAbsence: 0.2,
  volumeStability: 0.15,
  diversityScore: 0.1,
} as const;

const PAYLOADS_FOR_ANOMALY = 5; // last N payloads fed to the LLM

export class ScoringEngine {
  constructor(private llm: LLMClient, private archive: PayloadArchive) {}

  async score(snap: PublisherSnapshot, recentHashes: `0x${string}`[]): Promise<ScoreBreakdown> {
    const now = Math.floor(Date.now() / 1000);
    const cadence = computeCadence(snap);
    const freshness = computeFreshness(snap, now);
    const volumeStability = computeVolumeStability(snap);

    // Pull payloads for LLM + entropy. Both can use the same fetched data.
    const fetched = await this.archive.fetchMany(recentHashes.slice(-PAYLOADS_FOR_ANOMALY));
    const payloadsForLlm = fetched.filter((p): p is ArchivedPayload => p !== null).map((p) => p.payload);
    const payloadsForEntropy = fetched.filter((p): p is ArchivedPayload => p !== null);

    const role = PUBLISHER_REGISTRY[snap.publisher.toLowerCase()];
    const llmResult = payloadsForLlm.length > 0
      ? await this.llm.analyzeAnomaly({
          publisher: snap.publisher,
          publisherRole: role?.name ?? null,
          payloads: payloadsForLlm,
          isLowPqsKnown: role?.lowPqs ?? false,
        })
      : null;
    const anomalyAbsence = llmResult?.score ?? 5000; // neutral if no payloads

    const diversityScore = computeDiversityScore(payloadsForEntropy);

    const composite = Math.round(
      WEIGHTS.cadence * cadence +
        WEIGHTS.freshness * freshness +
        WEIGHTS.anomalyAbsence * anomalyAbsence +
        WEIGHTS.volumeStability * volumeStability +
        WEIGHTS.diversityScore * diversityScore,
    );

    return {
      cadence,
      freshness,
      anomalyAbsence,
      volumeStability,
      diversityScore,
      composite,
      llm: llmResult,
      payloadsAnalyzed: payloadsForLlm.length,
    };
  }

  /**
   * Map our 5-component breakdown to the 4 inputs PQSVerifier.submitScore() takes.
   *
   *   disputeScore   ← 10000 (no disputes tracking in v0.2; future: read DisputeFiled events)
   *   retentionScore ← subscriber-count stability from snapshot
   *   freshnessScore ← direct from breakdown.freshness
   *   revenueQuality ← weighted composite of the four "is the data real" signals
   */
  toContractInputs(snap: PublisherSnapshot, b: ScoreBreakdown): ContractInputs {
    const retentionScore = computeRetention(snap);
    // Reweight the four non-freshness components so they sum to 1.0
    // (0.30 + 0.20 + 0.15 + 0.10 = 0.75 in the master formula; renormalize to 1.0)
    const revenueQuality = Math.round(
      (0.3 * b.cadence + 0.2 * b.anomalyAbsence + 0.15 * b.volumeStability + 0.1 * b.diversityScore) / 0.75,
    );
    return {
      publisher: snap.publisher,
      disputeScore: 10000,
      retentionScore,
      freshnessScore: b.freshness,
      revenueQuality: clamp(revenueQuality, 0, 10000),
    };
  }
}

// ─── individual component computations ─────────────────────────────────────

/** Cadence: how consistent the publisher's own broadcast intervals are. */
export function computeCadence(snap: PublisherSnapshot): number {
  if (snap.intervals.length < 2) return 10000; // not enough samples — neutral-high
  const mean = snap.intervals.reduce((s, i) => s + i, 0) / snap.intervals.length;
  if (mean <= 0) return 0;
  const variance =
    snap.intervals.reduce((s, i) => s + (i - mean) ** 2, 0) / snap.intervals.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  // CV = 0 → score 10000; CV = 0.5 → score 5000; CV ≥ 1.0 → score 0
  return clamp(Math.round(10000 * Math.max(0, 1 - cv)), 0, 10000);
}

/** Freshness: time-decay since last broadcast, calibrated to publisher's own cadence. */
export function computeFreshness(snap: PublisherSnapshot, now: number): number {
  if (snap.intervals.length === 0) return 10000; // newly registered — neutral-high
  const meanInterval = snap.intervals.reduce((s, i) => s + i, 0) / snap.intervals.length;
  const elapsed = Math.max(0, now - snap.lastBroadcast);
  if (elapsed <= meanInterval) return 10000;
  const overdueRatio = (elapsed - meanInterval) / meanInterval;
  // exp(-overdueRatio): 1x overdue → 3679, 2x overdue → 1353, 3x → 498
  return clamp(Math.round(10000 * Math.exp(-overdueRatio)), 0, 10000);
}

/** VolumeStability: payload-size consistency. */
export function computeVolumeStability(snap: PublisherSnapshot): number {
  if (snap.payloadLengths.length < 2) return 10000;
  const mean = snap.payloadLengths.reduce((s, n) => s + n, 0) / snap.payloadLengths.length;
  if (mean <= 0) return 0;
  const variance =
    snap.payloadLengths.reduce((s, n) => s + (n - mean) ** 2, 0) / snap.payloadLengths.length;
  const cv = Math.sqrt(variance) / mean;
  return clamp(Math.round(10000 * Math.max(0, 1 - cv)), 0, 10000);
}

/** DiversityScore: Shannon entropy of payload bytes — catches "publish same byte" attack. */
export function computeDiversityScore(payloads: ArchivedPayload[]): number {
  if (payloads.length === 0) return 5000; // neutral
  // Concatenate the payload field of each archived record (as JSON string) into one byte string.
  const corpus = payloads.map((p) => JSON.stringify(p.payload ?? p)).join("");
  if (corpus.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const ch of corpus) freq[ch] = (freq[ch] ?? 0) + 1;
  let entropy = 0;
  const total = corpus.length;
  for (const c in freq) {
    const p = freq[c]! / total;
    entropy -= p * Math.log2(p);
  }
  // entropy is in [0, 8] bits/char-ish for typical text. Map to BPS:
  // entropy 4.0 → 5000, entropy 6.0 → 7500, entropy 8.0 → 10000.
  // For JSON text, baseline ASCII entropy is around 4-5, so we scale generously.
  const score = (entropy / 8) * 10000;
  return clamp(Math.round(score), 0, 10000);
}

/** Retention: subscriber-count stability — non-monotonic decreases lower the score. */
export function computeRetention(snap: PublisherSnapshot): number {
  if (snap.subscriberCounts.length === 0) return 10000;
  const last = snap.subscriberCounts[snap.subscriberCounts.length - 1]!;
  if (last === 0) return 0; // no subscribers = no retention
  // Count decrease events (vs cumulative additions): lower is better.
  let decreases = 0;
  for (let i = 1; i < snap.subscriberCounts.length; i++) {
    if (snap.subscriberCounts[i]! < snap.subscriberCounts[i - 1]!) decreases++;
  }
  const decreaseRate = decreases / snap.subscriberCounts.length;
  return clamp(Math.round(10000 * (1 - decreaseRate)), 0, 10000);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
