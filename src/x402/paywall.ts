import type { Request, Response, NextFunction } from "express";
import type { ExactPaymentPayload, PaymentRequirements, PaywallConfig } from "./types.js";

/** Build the 402 challenge `accepts[]` per the x402 spec. */
export function buildPaymentRequirements(cfg: PaywallConfig, resourceUrl: string): PaymentRequirements[] {
  return [
    {
      scheme: "exact",
      network: cfg.network,
      maxAmountRequired: cfg.priceAtomic,
      resource: resourceUrl,
      description: cfg.description ?? "",
      mimeType: "application/json",
      payTo: cfg.payTo,
      maxTimeoutSeconds: cfg.maxTimeoutSeconds ?? 60,
      asset: cfg.asset,
      extra: cfg.extra ?? null,
    },
  ];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      x402Payment?: ExactPaymentPayload;
      x402Requirements?: PaymentRequirements;
    }
  }
}

/**
 * Express middleware enforcing x402 payment on a route.
 *
 * No X-PAYMENT  -> 402 with the payment requirements.
 * Invalid       -> 402 with a reason.
 * Valid         -> verified payment + requirements stashed on the request; the
 *                  route handler runs and is responsible for calling settle
 *                  *after* doing the work (so the client only pays for a result).
 */
export function paywall(cfg: PaywallConfig) {
  return async function paywallMiddleware(req: Request, res: Response, next: NextFunction) {
    const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const requirements = buildPaymentRequirements(cfg, resourceUrl)[0];

    const payHeader = req.header("X-PAYMENT");
    if (!payHeader) {
      res.status(402).json({ x402Version: 1, error: "payment required", accepts: [requirements] });
      return;
    }

    let payment: ExactPaymentPayload;
    try {
      payment = JSON.parse(Buffer.from(payHeader, "base64").toString("utf8"));
    } catch (e: any) {
      res.status(402).json({ x402Version: 1, error: `malformed payment: ${e?.message ?? e}`, accepts: [requirements] });
      return;
    }

    const result = await cfg.verifier.verify(payment, requirements);
    if (!result.valid) {
      res.status(402).json({ x402Version: 1, error: result.reason ?? "invalid payment", accepts: [requirements] });
      return;
    }

    req.x402Payment = payment;
    req.x402Requirements = requirements;
    next();
  };
}
