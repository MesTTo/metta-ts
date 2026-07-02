// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { buildEnv, addAtomToEnv, initSt, mettaEval } from "./eval";
import { stdTable } from "./builtins";
import { preludeAtoms, runProgram } from "./runner";
import { stdlibAtoms } from "./stdlib";
import { sym, expr, gint } from "./atom";
import { parseAll } from "./parser";
import { standardTokenizer } from "./runner";
import { format } from "./parser";

const last = (src: string): string[] => {
  const r = runProgram(src);
  return r[r.length - 1]!.results.map(format);
};

// Functor (first-argument) indexing makes `match` skip atoms of other functors, so it scales to a huge
// &self instead of a linear scan (Prolog-style clause indexing).
describe("match functor indexing", () => {
  it("a functor-headed query returns only that functor's atoms", () => {
    expect(
      last(`
        !(add-atom &self (P a 1))
        !(add-atom &self (P b 2))
        !(add-atom &self (Q x 9))
        !(collapse (match &self (P $k $v) $v))
      `),
    ).toEqual(["(1 2)"]);
  });

  it("a variable-headed query still scans everything", () => {
    expect(
      last(`
        !(add-atom &self (Foo 1))
        !(collapse (match &self ($f 1) $f))
      `),
    ).toEqual(["(Foo)"]);
  });

  it("conjunctive match works through the index", () => {
    expect(
      last(`
        !(add-atom &self (link A B))
        !(add-atom &self (link B C))
        !(collapse (match &self (, (link $x $y) (link $y $z)) ($x $z)))
      `),
    ).toEqual(["((A C))"]);
  });

  it("scales: one match over a 100k-atom KB is fast and correct", () => {
    const env = buildEnv([...preludeAtoms(), ...stdlibAtoms()], stdTable());
    for (let i = 0; i < 100_000; i++) addAtomToEnv(env, expr([sym("Item"), gint(i)]));
    addAtomToEnv(env, expr([sym("Parent"), sym("Tom"), sym("Bob")]));
    const q = parseAll("!(match &self (Parent $x Bob) $x)", standardTokenizer())[0]!.atom;
    const t = performance.now();
    const [pairs] = mettaEval(env, 100_000, initSt(), [], q);
    const ms = performance.now() - t;
    expect(pairs.map((p) => format(p[0]))).toEqual(["Tom"]);
    // Indexed: ~sub-ms. Linear over 100k would be orders of magnitude slower; allow generous headroom.
    expect(ms).toBeLessThan(50);
  });

  it("scales by any argument: a single huge functor is fast keyed by either position", () => {
    // 100k atoms all of functor `edge`; functor indexing alone wouldn't help. Argument indexing does,
    // and it indexes every position, so querying by the 1st or the 2nd argument is fast.
    const env = buildEnv([...preludeAtoms(), ...stdlibAtoms()], stdTable());
    for (let i = 0; i < 100_000; i++) addAtomToEnv(env, expr([sym("edge"), gint(i), gint(i + 1)]));
    const run = (qs: string): [string[], number] => {
      const q = parseAll(qs, standardTokenizer())[0]!.atom;
      const t = performance.now();
      const [pairs] = mettaEval(env, 200_000, initSt(), [], q);
      return [pairs.map((p) => format(p[0])), performance.now() - t];
    };
    const [byFirst, ms1] = run("!(match &self (edge 50000 $y) $y)");
    expect(byFirst).toEqual(["50001"]);
    expect(ms1).toBeLessThan(20);
    const [bySecond, ms2] = run("!(match &self (edge $x 50000) $x)");
    expect(bySecond).toEqual(["49999"]);
    expect(ms2).toBeLessThan(20);
  });

  it("a var first-arg atom still matches a ground first-arg query (functorVarFirst bucket)", () => {
    // (edge $a 9) has a variable first arg; it must be a candidate for (edge 1 $y), binding $y=9.
    expect(
      last(`
        !(add-atom &self (edge 1 2))
        !(add-atom &self (edge $a 9))
        !(collapse (match &self (edge 1 $y) $y))
      `),
    ).toEqual(["(2 9)"]);
  });
});
