<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# @metta-ts/edsl

The ergonomic, typed eDSL. Builders produce ordinary atoms; the runner evaluates them on the core engine. For the conceptual tour, see [the typed eDSL](/edsl/overview); this page is the full surface.

```bash
npm install @metta-ts/edsl
```

## Terms

```ts
type Term = Atom | number | string | boolean | bigint | object | null | undefined;
type Var<T = unknown> = VariableAtom & { __varType?: T };
type VarValue<X> = X extends Var<infer T> ? T : unknown;

const v: <T = unknown>(name: string) => Var<T>           // a typed variable
const S: ((name: string) => SymbolAtom) & { [k: string]: SymbolAtom }  // S("Tom") or S.Tom
function ground(x: Term): Atom                            // atoms pass through; JS values are grounded
const e: (...items: Term[]) => ExpressionAtom             // a raw tuple/expression
function rel(name: string): (...args: Term[]) => ExpressionAtom  // a functor builder
const nil: () => ExpressionAtom                           // the empty list ()
function list(items: Term[], opts?: { cons?: string; nil?: Atom }): Atom  // (:: a (:: b ()))
```

A `Term` is anything a builder accepts: an atom, a variable, or a JS value that gets auto-grounded. `ground` is the primitive behind "pass a TypeScript object straight in".

## Special-form and operator combinators

```ts
const rule:  (head: Term, body: Term) => ExpressionAtom            // (= head body)
const decl:  (subject: Term, type: Term) => ExpressionAtom         // (: subject type)
const arrow: (...types: Term[]) => ExpressionAtom                  // (-> A B ... R)

const iff:    (cond: Term, then: Term, els: Term) => ExpressionAtom
const caseOf: (scrutinee: Term, cases: ReadonlyArray<readonly [Term, Term]>) => ExpressionAtom
const lett:   (pattern: Term, value: Term, body: Term) => ExpressionAtom
const letStar:(bindings: ReadonlyArray<readonly [Term, Term]>, body: Term) => ExpressionAtom
const matchSelf: (pattern: Term, template: Term, space?: Term) => ExpressionAtom  // defaults to &self
const superpose: (...items: Term[]) => ExpressionAtom
const collapse:  (x: Term) => ExpressionAtom
const empty:     () => ExpressionAtom
const unify:     (a: Term, b: Term, then: Term, els: Term) => ExpressionAtom

// arithmetic
const add, sub, mul, div, mod: (a: Term, b: Term) => ExpressionAtom
// comparison
const eq, gt, lt, ge, le: (a: Term, b: Term) => ExpressionAtom
// boolean
const and, or: (a: Term, b: Term) => ExpressionAtom
const not: (x: Term) => ExpressionAtom
// expression/list ops
const carAtom, cdrAtom: (x: Term) => ExpressionAtom
const consAtom: (head: Term, tail: Term) => ExpressionAtom
```

Each maps to the matching MeTTa form or grounded operation. Builders compose, so nested patterns are nested calls.

## The tagged template

```ts
function m(strings: TemplateStringsArray, ...values: Term[]): Atom      // exactly one atom
function mAll(strings: TemplateStringsArray, ...values: Term[]): Atom[] // several atoms
```

`m\`...\`` parses MeTTa source with `${...}` holes auto-grounded; it throws if the template is not exactly one atom (use `mAll` for several).

## The runner

```ts
const mettaDB: () => MettaDB

class MettaDB {
  readonly metta: MeTTa;                                  // the underlying hyperon runner
  add(...atoms: Term[]): this;                            // facts, rules, type declarations
  rule(head: Term, body: Term): this;                     // (= head body)
  declare(subject: Term, type: Term): this;              // (: subject type)
  eval(atom: Term): Atom[];                               // rewrite, return result atoms
  evalJs(atom: Term): unknown[];                          // results unwrapped to JS values
  evalAsync(atom: Term): Promise<Atom[]>;
  evalJsAsync(atom: Term): Promise<unknown[]>;
  query<V extends Record<string, Var>>(pattern: Term, vars: V): Array<Row<V>>;  // typed binding rows
  op(name: string, fn: (args: Atom[]) => Atom[]): this;
  asyncOp(name: string, fn: (args: Atom[]) => Promise<Atom[]>): this;
  run(src: string): Atom[][];                             // raw MeTTa source
}
type Row<V extends Record<string, Var>> = { [K in keyof V]: VarValue<V[K]> }
```

`query` runs `match &self` over stored atoms and returns one typed row per match, each variable mapped to its JS value (typed by the `Var<T>` phantom). `eval` rewrites with the `=` rules. `op`/`asyncOp` register TypeScript functions as grounded operations.
