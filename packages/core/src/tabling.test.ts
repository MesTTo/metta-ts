// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { buildEnv } from "./eval";
import { stdTable } from "./builtins";
import { parseAll } from "./parser";
import { standardTokenizer, preludeAtoms, runProgram } from "./runner";
import { analyzePurity, tableKey, keyWellFormed } from "./tabling";
import { expr, sym, gint, gfloat } from "./atom";
import { format } from "./parser";

const atoms = (src: string) =>
  parseAll(src, standardTokenizer())
    .filter((t) => !t.bang)
    .map((t) => t.atom);

describe("purity analysis", () => {
  it("a pure arithmetic recursion is pure; a state-using one is not", () => {
    const env = buildEnv(
      [
        ...preludeAtoms(),
        ...atoms(
          "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))\n" +
            "(= (bump) (change-state! &s 1))\n" +
            "(= (viafib $n) (+ 1 (fib $n)))",
        ),
      ],
      stdTable(),
    );
    const pure = analyzePurity(env);
    expect(pure.has("fib")).toBe(true);
    expect(pure.has("viafib")).toBe(true);
    expect(pure.has("bump")).toBe(false);
  });

  it("impurity propagates to callers", () => {
    const env = buildEnv(
      [...preludeAtoms(), ...atoms("(= (a) (b))\n(= (b) (add-atom &self x))")],
      stdTable(),
    );
    const pure = analyzePurity(env);
    expect(pure.has("a")).toBe(false);
    expect(pure.has("b")).toBe(false);
  });

  it("tableKey is stable and keyWellFormed rejects floats", () => {
    const call = expr([sym("fib"), gint(30)]);
    expect(tableKey(call)).toBe("(fib 30)");
    expect(keyWellFormed(call)).toBe(true);
    expect(keyWellFormed(expr([sym("g"), gfloat(1.5)]))).toBe(false);
  });
});

describe("tabling end to end", () => {
  it("tabled fib agrees with untabled (fib 20) and computes fib(30) fast", () => {
    const fib = "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))";
    const small = `${fib}\n!(fib 20)`;
    const untabled = runProgram(small, 100_000, new Map(), { tabling: false });
    const tabled = runProgram(small, 100_000, new Map(), { tabling: true });
    expect(tabled.map((r) => r.results.map(format))).toEqual(
      untabled.map((r) => r.results.map(format)),
    );
    // fib(30) is infeasible untabled (~35s); tabled it is instant and exact.
    const big = runProgram(`${fib}\n!(fib 30)`, 100_000, new Map(), { tabling: true });
    expect(big[0]!.results.map(format)).toEqual(["832040"]);
  });

  it("tabling preserves multiplicity of a pure function over many calls", () => {
    const src = "(= (tri $n) (if (< $n 1) 0 (+ $n (tri (- $n 1)))))\n!(+ (tri 5) (tri 5))";
    const tabled = runProgram(src, 100_000, new Map(), { tabling: true });
    expect(tabled[0]!.results.map(format)).toEqual(["30"]);
  });
});

describe("tabling invalidation", () => {
  it("a runtime add-atom of a new equation does not serve a stale cached answer", () => {
    const src =
      "(= (g $x) $x)\n" +
      "!(g 1)\n" + // primes the cache with (g 1)
      "!(add-atom &self (= (g 1) 99))\n" + // g's equations change at runtime
      "!(g 1)";
    const tabled = runProgram(src, 100_000, new Map(), { tabling: true });
    const untabled = runProgram(src, 100_000, new Map(), { tabling: false });
    const lastT = tabled[tabled.length - 1]!.results.map(format);
    const lastU = untabled[untabled.length - 1]!.results.map(format);
    // invalidation means the re-query matches the untabled oracle, not the stale cached answer
    expect(lastT).toEqual(lastU);
    expect(lastT).not.toEqual(["1"]);
  });
});

// A function defined at RUNTIME via add-atom (PeTTa's fibadd) lands in the per-world selfRules, not the
// static rule index, so it bypassed analyzePurity and ran un-memoised (exponential). It is now tabled with
// a rule-set-versioned key, which stays byte-identical to no-tabling even when the space mutates or the
// function is redefined.
describe("runtime-rule tabling (fibadd)", () => {
  const bothMatch = (src: string) => {
    const off = runProgram(src, 200_000_000, new Map(), { tabling: false });
    const on = runProgram(src, 200_000_000, new Map(), { tabling: true });
    expect(on.map((r) => r.results.map(format))).toEqual(off.map((r) => r.results.map(format)));
    return on;
  };

  it("a runtime-defined fib is memoised and correct", () => {
    const on = bothMatch(
      "!(add-atom &self (= (fib $N) (if (< $N 2) $N (+ (fib (- $N 1)) (fib (- $N 2))))))\n!(fib 22)",
    );
    expect(on[on.length - 1]!.results.map(format)).toEqual(["17711"]);
  });

  it("an IMPURE runtime function (match over the space) is NOT tabled, so state changes show", () => {
    // (cnt) reads the space, so tabling it would serve a stale count after a new (foo ...) is added.
    bothMatch(
      "!(add-atom &self (= (cnt) (foldall + (match &self (foo $x) 1) 0)))\n" +
        "!(add-atom &self (foo a))\n!(cnt)\n!(add-atom &self (foo b))\n!(cnt)",
    );
  });

  it("redefining a runtime function does not serve a stale memo (version bumps)", () => {
    bothMatch(
      "!(add-atom &self (= (k $n) (* $n 10)))\n!(k 5)\n" +
        "!(add-atom &self (= (k $n) (* $n 100)))\n!(collapse (k 5))",
    );
  });
});
