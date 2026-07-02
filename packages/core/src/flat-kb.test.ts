// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { FlatKB, Interner, encodeAtom, decodeAtom } from "./flat-kb";
import { sym, variable, expr, gint, gstr, gbool, atomVars, type Atom } from "./atom";
import { matchAtoms } from "./match";
import { lookupVal } from "./bindings";
import { format } from "./parser";

const A = (...items: Atom[]): Atom => expr(items);

describe("flat-kb encode/decode round-trip", () => {
  it("round-trips symbols, expressions, grounded values", () => {
    const it = new Interner();
    for (const a of [
      sym("foo"),
      A(sym("Parent"), sym("Tom"), sym("Bob")),
      A(sym("f"), gint(5), gstr("hi"), gbool(true)),
      A(sym("nest"), A(sym("g"), gint(-3)), sym("z")),
    ]) {
      expect(format(decodeAtom(encodeAtom(a, it), it))).toEqual(format(a));
    }
  });

  it("decodes distinct fresh variables to distinct de Bruijn names (not all $0)", () => {
    const it = new Interner();
    // Two distinct variables must not collapse to the same name on decode.
    expect(
      format(decodeAtom(encodeAtom(A(sym("f"), variable("x"), variable("y")), it), it)),
    ).toEqual("(f $0 $1)");
    // A repeated variable shares one name (alpha-equivalent to the original).
    expect(
      format(decodeAtom(encodeAtom(A(sym("g"), variable("x"), variable("x")), it), it)),
    ).toEqual("(g $0 $0)");
  });
});

// The set of binding maps a pattern produces over a fact set, via the reference tree matcher.
function treeMatch(facts: Atom[], pattern: Atom): string[] {
  const vars = atomVars(pattern);
  const out: string[] = [];
  for (const f of facts)
    for (const b of matchAtoms(pattern, f)) {
      const entries = vars.map((v) => `${v}=${format(lookupVal(b, v) ?? variable(v))}`);
      out.push(entries.join(","));
    }
  return out.sort();
}

function flatMatch(facts: Atom[], pattern: Atom): string[] {
  const kb = new FlatKB();
  for (const f of facts) kb.add(f);
  return kb
    .match(pattern)
    .map((m) =>
      atomVars(pattern)
        .map((v) => `${v}=${format(m.get(v) ?? variable(v))}`)
        .join(","),
    )
    .sort();
}

describe("flat-kb match — differential against the tree matcher", () => {
  const facts: Atom[] = [
    A(sym("Parent"), sym("Tom"), sym("Bob")),
    A(sym("Parent"), sym("Tom"), sym("Liz")),
    A(sym("Parent"), sym("Pam"), sym("Bob")),
    A(sym("Likes"), sym("Tom"), sym("Pie")),
    A(sym("eq"), sym("a"), sym("a")),
    A(sym("eq"), sym("a"), sym("b")),
    A(sym("edge"), gint(1), gint(2)),
    A(sym("edge"), gint(2), gint(3)),
    A(sym("triple"), sym("s"), sym("p"), A(sym("o"), gint(9))),
  ];
  const patterns: Atom[] = [
    A(sym("Parent"), sym("Tom"), variable("c")), // bind second
    A(sym("Parent"), variable("p"), sym("Bob")), // bind first
    A(sym("Parent"), variable("p"), variable("c")), // bind both
    A(sym("eq"), variable("x"), variable("x")), // repeated variable
    A(sym("edge"), gint(1), variable("y")), // ground first arg
    A(sym("edge"), variable("x"), gint(3)), // ground second arg
    A(sym("triple"), variable("s"), variable("p"), variable("o")), // nested ground bound to a var
    A(sym("Missing"), variable("x")), // unknown functor -> empty
    variable("anything"), // bare variable matches every fact
  ];

  for (const [i, pat] of patterns.entries()) {
    it(`pattern #${i} ${format(pat)} matches the tree matcher`, () => {
      expect(flatMatch(facts, pat)).toEqual(treeMatch(facts, pat));
    });
  }
});

describe("flat-kb scaling", () => {
  it("uses the functor index: a rare functor among 100k atoms matches without a full scan", () => {
    // The flat KB indexes by head functor (a single-functor query is a linear scan; that is what the
    // parallel matcher is for). With diverse functors, a functor-selective query skips the rest.
    const kb = new FlatKB();
    for (let i = 0; i < 100_000; i++) kb.add(A(sym("filler"), gint(i)));
    kb.add(A(sym("needle"), sym("found")));
    const res = kb.match(A(sym("needle"), variable("x")));
    expect(res.map((m) => format(m.get("x")!))).toEqual(["found"]);
  });

  it("matches a single-functor query correctly (linear scan over the functor bucket)", () => {
    const kb = new FlatKB();
    for (let i = 0; i < 10_000; i++) kb.add(A(sym("edge"), gint(i), gint(i + 1)));
    expect(
      kb.match(A(sym("edge"), gint(5_000), variable("y"))).map((m) => format(m.get("y")!)),
    ).toEqual(["5001"]);
  });
});
