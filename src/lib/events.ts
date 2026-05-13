import {
  createPublicClient,
  http,
  type PublicClient,
  type Log,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import kleur from "kleur";
import { ADDRESSES, DATA_STREAM_ABI } from "./contracts.js";
import type { Config } from "./config.js";
import { PublisherState, type BroadcastEvent } from "./state.js";

export type OnBroadcast = (ev: BroadcastEvent) => void | Promise<void>;

export class BroadcastListener {
  readonly client: PublicClient;
  readonly state: PublisherState;
  private unwatch: (() => void) | null = null;
  private latestBlock: bigint = 0n;

  constructor(
    private cfg: Config,
    private onEvent: OnBroadcast,
  ) {
    this.client = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(cfg.rpcUrl, { batch: false, retryCount: 2 }),
    });
    this.state = new PublisherState();
  }

  async hydrateFromLookback(): Promise<number> {
    // Pull historic broadcasts from the last LOOKBACK_BLOCKS to bootstrap state.
    // Without this, freshness/cadence start at zero on every restart.
    const tip = await this.client.getBlockNumber();
    this.latestBlock = tip;
    const fromBlock = tip > this.cfg.lookbackBlocks ? tip - this.cfg.lookbackBlocks : 0n;

    const logs = await this.client.getLogs({
      address: ADDRESSES.DataStream as `0x${string}`,
      event: DATA_STREAM_ABI[0],
      fromBlock,
      toBlock: tip,
    });

    let count = 0;
    for (const log of logs) {
      const ev = decodeBroadcast(log);
      if (ev) {
        this.state.ingest(ev);
        count++;
      }
    }
    return count;
  }

  private polling = false;

  async start(): Promise<void> {
    // Manual getLogs polling loop. viem's watchEvent creates a server-side filter
    // (eth_newFilter) even with `poll: true`, which fails on stateless / load-balanced
    // RPCs like publicnode where filters expire between requests. eth_getLogs with
    // explicit block ranges has no such issue and works on any RPC.
    this.polling = true;
    void this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const tip = await this.client.getBlockNumber();
        if (tip > this.latestBlock) {
          const fromBlock = this.latestBlock + 1n;
          const logs = await this.client.getLogs({
            address: ADDRESSES.DataStream as `0x${string}`,
            event: DATA_STREAM_ABI[0],
            fromBlock,
            toBlock: tip,
          });
          for (const log of logs) {
            const ev = decodeBroadcast(log);
            if (!ev) continue;
            this.state.ingest(ev);
            try {
              await this.onEvent(ev);
            } catch (err) {
              console.error(kleur.red(`onEvent handler threw: ${(err as Error).message}`));
            }
          }
          this.latestBlock = tip;
        }
      } catch (err) {
        console.error(kleur.yellow(`poll error (will retry): ${(err as Error).message}`));
      }
      await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs));
    }
  }

  stop(): void {
    this.polling = false;
    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }
  }

  getLatestBlock(): bigint {
    return this.latestBlock;
  }
}

function decodeBroadcast(log: Log): BroadcastEvent | null {
  // viem auto-decodes when we pass `event` to getLogs/watchEvent.
  // The decoded fields land on `log.args`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = (log as any).args as
    | {
        publisher: `0x${string}`;
        subscriberCount: bigint;
        payloadHash: `0x${string}`;
        payloadLength: bigint;
        totalSubscriberFees: bigint;
        timestamp: bigint;
      }
    | undefined;
  if (!a) return null;

  return {
    publisher: a.publisher,
    subscriberCount: Number(a.subscriberCount),
    payloadHash: a.payloadHash,
    payloadLength: Number(a.payloadLength),
    totalSubscriberFees: a.totalSubscriberFees,
    timestamp: Number(a.timestamp),
    blockNumber: log.blockNumber ?? 0n,
    txHash: log.transactionHash ?? ("0x" as `0x${string}`),
  };
}
