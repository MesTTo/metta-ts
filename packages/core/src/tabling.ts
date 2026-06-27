// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Automatic tabling support: classify which functors are safe to memoise, and build the memo key.
// A pure functor's result bag is a function of its ground arguments alone, so caching that bag and
// replaying it preserves order and multiplicity exactly. "Pure" here is conservative: no world or
// state mutation, no I/O, no type/space read, and no nondeterminism-introducing op.
import { type Atom } from "./atom";
import { format } from "./parser";
import { type MinEnv } from "./eval";

/** Ops that read or write mutable state, do I/O, read types/spaces, or introduce nondeterminism.
 *  A functor whose body reaches any of these (directly or transitively) is not tabled in P1. */
export const IMPURE_OPS: ReadonlySet<string> = new Set([
  "add-atom",
  "remove-atom",
  "add-reduct",
  "add-reducts",
  "add-atoms",
  "new-state",
  "get-state",
  "change-state!",
  "new-space",
  "new-mork-space",
  "fork-space",
  "get-atoms",
  "bind!",
  "import!",
  "transaction",
  "context-space",
  "par",
  "race",
  "once",
  "with-mutex",
  "superpose",
  "hyperpose",
  "collapse",
  "collapse-bind",
  "superpose-bind",
  "collapse-extract",
  "match",
  "metta",
  "metta-thread",
  "capture",
  "println!",
  "print!",
  "trace!",
  "pragma!",
  "register-module!",
  "get-type",
  "get-type-space",
  "get-doc",
  "empty",
]);

/** Every symbol that heads a subexpression of `a`, collected recursively. */
function headSymbols(a: Atom, out: Set<string>): Set<string> {
  if (a.kind === "expr" && a.items.length > 0) {
    if (a.items[0]!.kind === "sym") out.add((a.items[0] as { name: string }).name);
    for (const it of a.items) headSymbols(it, out);
  }
  return out;
}

// A rule LHS that can match any functor: its head is (recursively) a variable, e.g. `($x ...)`. An
// expression-headed rule like `((|-> ...) ...)` only matches that one constructor, so it does NOT threaten
// other functors' tabling. Only a genuinely variable-headed rule does.
function variableHeaded(a: Atom): boolean {
  return (
    a.kind === "var" || (a.kind === "expr" && a.items.length > 0 && variableHeaded(a.items[0]!))
  );
}

/** The set of functor names safe to table. Conservative: a variable-headed (`$x`-headed) equation can match
 *  anything, so its presence disables tabling entirely. (`varRules` also holds expression-headed equations,
 *  which match only their own constructor and are harmless here.) */
export function analyzePurity(env: MinEnv): Set<string> {
  if (env.varRules.some(([lhs]) => variableHeaded(lhs))) return new Set();
  const deps = new Map<string, Set<string>>();
  for (const [k, eqs] of env.ruleIndex) {
    const s = new Set<string>();
    for (const [, rhs] of eqs) headSymbols(rhs, s);
    deps.set(k, s);
  }
  const impure = new Set<string>();
  for (const [k, s] of deps) {
    for (const h of s)
      if (IMPURE_OPS.has(h)) {
        impure.add(k);
        break;
      }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [k, s] of deps) {
      if (impure.has(k)) continue;
      for (const h of s)
        if (impure.has(h)) {
          impure.add(k);
          changed = true;
          break;
        }
    }
  }
  const pure = new Set<string>();
  for (const k of deps.keys()) if (!impure.has(k)) pure.add(k);
  return pure;
}

/** The memo key for a ground call. The call has no variables, so its printed form is canonical. */
export function tableKey(call: Atom): string {
  return format(call);
}

/** A key is well-formed only if it contains no Float leaf (IEEE-754 breaks lawful equality, so a
 *  float-keyed table could merge or split keys differently from `match`). Mutable references never
 *  appear in a ground call, so the float check is the only one needed in P1. */
export function keyWellFormed(a: Atom): boolean {
  if (a.kind === "gnd") return a.value.g !== "float";
  if (a.kind === "expr") return a.items.every(keyWellFormed);
  return true;
}
