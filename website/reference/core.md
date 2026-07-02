<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# @metta-ts/core

The interpreter: atoms, parsing, matching, unification, evaluation, the standard library, and the flat knowledge base. Everything else builds on this. It has no platform dependencies and runs in any JavaScript runtime.

```bash
npm install @metta-ts/core
```

## Running programs

```ts
function runProgram(src: string, fuel?: number, imports?: Map<string, Atom[]>): QueryResult[]
```

Parse and evaluate a MeTTa source string. Non-bang atoms are added to the knowledge base; each `!`-query is evaluated. Returns one `QueryResult` per `!`-query, in order. `fuel` bounds evaluation steps (default 100000). `imports` backs `import!` (pre-read by the caller).

```ts
function runProgramAsync(
  src: string,
  asyncOps?: Map<string, AsyncGroundFn>,
  fuel?: number,
  imports?: Map<string, Atom[]>,
): Promise<QueryResult[]>
```

Like `runProgram`, but `!`-queries are awaited so async grounded operations (passed in `asyncOps`) can do I/O. A program with no async operations gives identical results to `runProgram`.

```ts
interface QueryResult {
  readonly query: Atom;     // the !-query atom
  readonly results: Atom[]; // its (nondeterministic) results
}

function evalSequential(atoms: readonly { atom: Atom; bang: boolean }[], fuel?, imports?): QueryResult[]
function collectImports(src: string): string[]   // import! targets referenced by a program
```

`evalSequential` runs an already-parsed program. `collectImports` lists the module names a program `import!`s, so a host can pre-read them.

## Parsing and formatting

```ts
function parse(src: string, tk: Tokenizer): Atom | undefined        // the first atom
function parseAll(src: string, tk: Tokenizer): TopAtom[]            // every top-level atom
function parseTop(src: string, tk: Tokenizer): TopAtom | undefined  // first, with its bang flag
function format(a: Atom): string                                    // render an atom as MeTTa text
function standardTokenizer(): Tokenizer                             // integers, floats, True/False
class Tokenizer { registerToken(regex: RegExp, constr: (token: string) => Atom): void }
interface TopAtom { atom: Atom; bang: boolean }
```

`format` is the inverse of parsing for display. A `Tokenizer` turns leaf tokens into atoms; register custom tokens to parse new grounded literals.

## Atoms

An `Atom` is a discriminated union of four kinds:

```ts
type Atom = SymAtom | VarAtom | ExprAtom | GndAtom;
type MetaType = "Symbol" | "Variable" | "Expression" | "Grounded";
```

Constructors:

```ts
function sym(name: string): SymAtom
function variable(name: string): VarAtom
function expr(items: readonly Atom[]): ExprAtom
function gnd(value: Ground, typ?: Atom, exec?: GroundedExec, match?: GroundedMatch): GndAtom
const gint:  (n: number) => GndAtom    // Number (integer)
const gfloat:(n: number) => GndAtom    // Number (float)
const gstr:  (s: string) => GndAtom    // String
const gbool: (b: boolean) => GndAtom   // Bool
const gunit: GndAtom                    // the unit atom ()
const emptyExpr: ExprAtom
```

A grounded atom carries a `Ground` value plus an optional type, an optional `exec` (makes it callable as an operation), and an optional `match` (custom unification):

```ts
type GroundedExec  = (args: readonly Atom[]) => readonly Atom[];
type GroundedMatch = (other: Atom) => readonly unknown[];
function groundType(v: Ground): Atom;     // the default type of a ground value
function groundEq(a: Ground, b: Ground): boolean;
```

Inspection:

```ts
function metaType(a: Atom): MetaType
function atomEq(a: Atom, b: Atom): boolean       // structural equality
function atomSize(a: Atom): number               // node count
function atomVars(a: Atom, out?: string[]): string[]  // variable names occurring in a
function isErrorAtom(a: Atom): boolean
const isExpr, isVar, isSym, isGnd: (a: Atom) => a is ...  // type guards
```

## Matching and unification

```ts
function matchAtoms(l: Atom, r: Atom): Bindings[]     // every way l matches r
function matchAtomsWith(custom: GroundMatcher | undefined, l: Atom, r: Atom): Bindings[]
function unifyTop(a: Atom, b: Atom): Subst | null     // most general unifier, or null
function unifiable(a: Atom, b: Atom): boolean
function occurs(x: string, a: Atom): boolean
function alphaEq(a: Atom, b: Atom): boolean           // equality up to variable renaming
function instantiate(b: Bindings, a: Atom): Atom      // apply a binding frame to an atom
type GroundMatcher = (left: Atom, right: Atom) => Bindings[];
```

`Bindings` is an immutable frame of variable associations; a match returns a list of frames (nondeterminism):

