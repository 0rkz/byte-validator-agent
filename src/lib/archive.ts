// Payload archive reader. Locally, the broadcast helper writes every payload to
// PAYLOAD_ARCHIVE_DIR keyed by hash. Remotely, the discovery-api at
// api.payperbyte.io/payload/{hash} serves the same content.
//
// The validator-agent reads payloads to feed the LLM anomaly detector — chain
// only has the hash, so this is the off-chain lookup.

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { Config } from "./config.js";

export interface ArchivedPayload {
  payload_hash: string;
  payload_length: number;
  publisher: string;
  tx_hash: string;
  archived_at: string;
  payload: unknown; // the actual user payload, shape varies by publisher
}

export class PayloadArchive {
  constructor(private cfg: Config) {}

  async fetch(hash: `0x${string}`): Promise<ArchivedPayload | null> {
    const key = hash.startsWith("0x") ? hash.slice(2) : hash;
    const local = await this.tryLocal(key);
    if (local) return local;
    return this.tryRemote(hash);
  }

  /** Fetch multiple, most-recent-first ordering preserved. Returns nulls for misses. */
  async fetchMany(hashes: `0x${string}`[]): Promise<(ArchivedPayload | null)[]> {
    return Promise.all(hashes.map((h) => this.fetch(h)));
  }

  private async tryLocal(key: string): Promise<ArchivedPayload | null> {
    const path = join(this.cfg.payloadArchiveDir, `${key}.json`);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as ArchivedPayload;
    } catch {
      return null;
    }
  }

  private async tryRemote(hash: `0x${string}`): Promise<ArchivedPayload | null> {
    try {
      const res = await fetch(`https://api.payperbyte.io/payload/${hash}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as ArchivedPayload;
    } catch {
      return null;
    }
  }
}
