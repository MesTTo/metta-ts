// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// De-risk gate for the compiled IMPURE body path (the matespace VM target). An impure recursive function
// (add-atom side effects + if/let/arithmetic/recursion) must compile byte-identically to the interpreter on
// the result, the fresh-variable counter (St.counter), AND the &self side-effect state and order. St is
// threaded across the program's queries so the side effects accumulate exactly as a real run.
import { describe, it, expect } from "vitest";
import { initSt, mettaEval } from "./eval";
import { format } from "./parser";
import { bangAtoms, compiledEnvWith, envWith } from "./compile-test-utils";
// Thread St (world + counter) across the program's queries, as a real run does, so add-atom side effects
// accumulate. Return each query's results and the final counter.
function run(src: string, compiled: boolean) {
  const env = compiled ? compiledEnvWith(src) : envWith(src);
  let st = initSt();
  const out: string[][] = [];
  for (const q of bangAtoms(src)) {
    const [pairs, st2] = mettaEval(env, 10_000_000, st, [], q);
    st = st2;
    out.push(pairs.map((p) => format(p[0])));
  }
  return { out, counter: st.counter };
}

describe("compiled impure body (matespace VM de-risk)", () => {
  const g = `
    (= (g $n) (if (== $n 0) done (let $x (add-atom &self (item $n)) (g (- $n 1)))))
    !(g 5)
    !(collapse (match &self (item $k) $k))`;

  it("g compiles (non-vacuous)", () => {
    expect(compiledEnvWith(g).compiled!.has("g")).toBe(true);
  });

  it("impure g: compiled == interpreted on results, counter, and &self side-effect order", () => {
    expect(run(g, true)).toEqual(run(g, false));
  });

  // A longer completing run: every looped application must advance the fresh-variable counter in lockstep
  // with the interpreter, and the 50 add-atoms must accumulate in the same order, across 50 iterations.
  const g50 = `
    (= (g $n) (if (== $n 0) done (let $x (add-atom &self (item $n)) (g (- $n 1)))))
    !(g 50)
    !(collapse (match &self (item $k) $k))`;
  it("impure g at depth 50: compiled == interpreted over many iterations", () => {
    const r = run(g50, true);
    expect(r).toEqual(run(g50, false));
    expect(r.out[0]).toEqual(["done"]); // it actually completed (non-vacuous)
  });

  // The regression guard for the matespace/scale OOM. A self-call recurses natively, so a deep impure
  // recursion overflows the host stack exactly as the interpreter does, producing the identical
  // `(Error <call> StackOverflow)` and rolling back every partial add-atom. The compiled path must NOT
  // trampoline this to completion: doing so built 1,000,000 atoms on scale.metta and ran the suite out of
  // memory, and diverged from the interpreter, which stops at the same native limit. At depth 200000 both
  // overflow well within the worker stack, so the test is fast (the overflow is cheap) — if the compiled
  // path ever ran unbounded again, this would build atoms until it timed out or ran out of memory.
  const deep = `
    (= (build $n) (if (== $n 0) done (let $x (add-atom &self (item $n)) (build (- $n 1)))))
    !(build 200000)
    !(collapse (match &self (item $k) $k))`;
  it("deep impure recursion overflows identically to the interpreter (no unbounded loop)", () => {
    const compiled = run(deep, true);
    expect(compiled).toEqual(run(deep, false));
    // It overflowed rather than completing, and the partial build rolled back to an empty space.
    expect(compiled.out[0]![0]).toContain("StackOverflow");
    expect(compiled.out[1]).toEqual(["()"]);
  });

  // A doubly-recursive impure function whose body returns a TUPLE of two recursive calls, matespacefast's
  // `rewriteK` shape. This is the one place the compiled slot machine and the interpreter legitimately
  // disagree on the gensym counter: the compiled VM builds each subtree once (O(2^d)); the interpreter, like
  // Hyperon's `interpret-tuple`, re-interprets the already-reduced tuple at each level (O(d*2^d), the scaling
  // confirmed against LeaTTa's minimal interpreter, `2^n*(1.5n+7)-3` fresh-variable steps for `(rk q n)`).
  // The dispatch skips that redundant re-interpretation for a compiled impure result, which is what lets
  // matespacefast beat PeTTa. The RESULT and the &self side effects are identical both ways; only the
  // fresh-variable counter advances differently, and since the counter only ever NAMES fresh variables
  // (monotonic and unique within a run) a different count yields a consistently-renamed, alpha-equivalent
  // term, never a captured one. That is exactly the equality the 270-assertion Hyperon oracle and LeaTTa
  // check (`alphaEq`), so we assert the results and side effects match, not the raw counter.
  const rk = `
    (= (rk $t $n) (if (== $n 0) z (let $x (add-atom &self (i $t)) ((rk (a $t) (- $n 1)) (rk (b $t) (- $n 1))))))
    !(rk q 4)
    !(length (collapse (match &self (i $k) $k)))`;
  it("doubly-recursive tuple body: compiled == interpreted on result and side effects (counter may differ)", () => {
    const c = run(rk, true);
    const i = run(rk, false);
    expect(c.out).toEqual(i.out); // result tree + &self side effects identical (ground, so alpha = exact)
    expect(c.out[1]).toEqual(["15"]); // 2^4 - 1 add-atoms accumulated (non-vacuous)
  });
});
