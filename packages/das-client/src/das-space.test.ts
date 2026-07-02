// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { sym, variable, expr, instantiate, atomEq } from "@metta-ts/core";
import { DasSpace } from "./das-space";
import { MockTransport } from "./transport";

describe("DasSpace (over a mock transport)", () => {
  it("implements the Space interface: add, query, remove", () => {
    const space = new DasSpace(new MockTransport());
    space.add(expr([sym("Similarity"), sym("human"), sym("chimp")]));
    space.add(expr([sym("Similarity"), sym("human"), sym("monkey")]));

    const res = space.query(expr([sym("Similarity"), sym("human"), variable("s")]));
    expect(res.length).toBe(2);
    const got = res.map((b) => instantiate(b, variable("s")));
    expect(got.some((a) => atomEq(a, sym("chimp")))).toBe(true);
    expect(got.some((a) => atomEq(a, sym("monkey")))).toBe(true);

    expect(space.remove(expr([sym("Similarity"), sym("human"), sym("chimp")]))).toBe(true);
    expect(space.query(expr([sym("Similarity"), sym("human"), variable("s")])).length).toBe(1);
  });
});
