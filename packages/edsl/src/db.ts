// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Typed runner around a `@metta-ts/hyperon` MeTTa instance. It keeps the two MeTTa mechanisms separate:
//   - `query` runs `match &self` over stored atoms and returns variable bindings (structural match).
//   - `eval` rewrites an atom with `=` rules and returns nondeterministic result atoms.
// `op` and `asyncOp` register TypeScript functions as grounded operations; `evalAsync` and `evalJsAsync`
// await async variants.
import { MeTTa, atomToJs, type Atom } from "@metta-ts/hyperon";
import { ground, type Term, type Var, type VarValue } from "./term";
import { rule, decl, assertEqual } from "./forms";

/** One typed binding row from a {@link MettaDB.query}: each requested variable mapped to its JS value. */
export type Row<V extends Record<string, Var>> = { [K in keyof V]: VarValue<V[K]> };

/** A typed MeTTa runner. Build it with {@link mettaDB}. */
export class MettaDB {
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

  /** `match &self pattern` over stored atoms, returning one typed row of JS bindings per match. */
  query<V extends Record<string, Var>>(pattern: Term, vars: V): Array<Row<V>> {
    const set = this.metta.space().query(ground(pattern));
    return set.frames.map((frame) => {
      const row = {} as Row<V>;
      for (const key in vars) {
        const bound = frame.resolve(vars[key]!);
        row[key] = (bound === undefined ? undefined : atomToJs(bound)) as Row<V>[typeof key];
      }
      return row;
    });
  }

  /** Register a synchronous TypeScript function as a grounded operation callable from MeTTa. */
  op(name: string, fn: (args: Atom[]) => Atom[]): this {
    this.metta.registerOperation(name, fn);
    return this;
  }

  /** Register an async TypeScript function (I/O) as a grounded operation; await it via {@link evalAsync}. */
  asyncOp(name: string, fn: (args: Atom[]) => Promise<Atom[]>): this {
    this.metta.registerAsyncOperation(name, fn);
    return this;
  }

  /** Run raw MeTTa source, one result group per `!`-query. */
  run(src: string): Atom[][] {
    return this.metta.run(src);
  }
}

/** Create an ergonomic, typed MeTTa runner. */
export const mettaDB = (): MettaDB => new MettaDB();
