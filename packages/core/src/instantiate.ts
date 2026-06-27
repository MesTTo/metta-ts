// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Applying a binding set as a substitution (LeaTTa `bindingsToSubst` / `instantiate`).
import { type Atom, variable } from "./atom";
import { type Bindings, lookupVal } from "./bindings";
import { type Subst } from "./substitution";

/** A binding set viewed as a substitution: value bindings only; `eq` aliases are dropped. */
export function bindingsToSubst(b: Bindings): Subst {
  const out: Array<readonly [string, Atom]> = [];
  for (const r of b) if (r.tag === "val") out.push([r.x, r.a]);
  return out;
}

/** Apply a binding set to an atom: replace each variable by its value binding (eq aliases dropped), one
 *  pass. Walks `b` directly via `lookupVal` instead of first materializing a `Subst` array on every call.
 *  that conversion was pure allocation on the hot substitution path (instantiate dominated the emit
 *  profile). A new term is built only where a child changed; the empty binding and closed subterms
 *  short-circuit to sharing. */
export function instantiate(b: Bindings, a: Atom, suffix = ""): Atom {
  if (a.kind === "var") {
    // `suffix` scopes a rule RHS's variables: `$x` resolves as `name<suffix>`, and an unbound one becomes
    // the freshened variable `name<suffix>`. The result is byte-identical to first freshening the RHS, just without the
    // clone. The suffix-free path (the overwhelming majority) is unchanged.
    if (suffix === "") return b.length === 0 ? a : (lookupVal(b, a.name) ?? a);
    const name = a.name + suffix;
    return lookupVal(b, name) ?? variable(name);
  }
  if (a.ground || a.kind !== "expr") return a;
  if (b.length === 0 && suffix === "") return a;
  const its = a.items;
  let items: Atom[] | null = null;
  for (let i = 0; i < its.length; i++) {
    const it = its[i]!;
    const r = instantiate(b, it, suffix);
    if (items !== null) items.push(r);
    else if (r !== it) {
      items = its.slice(0, i);
      items.push(r);
    }
  }
  return items === null ? a : { ...a, items };
}
