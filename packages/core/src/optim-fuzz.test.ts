// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Property-based differential fuzzing (fast-check) for the matespace optimizations: the re-reduce skip, the
// count-aggregate, and the direct &self-log tally. The curated corpus is homogeneous (symbol-headed `(num X)`
// atoms, a single all-variable pattern, ground results), which is exactly why it missed three byte-identity
// bugs that random inputs surface immediately:
//   * the count-aggregate over-counting candidates whose head does not unify (a different symbol, a grounded
//     value, or a nested expr), in both `&self` and named spaces;
//   * a nullary ground pattern routing through the exact-membership index and drifting the counter;
//   * the re-reduce skip freezing a higher-order `($f $x)` result instead of reducing it.
// Each property asserts the optimized path equals an independent reference: the materialized collapse, the
// aggregate-off streaming count, or the interpreter. Comparisons against the interpreter are up to alpha-
// equivalence (the equality the Hyperon oracle and LeaTTa use), so the benign compiled-vs-interpreter counter
// divergence on a doubly-recursive tuple body is tolerated while a genuinely different result is caught.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { runProgram } from "./runner";
import { format } from "./parser";
import { initSt, mettaEval } from "./eval";
import { type Atom } from "./atom";
import { alphaEq } from "./alpha";
import { bangAtoms, compiledEnvWith, envWith } from "./compile-test-utils";

const FUEL = 5_000_000;

/** Run a program in the default config (aggregate on); return each `!`-query's formatted results. */
function run(src: string): string[][] {
  return runProgram(src, FUEL).map((q) => q.results.map(format));
}

/** Run a program with the count-aggregate forced on or off (the streaming count is the reference). */
function runAgg(src: string, on: boolean): string[][] {
  const prev = process.env.METTA_COUNT_AGGREGATE;
  process.env.METTA_COUNT_AGGREGATE = on ? "1" : "0";
  try {
    return run(src);
  } finally {
    // eslint-disable-next-line no-restricted-syntax -- delete is the only way to truly unset an env var
    if (prev === undefined) delete process.env.METTA_COUNT_AGGREGATE;
    else process.env.METTA_COUNT_AGGREGATE = prev;
  }
}

/** Compiled vs interpreted, with `St` threaded across the whole program so side effects accumulate. Returns
 *  the result atoms per query (for alpha comparison) and the final fresh-variable counter. */
function runMode(src: string, compiled: boolean): { out: Atom[][]; counter: number } {
  const env = compiled ? compiledEnvWith(src) : envWith(src);
  let st = initSt();
  const out: Atom[][] = [];
  for (const q of bangAtoms(src)) {
    const [pairs, st2] = mettaEval(env, FUEL, st, [], q);
    st = st2;
    out.push(pairs.map((p) => p[0]));
  }
  return { out, counter: st.counter };
}

/** Two query-result lists are equal up to alpha-equivalence (variable renaming) per result atom. */
function alphaEqOut(a: Atom[][], b: Atom[][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (ai.length !== bi.length) return false;
    for (let j = 0; j < ai.length; j++) if (!alphaEq(ai[j]!, bi[j]!)) return false;
  }
  return true;
}

const last = (rows: string[][]): string => rows[rows.length - 1]![0] ?? "";

// ---------------- count-aggregate ----------------

