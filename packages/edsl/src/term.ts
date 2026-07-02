// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// eDSL term builders produce ordinary `@metta-ts/hyperon` atoms, so results run unchanged through the
// existing interpreter.
//
// Two conventions keep terms unambiguous:
//   - Symbols are explicit: `S("Tom")` or `S.Tom`.
//   - Any other JS value (number, string, boolean, object, array, Map, class instance) passed where a
//     term is expected is auto-grounded into a grounded atom, so TypeScript objects can appear in rules
//     and queries.
import {
  Atom,
  S as hS,
  V,
  E,
  ValueAtom,
  type SymbolAtom,
  type VariableAtom,
  type ExpressionAtom,
} from "@metta-ts/hyperon";

/** A typed variable. The phantom `T` is the JS type its binding unwraps to in a query result; it is a
 *  compile-time promise, while the runtime value is whatever unifies. */
export type Var<T = unknown> = VariableAtom & { readonly __varType?: T };

/** Anything a builder accepts in term position: an atom (incl. a {@link Var}), or a JS value to ground. */
export type Term = Atom | number | string | boolean | bigint | object | null | undefined;

/** Extract a {@link Var}'s phantom type (defaults to `unknown`). */
export type VarValue<X> = X extends Var<infer T> ? T : unknown;

/** A fresh typed variable: `v("x")` or `v<number>("n")`. */
export const v = <T = unknown>(name: string): Var<T> => V(name) as Var<T>;

/** `S` builds a symbol two ways: as a function `S("foo")` or as a property `S.foo`. */
export type SymbolBuilder = ((name: string) => SymbolAtom) & { readonly [key: string]: SymbolAtom };

export const S: SymbolBuilder = new Proxy(((name: string) => hS(name)) as SymbolBuilder, {
  get(_target, prop): SymbolAtom | undefined {
    return typeof prop === "string" ? hS(prop) : undefined;
  },
});

/** Coerce a {@link Term} to an atom: atoms and variables pass through; every other JS value is grounded. */
export function ground(x: Term): Atom {
  if (x instanceof Atom) return x;
  return ValueAtom(x as unknown);
}

/** A raw expression (tuple) from its items, each auto-grounded: `e(x, y, x)` builds `($x $y $x)`. Use it
 *  for patterns that are not headed by a functor, e.g. repeated-variable patterns or pair structures. */
export const e = (...items: Term[]): ExpressionAtom => E(...items.map(ground));

/** A functor builder: `rel("parent")` returns `(a, b) => (parent a b)`, auto-grounding each argument.
 *  Builders compose, so nested patterns like `rel("swap")(rel("Pair")(x, y))` are just function calls. */
export function rel(name: string): (...args: Term[]) => ExpressionAtom {
  const head = hS(name);
  return (...args: Term[]): ExpressionAtom => E(head, ...args.map(ground));
}

/** The empty expression `()`, MeTTa's conventional empty/nil list. */
export const nil = (): ExpressionAtom => E();

/** A Lisp-style cons list: `list([a, b, c])` builds `(:: a (:: b (:: c ())))`. Override the constructor
 *  and terminator symbols if your code uses different ones. */
export function list(items: Term[], opts?: { cons?: string; nil?: Atom }): Atom {
  const cons = hS(opts?.cons ?? "::");
  let acc: Atom = opts?.nil ?? E();
  for (let i = items.length - 1; i >= 0; i--) acc = E(cons, ground(items[i]!), acc);
  return acc;
}
