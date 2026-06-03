// Browser entry for the Sentinel web demo.
// Bundles the exact same AST audit engine the CLI + paid /audit endpoint use,
// so what a judge runs in the browser is byte-for-byte the production auditor.
import { audit, ALL_DETECTORS } from "../../src/analyzer/index.js";

// Expose to the page. No network, no server: the full 14-detector audit runs
// entirely client-side, which is also why the live x402 paywall is real value —
// the analysis is free to demo, the *trustless paid + on-chain-anchored* loop is
// the product.
(window as any).Sentinel = {
  audit,
  detectorCount: ALL_DETECTORS.length,
  detectorIds: ALL_DETECTORS.map((d) => d.id),
};
