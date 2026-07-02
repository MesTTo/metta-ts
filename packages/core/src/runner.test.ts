// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { runProgram } from "./runner";
import { format } from "./parser";

const q = (src: string, i = 0): string[] => runProgram(src)[i]!.results.map(format);

describe("runner + stdlib prelude", () => {
  it("stdlib if reduces", () => {
    expect(q("!(if (> 3 2) yes no)")).toEqual(["yes"]);
    expect(q("!(if (< 3 2) yes no)")).toEqual(["no"]);
  });

  it("stdlib let binds", () => {
    expect(q("!(let $x 5 (+ $x 1))")).toEqual(["6"]);
  });

  it("add-atom stores the atom unreduced; add-reduct reduces it first (Hyperon semantics)", () => {
    // `(: add-atom (-> SpaceType Atom (->)))`: the atom argument is Atom-typed, so `(foo (g))` is stored as
    // written, NOT reduced to `(foo 7)`. `add-reduct` is the evaluated variant, so it stores `(bar 7)`.
    const r = runProgram(`
      (= (g) 7)
      !(bind! &s (new-space))
      !(add-atom &s (foo (g)))
      !(add-reduct &s (bar (g)))
      !(match &s (foo (g)) yes)
      !(match &s (foo 7) yes)
      !(match &s (bar 7) yes)
      !(match &s (bar (g)) yes)
    `);
    expect(r[3]!.results.map(format)).toEqual(["yes"]); // add-atom kept (foo (g)) literal
    expect(r[4]!.results.map(format)).toEqual([]); //   ... so (foo 7) is not stored
    expect(r[5]!.results.map(format)).toEqual(["yes"]); // add-reduct reduced to (bar 7)
    expect(r[6]!.results.map(format)).toEqual([]); //   ... so (bar (g)) is not stored
  });

  it("cons-atom requires an expression tail (does not wrap a non-expression)", () => {
    expect(q("!(cons-atom a (b c))")).toEqual(["(a b c)"]);
    // a non-expression tail is not silently wrapped into (a b); the call is left unreduced
    expect(q("!(cons-atom a b)")).toEqual(["(cons-atom a b)"]);
  });

  it("get-type-space consults the named space's type declarations", () => {
    const r = runProgram(`
      !(add-atom &kb (: Foo Bar))
      !(get-type-space &kb Foo)
    `);
    expect(r[1]!.results.map(format)).toEqual(["Bar"]);
  });

  it("stdlib let* sequences bindings", () => {
    expect(q("!(let* (($x 2) ($y (* $x 3))) (+ $x $y))")).toEqual(["8"]);
  });

  it("arithmetic and comparison through the prelude types", () => {
    expect(q("!(+ 1 2)")).toEqual(["3"]);
    expect(q("!(== 2 2)")).toEqual(["True"]);
  });

  it("sequential: a definition is visible to a later query", () => {
    const src = "(= (f $x) (* $x $x))\n!(f 7)";
    expect(q(src)).toEqual(["49"]);
  });
});
