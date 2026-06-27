// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// A WAM-style trail: a mutable variable-binding store with O(1) bind and O(k) undo, the substrate for
// zero-allocation backtracking search. The immutable `Bindings`/`merge` model allocates a fresh binding
// set per intermediate result, which is the dominant cost when a conjunctive `match` enumerates a large
// join (the permutations benchmark builds ~360k of them). With a trail, a unification binds variables in
// place and records them so a failed or exhausted branch undoes back to a mark, with no per-solution
// allocation; only a kept result materializes. This is the substrate MORK's zero-alloc eval and Prolog's
// engine use. Variables are keyed by name (the same identity the immutable matcher uses), so results are
// interchangeable with the reference matcher; only the binding *mechanism* differs.

import { type Atom, atomEq } from "./atom";

export class Trail {
  private readonly binds = new Map<string, Atom>();
  private readonly trail: string[] = [];

  /** A restore point: the current trail length. */
  mark(): number {
    return this.trail.length;
  }

  /** Undo every binding made since `m`. */
  undo(m: number): void {
    const t = this.trail;
    while (t.length > m) this.binds.delete(t.pop()!);
  }

  /** Bind `$name` to `a` and record it on the trail. The caller guarantees `$name` is currently unbound. */
  bind(name: string, a: Atom): void {
    this.binds.set(name, a);
    this.trail.push(name);
  }

  /** Follow variable bindings to the representative: a non-variable, or an unbound variable. */
  deref(a: Atom): Atom {
    let cur = a;
    while (cur.kind === "var") {
      const v = this.binds.get(cur.name);
      if (v === undefined) return cur;
      cur = v;
    }
    return cur;
  }

  /** Resolve `a` against the current bindings, one pass (the same discipline as the immutable
   *  `instantiate`/`applySubst`): a variable becomes its bound value as-is; the value's own variables are
   *  not re-resolved, and an expression's children are resolved. This matches the evaluator exactly,
   *  including that a cyclic binding (`$y = (.. $y ..)`, which `matchAtoms` produces and `hasLoop` does not
   *  reject) terminates instead of looping. A new term is built only where a child changed. */
  resolve(a: Atom): Atom {
    if (a.kind === "var") return this.deref(a);
    if (a.kind !== "expr" || a.ground) return a;
    const its = a.items;
    let items: Atom[] | null = null;
    for (let i = 0; i < its.length; i++) {
      const it = its[i]!;
      const r = this.resolve(it);
      if (items !== null) items.push(r);
      else if (r !== it) {
        items = its.slice(0, i);
        items.push(r);
      }
    }
    return items === null ? a : { ...a, items };
  }
}

/** Unify two atoms against the trail, binding variables in place; returns whether they unify. On failure
 *  the trail may hold partial bindings, so callers undo to a mark. Mirrors the immutable matcher: a
 *  variable binds to the other side (no occurs check; `matchAtoms` admits cyclic bindings and the
 *  evaluator's one-pass `resolve` handles them, so adding one here would diverge), two symbols/grounded
 *  values must be equal, two expressions must have equal arity and unify pointwise. */
export function unifyTrail(tr: Trail, l0: Atom, r0: Atom): boolean {
  const l = tr.deref(l0);
  const r = tr.deref(r0);
  if (l === r) return true;
  if (l.kind === "var") {
    if (r.kind === "var" && l.name === r.name) return true;
    tr.bind(l.name, r);
    return true;
  }
  if (r.kind === "var") {
    tr.bind(r.name, l);
    return true;
  }
  if (l.kind === "sym") return r.kind === "sym" && l.name === r.name;
  if (l.kind === "gnd") return r.kind === "gnd" && atomEq(l, r);
  // expression
  if (r.kind !== "expr" || l.items.length !== r.items.length) return false;
  for (let i = 0; i < l.items.length; i++)
    if (!unifyTrail(tr, l.items[i]!, r.items[i]!)) return false;
  return true;
}
