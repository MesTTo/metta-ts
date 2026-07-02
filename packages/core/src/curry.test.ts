// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Opt-in currying, the PeTTa execution-model feature offered as the `curry` import module. PeTTa's
// translator turns every under-applied call into a `partial`; @metta-ts keeps the core Hyperon-faithful
// (an under-applied call stays irreducible or errors) and enables the behaviour only after
// `(import! &self curry)`. The flag is per-run, so the Hyperon oracle baseline is never affected.
import { describe, it, expect } from "vitest";
import { runProgram } from "./runner";
import { format } from "./parser";

const last = (src: string): string[] => {
  const r = runProgram(src);
  return r[r.length - 1]!.results.map(format);
};

describe("opt-in currying", () => {
  it("is off by default: an under-applied untyped call stays irreducible", () => {
    expect(last("(= (f $a $b) (+ $a $b))\n!(f 1)")).toEqual(["(f 1)"]);
  });

  it("is off by default: an under-applied grounded op is an arity error, not a partial", () => {
    expect(last("!(+ 1)")[0]).toContain("IncorrectNumberOfArguments");
  });

  it("when imported, under-applies a user function to a partial closure", () => {
    const src = "!(import! &self curry)\n(= (f $a $b) (+ $a $b))\n!(f 1)";
    expect(last(src)).toEqual(["(partial f (1))"]);
  });

  it("applies a partial closure to the remaining arguments", () => {
    const src = "!(import! &self curry)\n(= (f $a $b) (+ $a $b))\n!((f 1) 2)";
    expect(last(src)).toEqual(["3"]);
  });

  it("curries a grounded op (no arity error) and applies it", () => {
    expect(last("!(import! &self curry)\n!(+ 1)")).toEqual(["(partial + (1))"]);
    expect(last("!(import! &self curry)\n!((+ 1) 2)")).toEqual(["3"]);
  });

  it("a partial threads through maplist as a first-class function", () => {
    const src = "!(import! &self curry)\n!(maplist (+ 1) (1 2 3))";
    expect(last(src)).toEqual(["(2 3 4)"]);
  });

  it("curries an under-applied |-> lambda and completes it on the next application", () => {
    const src = "!(import! &self curry)\n!(((|-> ($x $y) (42 $x $y)) 43) 44)";
    expect(last(src)).toEqual(["(42 43 44)"]);
  });

  it("appends a tuple argument as a single element (partial over a list builder)", () => {
    const src = "!(import! &self curry)\n(= (h $a $b) (append ($a) $b))\n!((h 42) (1 2 3))";
    expect(last(src)).toEqual(["(42 1 2 3)"]);
  });

  it("a nullary thunk is still evaluated, not curried", () => {
    const src = "!(import! &self curry)\n(= (g) 7)\n!(g)";
    expect(last(src)).toEqual(["7"]);
  });
});
