// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { runProgram } from "./runner";
import { format } from "./parser";

// `transaction` (TS-native extension, opt-in via `!(import! &self concurrency)`): evaluate the body
// and commit its space mutations only on success; roll back (snapshot/restore the copy-on-write world)
// on a thrown Error atom or zero results. `collapse` renders a tuple as `(a b ...)` (bare, matching Hyperon).
const last = (src: string): string[] => {
  const rs = runProgram(src);
  return rs[rs.length - 1]!.results.map(format);
};

describe("transaction", () => {
  it("commits space mutations when the body adds and returns a value", () => {
    expect(
      last(`
        !(import! &self concurrency)
        !(add-atom &self (cnt 5))
        !(transaction (add-atom &self (cnt 7)))
        !(collapse (match &self (cnt $v) $v))
      `),
    ).toEqual(["(5 7)"]);
  });

  it("rolls back when the body adds then produces zero results", () => {
    expect(
      last(`
        !(import! &self concurrency)
        !(add-atom &self (cnt 5))
        !(transaction (let $u (add-atom &self (cnt 6)) (superpose ())))
        !(collapse (match &self (cnt $v) $v))
      `),
    ).toEqual(["(5)"]);
  });

  it("the transaction itself returns the body's results (zero on rollback)", () => {
    expect(
      last(`
        !(import! &self concurrency)
        !(transaction (let $u (add-atom &self (cnt 6)) (superpose ())))
      `),
    ).toEqual([]);
  });

  it("a superpose body with an Empty branch still commits (Empty is a value, not failure)", () => {
    // The body produces results (1 and the symbol Empty), so it commits; the add stays.
    expect(
      last(`
        !(import! &self concurrency)
        !(add-atom &self (cnt 5))
        !(transaction (let $u (add-atom &self (cnt 9)) (superpose (1 Empty))))
        !(collapse (match &self (cnt $v) $v))
      `),
    ).toEqual(["(5 9)"]);
  });
});
