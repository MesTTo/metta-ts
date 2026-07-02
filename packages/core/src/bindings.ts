// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Binding sets, a faithful port of LeaTTa `Core/Bindings.lean`.
// A binding set is a list of relations: `val x a` is `$x ← a`; `eq x y` is `$x = $y`.
import { type Atom, atomEq } from "./atom";

export interface ValRel {
  readonly tag: "val";
  readonly x: string;
  readonly a: Atom;
  readonly y: undefined;
}
export interface EqRel {
  readonly tag: "eq";
  readonly x: string;
  readonly a: undefined;
  readonly y: string;
}
export type BindingRel = ValRel | EqRel;
export type Bindings = readonly BindingRel[];

export const emptyBindings: Bindings = [];

const valRel = (x: string, a: Atom): ValRel => ({ tag: "val", x, a, y: undefined });
const eqRel = (x: string, y: string): EqRel => ({ tag: "eq", x, a: undefined, y });

function isValFor(r: BindingRel, x: string): r is ValRel {
  return r.tag === "val" && r.x === x;
}

function firstValIndex(b: Bindings, x: string): number {
  for (let i = 0; i < b.length; i++) if (isValFor(b[i]!, x)) return i;
  return -1;
}

function copyWithoutVal(
  b: Bindings,
  x: string,
  first: number,
  out: BindingRel[] = [],
): BindingRel[] {
  for (let i = 0; i < first; i++) out.push(b[i]!);
  for (let i = first + 1; i < b.length; i++) {
    const r = b[i]!;
    if (!isValFor(r, x)) out.push(r);
  }
  return out;
}

/** The atom bound to `$x` by a direct `val` relation, if any (eq aliases are not followed). */
export function lookupVal(b: Bindings, x: string): Atom | undefined {
  for (let i = 0; i < b.length; i++) {
    const r = b[i]!;
    if (isValFor(r, x)) return r.a;
  }
  return undefined;
}

/** Remove direct value bindings for `x`; equality relations remain. */
export function removeVal(b: Bindings, x: string): Bindings {
  const first = firstValIndex(b, x);
  if (first < 0) return b;
  return copyWithoutVal(b, x, first);
}

/** True if the set contains a trivial self-loop (`$x ← $x` or `$x = $x`). */
export function hasLoop(b: Bindings): boolean {
  for (const r of b) {
    if (r.tag === "val" && r.a.kind === "var" && r.a.name === r.x) return true;
    if (r.tag === "eq" && r.x === r.y) return true;
  }
  return false;
}

/** Bind `$x ← a`, dropping any previous value binding for `$x`. Raw: no consistency check. */
export function addValRaw(b: Bindings, x: string, a: Atom): Bindings {
  const first = firstValIndex(b, x);
  if (first < 0) {
    return prependValRaw(b, x, a);
  }
  return copyWithoutVal(b, x, first, [valRel(x, a)]);
}

/** Prepend `$x ← a` when the caller has already proved `$x` has no direct value binding. */
export function prependValRaw(b: Bindings, x: string, a: Atom): Bindings {
  const rel = valRel(x, a);
  return b.length === 0 ? [rel] : [rel, ...b];
}

/** Add the alias `$x = $y` (a no-op when `x = y`). Raw: no consistency check. */
export function addEqRaw(b: Bindings, x: string, y: string): Bindings {
  if (x === y) return b;
  return [eqRel(x, y), ...b];
}

// --- accessors: the encapsulation boundary for the binding representation ---

/** Build a single value relation. The canonical `ValRel` constructor for callers outside this module. */
export function makeValRel(x: string, a: Atom): ValRel {
  return valRel(x, a);
}

/** Build a binding set from an explicit list of relations (newest-first). */
export function fromRelations(rels: readonly BindingRel[]): Bindings {
  return rels;
}

/** Number of relations in the set. */
export function size(b: Bindings): number {
  return b.length;
}

/** Whether the set has no relations. */
export function isEmpty(b: Bindings): boolean {
  return b.length === 0;
}

/** Every relation, newest-first (the order `merge` folds them in). */
export function relations(b: Bindings): Iterable<BindingRel> {
  return b;
}

/** Each current value binding as `[var, atom]`. */
export function* valEntries(b: Bindings): Iterable<readonly [string, Atom]> {
  for (const r of b) if (r.tag === "val") yield [r.x, r.a] as const;
}

/** Whether any value binding satisfies `pred`. */
export function someVal(b: Bindings, pred: (x: string, a: Atom) => boolean): boolean {
  for (const r of b) if (r.tag === "val" && pred(r.x, r.a)) return true;
  return false;
}

/** Whether the set carries any `eq` alias. */
export function hasEq(b: Bindings): boolean {
  for (const r of b) if (r.tag === "eq") return true;
  return false;
}

/** Each `eq` alias relation, newest-first. */
export function* eqRelations(b: Bindings): Iterable<EqRel> {
  for (const r of b) if (r.tag === "eq") yield r;
}

export { atomEq };