describe("count-aggregate differential (fast-check)", () => {
  // Deterministic regressions for the three confirmed over-count / drift shapes.
  it("regression: &self different/grounded/nested head does not over-count", () => {
    const r = run(
      `!(add-atom &self (foo x))\n!(add-atom &self ((g) a))\n!(add-atom &self (5 b))\n!(add-atom &self (bar y))\n!(length (collapse (match &self (foo $v) $v)))`,
    );
    expect(last(r)).toBe("1"); // only (foo x) unifies with (foo $v)
  });
  it("regression: named space different-symbol head does not over-count", () => {
    const r = run(
      `!(bind! &s (new-space))\n!(add-atom &s (foo 1 2))\n!(add-atom &s (bar 3 4))\n!(add-atom &s (foo 5 6))\n!(length (collapse (match &s (foo $a $b) ($a $b))))`,
    );
    expect(last(r)).toBe("2");
  });
  it("regression: nullary ground pattern counts via the index, not the tally", () => {
    const r = run(
      `!(add-atom &self (tick))\n!(add-atom &self (tick x))\n!(length (collapse (match &self (tick) $z)))`,
    );
    expect(last(r)).toBe("1");
  });

  // Generators: heads include symbols, numbers (grounded head), and nested exprs; args include ground atoms,
  // numbers, and variables (non-ground atoms); atoms include bare symbols and bare variables; patterns are
  // all-distinct variables of arity 0..4 (including the nullary edge).
  const headG = fc.constantFrom("foo", "bar", "baz", "qux", "5", "7", "(g)", "(h q)");
  const argG = fc.constantFrom("a", "b", "c", "1", "2", "$w", "$w2");
  const atomG = fc.oneof(
    fc
      .tuple(headG, fc.array(argG, { maxLength: 4 }))
      .map(([h, a]) => (a.length === 0 ? h : `(${h} ${a.join(" ")})`)),
    fc.constantFrom("plainSym", "$bareVar", "(foo a b)", "((nested) a b)"),
  );
  const patG = fc
    .tuple(fc.constantFrom("foo", "bar", "baz", "qux"), fc.integer({ min: 0, max: 4 }))
    .map(([h, k]) =>
      k === 0 ? `(${h})` : `(${h} ${Array.from({ length: k }, (_, i) => `$v${i}`).join(" ")})`,
    );
  const spaceG = fc.boolean();

  // The aggregate count must equal the count of the materialized collapse (an independent oracle that never
  // routes through the aggregate).
  it("aggregate length == materialized collapse count", () => {
    fc.assert(
      fc.property(spaceG, fc.array(atomG, { maxLength: 16 }), patG, (named, atoms, pat) => {
        const space = named ? "&s" : "&self";
        const setup = named ? "!(bind! &s (new-space))\n" : "";
        const adds = atoms.map((a) => `!(add-atom ${space} ${a})`).join("\n");
        const src = `${setup}${adds}\n!(collapse (match ${space} ${pat} ${pat}))\n!(length (collapse (match ${space} ${pat} ${pat})))`;
        const r = runProgram(src, FUEL);
        const collapsed = r[r.length - 2]!.results;
        const truth =
          collapsed.length === 1 && collapsed[0]!.kind === "expr" ? collapsed[0]!.items.length : 0;
        return Number(format(r[r.length - 1]!.results[0]!)) === truth;
      }),
      { numRuns: 1000 },
    );
  });

  // Stronger: with the aggregate on vs off, the whole program (the count AND a trailing fresh variable that
  // reveals the gensym counter) must be byte-identical. Catches both count and counter divergence, including
  // non-ground candidates.
  it("aggregate-on == aggregate-off (count and gensym counter)", () => {
    fc.assert(
      fc.property(spaceG, fc.array(atomG, { maxLength: 16 }), patG, (named, atoms, pat) => {
        const space = named ? "&s" : "&self";
        const setup = named ? "!(bind! &s (new-space))\n" : "";
        const adds = atoms.map((a) => `!(add-atom ${space} ${a})`).join("\n");
        const src = `(= (gen) (pair $u $u))\n${setup}${adds}\n!(length (collapse (match ${space} ${pat} ${pat})))\n!(gen)`;
        return JSON.stringify(runAgg(src, true)) === JSON.stringify(runAgg(src, false));
      }),
      { numRuns: 1000 },
    );
  });
});

// ---------------- compiled impure VM ----------------

