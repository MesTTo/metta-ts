// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { buildEnv } from "./eval";
import { stdTable } from "./builtins";
import { parseAll, format } from "./parser";
import { standardTokenizer, preludeAtoms, runProgram } from "./runner";
import { analyzePurity } from "./tabling";
import { compileEnv } from "./compile";

const atoms = (src: string) =>
  parseAll(src, standardTokenizer())
    .filter((t) => !t.bang)
    .map((t) => t.atom);

function envWith(src: string) {
  const env = buildEnv([...preludeAtoms(), ...atoms(src)], stdTable());
  env.pureFunctors = analyzePurity(env);
  return env;
}

describe("deterministic-core compiler", () => {
  it("compiles fib (non-vacuous: the fast path really exists and computes)", () => {
    const c = compileEnv(
      envWith("(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))"),
    );
    expect(c.has("fib")).toBe(true);
    expect(c.get("fib")!.run([10])).toBe(55); // fib(10) = 55
  });

  it("compiles mutual recursion (even/odd) returning Bool", () => {
    const c = compileEnv(
      envWith(
        "(= (even $n) (if (== $n 0) True (odd (- $n 1))))\n" +
          "(= (odd $n) (if (== $n 0) False (even (- $n 1))))",
      ),
    );
    expect(c.has("even")).toBe(true);
    expect(c.get("even")!.run([10])).toBe(true);
    expect(c.get("odd")!.run([10])).toBe(false);
  });

  it("does not compile a function that uses match (outside the pure int/bool core)", () => {
    expect(compileEnv(envWith("(= (q $x) (match &self ($x) $x))")).has("q")).toBe(false);
  });

  it("does not compile a function calling an uncompilable one (fixpoint drop)", () => {
    const c = compileEnv(envWith("(= (a $n) (+ 1 (b $n)))\n(= (b $n) (match &self ($n) $n))"));
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(false);
  });

  it("division by zero is byte-identical to the interpreter (compiled bails)", () => {
    const src = "(= (q $n) (/ 10 $n))\n!(q 5)\n!(q 0)";
    const on = runProgram(src, 100_000, new Map(), { tabling: true }).map((r) =>
      r.results.map(format),
    );
    const off = runProgram(src, 100_000, new Map(), { tabling: false }).map((r) =>
      r.results.map(format),
    );
    expect(on).toEqual(off);
    expect(on[0]).toEqual(["2"]);
  });

  it("a float argument falls back to the interpreter (no divergence)", () => {
    const src = "(= (dbl $n) (+ $n $n))\n!(dbl 1.5)\n!(dbl 7)";
    const on = runProgram(src, 100_000, new Map(), { tabling: true }).map((r) =>
      r.results.map(format),
    );
    const off = runProgram(src, 100_000, new Map(), { tabling: false }).map((r) =>
      r.results.map(format),
    );
    expect(on).toEqual(off);
    expect(on[0]).toEqual(["3.0"]);
    expect(on[1]).toEqual(["14"]);
  });

  it("ackermann (deep recursion) compiled is exact", () => {
    const ack =
      "(= (ack $m $n) (if (== $m 0) (+ $n 1) (if (== $n 0) (ack (- $m 1) 1) (ack (- $m 1) (ack $m (- $n 1))))))";
    expect(runProgram(`${ack}\n!(ack 3 5)`)[0]!.results.map(format)).toEqual(["253"]); // 2^8 - 3
  });

  it("fib(90) is exact and fast via the compiled core", () => {
    const fib = "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))";
    expect(runProgram(`${fib}\n!(fib 90)`)[0]!.results.map(format)).toEqual([
      "2880067194370816120",
    ]);
  });

  it("compiles let-binding pure functions", () => {
    const c = compileEnv(envWith("(= (g $n) (let $x (* $n 2) (+ $x 1)))"));
    expect(c.has("g")).toBe(true);
    expect(c.get("g")!.run([10])).toBe(21); // (10*2)+1
    expect(
      runProgram("(= (g $n) (let $x (* $n 2) (+ $x 1)))\n!(g 10)")[0]!.results.map(format),
    ).toEqual(["21"]);
  });

  it("compiles a tuple-state function (destructure a tuple param, build a tuple result)", () => {
    // PeTTa's quad-step: a `($t $i $sum)` state tuple in, a new state tuple out, driven by iterate. The
    // compiled path must stay byte-identical to the interpreter across the whole loop.
    const quad =
      "(= (quad-step $d ($t $i $sum)) (if (== $i $t) ((+ $t 1) 1 (+ $sum (* $t $i))) ($t (+ $i 1) (+ $sum (* $t $i)))))\n" +
      "(= (quad-sum $n) (last (iterate 0 (/ (* $n (+ $n 1)) 2) (1 1 0) quad-step)))";
    expect(compileEnv(envWith(quad.split("\n")[0]!)).has("quad-step")).toBe(true);
    for (const n of [3, 10, 50, 100]) {
      const tabled = runProgram(`${quad}\n!(quad-sum ${n})`, 50_000_000, new Map(), {
        tabling: true,
      });
      const untabled = runProgram(`${quad}\n!(quad-sum ${n})`, 50_000_000, new Map(), {
        tabling: false,
      });
      expect(tabled[tabled.length - 1]!.results.map(format)).toEqual(
        untabled[untabled.length - 1]!.results.map(format),
      );
    }
    expect(runProgram(`${quad}\n!(quad-sum 100)`, 50_000_000)[0]!.results.map(format)).toEqual([
      "12920425",
    ]);
  });

  it("specializes a higher-order call so the whole loop compiles (iterate$quad-step)", () => {
    // iterate's `$step` is higher-order, which blocks compilation. The specializer binds $step=quad-step,
    // producing a first-order iterate$quad-step that compiles, so the 500500-iteration quad-sum 1000 runs
    // natively (was a >90s timeout interpreted) and is exact.
    const quad =
      "(= (quad-step $dummy ($t $i $sum)) (if (== $i $t) ((+ $t 1) 1 (+ $sum (* $t $i))) ($t (+ $i 1) (+ $sum (* $t $i)))))\n" +
      "(= (quad-sum $n) (last (iterate 0 (/ (* $n (+ $n 1)) 2) (1 1 0) quad-step)))";
    const t0 = Date.now();
    const r = runProgram(`${quad}\n!(quad-sum 1000)`, 2_000_000_000);
    expect(r[r.length - 1]!.results.map(format)).toEqual(["125417041750"]);
    expect(Date.now() - t0).toBeLessThan(5000); // native loop: well under a second, vs >90s interpreted
  });
});
