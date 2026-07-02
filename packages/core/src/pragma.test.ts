// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// `pragma!` writes interpreter settings in-language, faithful to Hyperon (stdlib/core.rs): the key must be a
// symbol, `max-stack-depth` must be an unsigned integer (0 = unlimited, the default), and the op returns
// unit. `max-stack-depth` bounds how deep the explicit minimal-MeTTa interpreter stack may grow before a
// branch degrades to a StackOverflow atom — a memory bound, not a step bound, and one the host can also seed
// via RunOptions. It is never a hard ceiling: the host's `fuel` argument is the resource ceiling and no
// pragma can raise it, so an embedded program cannot widen its own limits.
import { describe, it, expect } from "vitest";
import { runProgram } from "./runner";
import { format } from "./parser";

const results = (src: string, fuel = 2_000_000): string[] => {
  const r = runProgram(src, fuel);
  return r[r.length - 1]!.results.map(format);
};
const hasOverflow = (rs: string[]): boolean => rs.some((r) => r.includes("StackOverflow"));

describe("pragma! max-stack-depth", () => {
  it("accepts an unsigned integer and returns unit (Hyperon core.rs)", () => {
    expect(results("!(pragma! max-stack-depth 21)")).toEqual(["()"]);
    expect(results("!(pragma! max-stack-depth 0)")).toEqual(["()"]);
  });

  it("rejects a negative or non-integer value, mirroring Hyperon's error atom", () => {
    expect(results("!(pragma! max-stack-depth -12)")).toEqual([
      "(Error (pragma! max-stack-depth -12) UnsignedIntegerIsExpected)",
    ]);
    expect(results("!(pragma! max-stack-depth 2.5)")).toEqual([
      "(Error (pragma! max-stack-depth 2.5) UnsignedIntegerIsExpected)",
    ]);
  });

  it("accepts and ignores any other key (Hyperon stores arbitrary settings)", () => {
    expect(results("!(pragma! interpreter bare-minimal)")).toEqual(["()"]);
  });

  it("a positive bound cuts the interpreter stack; the default (0) leaves it unbounded", () => {
    // `(+ 1 (* 2 3))` nests one eval inside another, so its interpreter stack reaches depth 2. A bound of 1
    // cuts it to a StackOverflow atom; with no bound (or a generous one) it evaluates to 7.
    expect(hasOverflow(results("!(pragma! max-stack-depth 1)\n!(+ 1 (* 2 3))"))).toBe(true);
    expect(results("!(+ 1 (* 2 3))")).toEqual(["7"]);
    expect(results("!(pragma! max-stack-depth 1000)\n!(+ 1 (* 2 3))")).toEqual(["7"]);
  });

  it("does not disturb a shallow tail-recursion (chain depth stays ~2)", () => {
    // Minimal-MeTTa `div` recurses through `chain` at a near-constant stack depth, so even a tight bound does
    // not cut it; it computes the exact result. (Function-call recursion that does grow without bound is
    // caught separately by the native-stack guard, independent of this setting.)
    const div = `(= (div $x $y $a) (chain (eval (- $x $y)) $r1 (chain (eval (< $r1 0)) $r2 (chain (unify $r2 True $a (chain (eval (+ 1 $a)) $i (chain (eval (div $r1 $y $i)) $r4 $r4))) $r3 $r3))))`;
    expect(
      results(div + "\n!(pragma! max-stack-depth 100)\n!(chain (eval (div 50000 5 0)) $rr $rr)"),
    ).toEqual(["10000"]);
  });

  it("the embedder can seed the starting bound via RunOptions.maxStackDepth", () => {
    const r = runProgram("!(+ 1 (* 2 3))", 2_000_000, new Map(), { maxStackDepth: 1 });
    expect(r[r.length - 1]!.results.some((a) => format(a).includes("StackOverflow"))).toBe(true);
  });
});
