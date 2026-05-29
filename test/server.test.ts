import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp, type AgentCard } from "../src/server/app.js";
import type { PaymentVerifier, PaywallConfig, ExactPaymentPayload, PaymentRequirements } from "../src/x402/types.js";

const VULN = `
pragma solidity ^0.8.0;
contract Bad {
  address owner;
  mapping(address => uint) bal;
  function withdraw() public {
    require(tx.origin == owner, "no");
    (bool ok,) = msg.sender.call{value: bal[msg.sender]}("");
    ok;
    bal[msg.sender] = 0; // state write AFTER external call -> reentrancy
  }
}`;

function fakePayment(): ExactPaymentPayload {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "anvil",
    payload: {
      signature: "0x" + "11".repeat(65),
      authorization: {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        value: "10000",
        validAfter: "0",
        validBefore: "99999999999",
        nonce: "0x" + "00".repeat(32),
      },
    },
  };
}

function makeApp(verifier: PaymentVerifier) {
  const paywallCfg: PaywallConfig = {
    priceAtomic: "10000",
    network: "anvil",
    payTo: "0x2222222222222222222222222222222222222222",
    asset: "0x3333333333333333333333333333333333333333",
    verifier,
  };
  const agentCard: AgentCard = {
    name: "Sentinel",
    description: "test",
    agentDomain: "sentinel.kite.audit",
    capabilities: ["solidity-audit"],
    service: { auditEndpoint: "/audit", price: { amountAtomic: "10000", asset: paywallCfg.asset, network: "anvil" } },
  };
  return createApp({ paywallCfg, agentCard });
}

const acceptAll: PaymentVerifier = {
  async verify() {
    return { valid: true, payer: "0x1111111111111111111111111111111111111111" };
  },
  async settle() {
    return { settled: true, txHash: "0xdeadbeef" };
  },
};

describe("Sentinel HTTP agent", () => {
  it("serves an AgentCard", async () => {
    const res = await request(makeApp(acceptAll)).get("/.well-known/agent.json");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Sentinel");
    expect(res.body.service.auditEndpoint).toBe("/audit");
  });

  it("returns a 402 challenge with x402 accepts[] when no payment is present", async () => {
    const res = await request(makeApp(acceptAll)).post("/audit").send({ source: VULN });
    expect(res.status).toBe(402);
    expect(res.body.accepts).toHaveLength(1);
    const r = res.body.accepts[0];
    expect(r.scheme).toBe("exact");
    expect(r.maxAmountRequired).toBe("10000");
    expect(r.payTo).toBe("0x2222222222222222222222222222222222222222");
  });

  it("rejects a malformed X-PAYMENT header with 402", async () => {
    const res = await request(makeApp(acceptAll)).post("/audit").set("X-PAYMENT", "not-base64-json").send({ source: VULN });
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/malformed/);
  });

  it("rejects an invalid payment with the verifier's reason", async () => {
    const reject: PaymentVerifier = {
      async verify() {
        return { valid: false, reason: "insufficient amount" };
      },
      async settle() {
        return { settled: false };
      },
    };
    const header = Buffer.from(JSON.stringify(fakePayment())).toString("base64");
    const res = await request(makeApp(reject)).post("/audit").set("X-PAYMENT", header).send({ source: VULN });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe("insufficient amount");
  });

  it("runs the audit and settles after a valid payment", async () => {
    const header = Buffer.from(JSON.stringify(fakePayment())).toString("base64");
    const res = await request(makeApp(acceptAll)).post("/audit").set("X-PAYMENT", header).send({ source: VULN });
    expect(res.status).toBe(200);
    expect(res.body.report.findings.length).toBeGreaterThan(0);
    expect(res.body.payment.settled).toBe(true);
    expect(res.body.payment.txHash).toBe("0xdeadbeef");
    expect(res.headers["x-payment-response"]).toBeTruthy();
  });

  it("fails the request (402) if settlement fails — no free audits", async () => {
    const settleFails: PaymentVerifier = {
      async verify() {
        return { valid: true };
      },
      async settle() {
        return { settled: false, reason: "nonce already used" };
      },
    };
    const header = Buffer.from(JSON.stringify(fakePayment())).toString("base64");
    const res = await request(makeApp(settleFails)).post("/audit").set("X-PAYMENT", header).send({ source: VULN });
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/settlement failed/);
  });
});
