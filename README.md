# byte-validator-agent

> **Status:** v0.1 (early). Event listener + state tracking only. On-chain score submission lands in the next release.

Autonomous AI-agent validator for the [Byte Protocol](https://www.payperbyte.io). Watches `DataStream` broadcasts on Arbitrum Sepolia, maintains per-publisher state, and (in upcoming releases) submits PQS (Proof-of-Quality) scores to the on-chain `PQSVerifier` with LLM-augmented anomaly detection.

This is the **agent-side** complement to the human-operated Rust indexer. Same on-chain economics (200 PPB minimum stake, VPS-weighted USDC rewards, 3-warning divergence-suspend), independent scoring logic so the two indexers' submissions converge by merit rather than copy-attack.

## Run

```bash
npm install -g byte-validator-agent
byte-validator-agent
```

You'll see live `BroadcastStreamed` events as they land on-chain, plus an in-memory rolling state per publisher (broadcast count, average interval, last-active timestamp).

## Roadmap

| Version | Scope |
|---|---|
| **0.1** (this release) | Event listener + per-publisher state tracking. No on-chain writes. |
| 0.2 | LLM-augmented anomaly detection (Claude + Ollama hybrid). Scoring computation. |
| 0.3 | On-chain `submitScore()` + `finalizeBatch()` submission per 24h epoch. Heartbeat + `claimRewards()`. |
| 0.4 | Commit-reveal score submission (pending PQSVerifier V2 contract upgrade). |
| 1.0 | Mainnet-ready. Audited. Tiered economics (human-multiplier, supervisor role) per DECISION_LOG 2026-05-13 commitment. |

## Environment

| Var | Default | Notes |
|---|---|---|
| `RPC_URL` | `https://arbitrum-sepolia-rpc.publicnode.com` | Primary RPC. publicnode is free + reliable. |
| `RPC_URL_FALLBACK` | `https://sepolia-rollup.arbitrum.io/rpc` | Used on transport-layer failures (rate-limit, timeout). |
| `VALIDATOR_PRIVATE_KEY` | — | Required for on-chain writes (next release). |
| `POLL_INTERVAL_MS` | `4000` | viem `watchEvent` polling interval. |
| `LOOKBACK_BLOCKS` | `500` | Historical broadcasts hydrated at startup. |
| `LLM_STRATEGY` | `hybrid` | `claude` / `ollama` / `hybrid`. Effective in 0.2+. |
| `ANTHROPIC_API_KEY` | — | Required when LLM_STRATEGY=claude or hybrid. |
| `OLLAMA_URL` | `http://localhost:11434` | Required when LLM_STRATEGY=ollama or hybrid. |

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                       Arbitrum Sepolia                            │
│                                                                   │
│    DataStream  ────emits────►  BroadcastStreamed event            │
│        ▲                              │                           │
│        │                              ▼                           │
│    streamBroadcast()         ┌──────────────────┐                 │
│                              │  byte-validator- │                 │
│                              │     agent        │                 │
│                              │                  │                 │
│                              │  • event listen  │                 │
│                              │  • state track   │                 │
│                              │  • [next] score  │                 │
│                              │  • [next] submit │                 │
│                              └──────────────────┘                 │
│                                       │                           │
│                                       ▼ (next release)            │
│   PQSVerifier.submitScore(pub, dispute, retention, fresh, rev)    │
│   PQSVerifier.finalizeBatch(n)                                    │
│   ValidatorRegistry.heartbeat()                                   │
│   ValidatorRegistry.claimRewards()                                │
└───────────────────────────────────────────────────────────────────┘
```

## License

MIT
