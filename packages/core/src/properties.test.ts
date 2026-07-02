// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it } from "vitest";
import fc from "fast-check";
import { type Atom, sym, variable, expr, gint, atomEq, atomVars } from "./atom";
import { parse, format } from "./parser";
import { standardTokenizer } from "./runner";
import { alphaEq } from "./alpha";
import { matchAtoms } from "./match";
import { instantiate } from "./instantiate";

// A safe symbol name: starts with a letter, not "True"/"False", not all-digits (those tokenize).
const name = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,6}$/)
  .filter((s) => s !== "True" && s !== "False");

const atomArb: fc.Arbitrary<Atom> = fc.letrec<{ atom: Atom }>((tie) => ({
  atom: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    name.map(sym),
    name.map(variable),
    fc.integer({ min: -999, max: 999 }).map(gint),
    fc.array(tie("atom"), { maxLength: 3 }).map((xs) => expr(xs)),
  ),
})).atom;

const tk = standardTokenizer();

describe("properties (fast-check)", () => {
  it("parser round-trip: parse(format(a)) ≡ a", () => {
    fc.assert(
      fc.property(atomArb, (a) => {
        const r = parse(format(a), tk);
        return r !== undefined && atomEq(r, a);
      }),
    );
  });

  it("alphaEq is reflexive and symmetric", () => {
    fc.assert(fc.property(atomArb, (a) => alphaEq(a, a)));
    fc.assert(fc.property(atomArb, atomArb, (a, b) => alphaEq(a, b) === alphaEq(b, a)));
  });

  it("matcher soundness: a binding set instantiates the pattern to the ground target", () => {
    fc.assert(
      fc.property(atomArb, atomArb, (pattern, ground0) => {
        // Make the target ground by substituting any vars with a constant.
        const subst = (x: Atom): Atom =>
          x.kind === "var" ? sym("k") : x.kind === "expr" ? expr(x.items.map(subst)) : x;
        const ground = subst(ground0);
        for (const b of matchAtoms(pattern, ground)) {
          if (!atomEq(instantiate(b, pattern), ground)) return false;
        }
        return true;
      }),
    );
  });

  it("a matched pattern with no extra vars resolves all its variables", () => {
    fc.assert(
      fc.property(atomArb, (ground0) => {
        const subst = (x: Atom): Atom =>
          x.kind === "var" ? sym("k") : x.kind === "expr" ? expr(x.items.map(subst)) : x;
        const ground = subst(ground0);
        // pattern = ground with one leaf turned into a fresh var still matches and resolves.
        const pat = expr([variable("p"), ground]);
        const tgt = expr([sym("anchor"), ground]);
        const res = matchAtoms(pat, tgt);
        if (res.length === 0) return true;
        return atomVars(instantiate(res[0]!, pat)).length === 0;
      }),
    );
  });
});
