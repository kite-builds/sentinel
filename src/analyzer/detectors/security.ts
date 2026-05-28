import type { Detector, Finding } from "../types.js";
import {
  each,
  lineOf,
  findContracts,
  functionsOf,
  hasModifier,
  isStateChanging,
  writesToAny,
} from "../ast.js";

/** Find a low-level member ("call"/"send"/"transfer"/"delegatecall") used as the
 * callee of a FunctionCall, accounting for `addr.call{value: v}(data)` forms. */
function calleeLowLevel(callNode: any): string | null {
  let hit: string | null = null;
  each(callNode.expression, (n) => {
    if (hit) return;
    if (n.type === "MemberAccess" && ["call", "send", "transfer", "delegatecall"].includes(n.memberName)) {
      hit = n.memberName;
    }
  });
  return hit;
}

export const txOrigin: Detector = {
  id: "SEC-001",
  run({ ast }) {
    const out: Finding[] = [];
    each(ast, (n) => {
      if (n.type === "MemberAccess" && n.memberName === "origin" &&
          n.expression?.type === "Identifier" && n.expression.name === "tx") {
        out.push({
          id: "SEC-001",
          title: "Authorization via tx.origin",
          severity: "high",
          line: lineOf(n),
          description:
            "tx.origin returns the original EOA of the whole call chain, not the immediate caller. Using it for authorization lets a malicious intermediary contract impersonate the user (phishing).",
          recommendation: "Use msg.sender for authorization checks instead of tx.origin.",
        });
      }
    });
    return out;
  },
};

export const uncheckedLowLevelCall: Detector = {
  id: "SEC-002",
  run({ ast }) {
    const out: Finding[] = [];
    each(ast, (n) => {
      // A discarded low-level call: the call IS the whole statement expression.
      if (n.type === "ExpressionStatement" && n.expression?.type === "FunctionCall") {
        const kind = calleeLowLevel(n.expression);
        if (kind === "call" || kind === "send") {
          out.push({
            id: "SEC-002",
            title: `Unchecked return value of low-level .${kind}()`,
            severity: "medium",
            line: lineOf(n),
            description:
              `The boolean success value of .${kind}() is ignored. If the transfer/call fails the contract continues as if it succeeded, which can silently break accounting.`,
            recommendation:
              "Check the returned success flag, e.g. `(bool ok, ) = addr.call{value: v}(\"\"); require(ok);`, or prefer a pull-payment pattern.",
          });
        }
      }
    });
    return out;
  },
};

export const selfdestructUse: Detector = {
  id: "SEC-003",
  run({ ast }) {
    const out: Finding[] = [];
    each(ast, (n) => {
      if (n.type === "FunctionCall" && n.expression?.type === "Identifier" &&
          (n.expression.name === "selfdestruct" || n.expression.name === "suicide")) {
        out.push({
          id: "SEC-003",
          title: "Use of selfdestruct",
          severity: "high",
          line: lineOf(n),
          description:
            "selfdestruct removes the contract and force-sends its balance. It is deprecated, can be abused to grief contracts that rely on code existing, and behaves differently post-Cancun.",
          recommendation: "Avoid selfdestruct; use an explicit pause/withdraw pattern and access control.",
        });
      }
    });
    return out;
  },
};

export const delegatecallUse: Detector = {
  id: "SEC-004",
  run({ ast }) {
    const out: Finding[] = [];
    each(ast, (n) => {
      if (n.type === "MemberAccess" && n.memberName === "delegatecall") {
        out.push({
          id: "SEC-004",
          title: "delegatecall to a runtime-controlled target",
          severity: "high",
          line: lineOf(n),
          description:
            "delegatecall executes external code in this contract's storage context. If the target or calldata is attacker-influenced, it can overwrite any storage slot (including ownership) or self-destruct the caller.",
          recommendation:
            "Restrict the target to a vetted, immutable address; never delegatecall to user-supplied addresses.",
        });
      }
    });
    return out;
  },
};

