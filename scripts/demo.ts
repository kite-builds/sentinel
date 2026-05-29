/**
 * Narrated end-to-end demo of the Sentinel earning loop — the script behind the
 * hackathon video. Boots a local Anvil chain, deploys the ERC-8004 registries +
 * a MockUSDC, starts the live Sentinel HTTP agent, then plays the buyer:
 *
 *   GET AgentCard -> POST /audit (402 challenge) -> sign x402 payment ->
 *   POST /audit (paid) -> report + on-chain attestation + USDC settlement.
 *
 * Run:  PATH=$HOME/.foundry/bin:$PATH npx tsx scripts/demo.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { createApp, type AgentCard } from "../src/server/app.js";
import { AttestationClient } from "../src/chain/attest.js";
import { LocalVerifier } from "../src/x402/verify.js";
import type { ExactPaymentPayload, PaywallConfig } from "../src/x402/types.js";

const PORT = 8403;
const RPC = "http://127.0.0.1:8547";
const CHAIN_ID = 31337;
const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const DOMAIN = "sentinel.kite.audit";
const PRICE = "10000"; // 0.01 USDC

const SAMPLE = `// A contract a real user might submit
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
const step = (n: number, s: string) => console.log(`\n\x1b[36m[${n}]\x1b[0m \x1b[1m${s}\x1b[0m`);

function artifact(name: string, file = name) {
  const a = JSON.parse(readFileSync(`contracts/out/${file}.sol/${name}.json`, "utf8"));
  return new ethers.ContractFactory(a.abi, a.bytecode.object, undefined as any);
}
function abi(name: string, file = name) {
  return JSON.parse(readFileSync(`contracts/out/${file}.sol/${name}.json`, "utf8")).abi;
}

async function main() {
  step(0, "Booting local Anvil chain + deploying Sentinel's on-chain layer");
  const anvil: ChildProcess = spawn("anvil", ["--port", "8547", "--chain-id", String(CHAIN_ID), "--silent"], {
    stdio: "ignore",
  });
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { cacheTimeout: -1 });
  for (let i = 0; i < 50; i++) {
    try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }

  try {
    const agent = new ethers.Wallet(AGENT_KEY, provider);
    const buyer = new ethers.Wallet(BUYER_KEY, provider);

    const identity = await artifact("IdentityRegistry").connect(agent).deploy();
    await identity.waitForDeployment();
    const validation = await artifact("ValidationRegistry").connect(agent).deploy(await identity.getAddress());
    await validation.waitForDeployment();
    const usdc = await artifact("MockUSDC").connect(agent).deploy();
    await usdc.waitForDeployment();
    const usdcAddr = await usdc.getAddress();

    await (await (identity as any).newAgent(DOMAIN, agent.address)).wait();
    await (await (usdc as any).mint(buyer.address, "1000000")).wait();
    log(`    IdentityRegistry   ${await identity.getAddress()}`);
    log(`    ValidationRegistry ${await validation.getAddress()}`);
    log(`    MockUSDC           ${usdcAddr}`);
    log(`    Sentinel agent #1  ${agent.address}  domain=${DOMAIN}`);

    // Start the live HTTP agent.
    const paywallCfg: PaywallConfig = {
      priceAtomic: PRICE, network: "anvil", payTo: agent.address, asset: usdcAddr,
      description: "Sentinel smart-contract audit (1 contract)",
      extra: { name: "USD Coin (Mock)", version: "2" },
      verifier: new LocalVerifier({ chainId: CHAIN_ID, settler: agent }),
    };
    const attestation = new AttestationClient({
      identityRegistry: await identity.getAddress(),
      validationRegistry: await validation.getAddress(),
      signer: agent, agentDomain: DOMAIN,
    });
    const agentCard: AgentCard = {
      name: "Sentinel", description: "Autonomous Solidity audit agent (x402 + ERC-8004)",
      agentDomain: DOMAIN, capabilities: ["solidity-audit", "gas-optimization", "erc8004-attestation"],
      service: { auditEndpoint: "/audit", price: { amountAtomic: PRICE, asset: usdcAddr, network: "anvil" } },
    };
    const server = createApp({ paywallCfg, agentCard, attestation }).listen(PORT);
    const base = `http://127.0.0.1:${PORT}`;

    step(1, "Buyer reads the agent's ERC-8004 AgentCard");
    const card = await (await fetch(`${base}/.well-known/agent.json`)).json();
    log(`    ${JSON.stringify(card.registrations?.[0] ?? {}, null, 0)}  price=${card.service.price.amountAtomic} atomic USDC`);

    step(2, "Buyer requests an audit with NO payment → 402 Payment Required");
    const unpaid = await fetch(`${base}/audit`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: SAMPLE }),
    });
    const challenge: any = await unpaid.json();
    log(`    HTTP ${unpaid.status} — accepts: ${challenge.accepts[0].scheme} ${challenge.accepts[0].maxAmountRequired} on ${challenge.accepts[0].network}`);

    step(3, "Buyer signs an x402 (EIP-3009) payment authorization");
    const now = Math.floor(Date.now() / 1000);
    const auth = {
      from: buyer.address, to: agent.address, value: PRICE,
      validAfter: String(now - 60), validBefore: String(now + 3600),
      nonce: ethers.hexlify(ethers.randomBytes(32)),
    };
    const types = { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] };
    const signature = await buyer.signTypedData(
      { name: "USD Coin (Mock)", version: "2", chainId: CHAIN_ID, verifyingContract: usdcAddr }, types, auth,
    );
    const payment: ExactPaymentPayload = { x402Version: 1, scheme: "exact", network: "anvil", payload: { signature, authorization: auth } };
    log(`    signed: pay ${PRICE} USDC from ${auth.from.slice(0, 10)}… → ${auth.to.slice(0, 10)}…`);

    const usdcRead = new ethers.Contract(usdcAddr, abi("MockUSDC"), provider);
    const buyerBefore = await usdcRead.balanceOf(buyer.address);

    step(4, "Buyer resubmits with the X-PAYMENT header → agent audits, anchors, settles");
    const paid = await fetch(`${base}/audit`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-PAYMENT": Buffer.from(JSON.stringify(payment)).toString("base64") },
      body: JSON.stringify({ source: SAMPLE, name: "Vault.sol" }),
    });
    const result: any = await paid.json();
    log(`    HTTP ${paid.status} — ${result.report.counts.high} high · ${result.report.counts.medium} med · ${result.report.counts.gas} gas · score ${result.report.score}/100`);
    for (const f of result.report.findings.slice(0, 4)) log(`      • [${f.severity.toUpperCase()}] ${f.id} L${f.line} ${f.title}`);

    step(5, "Proof: payment settled + report anchored on-chain (ERC-8004 Validation Registry)");
    const buyerAfter = await usdcRead.balanceOf(buyer.address);
    log(`    USDC moved: buyer paid ${(buyerBefore - buyerAfter).toString()} atomic  (settle tx ${result.payment.txHash.slice(0, 18)}…)`);
    log(`    attestation: recordId=${result.attestation.recordId}  riskScore=${result.attestation.riskScore}  reportHash=${result.attestation.reportHash.slice(0, 18)}…`);
    const verified = await attestation.verify(result.report);
    log(`    on-chain verify(agentId, subject, reportHash) = \x1b[32m${verified}\x1b[0m`);

    log(`\n\x1b[32m✔ Sentinel sold an audit, got paid trustlessly, and left a verifiable on-chain record.\x1b[0m\n`);

    server.close();
    provider.destroy();
  } finally {
    anvil.kill("SIGKILL");
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
