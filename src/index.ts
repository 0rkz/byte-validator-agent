#!/usr/bin/env node
/**
 * byte-validator-agent — autonomous AI-agent validator for Byte Protocol.
 *
 * v0.2 (this release): scaffolding + event listener + 5-component scoring formula
 * with Claude/Ollama hybrid LLM-augmented anomaly detection. Scores logged but
 * NOT submitted on-chain yet.
 *
 * v0.3 (next): wire submitScore() + finalizeBatch() + heartbeat() + claimRewards().
 *
 * Required env vars (see src/lib/config.ts for full list):
 *   RPC_URL                  default: arbitrum-sepolia-rpc.publicnode.com
 *   ANTHROPIC_API_KEY        required if LLM_STRATEGY=claude or hybrid
 *   OLLAMA_URL               default: http://localhost:11434
 *   LLM_STRATEGY             default: hybrid
 *   SCORING_INTERVAL_MS      default: 60000 (60s for dev; 86400000 for prod-aligned 24h)
 */

import kleur from "kleur";
import { loadConfig } from "./lib/config.js";
import { BroadcastListener } from "./lib/events.js";
import type { BroadcastEvent } from "./lib/state.js";
import { LLMClient } from "./lib/llm.js";
import { PayloadArchive } from "./lib/archive.js";
import { ScoringEngine, PUBLISHER_REGISTRY, type ScoreBreakdown } from "./lib/scoring.js";
import type { ContractInputs } from "./lib/scoring.js";
import { buildSigner } from "./lib/signer.js";
import { OnchainClient } from "./lib/onchain.js";
import { formatEther, formatUnits } from "viem";

function banner(rpcUrl: string, llmStrategy: string, mode: string): void {
  const line = kleur.green("─".repeat(64));
  console.log();
  console.log(line);
  console.log(
    `  ${kleur.bold().green("🤖  byte-validator-agent")} ${kleur.dim("v0.3.0")} — ${kleur.dim("Byte Protocol agent-side validator")}`,
  );
  console.log();
  console.log(`  ${kleur.dim("Chain:        ")} Arbitrum Sepolia (421614)`);
  console.log(`  ${kleur.dim("RPC:          ")} ${rpcUrl}`);
  console.log(`  ${kleur.dim("LLM strategy: ")} ${llmStrategy}`);
  console.log(`  ${kleur.dim("Mode:         ")} ${mode}`);
  console.log(line);
  console.log();
}

function shortAddr(a: `0x${string}`): string {
  return `${a.slice(0, 10)}…${a.slice(-4)}`;
}

