<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# @metta-ts/hyperon

A TypeScript class API over the core, modeled on Python's `hyperon`. It wraps the core's immutable atoms in classes, and every Python method name is kept as an alias next to the idiomatic one, so ported Hyperon code reads naturally.

```bash
npm install @metta-ts/hyperon
```

## The MeTTa runner

```ts
class MeTTa {
  constructor();
  run(program: string, fuel?: number): Atom[][];                 // one Atom[] per !-query
  runAsync(program: string, fuel?: number): Promise<Atom[][]>;   // awaits async operations
  evaluateAtom(atom: Atom, fuel?: number): Atom[];               // evaluate one constructed atom
  evaluateAtomAsync(atom: Atom, fuel?: number): Promise<Atom[]>;
  parseAll(program: string): Atom[];
  parseSingle(program: string): Atom | undefined;
  space(): SpaceRef;                                             // the live top-level space
  tokenizer(): Tokenizer;
  getAtomTypes(atom: Atom): Atom[];                              // inferred types of an atom
  registerOperation(name: string, op: (args: Atom[]) => Atom[]): void;
  registerAsyncOperation(name: string, op: (args: Atom[]) => Promise<Atom[]>): void;
  registerToken(regex: RegExp, constr: (token: string) => Atom): void;
  registerAtom(name: string, atom: Atom): void;                 // bind a token to a fixed atom
}
```

`run` extends the knowledge base with non-bang atoms and evaluates each `!`-query. `space()` is live: atoms added through it are visible to the evaluator. A grounded operation registered with `registerOperation` that throws produces a MeTTa `(Error ...)` atom; throw `IncorrectArgumentError` instead to leave the call unevaluated so other rules can match.

```ts
class IncorrectArgumentError extends Error {}
function standardTokenizer(): Tokenizer
```

## Atoms

```ts
abstract class Atom {
  readonly catom: core.Atom;          // the underlying core atom
  static fromCAtom(c: core.Atom): Atom;
  metatype(): MetaType;
  equals(other: Atom): boolean;
  toString(): string;
  iterate(): Atom[];                  // this atom and all descendants, depth-first
  matchAtom(other: Atom): BindingsSet;
}
class SymbolAtom extends Atom { name(): string }
class VariableAtom extends Atom { name(): string; static parseName(name: string): VariableAtom }
class ExpressionAtom extends Atom { children(): Atom[] }
class GroundedAtom extends Atom {
  object(): GroundedObject;           // the wrapped object
  jsValue<T = unknown>(): T;          // typed shortcut for object().content
  groundedType(): Atom;
}
```

Constructors:

```ts
const S: (name: string) => SymbolAtom
const V: (name: string) => VariableAtom
const E: (...children: Atom[]) => ExpressionAtom
function G(obj: GroundedObject, type?: Atom): GroundedAtom
function ValueAtom(value: unknown, typeName?: string): GroundedAtom
function OperationAtom(name: string, op: (...args: Atom[]) => Atom[], unwrap?: boolean): GroundedAtom
const AtomType: { UNDEFINED, TYPE, ATOM, SYMBOL, VARIABLE, EXPRESSION, GROUNDED, ... }
```

`ValueAtom` wraps a JS value (primitives become MeTTa primitives; with a `typeName` it carries that type). `OperationAtom` makes a callable operation atom. `G` is the low-level constructor; an `OperationObject` becomes executable and a `MatchableObject` gets custom unification.

## Grounded objects

```ts
class GroundedObject { readonly content: unknown; readonly id?: string; copy(): GroundedObject }
class ValueObject extends GroundedObject { get value(): unknown; equals(other): boolean }
class MatchableObject extends ValueObject { match_(atom: Atom): unknown[] }  // override for custom unify
class OperationObject extends GroundedObject { execute(...args: Atom[]): Atom[] }
function clearGroundedObjects(): void
function groundToJs(g: core.Ground): unknown
function friendlyTypeName(atom: Atom): string
function atomIsError(atom: Atom): boolean
function atomsAreEquivalent(first: Atom, second: Atom): boolean
```

Subclass `MatchableObject` and override `match_` to define how a TypeScript type unifies; return one (empty) binding to match, none to fail. See [embedding objects](/typescript/embedding-objects).

## Spaces

```ts
class SpaceRef {
  addAtom(atom: Atom): void;
  removeAtom(atom: Atom): boolean;
  getAtoms(): Atom[];
  atomCount(): number;
  query(pattern: Atom): BindingsSet;                  // match a pattern, get binding frames
  subst(pattern: Atom, template: Atom): Atom[];       // match, then instantiate a template
}
class GroundingSpace extends SpaceRef { constructor() }   // a fresh in-memory space
```

## Bindings

```ts
class Bindings {
  resolve(variable: VariableAtom): Atom | undefined;
  pairs(): [VariableAtom, Atom][];
  addVarBinding(variable: VariableAtom, atom: Atom): boolean;
  addVarEquality(a: VariableAtom, b: VariableAtom): boolean;
  narrowVars(vars: VariableAtom[]): Bindings;
  merge(other: Bindings): BindingsSet;
  isEmpty(): boolean;
}
class BindingsSet {
  readonly frames: Bindings[];
  static empty(): BindingsSet; static single(): BindingsSet;
  get(index: number): Bindings | undefined;
  push(bindings: Bindings): void;
  isEmpty(): boolean; isSingle(): boolean;
}
```

A `query` returns a `BindingsSet`: an empty set means no match; one empty frame means a match binding nothing. Read a result with `frame.resolve(V("x"))`.

## Parsing

```ts
class Tokenizer { constructor(ctok?: core.Tokenizer); registerToken(regex: RegExp, constr): void }
class SExprParser { constructor(text: string); parse(tokenizer: Tokenizer): Atom | undefined; parseAll(tokenizer): Atom[] }
```

## Modules

```ts
function registerJsInterop(m: MeTTa): void   // js-atom / js-dot / js-list / js-dict
function registerJsonModule(m: MeTTa): void  // dict-space / get-keys / get-value / json-decode / json-encode
function registerCatalogModule(m: MeTTa, catalog: ModuleCatalog): void
function atomToJs(atom: Atom): unknown
function jsToAtom(value: unknown): Atom
class JsValue extends ValueObject
class SpaceValue extends ValueObject
class ModuleCatalog
```

See [JavaScript interop](/typescript/js-interop) for the interop module and `atomToJs`/`jsToAtom`.
