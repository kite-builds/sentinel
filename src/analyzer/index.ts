import pkg from "@solidity-parser/parser";
import type { AuditReport, Detector, Finding, Severity } from "./types.js";
import { collectStateVars, findContracts } from "./ast.js";
import { securityDetectors } from "./detectors/security.js";
import { gasDetectors } from "./detectors/gas.js";

const { parse } = pkg as { parse: (src: string, opts?: any) => any };

export const ALL_DETECTORS: Detector[] = [...securityDetectors, ...gasDetectors];

const SEVERITY_PENALTY: Record<Severity, number> = {
  high: 20,
  medium: 8,
  low: 3,
  gas: 1,
};

export interface AuditOptions {
  source?: string;
  detectors?: Detector[];
}

export function audit(code: string, opts: AuditOptions = {}): AuditReport {
  const detectors = opts.detectors ?? ALL_DETECTORS;
  const source = opts.source ?? "<inline>";
  const detectorErrors: { detector: string; error: string }[] = [];

  let ast: any;
  try {
    ast = parse(code, { loc: true, tolerant: true });
  } catch (e: any) {
    return {
      source,
      contracts: [],
      findings: [],
      counts: { high: 0, medium: 0, low: 0, gas: 0 },
      score: 0,
      detectorErrors: [{ detector: "parser", error: e?.message ?? String(e) }],
    };
  }

  const stateVars = collectStateVars(ast);
  const ctx = { ast, stateVars };

  const findings: Finding[] = [];
  for (const d of detectors) {
    try {
      findings.push(...d.run(ctx));
    } catch (e: any) {
      detectorErrors.push({ detector: d.id, error: e?.message ?? String(e) });
    }
  }

  findings.sort((a, b) => {
    const order: Severity[] = ["high", "medium", "low", "gas"];
    const s = order.indexOf(a.severity) - order.indexOf(b.severity);
    return s !== 0 ? s : a.line - b.line;
  });

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, gas: 0 };
  let penalty = 0;
  for (const f of findings) {
    counts[f.severity]++;
    penalty += SEVERITY_PENALTY[f.severity];
  }
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    source,
    contracts: findContracts(ast).map((c: any) => c.name),
    findings,
    counts,
    score,
    detectorErrors,
  };
}

export type { AuditReport, Finding, Severity } from "./types.js";
