import "dotenv/config";

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
    payloadArchiveDir: getEnv("PAYLOAD_ARCHIVE_DIR", "/home/orkz/byte/data-feeds/archive"),
    endpointUrl: getEnv("ENDPOINT_URL", "https://payperbyte.io/validator/agent-v01"),
    llmStrategy: (getEnv("LLM_STRATEGY", "hybrid") as Config["llmStrategy"]),
    anthropicApiKey: getOptional("ANTHROPIC_API_KEY"),
    ollamaUrl: getEnv("OLLAMA_URL", "http://localhost:11434"),
    logLevel: (getEnv("LOG_LEVEL", "info") as Config["logLevel"]),
  };
}
