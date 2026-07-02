// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Differential testing: run a program two ways and assert the printed result lists agree per query.
// Used to gate optimisations (e.g. tabling) byte-identical against the reference engine, on a fixed
// adversarial corpus plus generated programs.
import { type QueryResult } from "./runner";
import { format } from "./parser";

export type RunFn = (src: string) => QueryResult[] | Promise<QueryResult[]>;

export interface Divergence {
  readonly program: string;
  readonly a: string;
  readonly b: string;
}

function renderResults(rs: QueryResult[]): string {
  return rs.map((r) => format(r.query) + " => " + r.results.map(format).join(" ")).join("\n");
}

/** Run every program through both functions; return one Divergence per program whose printed
 *  results differ (order and multiplicity included, because `format`-joining preserves both). */
export async function differential(
  programs: string[],
  runA: RunFn,
  runB: RunFn,
): Promise<Divergence[]> {
  const out: Divergence[] = [];
  for (const program of programs) {
    const a = renderResults(await runA(program));
    const b = renderResults(await runB(program));
    if (a !== b) out.push({ program, a, b });
  }
  return out;
}

/** A fixed corpus that exercises the semantics tabling must not disturb. */
export const ADVERSARIAL: string[] = [
  "!(+ 1 2)",
  "(= (f $x) (g $x))\n(= (g $x) (* $x 2))\n!(f 21)",
  "!(superpose (a b c))",
  "(= (col) (collapse (superpose (1 2 3))))\n!(col)",
  "!(+ 0.0 -0.0)",
  "!(== 1 1.0)",
  "(= (dup $x) (superpose ($x $x)))\n!(dup 7)",
  "!(if (> 3 2) yes no)",
  "(= (amb) (superpose (1 2)))\n!(let $x (amb) (let $y (amb) ($x $y)))",
  "!(new-state 5)",
  "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))\n!(fib 12)",
  "(= (qd $n) (/ 12 $n))\n!(qd 3)\n!(qd 0)",
  "(= (dbl $n) (+ $n $n))\n!(dbl 2.5)\n!(dbl 7)",
  "(= (ack $m $n) (if (== $m 0) (+ $n 1) (if (== $n 0) (ack (- $m 1) 1) (ack (- $m 1) (ack $m (- $n 1))))))\n!(ack 2 3)",
  "(= (g $n) (let $x (* $n 2) (let $y (+ $x 1) (* $x $y))))\n!(g 6)",
];

// A tiny seeded PRNG so generated programs are deterministic across runs (no Math.random).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 0x100000000);
}

/** Generate `n` small pure recursive arithmetic programs with random int arguments. These are the
 *  shape tabling targets (overlapping subproblems), so they exercise the memo path. */
export function genPrograms(n: number, seed = 1): string[] {
  const rnd = lcg(seed);
  const defs = [
    (a: number) =>
      `(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))\n!(fib ${a})`,
    (a: number) => `(= (fact $n) (if (< $n 1) 1 (* $n (fact (- $n 1)))))\n!(fact ${a})`,
    (a: number) => `(= (sumto $n) (if (< $n 1) 0 (+ $n (sumto (- $n 1)))))\n!(sumto ${a})`,
    (a: number) =>
      `(= (even $n) (if (== $n 0) True (odd (- $n 1))))\n(= (odd $n) (if (== $n 0) False (even (- $n 1))))\n!(even ${a})`,
  ];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const def = defs[Math.floor(rnd() * defs.length)]!;
    const arg = 1 + Math.floor(rnd() * 12); // small, so untabled runs stay fast
    out.push(def(arg));
  }
  return out;
}
