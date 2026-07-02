// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { gint, atomEq } from "./atom";
import { runProgram } from "./runner";
import { format } from "./parser";

describe("large-integer correctness", () => {
  it("gint canonicalises a safe-range bigint to a number and they are equal", () => {
    expect(atomEq(gint(5n), gint(5))).toBe(true);
    expect(format(gint(5n))).toBe("5");
  });

  it("a literal past 2^53 parses and prints exactly", () => {
    const r = runProgram("!(+ 9007199254740991 2)");
    expect(r[0]!.results.map(format)).toEqual(["9007199254740993"]);
  });

  // fib(90) is fast now that tabling is on by default, and exact via bigint.
  it("fib(90) is exact (the value JS doubles cannot hold)", () => {
    const src =
      "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))\n!(fib 90)";
    // fib(90) = 2880067194370816120
    expect(runProgram(src)[0]!.results.map(format)).toEqual(["2880067194370816120"]);
  });
});

describe("grounded numeric ops stay exact on large ints", () => {
  const ev = (s: string) => runProgram(s)[0]!.results.map(format);
  it("* promotes to bigint", () => {
    expect(ev("!(* 3037000500 3037000500)")).toEqual(["9223372037000250000"]);
  });
  it("- back into range stays a plain integer string", () => {
    expect(ev("!(- 9007199254740993 9007199254740993)")).toEqual(["0"]);
  });
  it("comparisons are exact across the safe-range boundary", () => {
    expect(ev("!(< 9007199254740992 9007199254740993)")).toEqual(["True"]);
    expect(ev("!(> 9007199254740993 9007199254740992)")).toEqual(["True"]);
  });
  it("/ and % use exact integer division", () => {
    expect(ev("!(/ 9223372037000250000 3037000500)")).toEqual(["3037000500"]);
    expect(ev("!(% 9223372037000250001 3037000500)")).toEqual(["1"]);
  });
  it("int + float still promotes to float", () => {
    expect(ev("!(+ 2 0.5)")).toEqual(["2.5"]);
  });
});
