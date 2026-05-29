import expressImport, { type Express, type Request, type Response } from "express";
import { audit } from "../analyzer/index.js";

// express ships as CJS; under Node ESM the default import is the factory, but
// some bundlers (vitest/esbuild) expose it as a namespace object. Normalise so
// `express()` / `express.json()` work in both.
const express: typeof expressImport = (expressImport as any).default ?? expressImport;
import { paywall } from "../x402/paywall.js";
import type { PaywallConfig } from "../x402/types.js";
import type { AttestationClient } from "../chain/attest.js";

export interface AgentCard {
  name: string;
  description: string;
  agentDomain: string;
  /** ERC-8004 identity, filled in once resolvable. */
  registrations?: Array<{ agentId: string; agentAddress: string; chainId: number }>;
  capabilities: string[];
  service: {
    auditEndpoint: string;
    price: { amountAtomic: string; asset: string; network: string };
  };
}

export interface CreateAppOpts {
  paywallCfg: PaywallConfig;
  agentCard: AgentCard;
  /** Optional on-chain attestation; if omitted, audits run but aren't anchored. */
  attestation?: AttestationClient;
}

/**
 * Build the Sentinel HTTP agent:
 *   GET  /healthz            liveness
 *   GET  /.well-known/agent.json   ERC-8004 AgentCard (identity + service + price)
 *   POST /audit              x402-paywalled; { source } -> report + on-chain attestation
 *
 * Settlement happens *after* the audit succeeds, so a client only pays for a
 * delivered, on-chain-anchored result.
 */
export function createApp(opts: CreateAppOpts): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ type: ["text/plain", "application/solidity"], limit: "1mb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.get("/.well-known/agent.json", async (_req, res) => {
    const card: AgentCard = { ...opts.agentCard };
    if (opts.attestation) {
      try {
        const info = await opts.attestation.agentInfo();
        card.registrations = [
          {
            agentId: info.agentId.toString(),
            agentAddress: info.agentAddress,
            chainId: Number(opts.paywallCfg.network === "anvil" ? 31337 : 0) || 0,
          },
        ];
      } catch {
        /* identity not yet resolvable; serve base card */
      }
    }
    res.json(card);
  });

  app.post("/audit", paywall(opts.paywallCfg), async (req: Request, res: Response) => {
    const source = extractSource(req);
    if (!source) {
      res.status(400).json({ error: "missing Solidity source (JSON {source} or text/plain body)" });
      return;
    }

    // 1. Do the work the client is paying for.
    const report = audit(source, { source: req.body?.name ?? "<submitted>" });

    // 2. Anchor proof on-chain (best-effort; report still returned if anchoring is off).
    let attestation = null;
    if (opts.attestation) {
      try {
        attestation = await opts.attestation.attest(report);
      } catch (e: any) {
        res.status(502).json({ error: `attestation failed: ${e?.shortMessage ?? e?.message ?? e}` });
        return;
      }
    }

    // 3. Settle payment now that the result + proof exist.
    let payment = null;
    if (req.x402Payment && req.x402Requirements) {
      const settle = await opts.paywallCfg.verifier.settle(req.x402Payment, req.x402Requirements);
      if (!settle.settled) {
        res.status(402).json({ x402Version: 1, error: `settlement failed: ${settle.reason}` });
        return;
      }
      payment = { settled: true, txHash: settle.txHash, payer: req.x402Payment.payload.authorization.from };
      res.setHeader("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(payment)).toString("base64"));
    }

    res.json({ report, attestation, payment });
  });

  return app;
}

function extractSource(req: Request): string | null {
  if (typeof req.body === "string" && req.body.trim()) return req.body;
  if (req.body && typeof req.body.source === "string" && req.body.source.trim()) return req.body.source;
  return null;
}
