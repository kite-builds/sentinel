import { ethers } from "ethers";
import type { AuditReport } from "../analyzer/types.js";
import { IDENTITY_REGISTRY_ABI, VALIDATION_REGISTRY_ABI } from "./abis.js";

/**
 * Deterministic canonical JSON: object keys sorted recursively so the same
 * report always hashes to the same value regardless of property order.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc: Record<string, any>, k) => {
        acc[k] = sortKeys(value[k]);
        return acc;
      }, {});
  }
  return value;
}

/** keccak256 of the canonical report JSON — the anchor written on-chain. */
export function reportHash(report: AuditReport): string {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalize(report)));
}

/** Subject hash for an audit of raw source: keccak256(source). */
export function subjectHashFromSource(source: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(source));
}

/** Subject hash for an on-chain target: keccak256(abi.encode(address, chainId)). */
export function subjectHashFromTarget(target: string, chainId: number): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [target, chainId]),
  );
}

/** Analyzer score is 0..100 "safer is higher"; the registry wants 0..100 risk. */
export function toRiskScore(securityScore: number): number {
  return Math.max(0, Math.min(100, 100 - Math.round(securityScore)));
}

export interface AttestationRecord {
  recordId: number;
  txHash: string;
  reportHash: string;
  subjectHash: string;
  riskScore: number;
}

export interface AttestationClientOpts {
  identityRegistry: string;
  validationRegistry: string;
  /** Signer for the Sentinel agent address (must match its ERC-8004 record). */
  signer: ethers.Signer;
  agentDomain: string;
}

/**
 * Wraps Sentinel's ERC-8004 Identity + Validation registries: resolves the
 * agent's id and writes a tamper-evident attestation (report hash + risk score)
 * for every paid audit, so a buyer can later prove what they were sold.
 */
export class AttestationClient {
  private identity: ethers.Contract;
  private validation: ethers.Contract;
  private agentIdCache?: bigint;

  constructor(private readonly opts: AttestationClientOpts) {
    this.identity = new ethers.Contract(opts.identityRegistry, IDENTITY_REGISTRY_ABI, opts.signer);
    this.validation = new ethers.Contract(opts.validationRegistry, VALIDATION_REGISTRY_ABI, opts.signer);
  }

  /** Resolve (and cache) the Sentinel agent id from its registered domain. */
  async agentId(): Promise<bigint> {
    if (this.agentIdCache !== undefined) return this.agentIdCache;
    const info = await this.identity.resolveByDomain(this.opts.agentDomain);
    this.agentIdCache = info.agentId as bigint;
    return this.agentIdCache;
  }

  async agentInfo(): Promise<{ agentId: bigint; agentDomain: string; agentAddress: string }> {
    const info = await this.identity.resolveByDomain(this.opts.agentDomain);
    return { agentId: info.agentId, agentDomain: info.agentDomain, agentAddress: info.agentAddress };
  }

  /** Anchor a completed audit on-chain. Returns the record id + tx hash. */
  async attest(report: AuditReport): Promise<AttestationRecord> {
    const agentId = await this.agentId();
    const rHash = reportHash(report);
    const sHash = subjectHashFromSource(canonicalize({ source: report.source, contracts: report.contracts }));
    const risk = toRiskScore(report.score);

    const tx = await this.validation.recordAudit(agentId, sHash, rHash, risk);
    const receipt = await tx.wait();

    // recordId is the first topic-decoded arg of AuditRecorded, but recordCount-1 is simplest.
    const count: bigint = await this.validation.recordCount();
    return {
      recordId: Number(count - 1n),
      txHash: receipt?.hash ?? tx.hash,
      reportHash: rHash,
      subjectHash: sHash,
      riskScore: risk,
    };
  }

  /** Verify a (report, subject) pair was anchored by this agent. */
  async verify(report: AuditReport): Promise<boolean> {
    const agentId = await this.agentId();
    const rHash = reportHash(report);
    const sHash = subjectHashFromSource(canonicalize({ source: report.source, contracts: report.contracts }));
    return this.validation.verify(agentId, sHash, rHash);
  }
}
