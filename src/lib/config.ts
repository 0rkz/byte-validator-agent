import "dotenv/config";

/**
 * A machine-verifiable oracle the validator watches. When a broadcast from
 * `publisher` is observed, the agent fetches the payload and POSTs it to
 * `verifyUrl`/verify; a `verified == false` report is grounds to fileFlag.
 */
export interface OracleEntry {
  name: string;
  publisher: `0x${string}`;
  verifyUrl: string; // base URL — the agent POSTs to `${verifyUrl}/verify`
}

export interface Config {
  rpcUrl: string;
  rpcUrlFallback: string;
  validatorKey: `0x${string}` | null;
  pollIntervalMs: number;
  lookbackBlocks: bigint;
  payloadArchiveDir: string;
  endpointUrl: string;
  llmStrategy: "claude" | "ollama" | "hybrid";
  anthropicApiKey: string | null;
  ollamaUrl: string;
  scoringIntervalMs: number;
  // v0.3 on-chain
  stakeAmountWei: bigint; // PPB tokens to stake at register()
  heartbeatIntervalMs: number;
  submitIntervalMs: number;
  autoRegister: boolean;
  heartbeatEnabled: boolean;
  submitEnabled: boolean;
  // v0.4 oracle-answer verification loop
  flagEnabled: boolean;
  oracles: OracleEntry[]; // publisher (lowercased) → verify endpoint
  logLevel: "debug" | "info" | "warn" | "error";
}

function getEnv(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`required env var ${key} is not set`);
}

function getOptional(key: string): string | null {
  const v = process.env[key];
  return v && v !== "" ? v : null;
}

function asHexKey(raw: string | null): `0x${string}` | null {
  if (!raw) return null;
  const norm = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(norm)) {
    throw new Error(`VALIDATOR_PRIVATE_KEY must be 32-byte hex (got ${norm.length} chars)`);
  }
  return norm as `0x${string}`;
}

/**
 * Oracle registry — publisher address → /verify endpoint base URL.
 * The two machine-verifiable fact oracles ship as defaults; verify URLs are
 * env-overridable (PKG_FACTS_VERIFY_URL / CVE_FACTS_VERIFY_URL) so the loop
 * can point at staging / containerized endpoints without a code change.
 */
function loadOracles(): OracleEntry[] {
  return [
    {
      name: "pkg-facts",
      publisher: "0x14CF5b197acd9fe42B51570D812142B8Eb7cE131",
      verifyUrl: getEnv("PKG_FACTS_VERIFY_URL", "http://localhost:8082"),
    },
    {
      name: "cve-facts",
      publisher: "0x2c95b5Af64b305034caea44f13A546D1377B32aC",
      verifyUrl: getEnv("CVE_FACTS_VERIFY_URL", "http://localhost:8083"),
    },
  ];
}

export function loadConfig(): Config {
  return {
    rpcUrl: getEnv("RPC_URL", "https://arbitrum-sepolia-rpc.publicnode.com"),
    rpcUrlFallback: getEnv("RPC_URL_FALLBACK", "https://sepolia-rollup.arbitrum.io/rpc"),
    validatorKey: asHexKey(getOptional("VALIDATOR_PRIVATE_KEY")),
    pollIntervalMs: parseInt(getEnv("POLL_INTERVAL_MS", "4000"), 10),
    // 50000 blocks on Arbitrum Sepolia ≈ 3.5 hours of history — captures every
    // active publisher at least once at their natural cadence. publicnode handles
    // single-call getLogs over this range fine.
    lookbackBlocks: BigInt(getEnv("LOOKBACK_BLOCKS", "50000")),
    payloadArchiveDir: getEnv("PAYLOAD_ARCHIVE_DIR", "../data-feeds/archive"),
    endpointUrl: getEnv("ENDPOINT_URL", "https://payperbyte.io/validator/agent-v01"),
    llmStrategy: (getEnv("LLM_STRATEGY", "hybrid") as Config["llmStrategy"]),
    anthropicApiKey: getOptional("ANTHROPIC_API_KEY"),
    ollamaUrl: getEnv("OLLAMA_URL", "http://localhost:11434"),
    // 60s for dev/testing — easy to verify scoring loop fires. The on-chain submit
    // loop runs on its own SUBMIT_INTERVAL_MS (default 24h, matching BATCH_INTERVAL).
    scoringIntervalMs: parseInt(getEnv("SCORING_INTERVAL_MS", "60000"), 10),
    // v0.3 on-chain config
    stakeAmountWei: BigInt(getEnv("STAKE_AMOUNT_WEI", "200000000000000000000")), // 200 PPB (18 decimals)
    // ValidatorRegistry.HEARTBEAT_INTERVAL = 1h; we beat slightly under that.
    heartbeatIntervalMs: parseInt(getEnv("HEARTBEAT_INTERVAL_MS", "3300000"), 10), // 55 min
    submitIntervalMs: parseInt(getEnv("SUBMIT_INTERVAL_MS", "86400000"), 10), // 24h
    autoRegister: getEnv("AUTO_REGISTER", "false") === "true",
    heartbeatEnabled: getEnv("HEARTBEAT_ENABLED", "false") === "true",
    submitEnabled: getEnv("SUBMIT_ENABLED", "false") === "true",
    // v0.4 oracle-answer verification loop. Default OFF: when false the loop
    // logs the flag it WOULD file (dry-run) and sends no transaction. Flip to
    // true only after the auto-flag path has been verified end-to-end.
    flagEnabled: getEnv("FLAG_ENABLED", "false") === "true",
    oracles: loadOracles(),
    logLevel: (getEnv("LOG_LEVEL", "info") as Config["logLevel"]),
  };
}
