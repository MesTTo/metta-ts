// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// First-order syntactic unification, a faithful port of LeaTTa `Core/Unification.lean`.
// Returns a most-general unifier when one exists, else null. Used by the matcher's
// consistency check (addVarBinding); grounded custom matching is handled in match.ts.
import { type Atom, atomSize, atomEq } from "./atom";
import { type Subst, applySubst, extendSubst, occurs, variable } from "./substitution";

type Constraints = ReadonlyArray<readonly [string, Atom]>;

/** Decompose `a =? b` into variable constraints, or null on a head clash / arity mismatch. */
function decomposeEq(a: Atom, b: Atom): Constraints | null {
  if (a.kind === "var" && b.kind === "var") return a.name === b.name ? [] : [[a.name, b]];
  if (a.kind === "var") return [[a.name, b]];
  if (b.kind === "var") return [[b.name, a]];
  if (a.kind === "sym" && b.kind === "sym") return a.name === b.name ? [] : null;
  if (a.kind === "gnd" && b.kind === "gnd") return atomEq(a, b) ? [] : null;
  if (a.kind === "expr" && b.kind === "expr") return decomposeList(a.items, b.items);
  return null;
}

function decomposeList(xs: readonly Atom[], ys: readonly Atom[]): Constraints | null {
  if (xs.length !== ys.length) return null;
  const out: Array<readonly [string, Atom]> = [];
  for (let i = 0; i < xs.length; i++) {
    const c = decomposeEq(xs[i] as Atom, ys[i] as Atom);
    if (c === null) return null;
    out.push(...c);
  }
  return out;
}

function decomposeAll(eqs: ReadonlyArray<readonly [Atom, Atom]>): Constraints | null {
  const out: Array<readonly [string, Atom]> = [];
  for (const [a, b] of eqs) {
    const c = decomposeEq(a, b);
    if (c === null) return null;
    out.push(...c);
  }
  return out;
}

function unifyRounds(
  fuel: number,
  eqs: ReadonlyArray<readonly [Atom, Atom]>,
  s: Subst,
): Subst | null {
  const decomposed = decomposeAll(eqs);
  if (decomposed === null) return null;
  if (decomposed.length === 0) return s;
  if (fuel <= 0) return null;
  const [x, t] = decomposed[0] as readonly [string, Atom];
  const rest = decomposed.slice(1);
  if (occurs(x, t)) return null;
  const sub: Subst = [[x, t]];
  const rest2: Array<readonly [Atom, Atom]> = rest.map((p) => [
    applySubst(sub, variable(p[0])),
    applySubst(sub, p[1]),
  ]);
  return unifyRounds(fuel - 1, rest2, extendSubst(s, x, t));
}

/** Most-general unifier of two atoms, or null if they do not unify. */
export function unifyTop(a: Atom, b: Atom): Subst | null {
  return unifyRounds(atomSize(a) + atomSize(b), [[a, b]], []);
}

/** Whether two atoms unify (the satisfiability check used by addVarBinding). */
export function unifiable(a: Atom, b: Atom): boolean {
  return unifyTop(a, b) !== null;
}
