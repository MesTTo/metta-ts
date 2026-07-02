// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildEnv, initSt, mettaEval } from "./eval";
import { type Atom, expr, sym, variable } from "./atom";
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

function runFunctional(c: ReturnType<typeof compileEnv>, name: string, vals: number[]) {
  const h = c.get(name);
  expect(h?.kind).toBe("functional");
  if (h === undefined || h.kind !== "functional") return undefined;
  return h.run(vals);
}

function evalQuery(env: ReturnType<typeof envWith>, q: Atom) {
  const [pairs, st] = mettaEval(env, 10_000_000, initSt(), [], q);
  return { results: pairs.map((p) => format(p[0])), counter: st.counter };
}

function compareCompiledAndInterpreted(src: string, fuel = 100_000) {
  const run = (tabling: boolean) =>
    runProgram(src, fuel, new Map(), { tabling }).map((r) => r.results.map(format));
  const on = run(true);
  const off = run(false);
  expect(on).toEqual(off);
  return on;
}

const tilepuzzleMoveSrc = () =>
  readFileSync(
    new URL("../../node/bench/corpus-mettats/tilepuzzle.metta", import.meta.url),
    "utf8",
  ).split("!(import!")[0]!;

const tileState = (cells: readonly string[]): Atom => expr(cells.map((cell) => sym(cell)));

function tileSamples(): Atom[] {
  const base = ["___", "1", "2", "3", "4", "5", "6", "7", "8"];
  const states: Atom[] = [];
  for (let blank = 0; blank < base.length; blank++) {
    const cells = base.slice();
    [cells[0], cells[blank]] = [cells[blank]!, cells[0]!];
    states.push(tileState(cells));
  }
  for (let seed = 1; seed <= 24; seed++) {
    const cells = base.slice();
    for (let i = cells.length - 1; i > 0; i--) {
      const j = (seed * 17 + i * 31) % (i + 1);
      [cells[i], cells[j]] = [cells[j]!, cells[i]!];
    }
    states.push(tileState(cells));
  }
  return states;
}

