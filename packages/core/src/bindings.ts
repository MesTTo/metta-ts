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

/** The atom bound to `$x` by a direct `val` relation, if any (eq aliases are not followed). */
export function lookupVal(b: Bindings, x: string): Atom | undefined {
  for (const r of b) if (r.tag === "val" && r.x === x) return r.a;
  return undefined;
}

/** Remove direct value bindings for `x`; equality relations remain. */
export function removeVal(b: Bindings, x: string): Bindings {
  return b.filter((r) => !(r.tag === "val" && r.x === x));
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
  return [valRel(x, a), ...removeVal(b, x)];
}

/** Add the alias `$x = $y` (a no-op when `x = y`). Raw: no consistency check. */
export function addEqRaw(b: Bindings, x: string, y: string): Bindings {
  return x === y ? b : [eqRel(x, y), ...b];
}

export { atomEq };
