// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { sym, variable, expr, gint, metaType, atomEq, type Atom } from "./atom";

describe("atom constructors", () => {
  it("interns symbols to reference identity", () => {
    expect(sym("foo")).toBe(sym("foo"));
    expect(sym("foo")).not.toBe(sym("bar"));
  });

  it("derives meta-types correctly", () => {
    expect(metaType(sym("a"))).toBe("Symbol");
    expect(metaType(variable("x"))).toBe("Variable");
    expect(metaType(expr([sym("a"), sym("b")]))).toBe("Expression");
    expect(metaType(gint(42))).toBe("Grounded");
  });

  it("structural equality compares by value", () => {
    expect(atomEq(expr([sym("a"), variable("x")]), expr([sym("a"), variable("x")]))).toBe(true);
    expect(atomEq(expr([sym("a")]), expr([sym("b")]))).toBe(false);
    expect(atomEq(gint(1), gint(1))).toBe(true);
    expect(atomEq(gint(1), gint(2))).toBe(false);
  });

  it("every variant shares the same hidden-class field set", () => {
    const atoms: Atom[] = [sym("a"), variable("x"), expr([]), gint(1)];
    for (const x of atoms) {
      expect(Object.keys(x).sort()).toEqual(
        ["exec", "ground", "items", "kind", "match", "name", "typ", "value"].sort(),
      );
    }
  });
});
