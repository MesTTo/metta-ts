// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  S,
  V,
  E,
  G,
  ValueAtom,
  OperationObject,
  GroundedObject,
  ValueObject,
  SymbolAtom,
  VariableAtom,
  ExpressionAtom,
  GroundedAtom,
  AtomType,
  friendlyTypeName,
  atomsAreEquivalent,
  atomIsError,
} from "./atoms";
import { Bindings, BindingsSet } from "./bindings";
import { MeTTa, GroundingSpace, SExprParser, standardTokenizer } from "./base";

describe("atom constructors and metatypes", () => {
  it("builds symbols, variables, expressions, grounded values", () => {
    expect(S("foo").metatype()).toBe("Symbol");
    expect(V("x").metatype()).toBe("Variable");
    expect(E(S("+"), ValueAtom(1), ValueAtom(2)).metatype()).toBe("Expression");
    expect(ValueAtom(42).metatype()).toBe("Grounded");
  });

  it("renders atoms like MeTTa", () => {
    expect(S("foo").toString()).toBe("foo");
    expect(V("x").toString()).toBe("$x");
    expect(E(S("a"), S("b")).toString()).toBe("(a b)");
    expect(ValueAtom(3).toString()).toBe("3");
    expect(ValueAtom("hi").toString()).toBe('"hi"');
  });

  it("reads names and children", () => {
    expect((S("cat") as SymbolAtom).name()).toBe("cat");
    const e = E(S("a"), S("b")) as ExpressionAtom;
    expect(e.children().map((c) => c.toString())).toEqual(["a", "b"]);
  });

  it("compares and alpha-compares", () => {
    expect(S("a").equals(S("a"))).toBe(true);
    expect(S("a").equals(S("b"))).toBe(false);
    expect(atomsAreEquivalent(E(V("x"), V("y")), E(V("a"), V("b")))).toBe(true);
  });

  it("iterates depth-first", () => {
    const a = E(S("f"), E(S("g"), S("h")));
    expect(a.iterate().map((x) => x.toString())).toEqual(["(f (g h))", "f", "(g h)", "g", "h"]);
  });

  it("exposes AtomType constants", () => {
    expect(AtomType.NUMBER.toString()).toBe("Number");
    expect(AtomType.UNDEFINED.toString()).toBe("%Undefined%");
  });

  it("rejects a wrapper built from the wrong core atom kind", () => {
    expect(() => new SymbolAtom(V("x").catom)).toThrow(/SymbolAtom expects a 'sym' atom/);
    expect(() => new VariableAtom(S("x").catom)).toThrow(/VariableAtom expects a 'var' atom/);
  });

  it("friendlyTypeName reports value types", () => {
    expect(friendlyTypeName(ValueAtom(1))).toBe("Number (integer)");
    expect(friendlyTypeName(ValueAtom("s"))).toBe("String");
    expect(friendlyTypeName(S("foo"))).toBe("Symbol");
    expect(friendlyTypeName(E(S("a")))).toBe("Expression");
  });
});

describe("grounded objects", () => {
  it("wraps and recovers a JS object", () => {
    const obj = new ValueObject({ a: 1 });
    const g = G(obj);
    expect(g.metatype()).toBe("Grounded");
    expect((g as GroundedAtom).object()).toBe(obj);
  });

  it("object() returns a stable instance for primitives", () => {
    const g = ValueAtom(5) as GroundedAtom;
    expect(g.object()).toBe(g.object());
  });

  it("ValueAtom converts primitives", () => {
    expect(ValueAtom(5).toString()).toBe("5");
    expect(ValueAtom(2.5).toString()).toBe("2.5");
    expect(ValueAtom(true).toString()).toBe("True");
  });

  it("OperationObject executes over atoms", () => {
    const op = new OperationObject("dup", (a) => [a, a]);
    expect(op.execute(S("x")).map((x) => x.toString())).toEqual(["x", "x"]);
  });

  it("GroundedObject keeps content and id", () => {
    const o = new GroundedObject(99, "answer");
    expect(o.content).toBe(99);
    expect(o.toString()).toBe("answer");
  });
});

