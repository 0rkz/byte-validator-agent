#!/usr/bin/env node
/**
 * byte-validator-agent — autonomous AI-agent validator for Byte Protocol.
 *
 * v0.1 (today): scaffolding + event listener + per-publisher state.
 * v0.1+ (next session): scoring computation + submitScore() to PQSVerifier.
 *
 * Usage:  byte-validator-agent
 *
 * Required env vars (read by lib/config.ts):
 *   RPC_URL                  default: arbitrum-sepolia-rpc.publicnode.com
 *   VALIDATOR_PRIVATE_KEY    optional today; required for write ops next session
 *   POLL_INTERVAL_MS         default: 4000
 *   LOOKBACK_BLOCKS          default: 500
 *   ENDPOINT_URL             default: placeholder URL (registry metadata only)
 *   LLM_STRATEGY             default: hybrid (claude|ollama|hybrid)
 *   ANTHROPIC_API_KEY        used when LLM_STRATEGY=claude or hybrid
 *   OLLAMA_URL               default: http://localhost:11434
 */

import kleur from "kleur";
import { loadConfig } from "./lib/config.js";
import { BroadcastListener } from "./lib/events.js";
import type { BroadcastEvent } from "./lib/state.js";

function banner(rpcUrl: string): void {
  const line = kleur.green("─".repeat(64));
  console.log();
  console.log(line);
  console.log(
    `  ${kleur.bold().green("🤖  byte-validator-agent")} ${kleur.dim("v0.1.0")} — ${kleur.dim("Byte Protocol agent-side validator")}`,
  );
  console.log();
  console.log(`  ${kleur.dim("Chain:")} Arbitrum Sepolia (421614)`);
  console.log(`  ${kleur.dim("RPC:  ")} ${rpcUrl}`);
  console.log(`  ${kleur.dim("Mode: ")} v0.1 — event listener + state tracking (no on-chain writes yet)`);
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

async function main(): Promise<void> {
  const cfg = loadConfig();
  banner(cfg.rpcUrl);

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

  // Print initial state snapshot so we can see what's tracked.
  for (const snap of listener.state.all()) {
    const avgInterval =
      snap.intervals.length > 0
        ? Math.round(snap.intervals.reduce((s, i) => s + i, 0) / snap.intervals.length)
        : 0;
    console.log(
      `  ${kleur.gray("init")}  ${shortAddr(snap.publisher)}  ` +
        `broadcasts=${snap.broadcastCount}  ` +
        `avg-interval=${avgInterval}s  ` +
        `last=${new Date(snap.lastBroadcast * 1000).toISOString().slice(11, 19)}Z`,
    );
  }
  console.log();
  console.log(kleur.dim("  Watching for live broadcasts. Press Ctrl-C to stop."));
  console.log();

  await listener.start();

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log();
    console.log(kleur.dim("  Shutting down…"));
    listener.stop();
    process.exit(0);
  });

  // Keep the event loop alive
  await new Promise(() => {
    /* runs forever */
  });
}

main().catch((err) => {
  console.error(kleur.red(`Fatal: ${(err as Error).message}`));
  if (process.env.LOG_LEVEL === "debug") console.error(err);
  process.exit(1);
});
