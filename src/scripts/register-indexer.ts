#!/usr/bin/env node
/**
 * Admin tool: register a new indexer address on PQSVerifier.
 *
 * Run by the PQSVerifier admin (currently the deployer wallet). The admin's
 * private key is read from DEPLOYER_PRIVATE_KEY env var — DO NOT put this in
 * .env (which is shared with the agent). Pass it on the command line:
 *
 *   DEPLOYER_PRIVATE_KEY=0x... npx tsx scripts/register-indexer.ts 0xAgentAddress
 *
 * Idempotent: refuses if the target is already registered.
 */

import { createPublicClient, createWalletClient, http, isAddress, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { ADDRESSES, PQS_VERIFIER_ABI } from "../lib/contracts.js";

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target || !isAddress(target)) {
    console.error("usage: register-indexer.ts <agentAddress>");
    process.exit(1);
  }
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rawKey) {
    console.error("DEPLOYER_PRIVATE_KEY env var required (do not commit this).");
    process.exit(1);
  }
  const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    console.error("DEPLOYER_PRIVATE_KEY must be 32-byte hex");
    process.exit(1);
  }

  const rpc = process.env.RPC_URL ?? "https://arbitrum-sepolia-rpc.publicnode.com";
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
  const walletClient = createWalletClient({ chain: arbitrumSepolia, account, transport: http(rpc) });

  console.log(`admin:  ${account.address}`);
  console.log(`target: ${target}`);
  console.log();

  // verify admin
  const onchainAdmin = (await publicClient.readContract({
    address: ADDRESSES.PQSVerifier as Address,
    abi: PQS_VERIFIER_ABI,
    functionName: "admin",
  })) as Address;
  if (onchainAdmin.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`signer is not PQSVerifier admin (on-chain admin = ${onchainAdmin})`);
    process.exit(1);
  }

  // idempotency check
  const existing = (await publicClient.readContract({
    address: ADDRESSES.PQSVerifier as Address,
    abi: PQS_VERIFIER_ABI,
    functionName: "indexers",
    args: [target as Address],
  })) as readonly [boolean, boolean, bigint, bigint, bigint];
  if (existing[0]) {
    console.log(`already registered (suspended=${existing[1]})`);
    process.exit(0);
  }

  // simulate then send
  const { request } = await publicClient.simulateContract({
    address: ADDRESSES.PQSVerifier as Address,
    abi: PQS_VERIFIER_ABI,
    functionName: "registerIndexer",
    args: [target as Address],
    account,
  });
  const hash = (await walletClient.writeContract(request)) as Hash;
  console.log(`tx submitted: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.error(`tx reverted in block ${receipt.blockNumber}`);
    process.exit(1);
  }
  console.log(`✓ registered (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`);
}

main().catch((err) => {
  console.error(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
