/**
 * End-to-end proof of the Sentinel earning loop on a real EVM (local Anvil):
 *
 *   deploy ERC-8004 registries + MockUSDC -> register Sentinel agent ->
 *   fund a buyer -> buyer signs an x402 (EIP-3009) payment -> POST /audit ->
 *   server verifies, runs the audit, anchors the report on-chain, settles USDC ->
 *   assert the on-chain attestation verifies and the payment actually moved.
 *
 * Requires `anvil` (Foundry) on PATH and `forge build` artifacts in ./out.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import request from "supertest";
import { createApp, type AgentCard } from "../src/server/app.js";
import { AttestationClient } from "../src/chain/attest.js";
import { LocalVerifier } from "../src/x402/verify.js";
import type { ExactPaymentPayload, PaywallConfig } from "../src/x402/types.js";

const RPC = "http://127.0.0.1:8546";
const CHAIN_ID = 31337;
// Standard Anvil deterministic accounts (mnemonic "test test ... junk").
const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // acct 0
const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // acct 1
const AGENT_DOMAIN = "sentinel.kite.audit";
const PRICE = "10000"; // 0.01 USDC (6 decimals)

const VULN = `pragma solidity ^0.8.0;
contract Bank {
  mapping(address=>uint) bal;
  function withdraw() public {
    (bool ok,) = msg.sender.call{value: bal[msg.sender]}("");
    require(ok);
    bal[msg.sender] = 0;
  }
}`;

function artifact(name: string, file = name) {
  const a = JSON.parse(readFileSync(`contracts/out/${file}.sol/${name}.json`, "utf8"));
  return { abi: a.abi, bytecode: a.bytecode.object as string };
}

// This e2e suite needs Foundry's `anvil` on PATH. It's an optional dev tool, so
// a fresh clone (or CI without Foundry) won't have it. Detect it up front and
// skip the whole suite cleanly instead of letting `spawn("anvil")` throw an
// async ENOENT that surfaces as an unhandled error and reds the run.
const hasAnvil = spawnSync("anvil", ["--version"], { stdio: "ignore" }).error === undefined;
if (!hasAnvil) {
  console.warn("[e2e.chain] skipping: `anvil` not found on PATH (install Foundry to run the on-chain e2e).");
}

let anvil: ChildProcess;

async function waitForRpc(provider: ethers.JsonRpcProvider, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      await provider.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("anvil did not come up");
}

async function deploy(name: string, signer: ethers.Signer, args: any[] = [], file = name) {
  const art = artifact(name, file);
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, signer);
  const c = await factory.deploy(...args);
  await c.waitForDeployment();
  return c;
}

describe.skipIf(!hasAnvil)("Sentinel e2e (anvil)", () => {
  let identityAddr: string;
  let validationAddr: string;
  let usdcAddr: string;
  let agent: ethers.Wallet;
  let buyer: ethers.Wallet;
  let provider: ethers.JsonRpcProvider;

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", "8546", "--chain-id", String(CHAIN_ID), "--silent"], {
      stdio: "ignore",
    });
    // Capture spawn errors so a failed launch rejects beforeAll rather than
    // escaping as an unhandled exception.
    anvil.on("error", (e) => console.error("[e2e.chain] anvil failed to launch:", e.message));
    // cacheTimeout:-1 disables ethers' getTransactionCount cache; with anvil's
    // instant mining the default 250ms cache hands the same nonce to back-to-back
    // txs ("nonce too low").
    provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { cacheTimeout: -1 });
    await waitForRpc(provider);

    agent = new ethers.Wallet(AGENT_KEY, provider);
    buyer = new ethers.Wallet(BUYER_KEY, provider);

    // Fail fast if we attached to a stale chain (e.g. a leftover anvil on the
    // port) — otherwise deploy addresses shift and calls hit empty code.
    const startNonce = await provider.getTransactionCount(agent.address);
    if (startNonce !== 0) throw new Error(`expected a fresh chain, but agent nonce is ${startNonce}`);

    const identity = await deploy("IdentityRegistry", agent);
    identityAddr = await identity.getAddress();
    const validation = await deploy("ValidationRegistry", agent, [identityAddr]);
    validationAddr = await validation.getAddress();
    const usdc = await deploy("MockUSDC", agent);
    usdcAddr = await usdc.getAddress();

    for (const [n, a] of [["identity", identityAddr], ["validation", validationAddr], ["usdc", usdcAddr]] as const) {
      if ((await provider.getCode(a)) === "0x") throw new Error(`${n} has no code at ${a}`);
    }

    // Register Sentinel as ERC-8004 agent #1, controlled by the agent wallet.
    await (await (identity as any).newAgent(AGENT_DOMAIN, await agent.getAddress())).wait();
    // Fund the buyer with USDC.
    await (await (usdc as any).mint(await buyer.getAddress(), "1000000")).wait();
  }, 60_000);

  afterAll(() => {
    anvil?.kill("SIGKILL");
  });

  async function signPayment(): Promise<ExactPaymentPayload> {
    const now = Math.floor(Date.now() / 1000);
    const auth = {
      from: await buyer.getAddress(),
      to: await agent.getAddress(),
      value: PRICE,
      validAfter: String(now - 60),
      validBefore: String(now + 3600),
      nonce: ethers.hexlify(ethers.randomBytes(32)),
    };
    const domain = { name: "USD Coin (Mock)", version: "2", chainId: CHAIN_ID, verifyingContract: usdcAddr };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };
    const signature = await buyer.signTypedData(domain, types, auth);
    return { x402Version: 1, scheme: "exact", network: "anvil", payload: { signature, authorization: auth } };
  }

  function makeApp() {
    const verifier = new LocalVerifier({ chainId: CHAIN_ID, settler: agent });
    const paywallCfg: PaywallConfig = {
      priceAtomic: PRICE,
      network: "anvil",
      payTo: agent.address,
      asset: usdcAddr,
      verifier,
      extra: { name: "USD Coin (Mock)", version: "2" },
    };
    const attestation = new AttestationClient({
      identityRegistry: identityAddr,
      validationRegistry: validationAddr,
      signer: agent,
      agentDomain: AGENT_DOMAIN,
    });
    const agentCard: AgentCard = {
      name: "Sentinel",
      description: "e2e",
      agentDomain: AGENT_DOMAIN,
      capabilities: ["solidity-audit"],
      service: { auditEndpoint: "/audit", price: { amountAtomic: PRICE, asset: usdcAddr, network: "anvil" } },
    };
    return { app: createApp({ paywallCfg, agentCard, attestation }), attestation };
  }

  it("registered Sentinel as ERC-8004 agent #1", async () => {
    const id = new ethers.Contract(identityAddr, artifact("IdentityRegistry").abi, provider);
    const info = await id.resolveByDomain(AGENT_DOMAIN);
    expect(info.agentId).toBe(1n);
    expect(info.agentAddress.toLowerCase()).toBe(agent.address.toLowerCase());
  });

  it("challenges with 402 when unpaid", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/audit").send({ source: VULN });
    expect(res.status).toBe(402);
    expect(res.body.accepts[0].asset.toLowerCase()).toBe(usdcAddr.toLowerCase());
  });

  it("runs a paid audit: settles USDC + anchors report on-chain", async () => {
    const { app, attestation } = makeApp();
    const usdc = new ethers.Contract(usdcAddr, artifact("MockUSDC").abi, provider);
    const buyerBefore: bigint = await usdc.balanceOf(buyer.address);
    const agentBefore: bigint = await usdc.balanceOf(agent.address);

    const header = Buffer.from(JSON.stringify(await signPayment())).toString("base64");
    const res = await request(app).post("/audit").set("X-PAYMENT", header).send({ source: VULN, name: "Bank.sol" });

    expect(res.status).toBe(200);
    // Audit ran and found the reentrancy.
    expect(res.body.report.findings.some((f: any) => f.severity === "high")).toBe(true);
    // Payment settled on-chain.
    expect(res.body.payment.settled).toBe(true);
    expect(res.body.payment.txHash).toMatch(/^0x[0-9a-f]{64}$/i);
    // Report anchored.
    expect(res.body.attestation.recordId).toBe(0);
    expect(res.body.attestation.reportHash).toMatch(/^0x[0-9a-f]{64}$/i);

    // On-chain balances moved by exactly the price.
    const buyerAfter: bigint = await usdc.balanceOf(buyer.address);
    const agentAfter: bigint = await usdc.balanceOf(agent.address);
    expect(buyerBefore - buyerAfter).toBe(BigInt(PRICE));
    expect(agentAfter - agentBefore).toBe(BigInt(PRICE));

    // The anchored report independently verifies on-chain.
    const ok = await attestation.verify(res.body.report);
    expect(ok).toBe(true);
  });

  it("rejects a replayed payment (nonce already used)", async () => {
    const { app } = makeApp();
    const payment = await signPayment();
    const header = Buffer.from(JSON.stringify(payment)).toString("base64");
    const first = await request(app).post("/audit").set("X-PAYMENT", header).send({ source: VULN });
    expect(first.status).toBe(200);
    const replay = await request(app).post("/audit").set("X-PAYMENT", header).send({ source: VULN });
    expect(replay.status).toBe(402);
    expect(replay.body.error).toMatch(/settlement failed|already used/i);
  });
});
