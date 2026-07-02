// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Differential gate for the compiled nondeterministic let*-chain functors (compile.ts
// compileNondet): the compiled search must return, for every query, the same results in the same
// order as the plain interpreter, up to the consistent renaming of fresh variables (alphaEq, the
// equality the oracle and LeaTTa check; the impure-VM precedent). `tabling: false` disables the
// compiled layer entirely, so it is the interpreted baseline.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { runProgram } from "./runner";
import { format } from "./parser";
import { alphaEq } from "./alpha";
import { type Atom } from "./atom";

function results(src: string, tabling: boolean): Atom[][] {
  return runProgram(src, 10_000_000, new Map(), { tabling }).map((r) => r.results);
}

/** Assert the compiled run equals the interpreted run: same queries, same result counts, and each
 *  result pairwise alpha-equal in the same order. */
function expectAlphaIdentical(src: string): void {
  const compiled = results(src, true);
  const interpreted = results(src, false);
  expect(compiled.length).toBe(interpreted.length);
  for (let q = 0; q < compiled.length; q++) {
    const c = compiled[q]!;
    const i = interpreted[q]!;
    expect(
      c.map(format),
      `query ${q}: compiled ${c.length} vs interpreted ${i.length} results`,
    ).toHaveLength(i.length);
    for (let r = 0; r < c.length; r++)
      if (!alphaEq(c[r]!, i[r]!))
        expect(format(c[r]!), `query ${q} result ${r}`).toBe(format(i[r]!));
  }
}

const BC_RULES = `
(= (bc $kb $_ (: $prf $thm)) (match $kb (: $prf $thm) (: $prf $thm)))
(= (bc $kb (S $d) (: ($rule $p1) $thm))
   (let* (((: $rule (-> (: $p1 $t1) $thm)) (bc $kb $d (: $rule (-> (: $p1 $t1) $thm))))
          ((: $p1 $t1) (bc $kb $d (: $p1 $t1))))
     (: ($rule $p1) $thm)))
(= (bc $kb (S $d) (: ($rule $p1 $p2) $thm))
   (let* (((: $rule (-> (: $p1 $t1) (: $p2 $t2) $thm))
           (bc $kb $d (: $rule (-> (: $p1 $t1) (: $p2 $t2) $thm))))
          ((: $p1 $t1) (bc $kb $d (: $p1 $t1)))
          ((: $p2 $t2) (bc $kb $d (: $p2 $t2))))
     (: ($rule $p1 $p2) $thm)))
`;

describe("compiled nondet let*-chains are alpha-identical to the interpreter", () => {
  it("bc easy tier: free-proof query over a two-axiom KB", () => {
    expectAlphaIdentical(`${BC_RULES}
!(bind! &kb (new-space))
!(add-atom &kb (: a1 (-> (: $ter (E $t $r)) (: $tes (E $t $s)) (E $r $s))))
!(add-atom &kb (: a2 (E (P $t Zero) $t)))
!(bc &kb (S Z) (: $prf (E $t $t)))
!(bc &kb Z (: $prf (E (P $t Zero) $t)))
!(bc &kb (S (S Z)) (: $prf (E $q $q)))
`);
  });

  it("ground-proof checking queries (fully bound arguments)", () => {
    expectAlphaIdentical(`${BC_RULES}
!(bind! &kb (new-space))
!(add-atom &kb (: a2 (E (P t Zero) t)))
!(add-atom &kb (: a1 (-> (: $x (E $a $b)) (E $b $a))))
!(bc &kb (S Z) (: (a1 a2) (E t (P t Zero))))
!(bc &kb (S Z) (: (a1 a2) (E wrong wrong)))
`);
  });

  it("duplicate axioms keep multiset and order", () => {
    expectAlphaIdentical(`${BC_RULES}
!(bind! &kb (new-space))
!(add-atom &kb (: ax (T c)))
!(add-atom &kb (: ax (T c)))
!(bc &kb Z (: $p (T c)))
`);
  });

  it("a body outside the subset falls back to the interpreter unchanged", () => {
    // The second clause's let value calls a DIFFERENT functor, so compileNondet declines the whole
    // functor and the interpreter runs it; outputs must still agree (trivially, same engine).
    expectAlphaIdentical(`
(= (helper $x) (found $x))
(= (search $kb (: $p $t)) (match $kb (: $p $t) (: $p $t)))
(= (search $kb (deep $q)) (let $h (helper $q) $h))
!(bind! &kb (new-space))
!(add-atom &kb (: w (T c)))
!(search &kb (: $p (T c)))
!(search &kb (deep k))
`);
  });

  it("randomized mini knowledge bases and queries agree", () => {
    const consts = ["c0", "c1", "c2"] as const;
    const tyArb = fc.oneof(
      fc.constantFrom(...consts).map((c) => `(T ${c})`),
      fc
        .tuple(fc.constantFrom(...consts), fc.constantFrom(...consts))
        .map(([a, b]) => `(R ${a} ${b})`),
    );
    const axiomArb = fc.oneof(
      // Ground axiom (: axN <type>)
      tyArb.map((t) => (n: number) => `!(add-atom &kb (: ax${n} ${t}))`),
      // Unary rule (: rN (-> (: $p <ty-with-var>) <ty>))
      fc.tuple(fc.constantFrom(...consts), fc.constantFrom(...consts)).map(
        ([a, b]) =>
          (n: number) =>
            `!(add-atom &kb (: r${n} (-> (: $p (T ${a})) (R ${a} ${b}))))`,
      ),
    );
    fc.assert(
      fc.property(
        fc.array(axiomArb, { minLength: 1, maxLength: 5 }),
        tyArb,
        fc.integer({ min: 0, max: 2 }),
        (axioms, goal, depth) => {
          const kb = axioms.map((mk, i) => mk(i)).join("\n");
          const d = depth === 0 ? "Z" : depth === 1 ? "(S Z)" : "(S (S Z))";
          expectAlphaIdentical(`${BC_RULES}
!(bind! &kb (new-space))
${kb}
!(bc &kb ${d} (: $prf ${goal}))
`);
        },
      ),
      { numRuns: 60 },
    );
  });
});