export const weakRandomness: Detector = {
  id: "SEC-005",
  run({ ast }) {
    const out: Finding[] = [];
    const seen = new Set<number>();
    each(ast, (n) => {
      const isBlockField =
        n.type === "MemberAccess" && n.expression?.type === "Identifier" &&
        n.expression.name === "block" && ["timestamp", "difficulty", "prevrandao", "number"].includes(n.memberName);
      const isBlockhash = n.type === "FunctionCall" && n.expression?.type === "Identifier" && n.expression.name === "blockhash";
      if (isBlockField || isBlockhash) {
        const ln = lineOf(n);
        if (seen.has(ln)) return;
        seen.add(ln);
        out.push({
          id: "SEC-005",
          title: "Block property used as a randomness/critical source",
          severity: "medium",
          line: ln,
          description:
            "Validators can influence block.timestamp/number/prevrandao and blockhash within bounds. Using them as randomness or hard security gates is manipulable by miners/sequencers.",
          recommendation: "Use a verifiable randomness source (e.g. a VRF/oracle) for anything value-bearing.",
        });
      }
    });
    return out;
  },
};

export const missingAccessControl: Detector = {
  id: "SEC-006",
  run({ ast, stateVars }) {
    const out: Finding[] = [];
    for (const c of findContracts(ast)) {
      if (c.kind === "interface" || c.kind === "library") continue;
      const names = stateVars.get(c.name) ?? new Set<string>();
      for (const fn of functionsOf(c)) {
        if (fn.isConstructor || fn.isReceiveEther || fn.isFallback) continue;
        const vis = fn.visibility;
        const exposed = vis === "public" || vis === "external" || vis === "default";
        if (!exposed || !isStateChanging(fn) || hasModifier(fn) || !fn.body) continue;
        if (writesToAny(fn.body, names)) {
          out.push({
            id: "SEC-006",
            title: `Externally callable state-changing function "${fn.name}" has no access control`,
            severity: "medium",
            line: lineOf(fn),
            contract: c.name,
            description:
              `"${fn.name}" is ${vis} and writes contract state but carries no modifier and no visible msg.sender guard. If this is privileged logic, anyone can call it.`,
            recommendation:
              "Add an access-control modifier (e.g. onlyOwner / role check) or an explicit require(msg.sender == ...) guard if the function is meant to be restricted.",
          });
        }
      }
    }
    return out;
  },
};

export const reentrancy: Detector = {
  id: "SEC-007",
  run({ ast, stateVars }) {
    const out: Finding[] = [];
    for (const c of findContracts(ast)) {
      const names = stateVars.get(c.name) ?? new Set<string>();
      for (const fn of functionsOf(c)) {
        if (!fn.body || !isStateChanging(fn)) continue;
        const guard = (fn.modifiers || []).some((m: any) =>
          /reentran|nonReentrant|lock|mutex/i.test(m.name || ""));
        if (guard) continue;

        let firstExternalCallLine = Infinity;
        each(fn.body, (n) => {
          if (n.type === "FunctionCall") {
            const kind = calleeLowLevel(n);
            if (kind && kind !== "delegatecall") firstExternalCallLine = Math.min(firstExternalCallLine, lineOf(n));
          }
        });
        if (firstExternalCallLine === Infinity) continue;

        let stateWriteAfter = 0;
        each(fn.body, (n) => {
          if (stateWriteAfter) return;
          const ln = lineOf(n);
          if (ln <= firstExternalCallLine) return;
          if (n.type === "BinaryOperation" && /^(=|\+=|-=)$/.test(n.operator)) {
            const t = baseName(n.left);
            if (t && names.has(t)) stateWriteAfter = ln;
          }
        });
        if (stateWriteAfter) {
          out.push({
            id: "SEC-007",
            title: `Possible reentrancy in "${fn.name}" (state written after external call)`,
            severity: "high",
            line: firstExternalCallLine === Infinity ? lineOf(fn) : firstExternalCallLine,
            contract: c.name,
            description:
              `"${fn.name}" performs an external call (line ${firstExternalCallLine}) and then updates state (line ${stateWriteAfter}). A malicious callee can re-enter before state is finalized.`,
            recommendation:
              "Follow checks-effects-interactions: update state before the external call, and/or add a nonReentrant guard.",
          });
        }
      }
    }
    return out;
  },
};

function baseName(expr: any): string | null {
  let e = expr;
  while (e && typeof e === "object") {
    if (e.type === "Identifier") return e.name;
    if (e.type === "IndexAccess") { e = e.base; continue; }
    if (e.type === "MemberAccess") { e = e.expression; continue; }
    return null;
  }
  return null;
}

export const securityDetectors: Detector[] = [
  txOrigin,
  uncheckedLowLevelCall,
  selfdestructUse,
  delegatecallUse,
  weakRandomness,
  missingAccessControl,
  reentrancy,
];