describe("deterministic-core compiler", () => {
  it("compiles fib (non-vacuous: the fast path really exists and computes)", () => {
    const c = compileEnv(
      envWith("(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))"),
    );
    expect(c.has("fib")).toBe(true);
    expect(runFunctional(c, "fib", [10])).toBe(55); // fib(10) = 55
  });

  it("compiles mutual recursion (even/odd) returning Bool", () => {
    const c = compileEnv(
      envWith(
        "(= (even $n) (if (== $n 0) True (odd (- $n 1))))\n" +
          "(= (odd $n) (if (== $n 0) False (even (- $n 1))))",
      ),
    );
    expect(c.has("even")).toBe(true);
    expect(runFunctional(c, "even", [10])).toBe(true);
    expect(runFunctional(c, "odd", [10])).toBe(false);
  });

  it("a match-using function is outside the pure int/bool core but compiles as nondet", () => {
    const c = compileEnv(envWith("(= (q $x) (match &self ($x) $x))"));
    expect(c.get("q")?.kind).toBe("nondet");
  });

  it("does not compile a function calling an uncompilable one (fixpoint drop)", () => {
    const c = compileEnv(envWith("(= (a $n) (+ 1 (b $n)))\n(= (b $n) (match &self ($n) $n))"));
    expect(c.has("a")).toBe(false);
    // `b` itself is a terminal-match clause, which the nondet layer takes.
    expect(c.get("b")?.kind).toBe("nondet");
  });

  it("division by zero is byte-identical to the interpreter (compiled bails)", () => {
    const src = "(= (q $n) (/ 10 $n))\n!(q 5)\n!(q 0)";
    const on = compareCompiledAndInterpreted(src);
    expect(on[0]).toEqual(["2"]);
  });

  describe("impure saturation compiler (case-over-match + add-if-absent)", () => {
    const SATURATION = `
(= (add-atom-no-duplicate $Space $Atom)
   (if (== () (collapse (once (match $Space $Atom $Atom))))
       (add-atom $Space $Atom)
       (empty)))
(= (expand-once)
   (case (match &self (num $t) $t)
         (($x (add-atom-no-duplicate &self (num (S $x)))))))
(= (expandK $n)
   (if (== $n 0)
       done
       (let $temp1 (expand-once)
            (expandK (- $n 1)))))
(= (demo-peano $K)
   (let* (($s (add-atom &self (num Z)))
          ($g (expandK $K)))
         (match &self (num $1) $1)))
`;

    it("compiles the peano saturation loop imperatively", () => {
      const c = compileEnv(envWith(SATURATION));
      expect(c.get("add-atom-no-duplicate")?.kind).toBe("imperative");
      expect(c.get("expand-once")?.kind).toBe("imperative");
      expect(c.get("expandK")?.kind).toBe("imperative");
    });

    it("peano slice is byte-identical to the interpreter", () => {
      const on = compareCompiledAndInterpreted(
        `${SATURATION}\n!(length (collapse (demo-peano 25)))`,
        10_000_000,
      );
      expect(on[0]).toEqual(["26"]);
    });

    it("a duplicate add prunes to nothing, identically", () => {
      compareCompiledAndInterpreted(`
(= (add-atom-no-duplicate $Space $Atom)
   (if (== () (collapse (once (match $Space $Atom $Atom))))
       (add-atom $Space $Atom)
       (empty)))
(= (seed) (add-atom &self (k a)))
(= (try) (add-atom-no-duplicate &self (k a)))
!(seed)
!(try)
!(try)
!(match &self (k $x) $x)
`);
    });

    it("a case whose every branch prunes yields nothing, identically", () => {
      compareCompiledAndInterpreted(`
(= (add-atom-no-duplicate $Space $Atom)
   (if (== () (collapse (once (match $Space $Atom $Atom))))
       (add-atom $Space $Atom)
       (empty)))
(= (grow)
   (case (match &self (k $t) $t)
         (($x (add-atom-no-duplicate &self (k $x))))))
!(add-atom &self (k a))
!(add-atom &self (k b))
!(grow)
!(match &self (k $x) $x)
`);
    });

    it("two surviving branches fall back to the interpreter unchanged", () => {
      // The compiled case is single-valued and BAILs on >1 survivor; effects are on immutable
      // worlds, so the interpreter re-runs from the untouched state and the outputs agree.
      compareCompiledAndInterpreted(`
(= (add-atom-no-duplicate $Space $Atom)
   (if (== () (collapse (once (match $Space $Atom $Atom))))
       (add-atom $Space $Atom)
       (empty)))
(= (grow)
   (case (match &self (num $t) $t)
         (($x (add-atom-no-duplicate &self (num (S $x)))))))
!(add-atom &self (num Z))
!(add-atom &self (num (S (S Z))))
!(grow)
!(match &self (num $y) $y)
`);
    });

    it("add-if-absent on a named space, identically", () => {
      compareCompiledAndInterpreted(`
(= (add-atom-no-duplicate $Space $Atom)
   (if (== () (collapse (once (match $Space $Atom $Atom))))
       (add-atom $Space $Atom)
       (empty)))
(= (put $s $a) (let $r (add-atom-no-duplicate $s $a) done))
!(bind! &box (new-space))
!(put &box (p 1))
!(put &box (p 1))
!(put &box (p 2))
!(match &box (p $x) $x)
`);
    });
  });

  it("a float argument falls back to the interpreter (no divergence)", () => {
    const src = "(= (dbl $n) (+ $n $n))\n!(dbl 1.5)\n!(dbl 7)";
    const on = compareCompiledAndInterpreted(src);
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
    expect(runFunctional(c, "g", [10])).toBe(21); // (10*2)+1
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

  it("compiles tilepuzzle's constructor rewrite move and matches the interpreter", () => {
    const move = tilepuzzleMoveSrc();
    const compiledEnv = envWith(move);
    compiledEnv.compiled = compileEnv(compiledEnv);
    compiledEnv.compileDirty = false;
    const interpretedEnv = envWith(move);
    expect(compiledEnv.compiled.get("move")?.kind).toBe("rewrite");

    const dirs = ["U", "D", "L", "R"];
    for (const state of tileSamples()) {
      const generated = expr([
        sym("let"),
        variable("Snew"),
        expr([sym("move"), state, variable("d")]),
        expr([variable("Snew"), variable("d")]),
      ]);
      expect(evalQuery(compiledEnv, generated)).toEqual(evalQuery(interpretedEnv, generated));

      for (const dir of dirs) {
        const ground = expr([sym("move"), state, sym(dir)]);
        expect(evalQuery(compiledEnv, ground)).toEqual(evalQuery(interpretedEnv, ground));
      }
    }
  });
});
