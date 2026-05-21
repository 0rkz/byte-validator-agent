// On-chain writes: register, heartbeat, submitScore, claimRewards.
//
// Every write goes through a single `execute()` helper that:
//   - dry-runs when the *_ENABLED flag is false (logs the would-be tx, no send)
//   - simulates first (catches reverts before burning gas)
//   - waits for receipt and verifies status === "success"
//
// finalizeBatch() is intentionally NOT wired in v0.3 — agent stays a submitter-only.

import type { Address, Hash, TransactionReceipt } from "viem";
import { formatEther, formatUnits } from "viem";
import kleur from "kleur";
import type { Config } from "./config.js";
import type { Signer } from "./signer.js";
import type { ContractInputs } from "./scoring.js";
import {
  ADDRESSES,
  ERC20_ABI,
  PQS_VERIFIER_ABI,
  REPUTATION_ENGINE_ABI,
  VALIDATOR_REGISTRY_ABI,
  FLAG_TYPE,
} from "./contracts.js";

export interface RegistrationStatus {
  isValidator: boolean;
  stake: bigint;
  isIndexer: boolean;
  indexerSuspended: boolean;
}

export class OnchainClient {
  private lastUsedNonce: number | null = null;
  constructor(private cfg: Config, private signer: Signer) {}

  // ─── state reads ──────────────────────────────────────────────────────────

  async readStatus(): Promise<RegistrationStatus> {
    const [validatorRecord, indexerRecord] = await Promise.all([
      this.signer.publicClient.readContract({
        address: ADDRESSES.ValidatorRegistry as Address,
        abi: VALIDATOR_REGISTRY_ABI,
        functionName: "validators",
        args: [this.signer.address],
      }) as Promise<readonly [Address, bigint, bigint, bigint, bigint, bigint, bigint, number]>,
      this.signer.publicClient.readContract({
        address: ADDRESSES.PQSVerifier as Address,
        abi: PQS_VERIFIER_ABI,
        functionName: "indexers",
        args: [this.signer.address],
      }) as Promise<readonly [boolean, boolean, bigint, bigint, bigint]>,
    ]);
    return {
      isValidator: validatorRecord[2] > 0n, // registeredAt > 0
      stake: validatorRecord[1],
      isIndexer: indexerRecord[0],
      indexerSuspended: indexerRecord[1],
    };
  }

  async readBalance(): Promise<{ eth: bigint; ppb: bigint }> {
    const [eth, ppb] = await Promise.all([
      this.signer.publicClient.getBalance({ address: this.signer.address }),
      this.signer.publicClient.readContract({
        address: ADDRESSES.PPBToken as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [this.signer.address],
      }) as Promise<bigint>,
    ]);
    return { eth, ppb };
  }

  async readAllowance(spender: Address): Promise<bigint> {
    return (await this.signer.publicClient.readContract({
      address: ADDRESSES.PPBToken as Address,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [this.signer.address, spender],
    })) as bigint;
  }

  // ─── writes ───────────────────────────────────────────────────────────────

  /** First-time validator registration: approve PPB then register(). Idempotent. */
  async ensureRegistered(): Promise<{ skipped: boolean; reason?: string }> {
    if (!this.cfg.autoRegister) return { skipped: true, reason: "AUTO_REGISTER=false" };
    const status = await this.readStatus();
    if (status.isValidator) {
      return { skipped: true, reason: `already validator (stake=${formatUnits(status.stake, 18)} PPB)` };
    }
    const bal = await this.readBalance();
    if (bal.ppb < this.cfg.stakeAmountWei) {
      throw new Error(
        `insufficient PPB: have ${formatUnits(bal.ppb, 18)}, need ${formatUnits(this.cfg.stakeAmountWei, 18)}`,
      );
    }
    if (bal.eth < 1_000_000_000_000_000n) {
      throw new Error(`insufficient ETH for gas: have ${formatEther(bal.eth)}`);
    }

    // 1. approve if needed
    const allowance = await this.readAllowance(ADDRESSES.ValidatorRegistry as Address);
    if (allowance < this.cfg.stakeAmountWei) {
      await this.execute({
        label: "approve(ValidatorRegistry, stake)",
        address: ADDRESSES.PPBToken as Address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ADDRESSES.ValidatorRegistry, this.cfg.stakeAmountWei] as const,
        enabled: true, // approve is gated by autoRegister already
      });
    }

