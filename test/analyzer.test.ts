import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { audit } from "../src/analyzer/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, "contracts", f), "utf8");

function ids(code: string): Set<string> {
  return new Set(audit(code).findings.map((f) => f.id));
}

describe("Sentinel analyzer", () => {
  it("flags the expected issues in the vulnerable contract", () => {
    const found = ids(read("Vulnerable.sol"));
    for (const expected of [
      "SEC-001", "SEC-002", "SEC-003", "SEC-004", "SEC-005", "SEC-006", "SEC-007",
      "GAS-001", "GAS-002", "GAS-003", "GAS-004", "GAS-005", "MNT-001", "MNT-002",
    ]) {
      expect(found, `expected detector ${expected} to fire`).toContain(expected);
    }
  });

  it("scores the vulnerable contract well below the clean one", () => {
    const vuln = audit(read("Vulnerable.sol"));
    const clean = audit(read("Clean.sol"));
    expect(vuln.score).toBeLessThan(clean.score);
    expect(vuln.counts.high).toBeGreaterThan(0);
  });

  it("produces few/no findings on a clean, guarded contract", () => {
    const clean = audit(read("Clean.sol"));
    expect(clean.counts.high).toBe(0);
    expect(clean.score).toBeGreaterThanOrEqual(90);
  });

  it("never throws on malformed input and reports a parser error", () => {
    const r = audit("contract { this is not valid solidity ");
    expect(r).toBeTruthy();
    expect(Array.isArray(r.findings)).toBe(true);
  });

  it("every finding has a line, description and recommendation", () => {
    for (const f of audit(read("Vulnerable.sol")).findings) {
      expect(f.line).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
      expect(f.recommendation.length).toBeGreaterThan(0);
    }
  });
});
