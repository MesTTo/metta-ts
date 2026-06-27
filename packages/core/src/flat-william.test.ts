// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { FlatKB } from "./flat-kb";
import { williamTopK, type HeavyPattern } from "./flat-william";
import { sym, expr, gint, gstr, type Atom } from "./atom";
import { format } from "./parser";

const A = (...items: Atom[]): Atom => expr(items);

// Independent oracle on the ATOM TREE (not the flat token path williamTopK walks). Token length of a
// subterm = its preorder token count: a leaf is 1 token; an expr is 1 arity token plus its children.
function tokenLen(a: Atom): number {
  if (a.kind === "expr") return 1 + a.items.reduce((s, c) => s + tokenLen(c), 0);
  return 1;
}

function eachSubtree(a: Atom, cb: (s: Atom) => void): void {
  cb(a);
  if (a.kind === "expr") for (const c of a.items) eachSubtree(c, cb);
}

// Brute-force top-k over the tree, mirroring the gain formula. Structurally-equal subterms share a key
// (their canonical print); grounds and symbols print distinctly, matching the interned flat key.
function oracleTopK(facts: Atom[], k: number, refCost: number): HeavyPattern[] {
  const counts = new Map<string, { count: number; len: number; pattern: Atom }>();
  for (const f of facts)
    eachSubtree(f, (s) => {
      const key = format(s);
      const info = counts.get(key);
      if (info !== undefined) info.count++;
      else counts.set(key, { count: 1, len: tokenLen(s), pattern: s });
    });
  const scored: HeavyPattern[] = [];
  for (const { count, len, pattern } of counts.values()) {
    if (count < 2 || len < 2) continue;
    const gain = (count - 1) * len - count * refCost;
    if (gain > 0) scored.push({ pattern, count, len, gain });
  }
  scored.sort((a, b) => b.gain - a.gain || b.count - a.count);
  return scored.slice(0, k);
}

// Compare two rankings as multisets keyed by (printed pattern, count, len, gain). Tie order does not matter.
const asSet = (hs: HeavyPattern[]): string[] =>
  hs.map((h) => `${format(h.pattern)}|c=${h.count}|l=${h.len}|g=${h.gain}`).sort();

describe("william top-k — differential against a tree-walking oracle", () => {
  const corpora: Array<{ name: string; facts: Atom[] }> = [
    {
      name: "repeated nested subterm",
      facts: [
        A(sym("link"), A(sym("node"), sym("a")), A(sym("node"), sym("b"))),
        A(sym("link"), A(sym("node"), sym("a")), A(sym("node"), sym("c"))),
        A(sym("link"), A(sym("node"), sym("a")), A(sym("node"), sym("d"))),
      ],
    },
    {
      name: "repeated predicate tag (Hyperon-style typing)",
      facts: [
        A(sym(":"), sym("Tom"), sym("Animal")),
        A(sym(":"), sym("Sam"), sym("Animal")),
        A(sym(":"), sym("Pip"), sym("Animal")),
        A(sym(":"), sym("Rex"), sym("Plant")),
      ],
    },
    {
      name: "grounded values repeat",
      facts: [
        A(sym("obs"), gint(1), A(sym("at"), gint(100))),
        A(sym("obs"), gint(2), A(sym("at"), gint(100))),
        A(sym("obs"), gint(3), A(sym("at"), gint(100))),
        A(sym("meta"), gstr("v"), gstr("v")),
      ],
    },
    { name: "no repetition", facts: [A(sym("p"), sym("x")), A(sym("q"), sym("y"))] },
    { name: "empty", facts: [] },
  ];

  for (const { name, facts } of corpora)
    for (const refCost of [1, 4, 8])
      it(`${name} @ refCost=${refCost} matches the oracle`, () => {
        const kb = new FlatKB();
        for (const f of facts) kb.add(f);
        expect(asSet(williamTopK(kb, 100, refCost))).toEqual(
          asSet(oracleTopK(facts, 100, refCost)),
        );
      });
});

describe("william top-k — economics and ranking", () => {
  it("surfaces the heaviest repeated subterm first", () => {
    const kb = new FlatKB();
    for (const tgt of ["b", "c", "d"])
      kb.add(A(sym("link"), A(sym("node"), sym("a")), A(sym("node"), sym(tgt))));
    const top = williamTopK(kb, 1, 1);
    expect(top).toHaveLength(1);
    expect(format(top[0]!.pattern)).toBe("(node a)");
    expect(top[0]!.count).toBe(3); // (node a) on the left of all 3 links, plus never on the right
    expect(top[0]!.len).toBe(3); // arity + "node" + "a"
    expect(top[0]!.gain).toBe((3 - 1) * 3 - 3 * 1); // = 3
  });

  it("a single symbol never pays to factor (len < 2 filtered)", () => {
    const kb = new FlatKB();
    for (let i = 0; i < 50; i++) kb.add(A(sym("tag"), gint(i))); // `tag` repeats 50x but is one token
    // `tag` (len 1) is excluded; each `(tag i)` is unique. Nothing is worth factoring.
    expect(williamTopK(kb, 10, 1)).toEqual([]);
  });

  it("higher reference cost prunes marginal patterns", () => {
    const kb = new FlatKB();
    // `(pair x)` (len 2) occurs 3x: gain = (3-1)*2 - 3*refCost = 4 - 3*refCost.
    for (const w of ["wrap", "hold", "keep"]) kb.add(A(sym(w), A(sym("pair"), sym("x"))));
    // refCost 1 -> gain 4 - 3 = 1 > 0, survives.
    expect(williamTopK(kb, 10, 1).map((h) => format(h.pattern))).toContain("(pair x)");
    // refCost 4 -> gain 4 - 12 = -8, pruned. Nothing else repeats, so the result is empty.
    expect(williamTopK(kb, 10, 4)).toEqual([]);
  });

  it("scales: finds a frequent subterm among 100k facts", () => {
    const kb = new FlatKB();
    for (let i = 0; i < 100_000; i++) kb.add(A(sym("edge"), A(sym("kind"), sym("road")), gint(i)));
    // refCost 2 < the pattern's 3 tokens, so factoring 100k copies is a large net win.
    const top = williamTopK(kb, 1, 2);
    expect(format(top[0]!.pattern)).toBe("(kind road)");
    expect(top[0]!.count).toBe(100_000);
  });
});