    // 2. register
    await this.execute({
      label: `register(${formatUnits(this.cfg.stakeAmountWei, 18)} PPB, "${this.cfg.endpointUrl}")`,
      address: ADDRESSES.ValidatorRegistry as Address,
      abi: VALIDATOR_REGISTRY_ABI,
      functionName: "register",
      args: [this.cfg.stakeAmountWei, this.cfg.endpointUrl] as const,
      enabled: true,
    });
    return { skipped: false };
  }

  async heartbeat(): Promise<void> {
    await this.execute({
      label: "heartbeat()",
      address: ADDRESSES.ValidatorRegistry as Address,
      abi: VALIDATOR_REGISTRY_ABI,
      functionName: "heartbeat",
      args: [] as const,
      enabled: this.cfg.heartbeatEnabled,
    });
  }

  async submitScore(inputs: ContractInputs): Promise<void> {
    await this.execute({
      label: `submitScore(${inputs.publisher.slice(0, 10)}…, dispute=${inputs.disputeScore} retention=${inputs.retentionScore} freshness=${inputs.freshnessScore} revenue=${inputs.revenueQuality})`,
      address: ADDRESSES.PQSVerifier as Address,
      abi: PQS_VERIFIER_ABI,
      functionName: "submitScore",
      args: [
        inputs.publisher,
        BigInt(inputs.disputeScore),
        BigInt(inputs.retentionScore),
        BigInt(inputs.freshnessScore),
        BigInt(inputs.revenueQuality),
      ] as const,
      enabled: this.cfg.submitEnabled,
    });
  }

  async claimRewards(): Promise<void> {
    await this.execute({
      label: "claimRewards()",
      address: ADDRESSES.ValidatorRegistry as Address,
      abi: VALIDATOR_REGISTRY_ABI,
      functionName: "claimRewards",
      args: [] as const,
      enabled: this.cfg.heartbeatEnabled, // gated alongside heartbeat — same risk profile
    });
  }

  /**
   * fileFlag — open a dispute on RE06 against a provably-wrong oracle answer.
   *
   * Called by the verification loop only when the oracle's own /verify endpoint
   * returned `verified == false` with a non-empty `flaggable` set, i.e. a
   * deterministic fact mismatch the publisher cannot legitimately dispute.
   * FlagType.FACTUAL is the right class here: the dispute is over a checkable
   * fact, so once the 24h optimistic window lapses defaultUphold() slashes the
   * publisher with no human arbitration. Gated by FLAG_ENABLED — dry-run when
   * false (logs the would-be flag, no tx).
   */
  async fileFlag(
    publisher: Address,
    messageHash: Hash,
    flagType: number = FLAG_TYPE.FACTUAL,
  ): Promise<void> {
    await this.execute({
      label: `fileFlag(${publisher.slice(0, 10)}…, ${messageHash.slice(0, 10)}…, flagType=${flagType})`,
      address: ADDRESSES.ReputationEngine as Address,
      abi: REPUTATION_ENGINE_ABI,
      functionName: "fileFlag",
      args: [publisher, messageHash, flagType] as const,
      enabled: this.cfg.flagEnabled,
    });
  }

  // ─── execute helper ───────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async execute(req: {
    label: string;
    address: Address;
    abi: any;
    functionName: string;
    args: readonly unknown[];
    enabled: boolean;
  }): Promise<TransactionReceipt | null> {
    if (!req.enabled) {
      console.log(kleur.yellow(`      ${kleur.dim("[dry-run]")} ${req.label}`));
      return null;
    }
    // Locally-tracked pending nonce. publicnode is sharded; reads can return
    // stale counts seconds after a confirmation lands. Trust max(rpc_pending,
    // lastUsed+1) so back-to-back submits never collide.
    const rpcNonce = await this.signer.publicClient.getTransactionCount({
      address: this.signer.address,
      blockTag: "pending",
    });
    const nonce =
      this.lastUsedNonce === null
        ? rpcNonce
        : Math.max(rpcNonce, this.lastUsedNonce + 1);

    try {
      const { request } = await this.signer.publicClient.simulateContract({
        address: req.address,
        abi: req.abi,
        functionName: req.functionName,
        args: req.args,
        account: this.signer.account,
        nonce,
      });
      const hash = (await this.signer.walletClient.writeContract(request)) as Hash;
      console.log(kleur.cyan(`      ${req.label} → tx ${hash.slice(0, 18)}…`));
      this.lastUsedNonce = nonce;
      const receipt = await this.signer.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`tx reverted: ${hash}`);
      }
      console.log(
        kleur.green(`      ✓ ${req.functionName} mined in block ${receipt.blockNumber} (gas=${receipt.gasUsed})`),
      );
      return receipt;
    } catch (err) {
      console.error(kleur.red(`      ✗ ${req.label} failed: ${(err as Error).message.slice(0, 200)}`));
      // Reset local nonce on error so the next attempt re-reads from chain.
      this.lastUsedNonce = null;
      throw err;
    }
  }
}
