// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { MeTTa } from "../base";
import { S, E, V, ValueAtom, OperationAtom, GroundedAtom } from "../atoms";
import { registerJsInterop, atomToJs, jsToAtom } from "./js";

const run1 = (m: MeTTa, q: string): string[] => m.run(q)[0]!.map((a) => a.toString());

describe("js interop (TS-native py-atom analogue)", () => {
  it("js-atom resolves and calls a global function", () => {
    const m = new MeTTa();
    registerJsInterop(m);
    expect(run1(m, `!((js-atom "Math.abs") -5)`)).toEqual(["5"]);
    expect(run1(m, `!((js-atom "Math.max") 3 7 2)`)).toEqual(["7"]);
  });

  it("js-dot reads a method bound to its object", () => {
    const m = new MeTTa();
    registerJsInterop(m);
    expect(run1(m, `!((js-dot "hello world" "toUpperCase"))`)).toEqual([`"HELLO WORLD"`]);
  });

  it("js-list builds a JS array that round-trips through a JS method", () => {
    const m = new MeTTa();
    registerJsInterop(m);
    // Array.prototype.join on a js-list
    expect(run1(m, `!((js-dot (js-list (5 1 3)) "join") "-")`)).toEqual([`"5-1-3"`]);
  });

  it("js-dict builds a JS object readable via js-dot", () => {
    const m = new MeTTa();
    registerJsInterop(m);
    expect(run1(m, `!(js-dot (js-dict (("a" 1) ("b" 2))) "b")`)).toEqual(["2"]);
  });

  it("an unresolvable path is a hard error", () => {
    const m = new MeTTa();
    registerJsInterop(m);
    const out = run1(m, `!((js-atom "Nope.nope") 1)`);
    expect(out.join("")).toContain("did not resolve");
  });
});

describe("executable grounded atoms", () => {
  it("an OperationAtom bound to a token is callable in MeTTa", () => {
    const m = new MeTTa();
    // bind a token `dbl` to an executable operation atom
    m.registerAtom(
      "dbl",
      OperationAtom("dbl", (a) => [
        ValueAtom(((a as GroundedAtom).object().content as number) * 2),
      ]),
    );
    expect(run1(m, `!(dbl 21)`)).toEqual(["42"]);
  });
});

describe("evaluateAtom", () => {
  it("evaluates a single constructed atom", () => {
    const m = new MeTTa();
    expect(m.evaluateAtom(E(S("+"), ValueAtom(1), ValueAtom(2))).map((a) => a.toString())).toEqual([
      "3",
    ]);
  });
});

describe("atomToJs / jsToAtom round-trip", () => {
  it("round-trips primitives", () => {
    expect(atomToJs(ValueAtom(5))).toBe(5);
    expect(atomToJs(ValueAtom("hi"))).toBe("hi");
    expect(jsToAtom(42).toString()).toBe("42");
    expect(jsToAtom("x").toString()).toBe(`"x"`);
  });
  it("wraps a function as an executable atom", () => {
    const a = jsToAtom((x: number) => x + 1);
    expect(a).toBeInstanceOf(GroundedAtom);
    // applying it runs the JS function
    expect(((a as GroundedAtom).object() as { execute?: unknown }).execute).toBeTypeOf("function");
  });
  it("variable atoms pass through atomToJs as their name", () => {
    expect(atomToJs(V("x"))).toBe("x");
  });
});
