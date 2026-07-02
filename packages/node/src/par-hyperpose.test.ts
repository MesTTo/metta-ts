// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The worker-thread `(once (hyperpose …))` path must produce results identical to evaluating the branches in
// line. We assert that differentially: the same program run with the worker pool installed and with it
// disabled (`parEvalImpl` omitted, sequential fallback) gives byte-identical results.
import { describe, it, expect } from "vitest";
import { runProgram, format, type QueryResult } from "@metta-ts/core";
import { makeParEvalImpl } from "./par-hyperpose";

const shape = (rs: QueryResult[]): string[] =>
  rs.map((r) => "[" + r.results.map(format).join(", ") + "]");

// All branches cheap, so the sequential fallback also finishes; only the result identity is under test.
// The `once` branches all evaluate to True: `(once (hyperpose …))` over a worker race returns the branch
// that finishes FIRST (time order, like PeTTa's forked threads), which only coincides with the sequential
// branch-0 result when every branch agrees. `collapse`/`msort` are order-independent (collapse is not
// parallelised, so it runs sequentially in both arms anyway), so those compare directly.
const PROG = `
(= (find-divisor $n $test-divisor)
   (if (> (* $test-divisor $test-divisor) $n)
       $n
       (if (== 0 (% $n $test-divisor))
           $test-divisor
           (find-divisor $n (+ $test-divisor 1)))))
(= (prime? $n) (== $n (find-divisor $n 2)))
!(once (hyperpose ((prime? 7) (prime? 11) (prime? 13))))
!(collapse (hyperpose ((prime? 7) (prime? 8) (prime? 11))))
!(msort (collapse (let $xs (3 1 2) (hyperpose $xs))))
`;

describe("worker-thread hyperpose (once)", () => {
  it("is byte-identical to the sequential fallback (agreeing branches)", () => {
    const seq = runProgram(PROG, 1_000_000);
    const par = runProgram(PROG, 1_000_000, new Map(), { parEvalImpl: makeParEvalImpl(1_000_000) });
    expect(shape(par)).toEqual(shape(seq));
  });

  it("races branches so a cheap branch wins before an expensive one finishes", () => {
    // The first branch would take ~7e8 modulo steps; the cheap third branch settles `once` first. Without
    // worker parallelism this never returns in the test budget, so completing at all proves the race.
    const prog = `
(= (find-divisor $n $test-divisor)
   (if (> (* $test-divisor $test-divisor) $n)
       $n
       (if (== 0 (% $n $test-divisor))
           $test-divisor
           (find-divisor $n (+ $test-divisor 1)))))
(= (prime? $n) (== $n (find-divisor $n 2)))
!(once (hyperpose ((prime? 535372570000000063)
                   (prime? 537818110000000001)
                   (prime? 5421844300001)
                   (prime? 547344310000000013))))
`;
    const par = runProgram(prog, 100_000_000, new Map(), {
      parEvalImpl: makeParEvalImpl(100_000_000),
    });
    expect(shape(par)).toEqual(["[True]"]);
  }, 30_000);
});
