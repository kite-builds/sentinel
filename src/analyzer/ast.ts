// Small AST helpers over @solidity-parser/parser output. The parser emits plain
// objects with a `type` field; we walk them generically so we don't depend on a
// typed node model.

export function lineOf(node: any): number {
  return node?.loc?.start?.line ?? 0;
}

/** Depth-first visit of every node object (has a string `type`) under `root`. */
export function each(root: any, cb: (node: any, parent: any) => void): void {
  const seen = new Set<any>();
  const stack: { node: any; parent: any }[] = [{ node: root, parent: null }];
  while (stack.length) {
    const { node, parent } = stack.pop()!;
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (typeof node.type === "string") cb(node, parent);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) stack.push({ node: c, parent: node });
      } else if (child && typeof child === "object") {
        stack.push({ node: child, parent: node });
      }
    }
  }
}

export function findContracts(ast: any): any[] {
  const out: any[] = [];
  each(ast, (n) => {
    if (n.type === "ContractDefinition") out.push(n);
  });
  return out;
}

export function functionsOf(contract: any): any[] {
  return (contract.subNodes || []).filter(
    (n: any) => n.type === "FunctionDefinition"
  );
}

/** Map of contractName -> Set of its state variable names. */
export function collectStateVars(ast: any): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const c of findContracts(ast)) {
    const names = new Set<string>();
    for (const sub of c.subNodes || []) {
      if (sub.type === "StateVariableDeclaration") {
        for (const v of sub.variables || []) if (v?.name) names.add(v.name);
      }
    }
    map.set(c.name, names);
  }
  return map;
}

/** True if a function carries any modifier invocation (heuristic access guard). */
export function hasModifier(fn: any): boolean {
  return Array.isArray(fn.modifiers) && fn.modifiers.length > 0;
}

export function isStateChanging(fn: any): boolean {
  const m = fn.stateMutability;
  return m !== "view" && m !== "pure" && m !== "constant";
}

/** Does the subtree contain an assignment whose target identifier is in `names`? */
export function writesToAny(node: any, names: Set<string>): boolean {
  let found = false;
  each(node, (n) => {
    if (found) return;
    if (n.type === "BinaryOperation" && /^(=|\+=|-=|\*=|\/=|\|=|&=)$/.test(n.operator)) {
      const target = baseIdentifier(n.left);
      if (target && names.has(target)) found = true;
    }
    if ((n.type === "UnaryOperation") && (n.operator === "++" || n.operator === "--")) {
      const target = baseIdentifier(n.subExpression);
      if (target && names.has(target)) found = true;
    }
  });
  return found;
}

/** Resolve the root identifier name of an lvalue (handles a, a[i], a.b). */
export function baseIdentifier(expr: any): string | null {
  let e = expr;
  while (e && typeof e === "object") {
    if (e.type === "Identifier") return e.name;
    if (e.type === "IndexAccess") { e = e.base; continue; }
    if (e.type === "MemberAccess") { e = e.expression; continue; }
    return null;
  }
  return null;
}
