// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// A deep `chain` tail-recursion must run in linear time and space. The minimal-MeTTa `div` (PeTTa's
// he_minimalmetta) recurses N deep through nested `chain`s. Without pruning the binding carried across each
// `chain` step, `merge` keeps every level's freshened rule variables and the run goes quadratic — every
// later instantiate/merge re-scans the O(n) binding. The evaluator prunes that binding to the live
// continuation at the `chain` transition, so this completes in time and space proportional to the depth.
import { describe, it, expect } from "vitest";
import { runProgram } from "./runner";
import { format } from "./parser";

const DIV = `
(= (div $x $y $accum)
   (chain (eval (- $x $y)) $r1
     (chain (eval (< $r1 0)) $r2
       (chain (unify $r2 True $accum
         (chain (eval (+ 1 $accum)) $inc
           (chain (eval (div $r1 $y $inc)) $r4 $r4))) $r3 $r3))))`;

// `(div n 5 0)` counts how many times 5 fits into n, i.e. floor(n / 5), via a chain of n/5 reductions.
const divResult = (n: number, fuel: number): string[] =>
  runProgram(DIV + `\n!(chain (eval (div ${n} 5 0)) $rr $rr)`, fuel)[0]!.results.map(format);

const timeOf = (n: number): number => {
  const t0 = performance.now();
  divResult(n, 2_000_000);
  return performance.now() - t0;
};

describe("chain tail-recursion scopes its carried binding", () => {
  it("a 70000-deep div reduces to the exact result, no quadratic blow-up", () => {
    const t0 = performance.now();
    expect(divResult(350000, 2_000_000)).toEqual(["70000"]);
    // At this depth the pre-fix O(n^2) path takes ~15 minutes; the pruned O(n) path is well under a second.
    // A generous ceiling stays robust on a loaded CI while still failing loudly if the accumulation returns.
    expect(performance.now() - t0).toBeLessThan(8000);
  });

  it("scales linearly: 4x the depth costs roughly 4x, not 16x", () => {
    timeOf(100000); // warm the JIT so the ratio reflects steady state, not first-run compilation
    const small = timeOf(100000); // 20000 deep
    const big = timeOf(400000); // 80000 deep — 4x the work
    // Linear gives a ratio near 4; quadratic gives ~16. Asserting < 8 separates the two with margin to spare.
    expect(big / small).toBeLessThan(8);
  });
});
