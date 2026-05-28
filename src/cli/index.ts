#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { audit } from "../analyzer/index.js";
import type { AuditReport, Severity } from "../analyzer/types.js";

const SEV_LABEL: Record<Severity, string> = {
  high: "HIGH",
  medium: "MED ",
  low: "LOW ",
  gas: "GAS ",
};

function color(sev: Severity, s: string): string {
  if (!process.stdout.isTTY) return s;
  const codes: Record<Severity, string> = {
    high: "\x1b[31m", medium: "\x1b[33m", low: "\x1b[36m", gas: "\x1b[90m",
  };
  return `${codes[sev]}${s}\x1b[0m`;
}

function render(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`Sentinel audit — ${report.source}`);
  lines.push(`Contracts: ${report.contracts.join(", ") || "(none)"}`);
  lines.push("");
  if (report.detectorErrors.length) {
    for (const e of report.detectorErrors) lines.push(`! detector ${e.detector} errored: ${e.error}`);
    if (report.findings.length === 0 && report.score === 0) {
      lines.push("Could not parse the source. Is it valid Solidity?");
      return lines.join("\n");
    }
  }
  if (report.findings.length === 0) {
    lines.push("No findings. Score: 100/100");
    return lines.join("\n");
  }
  for (const f of report.findings) {
    lines.push(color(f.severity, `[${SEV_LABEL[f.severity]}] ${f.id}  L${f.line}  ${f.title}`));
    lines.push(`        ${f.description}`);
    lines.push(`        fix: ${f.recommendation}`);
    if (f.gasHint) lines.push(`        est: ${f.gasHint}`);
    lines.push("");
  }
  const c = report.counts;
  lines.push(`Summary: ${c.high} high · ${c.medium} medium · ${c.low} low · ${c.gas} gas`);
  lines.push(`Security score: ${report.score}/100`);
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file && process.stdin.isTTY) {
    console.error("usage: sentinel <Contract.sol> [--json]   (or pipe Solidity on stdin)");
    process.exit(2);
  }
  const code = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  const report = audit(code, { source: file ?? "<stdin>" });
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(render(report) + "\n");
  }
  // Exit non-zero if any high-severity issue, so it is CI-usable.
  process.exit(report.counts.high > 0 ? 1 : 0);
}

main();
