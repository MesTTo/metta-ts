// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { addValRaw, lookupVal, prependValRaw, removeVal, type Bindings } from "./bindings";
import { sym } from "./atom";

describe("Bindings value relations", () => {
  it("raw value replacement drops all prior values without reordering the remaining relations", () => {
    const b: Bindings = [
      { tag: "val", x: "x", a: sym("A"), y: undefined },
      { tag: "eq", x: "u", a: undefined, y: "v" },
      { tag: "val", x: "y", a: sym("B"), y: undefined },
      { tag: "val", x: "x", a: sym("C"), y: undefined },
    ];

    const out = addValRaw(b, "x", sym("D"));

    expect(out).toEqual([
      { tag: "val", x: "x", a: sym("D"), y: undefined },
      { tag: "eq", x: "u", a: undefined, y: "v" },
      { tag: "val", x: "y", a: sym("B"), y: undefined },
    ]);
    expect(lookupVal(out, "x")).toEqual(sym("D"));
    expect(lookupVal(out, "y")).toEqual(sym("B"));
  });

  it("unbound value prepend and no-op removal keep lookup semantics", () => {
    const b = prependValRaw([], "x", sym("A"));

    expect(lookupVal(b, "x")).toEqual(sym("A"));
    expect(removeVal(b, "y")).toBe(b);
  });
});
