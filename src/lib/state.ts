// In-memory per-publisher state. Built up from BroadcastStreamed events,
// drained at scoring time (next session's work). No persistence in v0.1 —
// the agent reconstructs state from a configurable lookback window each restart.

export interface BroadcastEvent {
  publisher: `0x${string}`;
  subscriberCount: number;
  payloadHash: `0x${string}`;
  payloadLength: number;
  totalSubscriberFees: bigint;
  timestamp: number; // unix seconds, from event payload
  blockNumber: bigint;
  txHash: `0x${string}`;
}

export interface PublisherSnapshot {
  publisher: `0x${string}`;
  broadcastCount: number;
  lastBroadcast: number; // unix seconds
  payloadLengths: number[]; // recent window, capped
  subscriberCounts: number[]; // recent window, capped
  intervals: number[]; // gaps between consecutive broadcasts, capped
  totalFees: bigint;
}

const WINDOW_SIZE = 60; // rolling window per metric — enough for a 24h scoring window at ~5min cadence

export class PublisherState {
  private byPublisher = new Map<`0x${string}`, PublisherSnapshot>();

  ingest(ev: BroadcastEvent): PublisherSnapshot {
    const key = ev.publisher.toLowerCase() as `0x${string}`;
    const prev = this.byPublisher.get(key);

    if (!prev) {
      const snap: PublisherSnapshot = {
        publisher: ev.publisher,
        broadcastCount: 1,
        lastBroadcast: ev.timestamp,
        payloadLengths: [ev.payloadLength],
        subscriberCounts: [ev.subscriberCount],
        intervals: [],
        totalFees: ev.totalSubscriberFees,
      };
      this.byPublisher.set(key, snap);
      return snap;
    }

    const interval = ev.timestamp - prev.lastBroadcast;
    const snap: PublisherSnapshot = {
      publisher: ev.publisher,
      broadcastCount: prev.broadcastCount + 1,
      lastBroadcast: ev.timestamp,
      payloadLengths: pushCapped(prev.payloadLengths, ev.payloadLength),
      subscriberCounts: pushCapped(prev.subscriberCounts, ev.subscriberCount),
      intervals: pushCapped(prev.intervals, interval),
      totalFees: prev.totalFees + ev.totalSubscriberFees,
    };
    this.byPublisher.set(key, snap);
    return snap;
  }

  snapshot(publisher: `0x${string}`): PublisherSnapshot | undefined {
    return this.byPublisher.get(publisher.toLowerCase() as `0x${string}`);
  }

  all(): PublisherSnapshot[] {
    return Array.from(this.byPublisher.values());
  }
}

function pushCapped<T>(arr: T[], next: T): T[] {
  const out = [...arr, next];
  return out.length > WINDOW_SIZE ? out.slice(out.length - WINDOW_SIZE) : out;
}
