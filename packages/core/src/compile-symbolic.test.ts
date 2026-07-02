// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Differential gate for the compiled general symbolic constructor rewrites (compile.ts compileSymbolic).
// Every case asserts the compiled path is byte-identical to the interpreter on BOTH the result atoms and
// the fresh-variable counter (st.counter), which is what a compiled execution path must preserve.
import { describe, it, expect } from "vitest";
import { compiledEnvWith, envWith, evalQuery, parseOne } from "./compile-test-utils";

// Run each query both compiled and interpreted; assert byte-identical results AND fresh-var counter.
function assertByteIdentical(src: string, queries: readonly string[]) {
  const cEnv = compiledEnvWith(src);
  const iEnv = envWith(src);
  for (const q of queries) {
    const a = parseOne(q);
    expect(evalQuery(cEnv, a), q).toEqual(evalQuery(iEnv, a));
  }
}

describe("compiled symbolic constructor rewrites", () => {
  const greater = `
    (= (Greater (S $x) Z) True)
    (= (Greater Z $x) False)
    (= (Greater (S $x) (S $y)) (Greater $x $y))`;

  it("compiles Greater to a symbolic holder (non-vacuous)", () => {
    const env = compiledEnvWith(greater);
    expect(env.compiled!.get("Greater")?.kind).toBe("symbolic");
  });

  it("Greater: nested patterns, recursion, candidate order, counter", () => {
    assertByteIdentical(greater, [
      "(Greater (S Z) Z)",
      "(Greater Z (S Z))",
      "(Greater (S (S Z)) (S Z))",
      "(Greater (S Z) (S (S Z)))",
      "(Greater (S (S (S Z))) (S (S (S Z))))",
      "(Greater Z Z)",
      "(Greater (S (S (S (S (S Z))))) (S (S Z)))",
    ]);
  });

  const fromNat = `
    (= (fromNat Z) 0)
    (= (fromNat (S $k)) (+ 1 (fromNat $k)))`;

  it("fromNat: recursive RHS with a grounded op, compiled == interpreted", () => {
    const env = compiledEnvWith(fromNat);
    expect(env.compiled!.get("fromNat")?.kind).toBe("symbolic");
    assertByteIdentical(fromNat, [
      "(fromNat Z)",
      "(fromNat (S Z))",
      "(fromNat (S (S Z)))",
      "(fromNat (S (S (S (S (S Z))))))",
    ]);
  });

  // The byte-identity-critical case: an RHS-only variable must survive as $y#<counter> with the SAME
  // number instantiate would assign in the interpreter.
  const gen = `(= (gen $x) (pair $x $y))`;
  it("surviving fresh RHS variable is numbered identically to the interpreter", () => {
    const env = compiledEnvWith(gen);
    expect(env.compiled!.get("gen")?.kind).toBe("symbolic");
    assertByteIdentical(gen, ["(gen a)", "(gen (foo b))", "(gen Z)", "(gen (S (S Z)))"]);
  });

  // A two-clause function whose recursive clause carries a fresh RHS variable, so the surviving fresh
  // number must stay in lockstep across recursive applications.
  const chainGen = `
    (= (cg Z) done)
    (= (cg (S $n)) (step $fresh (cg $n)))`;
  it("fresh variables across recursion stay in counter lockstep", () => {
    assertByteIdentical(chainGen, ["(cg Z)", "(cg (S Z))", "(cg (S (S Z)))", "(cg (S (S (S Z))))"]);
  });

  // A call argument is a query variable: the compiled path binds it to the matched pattern leaves
  // (matchSymPatQuery) instead of bailing, so a query-variable call like tilepuzzle's `(move $state $_)`
  // stays compiled. Byte-identical results and counter, including a query var bound to a constructor
  // subterm, a surviving fresh RHS variable, and a query variable flowing into the result.
  const qvar = `
    (= (Greater (S $x) Z) True)
    (= (Greater Z $x) False)
    (= (Greater (S $x) (S $y)) (Greater $x $y))
    (= (gen (S $x)) (pair $x $y))
    (= (idx (S $x)) $x)`;
  it("query-variable arguments stay on the compiled path, byte-identically", () => {
    assertByteIdentical(qvar, [
      "(Greater (S $q) Z)",
      "(Greater $q Z)",
      "(Greater (S Z) $q)",
      "(Greater (S (S $q)) (S Z))",
      "(Greater (S $a) (S $b))",
      "(gen (S $q))",
      "(idx (S $q))",
      "(Greater $x $y)",
    ]);
  });
});
