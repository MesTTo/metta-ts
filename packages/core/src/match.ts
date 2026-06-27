// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Nondeterministic pattern matching and binding-set merge, a faithful port of
// LeaTTa `Core/Matching.lean`. Matching follows the official left/right style.
import { type Atom, atomEq, variable } from "./atom";
import { type Bindings, type BindingRel, lookupVal, addValRaw, addEqRaw } from "./bindings";

// Rename every variable in `a` by appending `suffix`, sharing closed subterms (ground short-circuit, no
// clone). Used to scope a rule's variables WITHOUT cloning the whole rule upfront: the matcher applies the
// suffix to a left (rule) variable when it binds, and to a left subterm only in the rare case a right
// (query) variable binds to it. A real result is byte-identical to first freshening with `name + suffix`.
function suffixVars(a: Atom, suffix: string): Atom {
  if (a.ground) return a;
  if (a.kind === "var") return variable(a.name + suffix);
  if (a.kind === "expr") {
    const its = a.items;
    let items: Atom[] | null = null;
    for (let i = 0; i < its.length; i++) {
      const r = suffixVars(its[i]!, suffix);
      if (items !== null) items.push(r);
      else if (r !== its[i]) {
        items = its.slice(0, i);
        items.push(r);
      }
    }
    return items === null ? a : { ...a, items };
  }
  return a;
}

/** A custom matcher for grounded atoms; may be nondeterministic. */
export type GroundMatcher = (left: Atom, right: Atom) => Bindings[];

/** Does `target` occur in `a` once variables are resolved through the binding relations `rels`/`b`? The
 *  occurs check LeaTTa's `Unify.unifyTop` runs when reconciling a rebind. `seen` guards against following an
 *  existing benign alias forever. */
function occursThrough(
  target: string,
  a: Atom,
  rels: Bindings,
  b: Bindings,
  seen: Set<string>,
): boolean {
  if (a.ground) return false;
  if (a.kind === "var") {
    if (a.name === target) return true;
    if (seen.has(a.name)) return false;
    seen.add(a.name);
    const nv = lookupVal(rels, a.name) ?? lookupVal(b, a.name);
    return nv !== undefined && occursThrough(target, nv, rels, b, seen);
  }
  if (a.kind === "expr") return a.items.some((it) => occursThrough(target, it, rels, b, seen));
  return false;
}

/** Reconcile two already-determined values `l` and `r` by matching them and merging each result into `b`,
 *  so the constraint that they unify is propagated (hyperon's add_var_binding/add_var_equality semantics).
 *  A reconciliation that would force a variable to equal a term containing itself is rejected: LeaTTa's spec
 *  reconciles via occurs-checked unification (`Unify.unifyTop`), so a cyclic binding (e.g. unifying a2's
 *  `(= (+ $t Z) $t)` with a reflexive `(= $q $q)` forces `$t = (+ $t Z)`) must fail, not silently produce
 *  an unsound result. The shallow `hasLoop` misses this (it only catches `$x = $x`). Only the reconciliation
 *  path is checked; a direct match binding a variable to a term containing it is left as-is, matching LeaTTa
 *  (its `matchAtomsWith` has no occurs check; only `addVarBinding` does). */
function reconcile(b: Bindings, l: Atom, r: Atom): Bindings[] {
  const out: Bindings[] = [];
  for (const mb of matchAtoms(l, r)) {
    if (mb.some((rel) => rel.tag === "val" && occursThrough(rel.x, rel.a, mb, b, new Set())))
      continue;
    for (const m of merge(b, mb)) out.push(m);
  }
  return out;
}

/** Add `$x ← v` to `b` consistently. If `$x` is already bound to a different value, reconcile the old value
 *  against the new one (propagating the unification constraint), rejecting a cyclic result. Mirrors hyperon's
 *  `add_var_binding` with LeaTTa's occurs check. */
export function addVarBinding(b: Bindings, x: string, v: Atom): Bindings[] {
  const prev = lookupVal(b, x);
  if (prev === undefined) return [addValRaw(b, x, v)];
  if (atomEq(prev, v)) return [b];
  return reconcile(b, prev, v);
}

/** Add the alias `$x = $y` to `b` consistently. If both are already value-bound to different values,
 *  reconcile those values (mirrors hyperon's `add_var_equality`); otherwise record the equality. */
