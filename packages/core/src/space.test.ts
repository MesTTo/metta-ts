// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { InMemorySpace } from "./space";
import { sym, variable, expr, atomEq } from "./atom";
import { instantiate } from "./instantiate";

describe("InMemorySpace", () => {
  it("adds atoms and queries by pattern, returning binding sets", () => {
    const s = new InMemorySpace();
    s.add(expr([sym("Parent"), sym("Tom"), sym("Bob")]));
    s.add(expr([sym("Parent"), sym("Bob"), sym("Ann")]));
    const res = s.query(expr([sym("Parent"), sym("Tom"), variable("c")]));
    expect(res.length).toBe(1);
    expect(atomEq(instantiate(res[0]!, variable("c")), sym("Bob"))).toBe(true);
  });

  it("returns one binding set per matching atom", () => {
    const s = new InMemorySpace();
    s.add(expr([sym("p"), sym("a")]));
    s.add(expr([sym("p"), sym("b")]));
    expect(s.query(expr([sym("p"), variable("x")])).length).toBe(2);
  });

  it("remove deletes a matching atom; atoms() enumerates", () => {
    const s = new InMemorySpace();
    const a = expr([sym("A")]);
    s.add(a);
    expect(s.remove(a)).toBe(true);
    expect(s.remove(a)).toBe(false);
    expect(s.atoms().length).toBe(0);
  });
});
