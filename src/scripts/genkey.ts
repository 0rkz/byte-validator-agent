#!/usr/bin/env node
/**
 * One-shot wallet generator for the agent's on-chain identity.
 *
 * Generates a fresh secp256k1 key, prints the address, and appends
 *   VALIDATOR_PRIVATE_KEY=0x...
 *   VALIDATOR_ADDRESS=0x...
 * to .env (creating it from .env.example if absent). Refuses to overwrite an
 * existing VALIDATOR_PRIVATE_KEY — re-running is safe.
 *
 * Usage:
 *   npx tsx scripts/genkey.ts        # dev (from source)
 *   node dist/scripts/genkey.js      # after build
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync, chmodSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env");
const EXAMPLE_PATH = resolve(process.cwd(), ".env.example");

function readEnv(): string {
  if (!existsSync(ENV_PATH)) {
    if (existsSync(EXAMPLE_PATH)) {
      copyFileSync(EXAMPLE_PATH, ENV_PATH);
      chmodSync(ENV_PATH, 0o600);
      console.log(`  created .env from .env.example`);
    } else {
      writeFileSync(ENV_PATH, "", { mode: 0o600 });
    }
  }
  return readFileSync(ENV_PATH, "utf8");
}

function hasKey(env: string, name: string): boolean {
  return new RegExp(`^${name}=.+$`, "m").test(env);
}

function main(): void {
  const env = readEnv();
  if (hasKey(env, "VALIDATOR_PRIVATE_KEY")) {
    console.error(
      "  VALIDATOR_PRIVATE_KEY is already set in .env. Refusing to overwrite.\n" +
        "  If you want a fresh wallet, manually remove the line first.",
    );
    process.exit(1);
  }

  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);

  const appended =
    (env.endsWith("\n") || env.length === 0 ? "" : "\n") +
    `\n# Agent wallet (generated ${new Date().toISOString()})\n` +
    `VALIDATOR_PRIVATE_KEY=${pk}\n` +
    `VALIDATOR_ADDRESS=${account.address}\n`;
  writeFileSync(ENV_PATH, env + appended);
  chmodSync(ENV_PATH, 0o600);

  console.log(`  ✓ wallet generated`);
  console.log(`    address: ${account.address}`);
  console.log(`    .env:    ${ENV_PATH} (mode 0600)`);
  console.log();
  console.log(`  Next steps:`);
  console.log(`    1. Fund this address on Arbitrum Sepolia:`);
  console.log(`         ~0.05 ETH for gas`);
  console.log(`         200 PPB for stake (PPBToken 0x37a86e…69f3)`);
  console.log(`    2. Ask the PQSVerifier admin to call registerIndexer(${account.address})`);
  console.log(`    3. Set AUTO_REGISTER=true in .env and start the agent`);
}

main();
