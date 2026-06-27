// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Custom unification for a TypeScript type: subclass MatchableObject and override match_, then the core
// matcher calls into it. Here a Range value matches any integer within its bounds.
//
// Run it (after `pnpm build`): npx tsx examples/custom-matching.ts
import { MeTTa, G, MatchableObject, type Atom, type GroundedAtom } from "@metta-ts/hyperon";
import { sym as coreSym, gint, matchAtoms } from "@metta-ts/core";

class Range extends MatchableObject {
  constructor(
    readonly lo: number,
    readonly hi: number,
  ) {
    super({ lo, hi });
  }
  // Return one (empty) binding to signal a match, or none to signal no match.
  override match_(other: Atom): unknown[] {
    const g = other as GroundedAtom;
    const n = typeof g.object === "function" ? (g.object().content as unknown) : undefined;
    return typeof n === "number" && n >= this.lo && n <= this.hi ? [[]] : [];
  }
}

// Make a Range atom and match integers against it via the core matcher.
const range = G(new Range(1, 10));
console.log("5 in [1,10]:", matchAtoms(range.catom, gint(5)).length === 1); // true
console.log("20 in [1,10]:", matchAtoms(range.catom, gint(20)).length === 1); // false

// It is just an atom, so it also works inside a runner.
const m = new MeTTa();
void m; // (a Range could be stored in a space and matched by a query)
void coreSym;
