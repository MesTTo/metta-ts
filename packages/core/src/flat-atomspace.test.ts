// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { FlatAtomSpace } from "./flat-atomspace";
import { type Atom, expr, gint, gstr, sym, variable } from "./atom";
import { format, parseAll } from "./parser";
import { ORACLE_FILES, readOracleFile } from "./oracle-corpus";
import { standardTokenizer } from "./runner";

const BENCH_CORPUS = resolve(process.cwd(), "packages/node/bench/corpus-mettats");

const A = (...items: Atom[]): Atom => expr(items);

// All-compactable appends in these tests must succeed; fail loudly if one bails.
function mustAppend(store: FlatAtomSpace, atoms: Atom[]): FlatAtomSpace {
  const next = store.appendAll(atoms);
  if (next === undefined) throw new Error("appendAll unexpectedly bailed");
  return next;
}

const atomArb: fc.Arbitrary<Atom> = fc.letrec<{ atom: Atom }>((tie) => ({
  atom: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.stringMatching(/^[a-z][a-z0-9_]{0,5}$/).map(sym),
    fc.stringMatching(/^[a-z][a-z0-9_]{0,5}$/).map(variable),
    fc.integer({ min: -10_000, max: 10_000 }).map(gint),
    fc.string({ maxLength: 12 }).map(gstr),
    fc.array(tie("atom"), { maxLength: 4 }).map((xs) => expr(xs)),
  ),
})).atom;

function corpusAtoms(): Atom[] {
  const atoms: Atom[] = [];
  const tk = standardTokenizer();
  for (const name of ORACLE_FILES)
    atoms.push(...parseAll(readOracleFile(name), tk).map((top) => top.atom));
  for (const file of readdirSync(BENCH_CORPUS).filter((name) => name.endsWith(".metta"))) {
    const path = resolve(BENCH_CORPUS, file);
    atoms.push(...parseAll(readFileSync(path, "utf8"), tk).map((top) => top.atom));
  }
  return atoms;
}

describe("FlatAtomSpace encode/decode", () => {
  it("round-trips corpus and oracle atoms by format", () => {
    const store = FlatAtomSpace.empty();
    for (const atom of corpusAtoms()) expect(format(store.roundTrip(atom))).toEqual(format(atom));
  });

  it("round-trips random terms by format", () => {
    fc.assert(
      fc.property(atomArb, (atom) => {
        const store = FlatAtomSpace.empty();
        return format(store.roundTrip(atom)) === format(atom);
      }),
    );
  });
});

describe("FlatAtomSpace runtime store", () => {
  it("preserves multiplicity and tombstones one live fact", () => {
    const fact = A(sym("p"), sym("a"));
    const other = A(sym("p"), sym("b"));
    const store = mustAppend(FlatAtomSpace.empty(), [fact, fact, other]);

    expect(store.exactCount(fact)).toBe(2);
    const removed = store.removeOne(fact);
    expect(removed.exactCount(fact)).toBe(1);
    expect(removed.toArray().map(format)).toEqual(["(p a)", "(p b)"]);
  });

  it("keeps aborted append gaps invisible to later roots", () => {
    const base = mustAppend(FlatAtomSpace.empty(), [A(sym("p"), sym("base"))]);
    const branch = mustAppend(base, [A(sym("p"), sym("aborted"))]);
    const resumed = mustAppend(base, [A(sym("p"), sym("kept"))]);

    expect(branch.toArray().map(format)).toEqual(["(p base)", "(p aborted)"]);
    expect(resumed.toArray().map(format)).toEqual(["(p base)", "(p kept)"]);
  });

  it("streams candidates in insertion order with variable-headed facts included", () => {
    const store = mustAppend(FlatAtomSpace.empty(), [
      A(sym("p"), sym("a")),
      A(variable("h"), sym("wild")),
      A(sym("q"), sym("b")),
      A(sym("p"), sym("c")),
    ]);

    expect([...store.candidatesFor("p")].map(format)).toEqual(["(p a)", "($h wild)", "(p c)"]);
  });

  it("bails on a grounded executor and leaves the store usable", () => {
    const fact = A(sym("p"), sym("a"));
    const store = mustAppend(FlatAtomSpace.empty(), [fact]);
    const op = { ...gint(1), exec: () => [] } as unknown as Atom;
    expect(store.appendAll([A(sym("q"), op)])).toBeUndefined();
    // The aborted batch stays invisible; the store keeps working.
    expect(store.toArray().map(format)).toEqual(["(p a)"]);
    expect(mustAppend(store, [A(sym("p"), sym("b"))]).size).toBe(2);
  });
});
