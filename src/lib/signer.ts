// Wallet + write client setup. Built from VALIDATOR_PRIVATE_KEY. Read client uses
// the same RPC as the listener (publicnode) — write client uses the fallback
// (sepolia-rollup.arbitrum.io) to avoid head-of-line blocking when the read
// client is mid-getLogs.

import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import type { Config } from "./config.js";

export interface Signer {
  address: Address;
  account: PrivateKeyAccount; // pass to simulateContract so the request carries the full signer
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
}

export function buildSigner(cfg: Config): Signer {
  if (!cfg.validatorKey) {
    throw new Error(
      "VALIDATOR_PRIVATE_KEY is required for on-chain ops. Run `npm run genkey` to mint one.",
    );
  }
  const account = privateKeyToAccount(cfg.validatorKey);
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(cfg.rpcUrl),
  });
  const walletClient = createWalletClient({
    chain: arbitrumSepolia,
    account,
    transport: http(cfg.rpcUrlFallback),
  });
  return { address: account.address, account, publicClient, walletClient };
}
