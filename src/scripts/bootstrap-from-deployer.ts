#!/usr/bin/env node
/**
 * One-shot admin bootstrap: fund the agent address and register it as an indexer.
 *
 * Run by the PQSVerifier admin (deployer wallet). Combines what would otherwise
 * be three manual transactions:
 *   1. transfer ETH (gas) to agent — if balance below threshold
 *   2. transfer PPB (stake) to agent — if balance below threshold
 *   3. PQSVerifier.registerIndexer(agent) — if not already registered
 *
 * Idempotent: every step is gated by an on-chain state check, so re-running is
 * safe (skips anything already done).
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npm run bootstrap-from-deployer -- 0xAgentAddress
 *
 * The agent address is read from the CLI arg, or from VALIDATOR_ADDRESS in .env
 * if no arg given.
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { ADDRESSES, ERC20_ABI, PQS_VERIFIER_ABI } from "../lib/contracts.js";

const ETH_TOPUP = parseEther("0.01"); // ~7 days of hourly heartbeats + daily submits on L2
const PPB_TOPUP = parseUnits("200", 18); // exactly the stake required
const ETH_THRESHOLD = parseEther("0.005"); // top up only if below this
const PPB_THRESHOLD = parseUnits("200", 18); // top up only if below stake

async function main(): Promise<void> {
  const cliArg = process.argv[2];
  const envAddr = process.env.VALIDATOR_ADDRESS;
  const target = (cliArg ?? envAddr ?? "").trim();
  if (!target || !isAddress(target)) {
    console.error(
      "usage: bootstrap-from-deployer.ts <agentAddress>\n  (or set VALIDATOR_ADDRESS in .env)",
    );
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
  const pc = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
  const wc = createWalletClient({ chain: arbitrumSepolia, account, transport: http(rpc) });

  console.log(`deployer: ${account.address}`);
  console.log(`agent:    ${target}`);
  console.log();

  // Verify deployer == admin
  const onchainAdmin = (await pc.readContract({
    address: ADDRESSES.PQSVerifier as Address,
    abi: PQS_VERIFIER_ABI,
    functionName: "admin",
  })) as Address;
  if (onchainAdmin.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`signer is not PQSVerifier admin (on-chain admin = ${onchainAdmin})`);
    process.exit(1);
  }

  // ─── Step 1: ETH top-up ─────────────────────────────────────────────────
  const agentEth = await pc.getBalance({ address: target as Address });
  console.log(`step 1: ETH balance = ${formatEther(agentEth)} ETH`);
  if (agentEth < ETH_THRESHOLD) {
    const hash = (await wc.sendTransaction({ to: target as Address, value: ETH_TOPUP })) as Hash;
    console.log(`        → sending ${formatEther(ETH_TOPUP)} ETH: ${hash}`);
    await pc.waitForTransactionReceipt({ hash });
    console.log(`        ✓ ETH topped up`);
  } else {
    console.log(`        (skip — above threshold ${formatEther(ETH_THRESHOLD)})`);
  }

  // ─── Step 2: PPB top-up ─────────────────────────────────────────────────
  const agentPpb = (await pc.readContract({
    address: ADDRESSES.PPBToken as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [target as Address],
  })) as bigint;
  console.log(`step 2: PPB balance = ${formatUnits(agentPpb, 18)} PPB`);
  if (agentPpb < PPB_THRESHOLD) {
    const transferAbi = [
      {
        type: "function",
        name: "transfer",
        stateMutability: "nonpayable",
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
      },
    ] as const;
    const { request } = await pc.simulateContract({
      address: ADDRESSES.PPBToken as Address,
      abi: transferAbi,
      functionName: "transfer",
      args: [target as Address, PPB_TOPUP],
      account,
    });
    const hash = (await wc.writeContract(request)) as Hash;
    console.log(`        → transfer ${formatUnits(PPB_TOPUP, 18)} PPB: ${hash}`);
    await pc.waitForTransactionReceipt({ hash });
    console.log(`        ✓ PPB topped up`);
  } else {
    console.log(`        (skip — above threshold ${formatUnits(PPB_THRESHOLD, 18)})`);
  }

  // ─── Step 3: registerIndexer ────────────────────────────────────────────
  const existing = (await pc.readContract({
    address: ADDRESSES.PQSVerifier as Address,
    abi: PQS_VERIFIER_ABI,
    functionName: "indexers",
    args: [target as Address],
  })) as readonly [boolean, boolean, bigint, bigint, bigint, bigint, bigint];
  console.log(`step 3: indexer.registered = ${existing[0]}`);
  if (!existing[0]) {
    const { request } = await pc.simulateContract({
      address: ADDRESSES.PQSVerifier as Address,
      abi: PQS_VERIFIER_ABI,
      functionName: "registerIndexer",
      args: [target as Address],
      account,
    });
    const hash = (await wc.writeContract(request)) as Hash;
    console.log(`        → registerIndexer: ${hash}`);
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      console.error(`        ✗ tx reverted in block ${receipt.blockNumber}`);
      process.exit(1);
    }
    console.log(`        ✓ registered as indexer (block ${receipt.blockNumber})`);
  } else {
    console.log(`        (skip — already registered, suspended=${existing[1]})`);
  }

  console.log();
  console.log(`bootstrap complete — agent is funded and indexer-registered.`);
}

main().catch((err) => {
  console.error(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
