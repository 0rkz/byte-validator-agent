// Contract addresses on Arbitrum Sepolia (chain id 421614).
// Mirrors /home/orkz/byte/contracts/deployments/arbitrum-sepolia.json — duplicated
// here for distribution autonomy (see DECISION_LOG entry on shared-contracts deferral).
export const ARBITRUM_SEPOLIA_ID = 421614;

export const ADDRESSES = {
  DataStream: "0x7E12bF2B0d43B9Ea0Bc37A06EcAC36b810351F35",
  DataRegistry: "0x05D89769A066549115b1B4408bFf899D2737F30b",
  ValidatorRegistry: "0xEd0Ffa5201994cAC3e17566f445C5D0d0103F016",
  PQSVerifier: "0x67F97fc5E45889d3BFf7dcBA114Ca210f1896b0d",
  ReputationEngine: "0x3b842Aac0b932D546ed6C87895350EaeF0bEbcc3",
  PPBToken: "0x37a86eD3ee87109ff8cF96B3fe45c70a2ebB69f3",
  MockUSDC: "0x93BfEbF99AF028ee57B138Fd17a26cAe76a01Fd2",
  StreamSubscription: "0xcd3521E655ED4070BD95740cf610E955965B575d",
} as const;

// ─── ABI fragments ──────────────────────────────────────────────────────────
// Minimal — only the events + functions the agent-val needs across its lifetime.
// Full ABIs live at /home/orkz/byte/contracts/out/<Name>.sol/<Name>.json (Foundry build).

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
    type: "function",
    name: "validators",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "operator", type: "address" },
      { name: "stake", type: "uint256" },
      { name: "registeredAt", type: "uint256" },
      { name: "lastHeartbeat", type: "uint256" },
      { name: "heartbeatCount", type: "uint256" },
      { name: "missedHeartbeats", type: "uint256" },
      { name: "slashCount", type: "uint256" },
      { name: "tier", type: "uint8" },
    ],
  },
] as const;

// PQSVerifier — score submission + batch finalization
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
    name: "getVerifiedPQS",
    stateMutability: "view",
    inputs: [{ name: "publisher", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "composite", type: "uint256" },
          { name: "submittedAt", type: "uint256" },
          { name: "batchId", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getIndexerCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ReputationEngine — read current tier + composite PQS
export const REPUTATION_ENGINE_ABI = [
  {
    type: "function",
    name: "getTier",
    stateMutability: "view",
    inputs: [{ name: "publisher", type: "address" }],
    outputs: [{ type: "uint8" }],
  },
] as const;

// PPBToken (standard ERC-20 read surface)
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
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
