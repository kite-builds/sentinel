/**
 * attest-live.ts — write a REAL Sentinel audit attestation to the live
 * ERC-8004 Validation Registry on Mantle Sepolia (chain 5003).
 *
 * Unlike scripts/demo.ts (which spins up a local anvil), this performs a real
 * on-chain transaction signed by the Sentinel agent's registered address, so a
 * hackathon judge can click the explorer link and verify the audit receipt.
 *
 * Run:  PRIVATE_KEY=0x... npx tsx scripts/attest-live.ts
 * The PRIVATE_KEY must be the address registered as agent "sentinel.audit".
 */
import { ethers } from "ethers";
import { writeFileSync } from "node:fs";
import { audit } from "../src/analyzer/index.js";
import { AttestationClient, reportHash, toRiskScore } from "../src/chain/attest.js";

const RPC = process.env.MANTLE_RPC ?? "https://rpc.sepolia.mantle.xyz";
const CHAIN_ID = 5003;
const IDENTITY_REGISTRY = "0x8F18f53a7ED086FFe409933668b2F3c48d26CbF4";
const VALIDATION_REGISTRY = "0x6925CDFb19606C165d1ce4bCA16895a9a9Ac3507";
const AGENT_DOMAIN = "sentinel.audit";
const EXPLORER = "https://explorer.sepolia.mantle.xyz";

// A real, deliberately vulnerable contract — the kind a user submits for audit.
const SAMPLE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Vault {
  mapping(address => uint) public bal;
  address owner;
  function setOwner(address o) public { owner = o; }            // no access control
  function withdraw() public {
    require(tx.origin == owner, "not owner");                   // tx.origin auth
    (bool ok,) = msg.sender.call{value: bal[msg.sender]}("");   // external call...
    ok;
    bal[msg.sender] = 0;                                        // ...state write after = reentrancy
  }
}`;

const log = (s = "") => console.log(s);

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY env var required (Sentinel agent address signer).");

  log("┌──────────────────────────────────────────────────────────────┐");
  log("│  SENTINEL — live on-chain audit attestation (Mantle Sepolia)   │");
  log("└──────────────────────────────────────────────────────────────┘");

  // 1. Run the real audit engine.
  const report = audit(SAMPLE, { source: "Vault.sol" });
  log(`\n[1] Audited Vault.sol — ${report.findings.length} findings ` +
    `(${report.counts.high}H / ${report.counts.medium}M / ${report.counts.low}L / ${report.counts.gas} gas), ` +
    `safety score ${report.score}/100 → risk ${toRiskScore(report.score)}/100`);
  log(`    reportHash = ${reportHash(report)}`);

  // 2. Connect the agent signer to live Mantle Sepolia.
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const signer = new ethers.Wallet(pk, provider);
  const addr = await signer.getAddress();
  const bal = await provider.getBalance(addr);
  log(`\n[2] Agent signer ${addr}`);
  log(`    balance ${ethers.formatEther(bal)} MNT on chain ${CHAIN_ID}`);
  if (bal === 0n) throw new Error("Agent wallet has 0 MNT — cannot pay gas.");

  // 3. Write the attestation on-chain.
  const client = new AttestationClient({
    identityRegistry: IDENTITY_REGISTRY,
    validationRegistry: VALIDATION_REGISTRY,
    signer,
    agentDomain: AGENT_DOMAIN,
  });
  const info = await client.agentInfo();
  log(`\n[3] Resolved ERC-8004 agent #${info.agentId} (${info.agentDomain}) → ${info.agentAddress}`);
  if (info.agentAddress.toLowerCase() !== addr.toLowerCase())
    throw new Error("Signer is not the registered agent address; recordAudit would revert.");

  log("    Sending recordAudit() to the live Validation Registry…");
  const rec = await client.attest(report);
  log(`    ✅ tx ${rec.txHash}`);
  log(`       recordId=${rec.recordId} riskScore=${rec.riskScore}`);

  // 4. Verify the receipt by reading it back from chain.
  const verified = await client.verify(report);
  log(`\n[4] On-chain verify(agentId, subject, reportHash) = ${verified}`);
  if (!verified) throw new Error("Attestation written but verify() returned false — aborting.");

  const receipt = {
    network: "Mantle Sepolia",
    chainId: CHAIN_ID,
    agentId: Number(info.agentId),
    agentDomain: info.agentDomain,
    agentAddress: info.agentAddress,
    subject: "Vault.sol",
    riskScore: rec.riskScore,
    safetyScore: report.score,
    findings: report.findings.length,
    counts: report.counts,
    reportHash: rec.reportHash,
    subjectHash: rec.subjectHash,
    recordId: rec.recordId,
    txHash: rec.txHash,
    validationRegistry: VALIDATION_REGISTRY,
    identityRegistry: IDENTITY_REGISTRY,
    txUrl: `${EXPLORER}/tx/${rec.txHash}`,
    registryUrl: `${EXPLORER}/address/${VALIDATION_REGISTRY}`,
  };
  writeFileSync("media/onchain-attestation.json", JSON.stringify(receipt, null, 2) + "\n");
  log(`\n[5] Receipt → media/onchain-attestation.json`);
  log(`    tx:       ${receipt.txUrl}`);
  log(`    registry: ${receipt.registryUrl}`);
  log("\nDone — Sentinel just earned a verifiable on-chain audit receipt.");
}

main().catch((e) => { console.error(e); process.exit(1); });
