// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The result-producing per-position unify-capable admission (conjJoinPartials under experimental.trail).
// A conjunctive `match` that returns its template instances admits a schematic fact at a non-join position
// to the worst-case-optimal leapfrog. The leapfrog reorders and freshens differently from the coupled path,
// so an admitted schematic goal whose variable reaches the template is ALPHA-EQUIVALENT (same answer up to
// fresh-variable renaming, same cardinality), not byte-identical. Ground matches, no-template-leak matches,
// and the witness (a schematic fact binding a join variable non-ground, which must decline) stay byte-
// identical. The default path (trail off) is the byte-identical reference.
import { describe, expect, it } from "vitest";
import { runProgram, format, alphaEq, type Atom } from "./index";

function answers(src: string, trail: boolean): Atom[] {
  return runProgram(src, 100_000, new Map(), { experimental: { trail } }).flatMap((r) => r.results);
}

// Multiset equality up to alpha-renaming: a bijection pairing each off answer with an alpha-equal on answer.
function alphaMultisetEq(off: readonly Atom[], on: readonly Atom[]): boolean {
  if (off.length !== on.length) return false;
  const used = new Array<boolean>(on.length).fill(false);
  for (const a of off) {
    const i = on.findIndex((b, j) => !used[j] && alphaEq(a, b));
    if (i < 0) return false;
    used[i] = true;
  }
  return true;
}

describe("experimental.trail result path is the unify-capable admission", () => {
  it("ground conjunctive matches stay byte-identical", () => {
    const src =
      "(edge a b)(edge b c)(edge c a)(edge a c)(edge c b)(edge b a)\n" +
      "!(match &self (, (edge $x $y) (edge $y $z) (edge $z $x)) (tri $x $y $z))";
    expect(answers(src, true).map(format)).toEqual(answers(src, false).map(format));
  });

  it("a schematic var absent from the template stays byte-identical", () => {
    const src = "(p 1)(p 2)(t $a foo)\n!(match &self (, (p $x) (t $y $z)) (r $x))";
    expect(answers(src, true).map(format)).toEqual(answers(src, false).map(format));
  });

  it("a schematic fact binding a join variable non-ground declines (the witness), byte-identical", () => {
    const src = "(p 1)(p 2)(q $a foo)\n!(match &self (, (p $x) (q $x $z)) (res $x $z))";
    expect(answers(src, true).map(format)).toEqual(answers(src, false).map(format));
  });

  it("a schematic fact at a non-join position is admitted, alpha-equivalent to the coupled path", () => {
    const src = "(p 1)(p 2)(t $a foo)\n!(match &self (, (p $x) (t $y $z)) (r $x $y $z))";
    const off = answers(src, false);
    const on = answers(src, true);
    expect(on.length).toBe(off.length);
    expect(alphaMultisetEq(off, on)).toBe(true);
  });
});
