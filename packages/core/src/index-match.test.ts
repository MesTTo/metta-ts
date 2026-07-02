// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The ground-fact exact-match index (atomlog.ts / pmap.ts / hashOf) gives `matchCandidates` an O(1) fast
// path for an exact ground-membership match over runtime-added facts (the peano O(K^3) -> O(K^2) fix).
// Correctness is verified ADVERSARIALLY here: a ground match must return exactly the same results as a
// linear scan would, across multisets (duplicates), removals, mixed ground/non-ground logs (which DISABLE
// the fast path so a ground pattern can still unify a non-ground atom), state handles (also disabled), and
// many hash-bucket entries. A wrong count or a missed candidate would silently corrupt `match`.
import { describe, it, expect } from "vitest";
import { runProgram } from "./runner";
import { format } from "./parser";

const last = (src: string): string[] => {
  const r = runProgram(src, 50_000_000);
  return r[r.length - 1]!.results.map(format);
};
const sorted = (xs: string[]): string[] => [...xs].sort();
const queueLib = `
  (= (enqueue $E (queue $In $Out $N))
     (queue (cons $E $In) $Out (+ $N 1)))
  (= (dequeue $E (queue $In (cons $E $Out) $N))
     (queue $In $Out (- $N 1)))
  (= (dequeue $E (queue $In () $N))
     (let (cons $E $R) (reverse $In)
          (queue () $R (- $N 1))))
  (= (empty-queue) (queue () () 0))
  (= (add-unique-or-fail $space $Expression)
     (let $st (s (repra $Expression))
       (if (== () (collapse (once (match $space $st True))))
         (add-atom $space $st)
         (empty))))
`;

describe("ground-fact index fast path — correctness vs a scan", () => {
  it("exact ground membership over runtime adds", () => {
    const src = `
      !(add-atom &self (num Z))
      !(add-atom &self (num (S Z)))
      !(add-atom &self (num (S (S Z))))
      !(collapse (match &self (num (S Z)) found))`;
    expect(last(src)).toEqual(["(found)"]); // exactly one match
  });

  it("absent ground atom yields no match (the common peano case)", () => {
    const src = `
      !(add-atom &self (num Z))
      !(add-atom &self (num (S Z)))
      !(collapse (match &self (num (S (S (S Z)))) found))`;
    expect(last(src)).toEqual(["()"]);
  });

  it("preserves multiplicity: a duplicated atom matches once per copy", () => {
    const src = `
      !(add-atom &self (p a))
      !(add-atom &self (p a))
      !(add-atom &self (p a))
      !(collapse (match &self (p a) hit))`;
    expect(last(src)).toEqual(["(hit hit hit)"]);
  });

  it("remove-atom decrements the index", () => {
    const src = `
      !(add-atom &self (p a))
      !(add-atom &self (p a))
      !(remove-atom &self (p a))
      !(collapse (match &self (p a) hit))`;
    expect(last(src)).toEqual(["(hit)"]); // 2 added, 1 removed -> 1 left
  });

  it("a ground pattern still unifies a NON-ground runtime atom (fast path must disable)", () => {
    const src = `
      !(add-atom &self (edge 1 2))
      !(add-atom &self (edge $x 2))
      !(collapse (match &self (edge 1 2) hit))`;
    // The ground (edge 1 2) and the variable (edge $x 2) both match -> two results.
    expect(last(src)).toEqual(["(hit hit)"]);
  });

  it("variable-in-pattern queries are unaffected (not a ground pattern)", () => {
    const src = `
      !(add-atom &self (num Z))
      !(add-atom &self (num (S Z)))
      !(collapse (match &self (num $x) $x))`;
    expect(sorted(last(src))).toEqual(sorted(["(Z (S Z))"]));
  });

  // Hyperon's open issues 1079 / 1076: Space::visit can undercount atoms that share a head symbol. A
  // variable query over same-head atoms (one of them a duplicate) must return EVERY match with the right
  // multiplicity. LeaTTa proves first-argument indexing sound (no firing rule dropped) and its binary
  // returns 1 2 3 1 here; MeTTa-TS must match.
  it("same-head variable query keeps every match incl. a duplicate (Hyperon 1079/1076)", () => {
    const src = `
      !(add-atom &self (foo 1))
      !(add-atom &self (foo 2))
      !(add-atom &self (foo 3))
      !(add-atom &self (foo 1))
      !(collapse (match &self (foo $x) $x))`;
    expect(sorted(last(src))).toEqual(sorted(["(1 2 3 1)"]));
  });

  it("many distinct ground atoms all match exactly (bucket spread, no collisions lost)", () => {
    let src = "";
    for (let i = 0; i < 200; i++) src += `!(add-atom &self (k ${i}))\n`;
    src += `!(collapse (match &self (k 137) hit))`;
    expect(last(src)).toEqual(["(hit)"]);
    src = src.replace("(k 137)", "(k 999)"); // absent
    expect(last(src)).toEqual(["()"]);
  });

  it("nested/structured ground atoms match by structure, not identity", () => {
    const src = `
      !(add-atom &self (pair (a b) (c d)))
      !(collapse (match &self (pair (a b) (c d)) yes))`;
    expect(last(src)).toEqual(["(yes)"]);
  });
});

