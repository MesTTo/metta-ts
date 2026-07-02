// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { wcoJoin, type Relation } from "./wcojoin";

const key = (n: number): string => String(n);

/** Reference: the naive pairwise (binary) join, the order the default `match` uses. */
function naiveJoin(rels: ReadonlyArray<Relation<number>>): Array<Map<string, number>> {
  let cur: Array<Map<string, number>> = [new Map()];
  for (const r of rels) {
    const next: Array<Map<string, number>> = [];
    for (const b of cur)
      for (const t of r.tuples) {
        let ok = true;
        for (const [v, val] of t) {
          const p = b.get(v);
          if (p !== undefined && p !== val) {
            ok = false;
            break;
          }
        }
        if (ok) {
          const m = new Map(b);
          for (const [v, val] of t) m.set(v, val);
          next.push(m);
        }
      }
    cur = next;
  }
  return cur;
}

const solKey = (m: Map<string, number>): string =>
  [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");

const asSet = (sols: Array<Map<string, number>>): Set<string> => new Set(sols.map(solKey));

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 0x100000000);
}

/** A binary relation over `(va, vb)` from random pairs in [0, dom). */
function randRel(
  rnd: () => number,
  va: string,
  vb: string,
  count: number,
  dom: number,
): Relation<number> {
  const tuples: Array<Map<string, number>> = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const a = Math.floor(rnd() * dom);
    const b = Math.floor(rnd() * dom);
    const k = a + "," + b;
    if (seen.has(k)) continue;
    seen.add(k);
    tuples.push(
      new Map([
        [va, a],
        [vb, b],
      ]),
    );
  }
  return { vars: [va, vb], tuples };
}

describe("worst-case-optimal join agrees with the naive join", () => {
  it("triangle queries R(a,b) S(b,c) T(c,a) match the naive join exactly", () => {
    const rnd = lcg(42);
    for (let trial = 0; trial < 40; trial++) {
      const dom = 6 + Math.floor(rnd() * 6);
      const R = randRel(rnd, "a", "b", 20, dom);
      const S = randRel(rnd, "b", "c", 20, dom);
      const T = randRel(rnd, "c", "a", 20, dom);
      const rels = [R, S, T];
      expect(asSet(wcoJoin(rels, key))).toEqual(asSet(naiveJoin(rels)));
    }
  });

  it("path queries R(a,b) S(b,c) S(c,d) match the naive join", () => {
    const rnd = lcg(7);
    for (let trial = 0; trial < 40; trial++) {
      const dom = 5 + Math.floor(rnd() * 8);
      const rels = [
        randRel(rnd, "a", "b", 15, dom),
        randRel(rnd, "b", "c", 15, dom),
        randRel(rnd, "c", "d", 15, dom),
      ];
      expect(asSet(wcoJoin(rels, key))).toEqual(asSet(naiveJoin(rels)));
    }
  });

  it("a 4-clique query matches the naive join", () => {
    const rnd = lcg(99);
    for (let trial = 0; trial < 20; trial++) {
      const dom = 5 + Math.floor(rnd() * 5);
      const e = (va: string, vb: string) => randRel(rnd, va, vb, 18, dom);
      const rels = [e("a", "b"), e("a", "c"), e("a", "d"), e("b", "c"), e("b", "d"), e("c", "d")];
      expect(asSet(wcoJoin(rels, key))).toEqual(asSet(naiveJoin(rels)));
    }
  });

  it("handles the empty result and the single-relation cases", () => {
    const R: Relation<number> = {
      vars: ["a", "b"],
      tuples: [
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
      ],
    };
    const S: Relation<number> = {
      vars: ["b", "c"],
      tuples: [
        new Map([
          ["b", 9],
          ["c", 3],
        ]),
      ],
    };
    expect(wcoJoin([R, S], key)).toEqual([]); // b cannot be both 2 and 9
    expect(asSet(wcoJoin([R], key))).toEqual(asSet(naiveJoin([R])));
  });

  it("finds actual triangles in a known graph", () => {
    // edges of a graph with one directed 3-cycle 0->1->2->0
    const edge = (a: number, b: number) =>
      new Map([
        ["x", a],
        ["y", b],
      ]);
    const edges = [edge(0, 1), edge(1, 2), edge(2, 0), edge(0, 3), edge(3, 4)];
    const R: Relation<number> = {
      vars: ["a", "b"],
      tuples: edges.map(
        (e) =>
          new Map([
            ["a", e.get("x")!],
            ["b", e.get("y")!],
          ]),
      ),
    };
    const S: Relation<number> = {
      vars: ["b", "c"],
      tuples: edges.map(
        (e) =>
          new Map([
            ["b", e.get("x")!],
            ["c", e.get("y")!],
          ]),
      ),
    };
    const T: Relation<number> = {
      vars: ["c", "a"],
      tuples: edges.map(
        (e) =>
          new Map([
            ["c", e.get("x")!],
            ["a", e.get("y")!],
          ]),
      ),
    };
    const sols = wcoJoin([R, S, T], key);
    expect(asSet(sols)).toEqual(asSet(naiveJoin([R, S, T])));
    // the 3-cycle yields three rotations (0,1,2),(1,2,0),(2,0,1)
    expect(sols.length).toBe(3);
  });
});
