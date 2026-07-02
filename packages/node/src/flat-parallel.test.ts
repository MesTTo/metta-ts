// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect, afterAll } from "vitest";
import { FlatKB, sym, variable, expr, gint, format, type Atom } from "@metta-ts/core";
import { ParallelFlatMatcher } from "./flat-parallel";

const A = (...items: Atom[]): Atom => expr(items);

const sortBindings = (ms: Array<Map<string, Atom>>): string[] =>
  ms
    .map((m) =>
      [...m.entries()]
        .map(([k, v]) => `${k}=${format(v)}`)
        .sort()
        .join(","),
    )
    .sort();

describe("parallel flat matcher", () => {
  const matchers: ParallelFlatMatcher[] = [];
  const make = (kb: FlatKB): ParallelFlatMatcher => {
    const m = new ParallelFlatMatcher(kb, 4);
    matchers.push(m);
    return m;
  };
  afterAll(async () => {
    await Promise.all(matchers.map((m) => m.close()));
  });

  it("matches identically to the single-threaded FlatKB (differential)", async () => {
    const kb = new FlatKB();
    const facts = [
      A(sym("Parent"), sym("Tom"), sym("Bob")),
      A(sym("Parent"), sym("Tom"), sym("Liz")),
      A(sym("Parent"), sym("Pam"), sym("Bob")),
      A(sym("eq"), sym("a"), sym("a")),
      A(sym("eq"), sym("a"), sym("b")),
    ];
    for (const f of facts) kb.add(f);
    const par = make(kb);
    for (const pat of [
      A(sym("Parent"), sym("Tom"), variable("c")),
      A(sym("Parent"), variable("p"), variable("c")),
      A(sym("eq"), variable("x"), variable("x")),
      variable("any"),
    ]) {
      expect(sortBindings(await par.match(pat))).toEqual(sortBindings(kb.match(pat)));
    }
  });

  it("scans a large KB in parallel and finds every match of a non-selective query", async () => {
    const kb = new FlatKB();
    const N = 200_000;
    // half the atoms have tag `hot`, half `cold`; a query bound only on the tag is non-selective.
    for (let i = 0; i < N; i++) kb.add(A(sym(i % 2 === 0 ? "hot" : "cold"), gint(i)));
    const par = make(kb);
    const res = await par.match(A(sym("hot"), variable("x")));
    expect(res.length).toBe(N / 2);
    // and it agrees with the single-threaded matcher
    expect(res.length).toBe(kb.match(A(sym("hot"), variable("x"))).length);
  });
});
