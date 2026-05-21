// Oracle-answer verification loop — the "auto-flag" half of the verifiable-data
// trust loop. When a broadcast from a known machine-verifiable oracle publisher
// (pkg-facts, cve-facts) is observed, the agent fetches the payload off-chain,
// POSTs the answer back to that oracle's deterministic /verify endpoint, and:
//
//   verified == true            → the answer re-checks clean. Nothing to do.
//   error    != null            → registry / oracle unreachable. INCONCLUSIVE —
//                                 an unverifiable answer is never a slash. Skip.
//   verified == false           → the answer is provably wrong (non-empty
//                                 `flaggable` set). File a FACTUAL flag on RE06
//                                 — which auto-upholds, since the dispute is
//                                 over a deterministic fact. Machine-verifiable
//                                 feed → automated flag → automated slash,
//                                 zero humans in the trust loop.
//
// fileFlag itself is gated by FLAG_ENABLED (default false): when off, this loop
// logs the flag it WOULD file and sends no transaction — same dry-run pattern
// as submitScore / heartbeat.

import kleur from "kleur";
import type { Config, OracleEntry } from "./config.js";
import type { BroadcastEvent } from "./state.js";
import type { PayloadArchive } from "./archive.js";
import type { OnchainClient } from "./onchain.js";

/** Shape of the JSON returned by an oracle's POST /verify (see pkg-facts/verify.py). */
export interface VerifyReport {
  verified: boolean;
  flaggable: Array<{ field: string; claimed: unknown; actual: unknown }>;
  advisory: Array<{ field: string; claimed: unknown; actual: unknown }>;
  ground_truth?: unknown;
  error: string | null;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 10)}…${a.slice(-4)}` : a;
}

function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h;
}

/**
 * VerificationLoop — wires oracle-answer verification into the broadcast
 * listener. One instance is constructed in main(); `onBroadcast` is invoked for
 * every observed broadcast and short-circuits unless the publisher is a known
 * oracle.
 */
export class VerificationLoop {
  /** publisher address (lowercased) → oracle entry. */
  private readonly byPublisher: Map<string, OracleEntry>;

  constructor(
    private cfg: Config,
    private archive: PayloadArchive,
    // null when no signer is configured (read-only mode) — the loop still runs
    // and dry-run-logs, it just cannot send a tx even if FLAG_ENABLED were set.
    private onchain: OnchainClient | null,
  ) {
    this.byPublisher = new Map(
      cfg.oracles.map((o) => [o.publisher.toLowerCase(), o]),
    );
  }

  /** True if this publisher is a machine-verifiable oracle the loop watches. */
  isOracle(publisher: string): boolean {
    return this.byPublisher.has(publisher.toLowerCase());
  }

  /**
   * Handle one broadcast. No-op for non-oracle publishers. For an oracle
   * publisher: fetch the payload, POST it to /verify, and act on the report.
   * Never throws — all failures are caught and logged (a verify outage must not
   * take down the listener).
   */
  async onBroadcast(ev: BroadcastEvent): Promise<void> {
    const oracle = this.byPublisher.get(ev.publisher.toLowerCase());
    if (!oracle) return;

    try {
      await this.verifyBroadcast(oracle, ev);
    } catch (err) {
      console.error(
        kleur.red(
          `  ${kleur.gray(`[${timestamp()}]`)}  🔍 verify error (${oracle.name} ${shortHash(ev.payloadHash)}): ${(err as Error).message.slice(0, 200)}`,
        ),
      );
    }
  }

  private async verifyBroadcast(oracle: OracleEntry, ev: BroadcastEvent): Promise<void> {
    // 1. fetch the broadcast payload off-chain (chain only carries the hash).
    const archived = await this.archive.fetch(ev.payloadHash);
    if (!archived) {
      console.log(
        kleur.yellow(
          `  ${kleur.gray(`[${timestamp()}]`)}  🔍 ${oracle.name} ${shortHash(ev.payloadHash)} — payload not in archive, skipped`,
        ),
      );
      return;
    }

    // 2. POST the answer to the oracle's deterministic /verify endpoint.
    const report = await this.postVerify(oracle, archived.payload);
    if (!report) {
      console.log(
        kleur.yellow(
          `  ${kleur.gray(`[${timestamp()}]`)}  🔍 ${oracle.name} ${shortHash(ev.payloadHash)} — verify endpoint unreachable, skipped`,
        ),
      );
      return;
    }

    const prefix = `  ${kleur.gray(`[${timestamp()}]`)}  🔍 ${kleur.bold(oracle.name)} ${shortHash(ev.payloadHash)}`;

    // 3. act on the report.
    if (report.error) {
      // Registry / database unreachable on the oracle side. We cannot prove the
      // answer wrong, so this is INCONCLUSIVE — never a slash.
      console.log(`${prefix} — ${kleur.yellow("inconclusive — skipped")} ${kleur.dim(`(${report.error})`)}`);
      return;
    }

    if (report.verified) {
      console.log(`${prefix} — ${kleur.green("verified OK")}`);
      return;
    }

    // verified == false with no error → provably-wrong answer. Flag it.
    const fields = report.flaggable.map((f) => f.field).join(", ") || "(unspecified)";
    console.log(
      `${prefix} — ${kleur.red().bold("PROVABLY WRONG")} ${kleur.dim(`flaggable: [${fields}]`)}`,
    );
    for (const f of report.flaggable) {
      console.log(
        kleur.gray(
          `      └─ ${f.field}: claimed=${JSON.stringify(f.claimed)} actual=${JSON.stringify(f.actual)}`,
        ),
      );
    }

    await this.flag(oracle, ev, report);
  }

  /** POST {answer} to `${verifyUrl}/verify`. Returns null on transport failure. */
  private async postVerify(oracle: OracleEntry, answer: unknown): Promise<VerifyReport | null> {
    const url = `${oracle.verifyUrl.replace(/\/+$/, "")}/verify`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer }),
        signal: AbortSignal.timeout(15_000),
      });
      // The oracle returns 200 on a clean/flaggable verdict and 502 when its
      // own registry was unreachable — but in both cases the body is a valid
      // VerifyReport (with `error` set on the 502). Only a non-JSON / network
      // failure is a true transport miss.
      const body = (await res.json()) as VerifyReport;
      return body;
    } catch {
      return null;
    }
  }

  /**
   * File the flag (or dry-run-log it). FLAG_ENABLED gates the actual tx inside
   * OnchainClient.fileFlag — when false, that call logs `[dry-run] fileFlag…`.
   * Here we additionally emit an explicit DRY-RUN line so the would-be flag is
   * legible even without an on-chain signer configured.
   */
  private async flag(oracle: OracleEntry, ev: BroadcastEvent, report: VerifyReport): Promise<void> {
    const fields = report.flaggable.map((f) => f.field);

    if (!this.cfg.flagEnabled || !this.onchain) {
      const reason = !this.onchain ? "no signer configured" : "FLAG_ENABLED=false";
      console.log(
        kleur.yellow(
          `      ${kleur.bold("DRY-RUN:")} would fileFlag ${shortAddr(ev.publisher)} ${shortHash(ev.payloadHash)} ` +
            `— flaggable: [${fields.join(", ")}] ${kleur.dim(`(${reason})`)}`,
        ),
      );
      return;
    }

    // FLAG_ENABLED is true and a signer exists — file the FACTUAL flag on RE06.
    console.log(
      kleur.red(`      filing FACTUAL flag on ReputationEngine for ${oracle.name}…`),
    );
    await this.onchain.fileFlag(ev.publisher, ev.payloadHash);
  }
}
