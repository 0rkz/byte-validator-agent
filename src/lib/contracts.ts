// Contract addresses on Arbitrum Sepolia (chain id 421614).
// Mirrors the canonical deployments JSON in the byte-protocol-contracts repo
// — duplicated here for distribution autonomy so this agent runs without a
// dep on the contracts repo at runtime.
export const ARBITRUM_SEPOLIA_ID = 421614;

// v0.6 bundled redeploy 2026-05-20 (chain 421614). v0.5 is PAUSED.
// DataStream, DataRegistry, ValidatorRegistry, ReputationEngine, and USDC
// (now MockUSDC3009) migrated to fresh v0.6 addresses; StreamSubscription →
// StreamSubscriptionV0_6. PQSVerifier + PPBToken are reused from v0.5.
export const ADDRESSES = {
  DataStream: "0x8a20759a89f037B9c2062758f2789A1f858b0b27",
  DataRegistry: "0x85868CEF6db4531c8c6E378b725BC2813233e014",
  ValidatorRegistry: "0x7b3f9DA761E2D82FF4faaFfd4e36926049035c4A",
  PQSVerifier: "0xD7c8423296a6E2Dd36466AC0e41884846a27cdE9",
  ReputationEngine: "0xaF7cd2544B742Ea9Df439f0f5DD43Ab02Cbb9b56",
  PPBToken: "0x37a86eD3ee87109ff8cF96B3fe45c70a2ebB69f3",
  MockUSDC: "0x1c16659aeb3aE28467E90348fAAB8874a0D3A4d3",
  StreamSubscription: "0x713d1020C28C60A8735a77743138A78B77Dbb9b2",
} as const;

// ─── ABI fragments ──────────────────────────────────────────────────────────
// Minimal — only the events + functions the agent-val needs across its lifetime.
// Full ABIs come from the byte-protocol-contracts Foundry build output
// (out/<Name>.sol/<Name>.json).

// DataStream — broadcast event surface
export const DATA_STREAM_ABI = [
  {
    type: "event",
    name: "BroadcastStreamed",
    inputs: [
      { name: "publisher", type: "address", indexed: true },
      { name: "subscriberCount", type: "uint256", indexed: false },
      { name: "payloadHash", type: "bytes32", indexed: false },
      { name: "payloadLength", type: "uint256", indexed: false },
      { name: "totalSubscriberFees", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;

// ValidatorRegistry — registration + heartbeat + reward path
export const VALIDATOR_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "stake", type: "uint256" },
      { name: "endpoint", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "heartbeat",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "claimRewards",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "topUpStake",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    // v0.6 (VR06) — the v0.5 public `validators` mapping auto-getter was
    // dropped; VR06 exposes `getValidator(address)` which returns the full
    // Validator struct as a single tuple. Struct layout matches
    // ValidatorRegistryV0_6.Validator exactly (13 fields, order-significant).
    type: "function",
    name: "getValidator",
    stateMutability: "view",
    inputs: [{ name: "operator", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "operator", type: "address" },
          { name: "stake", type: "uint256" },
          { name: "registeredAt", type: "uint256" },
          { name: "lastHeartbeat", type: "uint256" },
          { name: "heartbeatCount", type: "uint256" },
          { name: "missedHeartbeats", type: "uint256" },
          { name: "slashCount", type: "uint256" },
          { name: "tier", type: "uint8" },
          { name: "vpsScore", type: "uint256" },
          { name: "uptimeBps", type: "uint256" },
          { name: "endpoint", type: "string" },
          { name: "active", type: "bool" },
          { name: "lastClaimedEpoch", type: "uint256" },
        ],
      },
    ],
  },
  {
    // v0.6 (VR06) — total registered validators (validatorList length).
    type: "function",
    name: "getValidatorCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// PQSVerifier — score submission + batch finalization + indexer admin
export const PQS_VERIFIER_ABI = [
  {
    type: "function",
    name: "submitScore",
    stateMutability: "nonpayable",
    inputs: [
      { name: "publisher", type: "address" },
      { name: "disputeScore", type: "uint256" },
      { name: "retentionScore", type: "uint256" },
      { name: "freshnessScore", type: "uint256" },
      { name: "revenueQuality", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeBatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "publisherCount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "registerIndexer",
    stateMutability: "nonpayable",
    inputs: [{ name: "indexer", type: "address" }],
    outputs: [],
  },
  {
    // Mirrors PQSVerifier.PQSScore struct exactly (6 fields, order-significant).
    // The prior fragment here was stale (composite/submittedAt/batchId).
    type: "function",
    name: "getVerifiedPQS",
    stateMutability: "view",
    inputs: [{ name: "publisher", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "disputeScore", type: "uint256" },
          { name: "retentionScore", type: "uint256" },
          { name: "freshnessScore", type: "uint256" },
          { name: "revenueQuality", type: "uint256" },
          { name: "composite", type: "uint256" },
          { name: "timestamp", type: "uint256" },
        ],
      },
    ],
  },
  {
    // Mirrors PQSVerifier.Indexer struct exactly (7 fields, order-significant).
    // The prior fragment here was stale: it omitted `registeredAt` +
    // `totalSubmissions` and had warningCount/lastSubmission transposed.
    type: "function",
    name: "indexers",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "suspended", type: "bool" },
      { name: "registeredAt", type: "uint256" },
      { name: "lastSubmission", type: "uint256" },
      { name: "warningCount", type: "uint256" },
      { name: "lastWarningReset", type: "uint256" },
      { name: "totalSubmissions", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getIndexerCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getActiveIndexerCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "MAX_INDEXERS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "BATCH_INTERVAL",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ReputationEngine (v0.6, RE06 — 0xaF7cd2…9b56) — file flags.
//
// fileFlag(publisher, messageHash, flagType): opens a dispute against a
// broadcast. The agent files FlagType.FACTUAL for a deterministically-proven
// wrong oracle answer — a provable fact mismatch — which then auto-upholds via
// defaultUphold() once the 24h optimistic window lapses (no arbitration).
// flagType enum (ReputationEngineV0_6.FlagType): FACTUAL=0, BLOAT=1,
// QUALITY=2, FABRICATION=3.
//
// NOTE: v0.5's public `getTier(address)→uint8` getter has no equivalent on
// RE06 — tier reads now live on DataRegistry, and RE06 only exposes the
// write-side `updateTier`. The stale `getTier` fragment was removed; the
// agent never called it, so this is a no-op for runtime behaviour.
export const REPUTATION_ENGINE_ABI = [
  {
    type: "function",
    name: "fileFlag",
    stateMutability: "nonpayable",
    inputs: [
      { name: "publisher", type: "address" },
      { name: "messageHash", type: "bytes32" },
      { name: "flagType", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

// ReputationEngineV0_6.FlagType enum — the dispute classification fileFlag takes.
export const FLAG_TYPE = {
  FACTUAL: 0,
  BLOAT: 1,
  QUALITY: 2,
  FABRICATION: 3,
} as const;

// PPBToken (standard ERC-20 read + approve surface)
export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;
