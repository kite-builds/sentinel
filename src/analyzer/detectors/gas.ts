import type { Detector, Finding } from "../types.js";
import { each, lineOf, findContracts, functionsOf } from "../ast.js";

export const requireStringError: Detector = {
  id: "GAS-001",
  run({ ast }) {
    const out: Finding[] = [];
    each(ast, (n) => {
      if (n.type === "FunctionCall" && n.expression?.type === "Identifier" &&
          n.expression.name === "require" && (n.arguments?.length ?? 0) >= 2) {
        const msg = n.arguments[1];
        if (msg?.type === "StringLiteral") {
          out.push({
            id: "GAS-001",
            title: "require() with revert string",
            severity: "gas",
            line: lineOf(n),
            description:
              "Revert strings are stored in bytecode and copied on revert, inflating deploy cost and per-revert gas.",
            recommendation:
              "Use custom errors (`error X(); ... if (!cond) revert X();`). Saves ~50 deploy gas/char and is cheaper on revert.",
            gasHint: "~deploy + revert savings",
          });
        }
      }
    });
    return out;
  },
};

export const lengthInLoop: Detector = {
  id: "GAS-002",
  run({ ast }) {
    const out: Finding[] = [];
    each(ast, (n) => {
      if (n.type === "ForStatement" && n.conditionExpression) {
        let found = false;
        each(n.conditionExpression, (m) => {
          if (m.type === "MemberAccess" && m.memberName === "length") found = true;
        });
        if (found) {
          out.push({
            id: "GAS-002",
            title: "Array length read in loop condition",
            severity: "gas",
            line: lineOf(n),
            description:
              "Reading `.length` every iteration re-executes the access (an SLOAD for storage arrays). For storage arrays this is costly across iterations.",
            recommendation: "Cache the length in a local before the loop: `uint len = arr.length; for (...; i < len; ...)`.",
            gasHint: "~100 gas/iteration for storage arrays",
          });
        }
      }
    });
    return out;
  },
};

export const postIncrementInLoop: Detector = {
  id: "GAS-003",
  run({ ast }) {
    const out: Finding[] = [];
    each(ast, (n) => {
      if (n.type === "ForStatement" && n.loopExpression) {
        const e = n.loopExpression.expression ?? n.loopExpression;
        if (e?.type === "UnaryOperation" && (e.operator === "++" || e.operator === "--") && e.isPrefix === false) {
          out.push({
            id: "GAS-003",
            title: "Post-increment in loop counter",
            severity: "gas",
            line: lineOf(n),
            description:
              "`i++` creates a temporary copy of the prior value; `++i` does not. In a loop the difference accumulates.",
            recommendation: "Use `++i` instead of `i++` in the loop expression (and `unchecked { ++i; }` when overflow is impossible).",
            gasHint: "~5 gas/iteration",
          });
        }
      }
    });
    return out;
  },
};

const REF_ELEMENTARY = new Set(["string", "bytes"]);
function isReferenceParam(p: any): boolean {
  const t = p?.typeName;
  if (!t) return false;
  if (t.type === "ArrayTypeName") return true;
  if (t.type === "UserDefinedTypeName") return true; // structs
  if (t.type === "ElementaryTypeName" && REF_ELEMENTARY.has(t.name)) return true;
  return false;
}

export const externalCalldata: Detector = {
  id: "GAS-004",
  run({ ast }) {
    const out: Finding[] = [];
    for (const c of findContracts(ast)) {
      for (const fn of functionsOf(c)) {
        if (fn.visibility !== "public" || fn.isConstructor) continue;
        const params = fn.parameters || [];
        const memRef = params.find((p: any) => isReferenceParam(p) && (p.storageLocation === "memory" || p.storageLocation == null));
        if (memRef) {
          out.push({
            id: "GAS-004",
            title: `Reference-type param in public function "${fn.name}" copied to memory`,
            severity: "gas",
            line: lineOf(fn),
            contract: c.name,
            description:
              `"${fn.name}" is public and takes a reference-type argument in memory. If it is never called internally, marking it external and the parameter calldata avoids an unnecessary memory copy.`,
            recommendation: "If not called internally, change visibility to `external` and the parameter location to `calldata`.",
            gasHint: "copy cost scales with input size",
          });
        }
      }
    }
    return out;
  },
};

export const literalConstant: Detector = {
  id: "GAS-005",
  run({ ast }) {
    const out: Finding[] = [];
    const litTypes = new Set(["NumberLiteral", "StringLiteral", "BooleanLiteral", "HexLiteral"]);
    for (const c of findContracts(ast)) {
      for (const sub of c.subNodes || []) {
        if (sub.type !== "StateVariableDeclaration") continue;
        for (const v of sub.variables || []) {
          if (v.isDeclaredConst || v.isImmutable) continue;
          if (v.expression && litTypes.has(v.expression.type)) {
            out.push({
              id: "GAS-005",
              title: `State variable "${v.name}" has a literal initializer but is not constant/immutable`,
              severity: "gas",
              line: lineOf(v),
              contract: c.name,
              description:
                `"${v.name}" is initialised with a compile-time literal. If it is never reassigned, marking it constant (or immutable, if set once in the constructor) removes a storage slot and replaces SLOADs with cheap inlined reads.`,
              recommendation: "Mark as `constant` if the value is fixed, or `immutable` if set once in the constructor.",
              gasHint: "~2100 gas saved per read (cold SLOAD)",
            });
          }
        }
      }
    }
    return out;
  },
};

// --- Mantle / L2-aware detectors ---

export const blockNumberForTime: Detector = {
  id: "MNT-001",
  run({ ast }) {
    const out: Finding[] = [];
    const seen = new Set<number>();
    each(ast, (n) => {
      if (n.type === "MemberAccess" && n.memberName === "number" &&
          n.expression?.type === "Identifier" && n.expression.name === "block") {
        const ln = lineOf(n);
        if (seen.has(ln)) return;
        seen.add(ln);
        out.push({
          id: "MNT-001",
          title: "block.number used (unreliable for time on L2)",
          severity: "low",
          line: ln,
          description:
            "On Mantle and other L2s, block production cadence differs from Ethereum L1 and can change over time, so block.number is a poor proxy for elapsed wall-clock time. Logic that assumes ~12s/block will drift.",
          recommendation: "Use block.timestamp for time/duration logic on Mantle; reserve block.number for ordering only.",
        });
      }
    });
    return out;
  },
};

export const transferStipend: Detector = {
  id: "MNT-002",
  run({ ast }) {
    const out: Finding[] = [];
    each(ast, (n) => {
      if (n.type === "FunctionCall" && n.expression?.type === "MemberAccess" &&
          (n.expression.memberName === "transfer" || n.expression.memberName === "send") &&
          (n.arguments?.length ?? 0) === 1) {
        out.push({
          id: "MNT-002",
          title: `Native value transfer via .${n.expression.memberName}() (fixed 2300-gas stipend)`,
          severity: "medium",
          line: lineOf(n),
          description:
            ".transfer()/.send() forward only 2300 gas. Recipients that are smart contracts/multisigs (common for agents on Mantle) may need more, and gas repricing can break these calls. This is brittle on L2s.",
          recommendation:
            "Prefer `(bool ok, ) = recipient.call{value: amount}(\"\"); require(ok);` with a reentrancy guard, instead of .transfer()/.send().",
        });
      }
    });
    return out;
  },
};

export const gasDetectors: Detector[] = [
  requireStringError,
  lengthInLoop,
  postIncrementInLoop,
  externalCalldata,
  literalConstant,
  blockNumberForTime,
  transferStipend,
];