describe("compiled impure differential (fast-check)", () => {
  // Deterministic regression: a higher-order body must reduce, not freeze.
  it("regression: higher-order ($f $x) result is reduced, not frozen as data", () => {
    const src = `(= (doit $f $x) (let $z (add-atom &self (q $x)) ($f $x)))\n(= (foo $y) (R $y))\n!(doit foo 3)`;
    const { out: c } = runMode(src, true);
    const { out: i } = runMode(src, false);
    expect(c.map((r) => r.map(format))).toEqual(i.map((r) => r.map(format))); // both (R 3)
  });

  // A random single-clause impure recursive function (the matespace family: single OR doubly-recursive tuple
  // body, varied base and let/let* effect prefix) must compile equal to the interpreter up to alpha. The
  // gensym counter legitimately diverges on the tuple body, so we compare the result tree and the &self side
  // effects (both ground, so alpha == exact), not the raw counter.
  const baseG = fc.constantFrom("z", "done", "(leaf $p)");
  const stepG = fc.constantFrom(
    "(let $x (add-atom &self (item $p)) RECUR)",
    "(let* (($x (add-atom &self (a $p))) ($y (add-atom &self (b $p)))) RECUR)",
  );
  const recurG = fc.constantFrom(
    "(f (s $p) (- $n 1))",
    "((f (a $p) (- $n 1)) (f (b $p) (- $n 1)))",
  );
  it("impure single-clause function: compiled == interpreted up to alpha (result + side effects)", () => {
    fc.assert(
      fc.property(
        baseG,
        stepG,
        recurG,
        fc.integer({ min: 0, max: 4 }),
        (base, step, recur, depth) => {
          const body = `(if (== $n 0) ${base} ${step.replace("RECUR", recur)})`;
          const src = `(= (f $p $n) ${body})\n!(f q ${depth})\n!(collapse (match &self (item $w) $w))\n!(collapse (match &self (a $w) $w))`;
          return alphaEqOut(runMode(src, true).out, runMode(src, false).out);
        },
      ),
      { numRuns: 600 },
    );
  });

  // Higher-order dispatch: applying a parameter that may be a function (foo/bar) or a constructor (k/pair)
  // must compile equal to the interpreter. Pre-fix this returned `(foo 3)` (frozen) instead of `(R 3)`.
  it("higher-order dispatch: compiled == interpreted up to alpha", () => {
    const fnG = fc.constantFrom("foo", "bar", "k", "pair");
    fc.assert(
      fc.property(fnG, fc.integer({ min: 0, max: 6 }), (f, x) => {
        const src = `(= (foo $y) (R $y))\n(= (bar $y) (S $y))\n(= (apply1 $g $a) (let $z (add-atom &self (log $a)) ($g $a)))\n!(apply1 ${f} ${x})\n!(collapse (match &self (log $w) $w))`;
        return alphaEqOut(runMode(src, true).out, runMode(src, false).out);
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------- void-context build ----------------

/** Run a program with the void-context build forced on or off (normal build is the reference). */
function runVoid(src: string, on: boolean): string[][] {
  const prev = process.env.METTA_VOID_BUILD;
  process.env.METTA_VOID_BUILD = on ? "1" : "0";
  try {
    return run(src);
  } finally {
    // eslint-disable-next-line no-restricted-syntax -- delete is the only way to truly unset an env var
    if (prev === undefined) delete process.env.METTA_VOID_BUILD;
    else process.env.METTA_VOID_BUILD = prev;
  }
}

describe("void-build differential (fast-check)", () => {
  // Deterministic regression: matespace's build, void on vs off, including a trailing fresh variable that
  // reveals the gensym counter.
  it("regression: matespace void-on == void-off (count and counter)", () => {
    const src = `(= (rewriteK $t $n) (if (== $n 0) done (let* (($_1 (add-atom &self (num (M $t)))) ($_2 (add-atom &self (num (W $t))))) ((rewriteK (M $t) (- $n 1)) (rewriteK (W $t) (- $n 1))))))
(= (demo $K) (let* (($s (add-atom &self (num Z))) ($g (rewriteK Z $K))) (match &self (num $1) (num $1))))
(= (gen) (pair $u $u))
!(length (collapse (demo 5)))
!(gen)`;
    expect(runVoid(src, true)).toEqual(runVoid(src, false));
  });

  // Property: a random build-then-count program (single or doubly-recursive impure build, then a count of the
  // built atoms) must be byte-identical (result AND gensym counter) with the void build on vs off.
  const baseG = fc.constantFrom("z", "done");
  const stepG = fc.constantFrom(
    "(let $x (add-atom &self (item $p)) RECUR)",
    "(let* (($x (add-atom &self (a $p))) ($y (add-atom &self (b $p)))) RECUR)",
  );
  const recurG = fc.constantFrom(
    "(f (s $p) (- $n 1))",
    "((f (a $p) (- $n 1)) (f (b $p) (- $n 1)))",
  );
  it("random build-then-count: void-on == void-off (count and counter)", () => {
    fc.assert(
      fc.property(
        baseG,
        stepG,
        recurG,
        fc.integer({ min: 0, max: 5 }),
        (base, step, recur, depth) => {
          const body = `(if (== $n 0) ${base} ${step.replace("RECUR", recur)})`;
          const src = `(= (f $p $n) ${body})
(= (demo $K) (let* (($s (add-atom &self (item q))) ($g (f q $K))) (match &self (item $w) $w)))
(= (gen) (pair $u $u))
!(length (collapse (demo ${depth})))
!(gen)`;
          return JSON.stringify(runVoid(src, true)) === JSON.stringify(runVoid(src, false));
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------- conjunctive collapse-count via the WCO join ----------------

/** Run a program with the conjunctive collapse-count forced on (the WCO-join fold, the default) or off (the
 *  materializing matcher counts the answers); return each query's raw result atoms. The materializing path is
 *  the reference. */
function runConjAtoms(src: string, on: boolean): Atom[][] {
  const prev = process.env.METTA_CONJ_COUNT;
  process.env.METTA_CONJ_COUNT = on ? "1" : "0";
  try {
    return runProgram(src, FUEL).map((q) => q.results);
  } finally {
    // eslint-disable-next-line no-restricted-syntax -- delete is the only way to truly unset an env var
    if (prev === undefined) delete process.env.METTA_CONJ_COUNT;
    else process.env.METTA_CONJ_COUNT = prev;
  }
}

describe("conjunctive collapse-count differential (fast-check)", () => {
  // The fold and the materializing matcher must agree on the COUNT (the only observable of `length`/`collapse`,
  // a ground number) and on each result atom UP TO ALPHA. They split the goals between the join and the trailed
  // tail slightly differently for a schematic fact whose variable reaches a join position, so the fold may
  // freshen one more or one fewer candidate; the gensym counter then lands a step apart. That is the same
  // benign artifact the compiled-vs-interpreter differential tolerates (the counter only NAMES fresh variables,
  // so a different value is a consistent renaming, never a capture — the equality the oracle and LeaTTa use).
  // A genuine miscount or a captured variable is NOT alpha-equivalent and is still caught.
  it("regression: triangle count, join-on == materialize (up to alpha)", () => {
    const src = `(e a b)(e b c)(e c a)(e a c)(e b a)(e c b)
(= (gen) (pair $u $u))
!(length (collapse (match &self (, (e $x $y) (e $y $z) (e $z $x)) ($x $y $z))))
!(gen)`;
    expect(alphaEqOut(runConjAtoms(src, true), runConjAtoms(src, false))).toBe(true);
  });

  // Property: a random conjunctive count over a random edge set (ground AND schematic facts, the latter
  // exercising the per-position join admission and the schematic-at-join decline) must agree. The trailing
  // `(gen)` surfaces the gensym counter so a capturing divergence (a non-alpha change) would fail.
  const sym = fc.constantFrom("a", "b", "c");
  const goalSet = fc.subarray(
    ["(e $x $y)", "(e $y $z)", "(e $z $x)", "(e $x $z)", "(e $y $x)", "(t $x)", "(t $z)"],
    { minLength: 2, maxLength: 5 },
  );
  const fact = fc.oneof(
    fc.tuple(sym, sym).map(([a, b]) => `(e ${a} ${b})`),
    fc.tuple(sym).map(([a]) => `(e ${a} $w)`), // schematic: ground head, variable tail
    fc.tuple(sym).map(([a]) => `(e $w ${a})`), // schematic: variable head, ground tail
    fc.tuple(sym).map(([a]) => `(t ${a})`),
    fc.constant("(t $w)"), // a fully-schematic unary fact
  );
  it("random conjunctive count: join-on == materialize (count exact, atoms up to alpha)", () => {
    fc.assert(
      fc.property(fc.array(fact, { minLength: 0, maxLength: 9 }), goalSet, (facts, goals) => {
        const src = `${facts.join("")}
(= (gen) (pair $u $u))
!(length (collapse (match &self (, ${goals.join(" ")}) ($x $y $z))))
!(gen)`;
        const on = runConjAtoms(src, true);
        const off = runConjAtoms(src, false);
        // The count (query 0, a ground number) must match exactly; both queries must match up to alpha.
        return format(on[0]![0]!) === format(off[0]![0]!) && alphaEqOut(on, off);
      }),
      { numRuns: 1500 },
    );
  });
});
