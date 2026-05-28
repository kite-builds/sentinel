export type Severity = "high" | "medium" | "low" | "gas";

export interface Finding {
  /** Stable detector id, e.g. "SEC-001" or "GAS-002". */
  id: string;
  /** Short human title. */
  title: string;
  severity: Severity;
  /** 1-based source line, or 0 if unknown. */
  line: number;
  /** The contract this finding belongs to, if known. */
  contract?: string;
  /** What is wrong / why it matters. */
  description: string;
  /** Concrete fix suggestion. */
  recommendation: string;
  /** Rough gas saved per call/deploy, for gas findings only. */
  gasHint?: string;
}

export interface AuditReport {
  /** Source file name or "<inline>". */
  source: string;
  contracts: string[];
  findings: Finding[];
  counts: Record<Severity, number>;
  /** 0-100; starts at 100, penalised by findings. Higher = safer. */
  score: number;
  /** Detectors that threw, with their error message (never aborts the audit). */
  detectorErrors: { detector: string; error: string }[];
}

/** A detector receives the parsed AST and emits zero or more findings. */
export interface DetectorContext {
  ast: any;
  /** State variable names per contract: contractName -> Set<varName>. */
  stateVars: Map<string, Set<string>>;
}

export type Detector = {
  id: string;
  run: (ctx: DetectorContext) => Finding[];
};
