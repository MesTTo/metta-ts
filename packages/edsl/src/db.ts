// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Typed runner around a `@metta-ts/hyperon` MeTTa instance. It keeps the two MeTTa mechanisms separate:
//   - `query` runs `match &self` over stored atoms and returns variable bindings (structural match).
//   - `eval` rewrites an atom with `=` rules and returns nondeterministic result atoms.
// Host bridge, both directions:
//   - `op`/`asyncOp` register raw (Atom[] -> Atom[]) grounded operations; `fn`/`fns`/`asyncFn` register
//     plain typed TypeScript functions with args auto-unwrapped and the result auto-grounded.
//   - `call` (a proxy) and `import` call MeTTa functions from TypeScript: `db.call.fib(5)` or a typed
//     `const fib = db.import<[number], number>("fib")`.
import {
  MeTTa,
  E,
  S,
  atomToJs,
  registerJsonModule,
  type Atom,
  type ExpressionAtom,
} from "@metta-ts/hyperon";
import { ground, patternVars, type Term, type Var, type VarValue } from "./term";
import { rule, decl, assertEqual } from "./forms";
import { parseSource } from "./template";
import { type SourceRow } from "./source-vars";

/** One typed binding row from {@link MettaDB.query} with explicit vars: each requested variable mapped
 *  to its JS value. */
export type Row<V extends Record<string, Var>> = { [K in keyof V]: VarValue<V[K]> };

/** Any function, used as the permissive default for names outside a schema. */
type AnyFn = (...args: never[]) => unknown;

/** A schema mapping MeTTa function names to their TypeScript signatures, for a typed runner:
 *  `mettaDB<{ fact: (n: number) => number }>()`. Both an `interface` and a `type` work. */
export type FnSchema = Record<string, AnyFn>;

/** The argument tuple / return type of a schema entry (like `Parameters`/`ReturnType`, but tolerant of
 *  a non-function member, which extracts as `never`). */
type FnArgs<F> = F extends (...a: infer A) => unknown ? A : never;
type FnRet<F> = F extends (...a: never[]) => infer R ? R : never;

/** A MeTTa function imported as a typed TypeScript callable (see {@link MettaDB.import}). Returns the
 *  first result unwrapped to JS, or `undefined` when the call produces no result. */
export type ImportedFn<Args extends unknown[], Ret> = (...args: Args) => Ret | undefined;

/** Proxy surface for calling MeTTa functions by name. A name in the schema `S` is typed by its
 *  signature (`db.call.fact(5): number[]`); any other name falls back to `unknown[]`. Bracket access
 *  handles hyphenated names: `db.call["is-son"]("Bob", "Tom")`. */
export type CallProxy<S> = {
  [K in keyof S]: (...args: FnArgs<S[K]>) => FnRet<S[K]>[];
} & Record<string, (...args: Term[]) => unknown[]>;

/** A typed MeTTa runner. Build it with {@link mettaDB}. The optional schema `S` types the host bridge
 *  (`call`, `import`, `fn`); the default is an empty schema, so with no schema those stay permissive
 *  (`db.call.<any>(...)` is `unknown[]`, `db.import(name)` a permissive callable) but still work. */
export class MettaDB<S = Record<never, never>> {
  /** The underlying hyperon runner, for anything the eDSL does not wrap. */
  readonly metta: MeTTa = new MeTTa();

  /** Add atoms (facts, rules, type declarations) to the program space. JS values are auto-grounded. */
  add(...atoms: Term[]): this {
    const space = this.metta.space();
    for (const a of atoms) space.addAtom(ground(a));
    return this;
  }

  /** Add a rewrite rule `(= head body)`. Call repeatedly with the same head for nondeterminism. */
  rule(head: Term, body: Term): this {
    return this.add(rule(head, body));
  }

  /** Add a type declaration `(: subject type)`. */
  declare(subject: Term, type: Term): this {
    return this.add(decl(subject, type));
  }

  /** Evaluate an atom by rewriting, returning all (nondeterministic) result atoms. */
  eval(atom: Term): Atom[] {
    return this.metta.evaluateAtom(ground(atom));
  }

  /** Evaluate and return the first result atom, or `undefined` for no result. */
  evalFirst(atom: Term): Atom | undefined {
    return this.eval(atom)[0];
  }

  /** Like {@link eval}, but each result unwrapped to a plain JS value (grounded -> value, symbol -> name,
   *  expression -> array). */
  evalJs(atom: Term): unknown[] {
    return this.eval(atom).map(atomToJs);
  }

  /** Evaluate `(assertEqual actual expected)` and report whether it passed. A passing assert reduces to
   *  the unit atom `()`; a failing one to an `(Error ...)`. Use it for tests written in the eDSL. */
  test(actual: Term, expected: Term): boolean {
    const results = this.eval(assertEqual(actual, expected));
    if (results.length !== 1) return false;
    const js = atomToJs(results[0]!);
    return Array.isArray(js) && js.length === 0;
  }

  /** Like {@link eval}, awaiting any async grounded operations reached during evaluation. */
  async evalAsync(atom: Term): Promise<Atom[]> {
    return this.metta.evaluateAtomAsync(ground(atom));
  }

  /** Like {@link evalJs}, awaiting async grounded operations. */
  async evalJsAsync(atom: Term): Promise<unknown[]> {
    return (await this.evalAsync(atom)).map(atomToJs);
  }