describe("named-space ground index fast path", () => {
  it("exact ground membership over named-space adds", () => {
    const src = `
      !(add-atom &kb (num Z))
      !(add-atom &kb (num (S Z)))
      !(add-atom &kb (num (S (S Z))))
      !(collapse (match &kb (num (S Z)) found))`;
    expect(last(src)).toEqual(["(found)"]);
  });

  it("preserves named-space duplicate multiplicity", () => {
    const src = `
      !(add-atom &kb (p a))
      !(add-atom &kb (p a))
      !(add-atom &kb (p a))
      !(collapse (match &kb (p a) hit))`;
    expect(last(src)).toEqual(["(hit hit hit)"]);
  });

  it("falls back to the scan when a non-ground named atom can unify", () => {
    const src = `
      !(add-atom &kb (edge 1 2))
      !(add-atom &kb (edge $x 2))
      !(collapse (match &kb (edge 1 2) hit))`;
    expect(last(src)).toEqual(["(hit hit)"]);
  });

  it("remove-atom updates a named space while preserving insertion order", () => {
    const src = `
      !(add-atom &kb (p a))
      !(add-atom &kb (p b))
      !(add-atom &kb (p a))
      !(remove-atom &kb (p a))
      !(collapse (get-atoms &kb))`;
    expect(last(src)).toEqual(["((p b) (p a))"]);
  });

  it("fork-space materializes a named space in insertion order", () => {
    const src = `
      !(add-atom &kb (p a))
      !(add-atom &kb (p b))
      !(let $fork (fork-space &kb)
        (let $_ (add-atom $fork (p c))
          (collapse (match $fork (p $x) $x))))`;
    expect(last(src)).toEqual(["(a b c)"]);
  });

  it("import! appends module atoms into a named space", () => {
    const src = `
      !(import! &kb concurrency)
      !(collapse (match &kb (: transaction (-> Atom %Undefined%)) found))`;
    expect(last(src)).toEqual(["(found)"]);
  });

  it("once over exact named membership advances the counter as the full scan did", () => {
    const src = `
      !(add-atom &kb (p a))
      !(add-atom &kb (p b))
      !(add-atom &kb (p c))
      (= (fresh) $z)
      !(once (match &kb (p b) ok))
      !(fresh)`;
    expect(last(src)).toEqual(["$z#3"]);
  });

  it("collapse once over exact named membership returns the same tuple shape", () => {
    const src = `
      !(add-atom &kb (p a))
      !(add-atom &kb (p b))
      !(collapse (once (match &kb (p b) ok)))
      !(collapse (once (match &kb (p z) ok)))`;
    expect(last(src)).toEqual(["()"]);
    expect(runProgram(src, 50_000_000)[2]!.results.map(format)).toEqual(["(ok)"]);
  });

  it("canonical add-unique-or-fail keeps one named-space copy", () => {
    const src = `
      (= (add-unique-or-fail $space $Expression)
        (let $st (s (repra $Expression))
          (if (== () (collapse (once (match $space $st True))))
            (add-atom $space $st)
            (empty))))
      !(add-unique-or-fail &dup (a b))
      !(add-unique-or-fail &dup (a b))
      !(collapse (get-atoms &dup))`;
    expect(last(src)).toEqual(["((s (repra (a b))))"]);
  });
});

describe("lib_datastructures guarded fast paths", () => {
  it("evaluates the two-stack queue helpers with variable dequeue binding", () => {
    const src = `
      ${queueLib}
      !(let* (($q0 (empty-queue))
              ($q1 (enqueue a $q0))
              ($q2 (enqueue b $q1))
              ($q3 (once (dequeue $x $q2)))
              ($q4 (once (dequeue $y $q3))))
         ($x $q3 $y $q4))`;
    expect(last(src)).toEqual(["(a (queue () (b) 1) b (queue () () 0))"]);
  });
});
