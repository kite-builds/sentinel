import { ethers } from "ethers";
import { createApp, type AgentCard } from "./app.js";
import { AttestationClient } from "../chain/attest.js";
import { FacilitatorVerifier, LocalVerifier } from "../x402/verify.js";
import type { PaymentVerifier, PaywallConfig } from "../x402/types.js";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing required env ${name}`);
  return v;
}

async function main() {
  const port = Number(process.env.PORT ?? 8402);
  const rpcUrl = env("RPC_URL", "http://127.0.0.1:8545");
  const chainId = Number(env("CHAIN_ID", "31337"));
  const network = env("X402_NETWORK", "anvil");
  const mode = env("X402_MODE", "local"); // "local" | "facilitator"

  const agentKey = env("AGENT_PRIVATE_KEY");
  // cacheTimeout:-1 disables the getTransactionCount cache so the back-to-back
  // recordAudit + settle txs from the agent don't collide on a stale nonce.
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { cacheTimeout: -1 });
  const signer = new ethers.Wallet(agentKey, provider);

  const asset = env("X402_ASSET");
  const payTo = env("X402_PAYTO", await signer.getAddress());
  const priceAtomic = env("X402_PRICE_ATOMIC", "10000"); // 0.01 USDC

  let verifier: PaymentVerifier;
  if (mode === "facilitator") {
    verifier = new FacilitatorVerifier({ facilitatorUrl: env("FACILITATOR_URL", "https://x402.org/facilitator") });
  } else {
    verifier = new LocalVerifier({ chainId, settler: signer });
  }

  const paywallCfg: PaywallConfig = {
    priceAtomic,
    network,
    payTo,
    asset,
    description: "Sentinel smart-contract audit (1 contract)",
    maxTimeoutSeconds: 120,
    extra: { name: process.env.X402_ASSET_NAME ?? "USD Coin (Mock)", version: process.env.X402_ASSET_VERSION ?? "2" },
    verifier,
  };

  const agentDomain = env("AGENT_DOMAIN", "sentinel.kite.audit");
  const attestation = new AttestationClient({
    identityRegistry: env("IDENTITY_REGISTRY"),
    validationRegistry: env("VALIDATION_REGISTRY"),
    signer,
    agentDomain,
  });

  const agentCard: AgentCard = {
    name: "Sentinel",
    description: "Autonomous AI smart-contract audit agent for Mantle. Pays-per-audit via x402, anchors every report on-chain (ERC-8004).",
    agentDomain,
    capabilities: ["solidity-audit", "gas-optimization", "mantle-l2-checks", "erc8004-attestation"],
    service: {
      auditEndpoint: `/audit`,
      price: { amountAtomic: priceAtomic, asset, network },
    },
  };

  const app = createApp({ paywallCfg, agentCard, attestation });
  app.listen(port, () => {
    console.log(`Sentinel agent listening on :${port} (mode=${mode}, network=${network}, chainId=${chainId})`);
    console.log(`  AgentCard: http://127.0.0.1:${port}/.well-known/agent.json`);
    console.log(`  Audit:     POST http://127.0.0.1:${port}/audit`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
