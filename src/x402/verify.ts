import { ethers } from "ethers";
import type {
  ExactPaymentPayload,
  PaymentRequirements,
  PaymentVerifier,
  SettleResult,
  VerifyResult,
} from "./types.js";

const EIP3009_ABI = [
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)",
  "function balanceOf(address) view returns (uint256)",
];

function typedData(
  asset: string,
  chainId: number,
  name: string,
  version: string,
  auth: ExactPaymentPayload["payload"]["authorization"],
) {
  const domain = { name, version, chainId, verifyingContract: asset };
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
  const message = {
    from: auth.from,
    to: auth.to,
    value: auth.value,
    validAfter: auth.validAfter,
    validBefore: auth.validBefore,
    nonce: auth.nonce,
  };
  return { domain, types, message };
}

export interface LocalVerifierOpts {
  chainId: number;
  /** ethers signer that submits the settlement tx (the facilitator wallet). */
  settler: ethers.Signer;
  /** Default EIP-712 asset domain name/version if requirements omit `extra`. */
  assetName?: string;
  assetVersion?: string;
}

/**
 * Self-contained x402 verifier: validates the EIP-712 signature of an EIP-3009
 * authorization offline (no external facilitator), then settles by submitting
 * `transferWithAuthorization` on-chain. This is what makes Sentinel demoable
 * end-to-end against a local Anvil node — and is a drop-in facilitator for any
 * EVM where you control a relayer wallet.
 */
export class LocalVerifier implements PaymentVerifier {
  constructor(private readonly opts: LocalVerifierOpts) {}

  async verify(payment: ExactPaymentPayload, req: PaymentRequirements): Promise<VerifyResult> {
    if (payment.scheme !== "exact") return { valid: false, reason: "unsupported scheme" };
    const auth = payment.payload?.authorization;
    const sig = payment.payload?.signature;
    if (!auth || !sig) return { valid: false, reason: "missing authorization or signature" };

    if (auth.to.toLowerCase() !== req.payTo.toLowerCase()) {
      return { valid: false, reason: "payTo mismatch" };
    }
    if (BigInt(auth.value) < BigInt(req.maxAmountRequired)) {
      return { valid: false, reason: "insufficient amount" };
    }
    const now = Math.floor(Date.now() / 1000);
    if (now <= Number(auth.validAfter)) return { valid: false, reason: "authorization not yet valid" };
    if (now >= Number(auth.validBefore)) return { valid: false, reason: "authorization expired" };

    const name = req.extra?.name ?? this.opts.assetName ?? "USD Coin (Mock)";
    const version = req.extra?.version ?? this.opts.assetVersion ?? "2";
    const { domain, types, message } = typedData(req.asset, this.opts.chainId, name, version, auth);

    let recovered: string;
    try {
      recovered = ethers.verifyTypedData(domain, types, message, sig);
    } catch (e: any) {
      return { valid: false, reason: `bad signature: ${e?.message ?? e}` };
    }
    if (recovered.toLowerCase() !== auth.from.toLowerCase()) {
      return { valid: false, reason: "signature does not match payer" };
    }
    return { valid: true, payer: auth.from };
  }

  async settle(payment: ExactPaymentPayload, req: PaymentRequirements): Promise<SettleResult> {
    const auth = payment.payload.authorization;
    const sig = ethers.Signature.from(payment.payload.signature);
    const asset = new ethers.Contract(req.asset, EIP3009_ABI, this.opts.settler);
    try {
      const tx = await asset.transferWithAuthorization(
        auth.from,
        auth.to,
        auth.value,
        auth.validAfter,
        auth.validBefore,
        auth.nonce,
        sig.v,
        sig.r,
        sig.s,
      );
      const receipt = await tx.wait();
      return { settled: true, txHash: receipt?.hash ?? tx.hash };
    } catch (e: any) {
      return { settled: false, reason: e?.shortMessage ?? e?.message ?? String(e) };
    }
  }
}

export interface FacilitatorVerifierOpts {
  facilitatorUrl: string;
}

/**
 * Production verifier delegating to a hosted x402 facilitator
 * (e.g. https://x402.org/facilitator). Verify + settle are both POSTs.
 */
export class FacilitatorVerifier implements PaymentVerifier {
  constructor(private readonly opts: FacilitatorVerifierOpts) {}

  async verify(payment: ExactPaymentPayload, req: PaymentRequirements): Promise<VerifyResult> {
    const res = await fetch(`${this.opts.facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentPayload: payment, paymentRequirements: req }),
    });
    if (!res.ok) return { valid: false, reason: `facilitator ${res.status}` };
    const body: any = await res.json();
    return { valid: !!body.isValid, reason: body.invalidReason, payer: body.payer };
  }

  async settle(payment: ExactPaymentPayload, req: PaymentRequirements): Promise<SettleResult> {
    const res = await fetch(`${this.opts.facilitatorUrl}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentPayload: payment, paymentRequirements: req }),
    });
    if (!res.ok) return { settled: false, reason: `facilitator ${res.status}` };
    const body: any = await res.json();
    return { settled: !!body.success, txHash: body.transaction, reason: body.errorReason };
  }
}