  /** `match &self pattern` over stored atoms, returning one binding row per match. With no `vars`, the
   *  row keys are inferred from the pattern's free variables and the values come back as plain JS
   *  (typed `unknown`); pass an explicit `vars` map to get statically-typed values. */
  query(pattern: Term): Array<Record<string, unknown>>;
  query<V extends Record<string, Var>>(pattern: Term, vars: V): Array<Row<V>>;
  query<V extends Record<string, Var>>(
    pattern: Term,
    vars?: V,
  ): Array<Row<V>> | Array<Record<string, unknown>> {
    const pat = ground(pattern);
    const set = this.metta.space().query(pat);
    const cols: Record<string, Var> =
      vars ?? Object.fromEntries(patternVars(pat).map((v) => [v.name(), v]));
    return set.frames.map((frame) => {
      const row: Record<string, unknown> = {};
      for (const key in cols) {
        const bound = frame.resolve(cols[key]!);
        row[key] = bound === undefined ? undefined : atomToJs(bound);
      }
      return row as Row<V>;
    });
  }

  /** `match &self` from a plain MeTTa source string, with the result rows typed by the pattern's
   *  `$`-variables: `db.q("(Likes Ada $thing)")` returns `Array<{ thing: unknown }>`, keys inferred and
   *  autocompleted at compile time. Values are `unknown` (they come from runtime rewriting). For the
   *  builder form use {@link query}. */
  q<Src extends string>(src: Src): Array<SourceRow<Src>> {
    return this.query(parseSource(src)) as Array<SourceRow<Src>>;
  }

  /** Register a synchronous TypeScript function as a raw grounded operation (atoms in, atoms out). */
  op(name: string, fn: (args: Atom[]) => Atom[]): this {
    this.metta.registerOperation(name, fn);
    return this;
  }

  /** Register an async TypeScript function (I/O) as a raw grounded operation; await it via
   *  {@link evalAsync}. */
  asyncOp(name: string, fn: (args: Atom[]) => Promise<Atom[]>): this {
    this.metta.registerAsyncOperation(name, fn);
    return this;
  }

  /** Shared body of {@link fn}/{@link fns}: unwrap args to JS, call, ground the result. */
  private registerFn(name: string, fn: AnyFn): this {
    return this.op(name, (args) => [ground(fn(...(args.map(atomToJs) as never[])) as Term)]);
  }

  /** Register a plain typed function as a grounded operation, with arguments auto-unwrapped to JS and the
   *  single result auto-grounded: `db.fn("balance-of", (a: {balance: number}) => a.balance)`. When the
   *  name is in the schema `S`, `fn` is checked against its declared signature. Return an array from `fn`
   *  to yield it as one grounded list; use {@link op} for multiple (nondeterministic) results or full
   *  atom control. */
  fn<K extends string>(name: K, fn: K extends keyof S ? S[K] : AnyFn): this {
    return this.registerFn(name, fn as AnyFn);
  }

  /** Register several typed functions at once, keyed by name: `db.fns({ inc: n => n+1, ... })`. The JS
   *  key becomes the MeTTa token. */
  fns(map: Record<string, AnyFn>): this {
    for (const [name, fn] of Object.entries(map)) this.registerFn(name, fn);
    return this;
  }

  /** Register a plain async typed function as a grounded operation (args unwrapped, result grounded). */
  asyncFn(name: string, fn: (...args: never[]) => Promise<unknown>): this {
    return this.asyncOp(name, async (args) => [
      ground((await fn(...(args.map(atomToJs) as never[]))) as Term),
    ]);
  }

  /** Import a MeTTa function as a typed TypeScript callable. Arguments are auto-grounded, the call is
   *  `(name ...args)`, and the first result is unwrapped to JS. A name in the schema `S` is typed from
   *  its signature (`db.import("fact")`); a name outside the schema returns a permissive callable. */
  import<K extends string>(
    name: K,
  ): K extends keyof S ? ImportedFn<FnArgs<S[K]>, FnRet<S[K]>> : ImportedFn<unknown[], unknown> {
    const fn = (...args: unknown[]): unknown => {
      const results = this.evalJs(callExpr(name, args as Term[]));
      return results.length === 0 ? undefined : results[0];
    };
    return fn as K extends keyof S
      ? ImportedFn<FnArgs<S[K]>, FnRet<S[K]>>
      : ImportedFn<unknown[], unknown>;
  }

  /** Proxy for calling MeTTa functions by name from TypeScript. `db.call.fib(5)` evaluates `(fib 5)` and
   *  returns each result unwrapped to JS; bracket access handles hyphenated names. */
  get call(): CallProxy<S> {
    return new Proxy(Object.create(null) as CallProxy<S>, {
      get: (_t, prop) =>
        typeof prop === "string"
          ? (...args: Term[]): unknown[] => this.evalJs(callExpr(prop, args))
          : undefined,
    });
  }

  /** Enable the JSON module on this runner, registering `json-encode`, `json-decode`, `dict-space`,
   *  `get-keys`, and `get-value` (see the builders of the same name). Chainable. */
  useJson(): this {
    registerJsonModule(this.metta);
    return this;
  }

  /** Run raw MeTTa source, one result group per `!`-query. */
  run(src: string): Atom[][] {
    return this.metta.run(src);
  }
}

/** `(name ...args)` as an expression atom with each argument auto-grounded. */
function callExpr(name: string, args: Term[]): ExpressionAtom {
  return E(S(name), ...args.map(ground));
}

/** Create an ergonomic, typed MeTTa runner. Pass a schema to type the host bridge:
 *  `mettaDB<{ fact: (n: number) => number }>()`. */
export const mettaDB = <S = Record<never, never>>(): MettaDB<S> => new MettaDB<S>();