export function addVarEquality(b: Bindings, x: string, y: string): Bindings[] {
  const vx = lookupVal(b, x);
  const vy = lookupVal(b, y);
  if (vx === undefined || vy === undefined || atomEq(vx, vy)) return [addEqRaw(b, x, y)];
  return reconcile(b, vx, vy);
}

/** Fold one relation into every candidate set, keeping consistent extensions (LeaTTa `mergeOne`). */
function mergeOne(bs: Bindings[], r: BindingRel): Bindings[] {
  const out: Bindings[] = [];
  for (const b of bs) {
    const ext = r.tag === "val" ? addVarBinding(b, r.x, r.a) : addVarEquality(b, r.x, r.y);
    for (const e of ext) out.push(e);
  }
  return out;
}

/** Combine two binding sets into all their consistent unions (LeaTTa `merge`). */
export function merge(a: Bindings, b: Bindings): Bindings[] {
  let acc: Bindings[] = [a];
  for (const r of b) acc = mergeOne(acc, r);
  return acc;
}

/** Match atoms in the official left/right style (LeaTTa `matchAtomsWith`). `leftSuffix` (default empty)
 *  scopes the LEFT atom's variables: a left variable `$x` is treated as `$x<suffix>`, so a rule LHS can be
 *  matched without first cloning it with freshened variables. */
export function matchAtomsWith(
  custom: GroundMatcher | undefined,
  l: Atom,
  r: Atom,
  leftSuffix = "",
): Bindings[] {
  if (l.kind === "sym" && r.kind === "sym") return l.name === r.name ? [[]] : [];
  if (l.kind === "var" && r.kind === "var") {
    const lx = l.name + leftSuffix;
    return lx === r.name ? [[]] : [[{ tag: "val", x: lx, a: r, y: undefined }]];
  }
  if (l.kind === "var") return [[{ tag: "val", x: l.name + leftSuffix, a: r, y: undefined }]];
  // a right (query) variable binds to the left (rule) subterm; scope that subterm's variables too.
  if (r.kind === "var")
    return [
      [
        {
          tag: "val",
          x: r.name,
          a: leftSuffix === "" ? l : suffixVars(l, leftSuffix),
          y: undefined,
        },
      ],
    ];
  if (l.kind === "expr" && r.kind === "expr")
    return matchAll(custom, [[]], l.items, r.items, leftSuffix);
  if (l.kind === "gnd") return matchGrounded(custom, l, r);
  if (r.kind === "gnd") return matchGrounded(custom, r, l);
  return atomEq(l, r) ? [[]] : [];
}

function matchGrounded(custom: GroundMatcher | undefined, g: Atom, other: Atom): Bindings[] {
  if (g.kind === "gnd" && g.match !== undefined) return g.match(other) as Bindings[];
  if (custom !== undefined) return custom(g, other);
  return atomEq(g, other) ? [[]] : [];
}

/** Pointwise-match two atom lists, threading the accumulated binding sets (LeaTTa `matchAll`). */
function matchAll(
  custom: GroundMatcher | undefined,
  acc: Bindings[],
  xs: readonly Atom[],
  ys: readonly Atom[],
  leftSuffix = "",
): Bindings[] {
  if (xs.length !== ys.length) return [];
  let cur = acc;
  for (let i = 0; i < xs.length; i++) {
    const subs = matchAtomsWith(custom, xs[i] as Atom, ys[i] as Atom, leftSuffix);
    const next: Bindings[] = [];
    for (const a of cur) for (const b of subs) for (const m of merge(a, b)) next.push(m);
    cur = next;
    if (cur.length === 0) break;
  }
  return cur;
}

/** Match pattern `l` against `r` with the default matcher (no custom grounded matching). */
export function matchAtoms(l: Atom, r: Atom): Bindings[] {
  return matchAtomsWith(undefined, l, r);
}

/** Match a rule LHS `l` against `r`, scoping `l`'s variables with `suffix` (so the rule need not be cloned
 *  with freshened variables first). The resulting bindings key the rule variables as `name<suffix>`, exactly
 *  as upfront freshening would, so `instantiate(_, rhs, suffix)` resolves the matching RHS identically. */
export function matchAtomsScoped(l: Atom, r: Atom, suffix: string): Bindings[] {
  return matchAtomsWith(undefined, l, r, suffix);
}
