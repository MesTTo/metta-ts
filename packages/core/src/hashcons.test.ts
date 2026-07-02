// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { createInternTable, expr, gint, gnd, internAtom, internExpr, sym, variable } from "./atom";

describe("hash-cons interning", () => {
  it("shares structurally equal expressions in one table", () => {
    const table = createInternTable();
    const items = [sym("tuple"), ...Array.from({ length: 63 }, (_, i) => sym("S" + i))];
    const a = internExpr(table, expr(items));
    const b = internExpr(table, expr(items));

    expect(a).toBe(b);
    expect(a.items[1]).toBe(b.items[1]);
  });

  it("canonicalizes variables per table", () => {
    const table = createInternTable();
    const a = internAtom(table, variable("x"));
    const b = internAtom(table, variable("x"));

    expect(a).toBe(b);
  });

  it("does not intern expressions containing grounded literals", () => {
    const table = createInternTable();
    const items = [sym("tuple"), ...Array.from({ length: 63 }, (_, i) => gint(i))];
    const a = internExpr(table, expr(items));
    const b = internExpr(table, expr(items));

    expect(a).not.toBe(b);
  });

  it("does not intern expressions containing executable or ext grounded atoms", () => {
    const table = createInternTable();
    const left = gnd({ g: "ext", kind: "cell", id: "same" }, sym("Grounded"), () => [sym("left")]);
    const right = gnd({ g: "ext", kind: "cell", id: "same" }, sym("Grounded"), () => [
      sym("right"),
    ]);

    const suffix = Array.from({ length: 62 }, (_, i) => sym("S" + i));
    const a = internExpr(table, expr([sym("box"), left, ...suffix]));
    const b = internExpr(table, expr([sym("box"), right, ...suffix]));

    expect(a).not.toBe(b);
    expect(a.items[1]).toBe(left);
    expect(b.items[1]).toBe(right);
  });

  it("does not intern state handle expressions", () => {
    const table = createInternTable();
    const a = internExpr(table, expr([sym("State"), gint(1)]));
    const b = internExpr(table, expr([sym("State"), gint(1)]));

    expect(a).not.toBe(b);
  });
});
