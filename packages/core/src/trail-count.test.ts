// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The fast collapse-count paths (matchConjCount, default for conjunctions; matchCountTrail, behind
// experimental.trail for single patterns) must produce the same answer as the materializing matcher for every
// `(length (collapse (match ...)))` consumer they serve. Each case reduces a match to a count and asserts the
// fast path equals the materialize path byte-for-byte, exercising the single-pattern path, the wcoJoin fold
// with an empty tail, a non-ground tail, eq aliases, and the no-answer case. `optimized` runs both fast paths
// (trail on, conj-count on); the reference forces the materialize path (trail off, METTA_CONJ_COUNT=0).
import { describe, expect, it } from "vitest";
import { runProgram, format } from "./index";

function counts(src: string, optimized: boolean): string[][] {
  const prev = process.env.METTA_CONJ_COUNT;
  process.env.METTA_CONJ_COUNT = optimized ? "1" : "0";
  try {
    return runProgram(src, 100_000, new Map(), { experimental: { trail: optimized } }).map((r) =>
      r.results.map(format),
    );
  } finally {
    // eslint-disable-next-line no-restricted-syntax -- delete is the only way to truly unset an env var
    if (prev === undefined) delete process.env.METTA_CONJ_COUNT;
    else process.env.METTA_CONJ_COUNT = prev;
  }
}

describe("fast collapse-count is byte-identical to the materializing count", () => {
  const cases: Array<readonly [string, string]> = [
    ["single-pattern", "(num 1)(num 2)(num 3)\n!(length (collapse (match &self (num $x) $x)))"],
    ["single-pattern, no answer", "(a b)\n!(length (collapse (match &self (z $x) $x)))"],
    [
      "ground cyclic triangle join (empty tail)",
      "(e a b)(e b c)(e c a)(e a c)(e b a)(e c b)\n" +
        "!(length (collapse (match &self (, (e $x $y) (e $y $z) (e $z $x)) ($x $y $z))))",
    ],
    [
      "two ground relations joined on a shared variable",
      "(p 1)(p 2)(p 3)(c 1 x)(c 2 y)\n" +
        "!(length (collapse (match &self (, (p $n) (c $n $v)) ($n $v))))",
    ],
    [
      "ground join with a schematic non-ground tail",
      "(p 1)(p 2)(t $a foo)\n!(length (collapse (match &self (, (p $x) (t $y $z)) ($x $y $z))))",
    ],
    [
      "conjunction with no solutions",
      "(e a b)(e b c)\n!(length (collapse (match &self (, (e $x $y) (e $y $x)) ($x $y))))",
    ],
    [
      "repeated query variable across goals",
      "(p 1 a)(p 2 a)(p 1 b)(q a)(q b)\n" +
        "!(length (collapse (match &self (, (p $x $y) (q $y)) ($x $y))))",
    ],
    ["size-atom consumer", "(s a)(s b)\n!(size-atom (collapse (match &self (s $x) $x)))"],
    [
      // a schematic fact binds the join variable $x non-ground (the mork-uni-join witness shape): the
      // per-position routing must decline it to the coupled path, not the leapfrog.
      "schematic fact at a join position stays coupled",
      "(p 1)(p 2)(q $a foo)\n!(length (collapse (match &self (, (p $x) (q $x $z)) ($x $z))))",
    ],
    [
      // schematic facts whose variables miss every join position are admitted to the join (a free column it
      // enumerates); the count over the Cartesian product must match the coupled tail.
      "schematic facts at a non-join position ride the join",
      "(p 1)(t $a x)(t $b y)\n!(length (collapse (match &self (, (p $n) (t $m $v)) ($n $m $v))))",
    ],
  ];
  for (const [name, src] of cases) {
    it(name, () => expect(counts(src, true)).toEqual(counts(src, false)));
  }
});
