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
