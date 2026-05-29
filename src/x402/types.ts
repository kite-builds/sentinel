/**
 * x402 "exact" EVM scheme types — the subset Sentinel needs to sell audits.
 * Mirrors the x402 protocol (https://x402.org): a 402 challenge advertises
 * `accepts[]`; the client retries with a base64 `X-PAYMENT` header carrying a
 * signed EIP-3009 authorization; the server verifies, serves, then settles.
 */

export type X402Network =
  | "base"
  | "base-sepolia"
  | "mantle"
  | "mantle-sepolia"
  | "anvil"
  | string;

/** EIP-3009 TransferWithAuthorization fields (string-encoded for JSON transport). */
export interface ExactAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string; // 0x-prefixed 32-byte hex
}

/** The decoded X-PAYMENT payload for the "exact" scheme. */
export interface ExactPaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: X402Network;
  payload: {
    signature: string;
    authorization: ExactAuthorization;
  };
}

/** One entry in the 402 challenge `accepts[]` array. */
export interface PaymentRequirements {
  scheme: "exact";
  network: X402Network;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  /** EIP-712 domain hints for the asset (name/version) used in local verification. */
  extra?: { name?: string; version?: string } | null;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  payer?: string;
}

export interface SettleResult {
  settled: boolean;
  txHash?: string;
  reason?: string;
}

/** A verifier validates a payment against requirements; a settler executes it. */
export interface PaymentVerifier {
  verify(payment: ExactPaymentPayload, req: PaymentRequirements): Promise<VerifyResult>;
  settle(payment: ExactPaymentPayload, req: PaymentRequirements): Promise<SettleResult>;
}

export interface PaywallConfig {
  /** Price in atomic units of the asset (USDC = 6 decimals). */
  priceAtomic: string;
  network: X402Network;
  payTo: string;
  asset: string;
  description?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string } | null;
  /** Pluggable verifier: facilitator-backed in prod, local EIP-712 for dev/demo. */
  verifier: PaymentVerifier;
}
