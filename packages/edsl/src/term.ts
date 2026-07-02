// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// eDSL term builders produce ordinary `@metta-ts/hyperon` atoms, so results run unchanged through the
// existing interpreter.
//
// Two conventions keep terms unambiguous:
//   - Names come from proxies: `const { Ada, parent } = names()` mints a symbol/functor per key, and
//     `const { x, y } = vars()` mints a fresh logic variable per key. A bare name grounds to its symbol;
//     a called name applies it, so `parent(Ada, Bob)` builds `(parent Ada Bob)`.
//   - Any other JS value (number, string, boolean, object, array, Map, class instance) passed where a
//     term is expected is auto-grounded into a grounded atom, so TypeScript objects appear in rules and
//     queries directly.
import {
  Atom,
  S as hS,
  V,
  E,
  ValueAtom,
  SymbolAtom,
  VariableAtom,
  ExpressionAtom,
} from "@metta-ts/hyperon";

/** A typed variable. The phantom `T` is the JS type its binding unwraps to in a query result; it is a
 *  compile-time promise, while the runtime value is whatever unifies. */
export type Var<T = unknown> = VariableAtom & { readonly __varType?: T };

/** Brand marking a functor/symbol builder minted by {@link names}. A branded builder is a callable
 *  object (TS call-signature pattern) whose brand carries its head symbol, so {@link ground} can turn a
 *  bare, uncalled builder into that symbol. A real `unique symbol` (runtime value and type-level key)
 *  cannot collide with user data. */
const HEAD: unique symbol = Symbol("metta.edsl.head");

/** A name minted by {@link names}: call it to apply the functor (`parent(a, b)` -> `(parent a b)`), or
 *  use it bare as a term, where it grounds to its symbol (`Ada` -> the symbol `Ada`). */
export type Name = ((...args: Term[]) => ExpressionAtom) & { readonly [HEAD]: SymbolAtom };

/** Anything a builder accepts in term position: an atom (incl. a {@link Var}), a {@link Name}, or a JS
 *  value to ground. `Name` is a function, hence covered by `object`, but is listed for intent. */
export type Term = Atom | Name | number | string | boolean | bigint | object | null | undefined;

/** Extract a {@link Var}'s phantom type (defaults to `unknown`). */
export type VarValue<X> = X extends Var<infer T> ? T : unknown;

function isName(x: unknown): x is Name {
  return typeof x === "function" && (x as Partial<Name>)[HEAD] !== undefined;
}

/** Coerce a {@link Term} to an atom: atoms and variables pass through; a bare builder becomes its head
 *  symbol; every other JS value is grounded. */
export function ground(x: Term): Atom {
  if (x instanceof Atom) return x;
  if (isName(x)) return x[HEAD];
  return ValueAtom(x as unknown);
}

/** Build one {@link Name} for `name`: a callable functor builder branded with its head symbol. */
function makeName(name: string): Name {
  const head = hS(name);
  const fn = (...args: Term[]): ExpressionAtom => E(head, ...args.map(ground));
  return Object.assign(fn, { [HEAD]: head, toString: () => name }) as Name;
}

/** A proxy that mints a {@link Name} per property, memoised so `p.parent` is stable within one scope:
 *  `const { parent, Ada, Bob } = names()`. Symbols and functors share this one namespace; a name is a
 *  symbol when used bare and a functor when applied. Optionally type the known names:
 *  `names<{ parent: unknown; Ada: unknown }>()` restricts the keys. */
export type Names<K extends string = string> = Record<K, Name>;

export function names<K extends string = string>(): Names<K> {
  const cache = new Map<string, Name>();
  return new Proxy(Object.create(null) as Names<K>, {
    get(_t, prop): Name | undefined {
      if (typeof prop !== "string") return undefined;
      let n = cache.get(prop);
      if (n === undefined) {
        n = makeName(prop);
        cache.set(prop, n);
      }
      return n;
    },
  });
}

/** A proxy that mints a fresh {@link Var} per property, memoised so `q.x` is the same variable
 *  everywhere in one scope: `const { x, y } = vars()`. Type the bindings with a record:
 *  `const { n, name } = vars<{ n: number; name: string }>()`. */
export type Vars<T extends Record<string, unknown> = Record<string, unknown>> = {
  readonly [K in keyof T]: Var<T[K]>;
};

export function vars<T extends Record<string, unknown> = Record<string, unknown>>(): Vars<T> {
  const cache = new Map<string, Var>();
  return new Proxy(Object.create(null) as Vars<T>, {
    get(_t, prop): Var | undefined {
      if (typeof prop !== "string") return undefined;
      let x = cache.get(prop);
      if (x === undefined) {
        x = V(prop) as Var;
        cache.set(prop, x);
      }
      return x;
    },
  });
}

/** Collect the distinct variables occurring in a pattern, in first-seen order. Backs auto-inferred
 *  query rows: the free variables ARE the columns. */
export function patternVars(atom: Atom): Var[] {
  const seen = new Map<string, Var>();
  const walk = (a: Atom): void => {
    if (a instanceof VariableAtom) {
      if (!seen.has(a.name())) seen.set(a.name(), a as Var);
    } else if (a instanceof ExpressionAtom) for (const c of a.children()) walk(c);
  };
  walk(atom);
  return [...seen.values()];
}

/** A raw expression (tuple) from its items, each auto-grounded: `e(x, y, x)` builds `($x $y $x)`. Use it
 *  for patterns not headed by a functor, e.g. repeated-variable patterns or pair structures. */
export const e = (...items: Term[]): ExpressionAtom => E(...items.map(ground));

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