function shortHash(h: `0x${string}`): string {
  return `${h.slice(0, 10)}…${h.slice(-4)}`;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function formatBroadcast(ev: BroadcastEvent): string {
  const feesUsdc = Number(ev.totalSubscriberFees) / 1e6;
  return (
    `  ${kleur.gray(`[${timestamp()}]`)}  ${kleur.cyan("📡")}  ` +
    `${kleur.bold(shortAddr(ev.publisher))}  ` +
    `${kleur.dim(`subs=${ev.subscriberCount}`)}  ` +
    `${kleur.dim(`bytes=${ev.payloadLength}`)}  ` +
    `${kleur.dim(`fees=$${feesUsdc.toFixed(4)}`)}  ` +
    `${kleur.gray(`hash=${shortHash(ev.payloadHash)}`)}  ` +
    `${kleur.gray(`blk=${ev.blockNumber}`)}`
  );
}

function gradeColor(score: number): (s: string) => string {
  if (score >= 9000) return kleur.green;
  if (score >= 7500) return kleur.cyan;
  if (score >= 5000) return kleur.yellow;
  if (score >= 2500) return kleur.magenta;
  return kleur.red;
}

function formatScore(addr: `0x${string}`, b: ScoreBreakdown): string[] {
  const role = PUBLISHER_REGISTRY[addr.toLowerCase()];
  const name = role?.name ?? "unknown";
  const lines = [
    `  ${kleur.gray(`[${timestamp()}]`)}  ${kleur.bold("📊 SCORE")}  ${shortAddr(addr)} ${kleur.dim(`(${name})`)}`,
    `      ${kleur.dim("cadence       ")} ${gradeColor(b.cadence)(b.cadence.toString().padStart(5))}`,
    `      ${kleur.dim("freshness     ")} ${gradeColor(b.freshness)(b.freshness.toString().padStart(5))}`,
    `      ${kleur.dim("anomalyAbsence")} ${gradeColor(b.anomalyAbsence)(b.anomalyAbsence.toString().padStart(5))}  ${kleur.dim(`(${b.llm?.provider ?? "—"}, ${b.payloadsAnalyzed}p, ${b.llm?.latencyMs ?? 0}ms)`)}`,
    `      ${kleur.dim("volStability  ")} ${gradeColor(b.volumeStability)(b.volumeStability.toString().padStart(5))}`,
    `      ${kleur.dim("diversity     ")} ${gradeColor(b.diversityScore)(b.diversityScore.toString().padStart(5))}`,
    `      ${kleur.bold("composite     ")} ${gradeColor(b.composite)(kleur.bold(b.composite.toString().padStart(5)))}`,
  ];
  if (b.llm && b.llm.reasoning) {
    lines.push(`      ${kleur.gray(`└─ ${b.llm.reasoning.slice(0, 100)}`)}`);
  }
  return lines;
}

async function main(): Promise<void> {
  const cfg = loadConfig();

  // ─── on-chain pre-flight ────────────────────────────────────────────────
  // Build the signer first (if a key is configured) so the banner can report
  // wallet status, balances, and which write loops are armed.
  const signer = cfg.validatorKey ? buildSigner(cfg) : null;
  const onchain = signer ? new OnchainClient(cfg, signer) : null;

  const writeFlags = [
    cfg.autoRegister ? "register" : null,
    cfg.heartbeatEnabled ? "heartbeat" : null,
    cfg.submitEnabled ? "submitScore" : null,
  ].filter(Boolean);
  const mode = signer
    ? `v0.3 — listener + scoring + on-chain [${writeFlags.length ? writeFlags.join(", ") : "all writes dry-run"}]`
    : `v0.3 — listener + scoring (read-only; set VALIDATOR_PRIVATE_KEY for on-chain)`;
  banner(cfg.rpcUrl, cfg.llmStrategy, mode);

  if (signer && onchain) {
    const bal = await onchain.readBalance();
    const status = await onchain.readStatus();
    console.log(`  ${kleur.dim("Agent address:")} ${signer.address}`);
    console.log(
      `  ${kleur.dim("Balance:      ")} ${formatEther(bal.eth)} ETH, ${formatUnits(bal.ppb, 18)} PPB`,
    );
    console.log(
      `  ${kleur.dim("Registry:     ")} validator=${status.isValidator ? kleur.green("yes") : kleur.yellow("no")}  ` +
        `indexer=${status.isIndexer ? (status.indexerSuspended ? kleur.red("suspended") : kleur.green("yes")) : kleur.yellow("no")}`,
    );

    if (cfg.autoRegister && !status.isValidator) {
      console.log(kleur.dim(`  Registering as validator…`));
      try {
        await onchain.ensureRegistered();
      } catch (err) {
        console.error(kleur.red(`  Auto-register failed: ${(err as Error).message}`));
      }
    }
    console.log();
  }

  const listener = new BroadcastListener(cfg, async (ev) => {
    console.log(formatBroadcast(ev));
  });

  console.log(kleur.dim(`  Hydrating state from last ${cfg.lookbackBlocks} blocks…`));
  const hydrated = await listener.hydrateFromLookback();
  console.log(
    kleur.green(
      `  ✓ hydrated ${hydrated} historical broadcast${hydrated === 1 ? "" : "s"} (state for ${listener.state.all().length} publisher${listener.state.all().length === 1 ? "" : "s"})`,
    ),
  );
  console.log();

  for (const snap of listener.state.all()) {
    const avgInterval =
      snap.intervals.length > 0
        ? Math.round(snap.intervals.reduce((s, i) => s + i, 0) / snap.intervals.length)
        : 0;
    const role = PUBLISHER_REGISTRY[snap.publisher.toLowerCase()];
    console.log(
      `  ${kleur.gray("init")}  ${shortAddr(snap.publisher)} ${kleur.dim(`(${role?.name ?? "unknown"})`)}  ` +
        `broadcasts=${snap.broadcastCount}  ` +
        `avg-interval=${avgInterval}s  ` +
        `last=${new Date(snap.lastBroadcast * 1000).toISOString().slice(11, 19)}Z`,
    );
  }
  console.log();
  console.log(
    kleur.dim(
      `  Watching for live broadcasts. Scoring every ${Math.round(cfg.scoringIntervalMs / 1000)}s. Press Ctrl-C to stop.`,
    ),
  );
  console.log();

  await listener.start();

  // Scoring loop — independent of event listener cadence. Latest ContractInputs
  // per publisher are cached here so the (much slower) submit loop can pick up
  // whatever the current composite is when its window opens.
  const llm = new LLMClient(cfg);
  const archive = new PayloadArchive(cfg);
  const engine = new ScoringEngine(llm, archive);
  const latestInputs = new Map<`0x${string}`, ContractInputs>();

  const scoringTick = async () => {
    const snaps = listener.state.all();
    if (snaps.length === 0) return;
    console.log(kleur.dim(`  ${"─".repeat(60)}`));
    console.log(
      kleur.dim(`  ${kleur.bold("scoring tick")} ─ ${snaps.length} publisher${snaps.length === 1 ? "" : "s"}`),
    );
    for (const snap of snaps) {
      try {
        const breakdown = await engine.score(snap, snap.recentHashes);
        for (const line of formatScore(snap.publisher, breakdown)) console.log(line);
        const inputs = engine.toContractInputs(snap, breakdown);
        latestInputs.set(snap.publisher.toLowerCase() as `0x${string}`, inputs);
        console.log(
          kleur.gray(
            `      ${kleur.dim("→ contract inputs:")} dispute=${inputs.disputeScore} retention=${inputs.retentionScore} freshness=${inputs.freshnessScore} revenueQuality=${inputs.revenueQuality}`,
          ),
        );
      } catch (err) {
        console.error(
          kleur.red(`  scoring failed for ${shortAddr(snap.publisher)}: ${(err as Error).message}`),
        );
      }
    }
    console.log();
  };

  // First tick after a short warm-up, then on the configured interval
  setTimeout(() => {
    void scoringTick();
    setInterval(() => void scoringTick(), cfg.scoringIntervalMs);
  }, 8_000);

  // ─── heartbeat loop ────────────────────────────────────────────────────
  // Fires every HEARTBEAT_INTERVAL_MS (default 55min). If HEARTBEAT_ENABLED is
  // false the wrapper logs a dry-run line and skips the tx — useful for
  // verifying the loop is alive before flipping the flag.
  if (onchain) {
    const heartbeatTick = async () => {
      const status = await onchain.readStatus();
      if (!status.isValidator) {
        console.log(kleur.gray(`  ${"─".repeat(60)}`));
        console.log(kleur.gray(`  heartbeat skipped — not registered as validator yet`));
        return;
      }
      console.log(kleur.dim(`  ${"─".repeat(60)}`));
      console.log(kleur.dim(`  ${kleur.bold("heartbeat tick")}`));
      try {
        await onchain.heartbeat();
      } catch (err) {
        console.error(kleur.red(`  heartbeat error: ${(err as Error).message.slice(0, 200)}`));
      }
    };
    setTimeout(() => {
      void heartbeatTick();
      setInterval(() => void heartbeatTick(), cfg.heartbeatIntervalMs);
    }, 15_000);
  }

  // ─── submit loop ───────────────────────────────────────────────────────
  // Fires every SUBMIT_INTERVAL_MS (default 24h = BATCH_INTERVAL). Submits the
  // latest cached ContractInputs for every publisher we've scored. If
  // SUBMIT_ENABLED is false, each submitScore() is a dry-run.
  if (onchain) {
    const submitTick = async () => {
      if (latestInputs.size === 0) {
        console.log(kleur.gray(`  submit skipped — no scored publishers yet`));
        return;
      }
      const status = await onchain.readStatus();
      if (!status.isIndexer) {
        console.log(
          kleur.yellow(`  submit skipped — agent not registered as indexer on PQSVerifier yet`),
        );
        return;
      }
      if (status.indexerSuspended) {
        console.log(kleur.red(`  submit skipped — indexer suspended`));
        return;
      }
      console.log(kleur.dim(`  ${"─".repeat(60)}`));
      console.log(kleur.dim(`  ${kleur.bold("submit tick")} ─ ${latestInputs.size} publisher(s)`));
      for (const [, inputs] of latestInputs) {
        try {
          await onchain.submitScore(inputs);
        } catch (err) {
          console.error(
            kleur.red(`  submitScore failed for ${shortAddr(inputs.publisher)}: ${(err as Error).message.slice(0, 200)}`),
          );
        }
      }
    };
    // First submit pass after 60s so scoring has had a tick to populate the cache
    setTimeout(() => {
      void submitTick();
      setInterval(() => void submitTick(), cfg.submitIntervalMs);
    }, 60_000);
  }

  process.on("SIGINT", () => {
    console.log();
    console.log(kleur.dim("  Shutting down…"));
    listener.stop();
    process.exit(0);
  });

  await new Promise(() => {
    /* runs forever */
  });
}

main().catch((err) => {
  console.error(kleur.red(`Fatal: ${(err as Error).message}`));
  if (process.env.LOG_LEVEL === "debug") console.error(err);
  process.exit(1);
});