describe("matching and bindings", () => {
  it("matchAtom yields variable bindings", () => {
    const set = E(S("point"), V("x"), V("y")).matchAtom(E(S("point"), ValueAtom(1), ValueAtom(2)));
    expect(set instanceof BindingsSet).toBe(true);
    expect(set.isEmpty()).toBe(false);
    const frame = set.frames[0]!;
    expect(frame.resolve(V("x"))?.toString()).toBe("1");
    expect(frame.resolve(V("y"))?.toString()).toBe("2");
  });

  it("a Bindings frame records and resolves associations", () => {
    const b = new Bindings();
    expect(b.isEmpty()).toBe(true);
    b.addVarBinding(V("z"), S("hello"));
    expect(b.isEmpty()).toBe(false);
    expect(b.resolve(V("z"))?.toString()).toBe("hello");
    expect(b.pairs().map(([v, a]) => `${v.toString()}=${a.toString()}`)).toEqual(["$z=hello"]);
  });

  it("addVarEquality records a variable alias on a set", () => {
    const set = new BindingsSet();
    expect(set.addVarEquality(V("a"), V("b"))).toBe(true);
    // the alias is recorded as a relation in the frame
    expect(set.frames[0]!.raw().some((r) => r.tag === "eq")).toBe(true);
  });

  it("non-matching atoms give an empty set", () => {
    expect(S("a").matchAtom(S("b")).isEmpty()).toBe(true);
  });
});

describe("spaces", () => {
  it("adds, queries, and substitutes", () => {
    const sp = new GroundingSpace();
    sp.addAtom(E(S("parent"), S("tom"), S("bob")));
    sp.addAtom(E(S("parent"), S("tom"), S("liz")));
    expect(sp.atomCount()).toBe(2);
    const kids = sp.subst(E(S("parent"), S("tom"), V("c")), V("c"));
    expect(kids.map((k) => k.toString()).sort()).toEqual(["bob", "liz"]);
  });
});

describe("parser", () => {
  it("parses an expression", () => {
    const a = new SExprParser("(+ 1 2)").parse(standardTokenizer());
    expect(a?.toString()).toBe("(+ 1 2)");
  });
  it("parses all top-level atoms", () => {
    const atoms = new SExprParser("(foo) (bar baz)").parseAll(standardTokenizer());
    expect(atoms.map((a) => a.toString())).toEqual(["(foo)", "(bar baz)"]);
  });
});

describe("MeTTa runner", () => {
  it("evaluates arithmetic", () => {
    const m = new MeTTa();
    const out = m.run("!(+ 1 2)");
    expect(out[0]!.map((a) => a.toString())).toEqual(["3"]);
  });

  it("keeps a knowledge base across run calls and answers match", () => {
    const m = new MeTTa();
    m.run("(= (color) red)\n(= (color) green)");
    const out = m.run("!(color)");
    expect(out[0]!.map((a) => a.toString()).sort()).toEqual(["green", "red"]);
  });

  it("exposes its space and types", () => {
    const m = new MeTTa();
    m.run("(knows alice)");
    expect(
      m
        .space()
        .getAtoms()
        .some((a) => a.toString() === "(knows alice)"),
    ).toBe(true);
    expect(m.getAtomTypes(ValueAtom(1)).map((t) => t.toString())).toContain("Number");
  });

  it("registers a custom grounded operation callable from MeTTa", () => {
    const m = new MeTTa();
    m.registerOperation("double", (args) => {
      const v = args[0]!;
      return [ValueAtom(((v as GroundedAtom).object().content as number) * 2)];
    });
    const out = m.run("!(double 21)");
    expect(out[0]!.map((a) => a.toString())).toEqual(["42"]);
  });

  it("error atoms are detected", () => {
    expect(atomIsError(E(S("Error"), S("x"), S("boom")))).toBe(true);
    expect(atomIsError(S("ok"))).toBe(false);
  });

  it("space() is live: atoms added through it reach evaluation, removal retracts", () => {
    const m = new MeTTa();
    m.space().addAtom(E(S("="), E(S("greeting")), S("hello")));
    // adding via the space affects what run() evaluates
    expect(m.run("!(greeting)")[0]!.map((a) => a.toString())).toEqual(["hello"]);
    // and run() atoms are visible through the space
    m.run("(= (greeting) hi)");
    expect(
      m
        .run("!(greeting)")[0]!
        .map((a) => a.toString())
        .sort(),
    ).toEqual(["hello", "hi"]);
    // removing retracts from evaluation too
    const removed = m.space().removeAtom(E(S("="), E(S("greeting")), S("hello")));
    expect(removed).toBe(true);
    expect(m.run("!(greeting)")[0]!.map((a) => a.toString())).toEqual(["hi"]);
  });
});
