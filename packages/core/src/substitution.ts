// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// First-order substitution, a faithful port of LeaTTa `Core/Substitution.lean`.
import { type Atom, variable } from "./atom";

/** A substitution: an association list of variable name to atom. */
export type Subst = ReadonlyArray<readonly [string, Atom]>;

export const emptySubst: Subst = [];

/** First value assigned to `x`, if any. */
export function lookupSubst(s: Subst, x: string): Atom | undefined {
  for (const [k, v] of s) if (k === x) return v;
  return undefined;
}

/** Drop every binding for `x`. */
export function eraseSubst(s: Subst, x: string): Subst {
  return s.filter((p) => p[0] !== x);
}

/** `(x,a) :: erase s x` (LeaTTa `Subst.extend`). */
export function extendSubst(s: Subst, x: string, a: Atom): Subst {
  return [[x, a], ...eraseSubst(s, x)];
}

/** Apply `s` to an atom: replace each variable by its assigned value (one pass; the substituted
 *  value is not itself re-substituted). */
export function applySubst(s: Subst, a: Atom): Atom {
  if (a.ground) return a; // closed term: substitution is identity, no walk (closed-term short-circuit)
  if (s.length === 0) return a; // empty substitution is identity (no clone)
  switch (a.kind) {
    case "var":
      return lookupSubst(s, a.name) ?? a;
    case "expr": {
      // Clone only if a child actually changed; otherwise share the reference (no allocation). An inline
      // loop with a lazily-allocated array (copy the unchanged prefix once on the first change) avoids the
      // per-call closure and `.map` iterator allocation, the dominant cost when substituting through many
      // results, where this short-circuits to sharing on every closed subterm.
      const its = a.items;
      let items: Atom[] | null = null;
      for (let i = 0; i < its.length; i++) {
        const it = its[i]!;
        const r = applySubst(s, it);
        if (items !== null) items.push(r);
        else if (r !== it) {
          items = its.slice(0, i);
          items.push(r);
        }
      }
      return items === null ? a : { ...a, items };
    }
    default:
      return a;
  }
}

/** Occurs-check: does `$x` appear anywhere in the atom? */
export function occurs(x: string, a: Atom): boolean {
  if (a.ground) return false; // closed term: no variable occurs in it
  switch (a.kind) {
    case "var":
      return x === a.name;
    case "expr":
      return a.items.some((it) => occurs(x, it));
    default:
      return false;
  }
}

export { variable };