```ts
type Bindings = readonly BindingRel[];
const emptyBindings: Bindings;
function lookupVal(b: Bindings, x: string): Atom | undefined
function eqClasses(b: Bindings, x: string): string[]
function addValRaw(b: Bindings, x: string, a: Atom): Bindings
function addEqRaw(b: Bindings, x: string, y: string): Bindings
function merge(a: Bindings, b: Bindings): Bindings[]   // consistent combinations of two frames
function bindingsToSubst(b: Bindings): Subst
```

A `Subst` is the simpler variable-to-atom substitution used by unification:

```ts
type Subst = ReadonlyArray<readonly [string, Atom]>;
function applySubst(s: Subst, a: Atom): Atom
function extendSubst(s: Subst, x: string, a: Atom): Subst
function lookupSubst(s: Subst, x: string): Atom | undefined
```

## Grounded operations and evaluation

A grounded operation returns a `ReduceResult`:

```ts
type ReduceResult =
  | { tag: "ok"; results: Atom[] }
  | { tag: "noReduce" }
  | { tag: "incorrectArgument"; msg: string }  // leave unevaluated, try other rules
  | { tag: "runtimeError"; msg: string };      // becomes an (Error ...) atom
type GroundFn = (args: readonly Atom[]) => ReduceResult;
type AsyncGroundFn = (args: readonly Atom[]) => Promise<ReduceResult>;
type GroundingTable = Map<string, GroundFn>;

function baseTable(): GroundingTable     // the primitive operations
function stdTable(): GroundingTable      // base + standard library host primitives
function callGrounded(gt: GroundingTable, op: string, args: readonly Atom[]): ReduceResult
function setOutputSink(fn: (line: string) => void): (line: string) => void  // capture println!/trace! lines
function setRawSink(fn: (text: string) => void): (text: string) => void      // capture print! (no trailing newline)
class AsyncInSyncError extends Error     // thrown if a sync run reaches an async op
```

For incremental evaluation below `runProgram`, build an environment and evaluate atoms directly:

```ts
function buildEnv(atoms: Atom[], gt: GroundingTable): MinEnv
function emptyEnv(gt: GroundingTable): MinEnv
function addAtomToEnv(env: MinEnv, x: Atom): void   // index one atom (rules, types, clause index)
const initSt: () => St                              // a fresh evaluation state
function mettaEval(env, fuel, st, bnd: Bindings, a: Atom): [Array<[Atom, Bindings]>, St]
function mettaEvalAsync(env, fuel, st, bnd, a, signal?: AbortSignal): Promise<[Array<[Atom, Bindings]>, St]>
function evalAtom(env: MinEnv, atom: Atom, st?, fuel?): [Atom[], St]
function getTypes(env: MinEnv, a: Atom): Atom[]
```

## Spaces

```ts
interface Space { /* add, remove, atoms, query, ... */ }
class InMemorySpace implements Space
```

The default `&self` space is an `InMemorySpace`. For the class-style space API, see [`@metta-ts/hyperon`](/reference/hyperon).

## Standard library and modules

```ts
function preludeAtoms(): Atom[]       // the prelude (cached)
function stdlibAtoms(): Atom[]        // the standard library, always loaded (cached)
function builtinModules(): Map<string, Atom[]>             // opt-in modules, e.g. "concurrency"
function withBuiltinModules(extra?: Map<string, Atom[]>): Map<string, Atom[]>
const STDLIB_SRC: string
const CONCURRENCY_MODULE_SRC: string
```

## The flat knowledge base

For large, mostly-ground knowledge bases, `FlatKB` stores atoms as interned `Int32` tokens:

```ts
class FlatKB {
  readonly interner: Interner;
  add(a: Atom): void;
  match(pattern: Atom): Array<Map<string, Atom>>;   // variable name -> matched atom, per match
  get tokenArray(): readonly number[];              // for packing into a SharedArrayBuffer
  get factOffsets(): readonly number[];
  get size(): number;
}
class Interner {
  internSym(name: string): number; internGround(value: Ground): number;
  lookupSym(name: string): number | undefined; lookupGround(value: Ground): number | undefined;
  decodeLeaf(id: number): Atom; get size(): number;
}
function encodeAtom(a: Atom, it: Interner): number[]
function decodeAtom(tokens: Int32Array | number[], it: Interner): Atom
function encodePattern(a: Atom, it: Interner): { tokens: number[]; varNames: string[] }
function matchFlatAt(pat: ArrayLike<number>, fact: Int32Array | number[], factStart: number): Map<number, [number, number]> | null
const TAG_ARITY, TAG_SYMBOL, TAG_NEWVAR, TAG_VARREF: number
```

### Frequent-subpattern mining

```ts
function williamTopK(kb: FlatKB, k: number, refCost?: number): HeavyPattern[]
interface HeavyPattern { pattern: Atom; count: number; len: number; gain: number }
```

`williamTopK` returns the top-`k` repeated subpatterns by compression gain `(count - 1) * len - count * refCost`. See [scaling](/advanced/scaling) for usage and benchmarks.
