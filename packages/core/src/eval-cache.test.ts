// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Building a growing data term must stay linear. Hyperon's "already evaluated" optimization (spec `metta`)
// marks a ground expression that reduced to itself so it is not re-walked on the next visit. Without it,
// constructing a Peano numeral `(S (S ... Z))` re-evaluates the whole term every step — O(n^2). PeTTa's
// `peanofast` (2500 deep) is the case this targets.
import { describe, it, expect } from "vitest";
import { runProgram } from "./runner";
import { format } from "./parser";

// Build K Peano `(num (S^i Z))` atoms, then count them.
const peano = (k: number) =>
  `(= (expandK $e $n) (if (== $n 0) done (let $t (add-atom &self (num $e)) (expandK (S $e) (- $n 1)))))
   (= (demo-peano $K) (expandK Z $K))
   !(demo-peano ${k})
   !(test (length (collapse (match &self (num $1) $1))) ${k})`;

const run = (k: number) => runProgram(peano(k), 99_000_000);
const timeOf = (k: number) => {
  const t0 = performance.now();
  run(k);
  return performance.now() - t0;
};

// K is bounded by the host call stack here (this build is not tail-recursive, so vitest's default stack caps
// it ~150 deep; the CLI re-execs with a larger stack). The full 2500-deep `peanofast` — 20s before this
// optimization, ~0.3s after — runs via the corpus benchmark.
describe("growing data terms evaluate (Hyperon evaluated-cache)", () => {
  it("a Peano build reduces to exactly K — the cache does not change results", () => {
    expect(run(150)[1]!.results.map(format)).toEqual(["()"]); // the (test (length ...) 150) assertion passes
  });

  it("the warm path is fast (the cache is engaged)", () => {
    run(150); // warm
    expect(timeOf(150)).toBeLessThan(2000);
  });
});
