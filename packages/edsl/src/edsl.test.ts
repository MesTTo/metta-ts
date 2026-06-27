// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  mettaDB,
  S,
  v,
  e,
  rel,
  nil,
  list,
  rule,
  iff,
  gt,
  lt,
  add,
  sub,
  mul,
  matchSelf,
  arrow,
  decl,
  m,
  mAll,
  ground,
  ValueAtom,
  type GroundedAtom,
  quote,
  getType,
  getMetatype,
  assertEqual,
  deconsAtom,
  unique,
  sealed,
  consAtom,
} from "./index";

describe("exercise 1.1 — store facts, query with match (typed bindings)", () => {
  it("returns all things Ada likes", () => {
    const db = mettaDB();
    db.add(
      rel("Likes")(S.Ada, S.Coffee),
      rel("Likes")(S.Ada, S.Chocolate),
      rel("Likes")(S.Turing, S.Tea),
    );
    const thing = v<string>("thing");
    const rows = db.query(rel("Likes")(S.Ada, thing), { thing });
    expect(rows.map((r) => r.thing).sort()).toEqual(["Chocolate", "Coffee"]);
  });
});

describe("exercise 2.1 — inc, dec, square via rewrite rules + grounded arithmetic", () => {
  const db = mettaDB();
  const x = v<number>("x");
  db.rule(rel("inc")(x), add(x, 1));
  db.rule(rel("dec")(x), sub(x, 1));
  db.rule(rel("square")(x), mul(x, x));
  it("evaluates", () => {
    expect(db.evalJs(rel("inc")(41))).toEqual([42]);
    expect(db.evalJs(rel("dec")(10))).toEqual([9]);
    expect(db.evalJs(rel("square")(12))).toEqual([144]);
  });
});

describe("exercise 2.2 — classify with if", () => {
  const db = mettaDB();
  const x = v<number>("x");
  db.rule(rel("classify")(x), iff(gt(x, 0), S.Positive, iff(lt(x, 0), S.Negative, S.Zero)));
  it("guards on sign", () => {
    expect(db.eval(rel("classify")(7)).map(String)).toEqual(["Positive"]);
    expect(db.eval(rel("classify")(0)).map(String)).toEqual(["Zero"]);
    expect(db.eval(rel("classify")(-3)).map(String)).toEqual(["Negative"]);
  });
});

describe("exercise 3.1 — factorial recursion", () => {
  it("computes fact n", () => {
    const db = mettaDB();
    const x = v<number>("x");
    db.rule(rel("fact")(x), iff(gt(x, 0), mul(x, rel("fact")(sub(x, 1))), 1));
    expect(db.evalJs(rel("fact")(0))).toEqual([1]);
    expect(db.evalJs(rel("fact")(5))).toEqual([120]);
    expect(db.evalJs(rel("fact")(7))).toEqual([5040]);
  });
});

describe("structured patterns and repeated variables (arbitrary LHS)", () => {
  it("swap deconstructs a nested pattern", () => {
    const db = mettaDB();
    const [x, y] = [v("x"), v("y")];
    db.rule(rel("swap")(rel("Pair")(x, y)), rel("Pair")(y, x));
    expect(db.eval(rel("swap")(rel("Pair")(S.A, S.B))).map(String)).toEqual(["(Pair B A)"]);
  });
  it("a repeated variable in the LHS only matches when both positions agree", () => {
    const db = mettaDB();
    const [x, y] = [v("x"), v("y")];
    db.rule(rel("check")(e(x, y, x)), e(x, y));
    expect(db.eval(rel("check")(e(S.B, S.A, S.B))).map(String)).toEqual(["(B A)"]);
    // (B A A) does not match ($x $y $x), so the call is left unreduced
    expect(db.eval(rel("check")(e(S.B, S.A, S.A))).map(String)).toEqual(["(check (B A A))"]);
  });
});

describe("nondeterminism — multiple rules per head", () => {
  it("(bin) yields both 0 and 1", () => {
    const db = mettaDB();
    db.rule(rel("bin")(), 0);
    db.rule(rel("bin")(), 1);
    expect(db.evalJs(rel("bin")()).sort()).toEqual([0, 1]);
  });
});

describe("cons lists and recursion over them", () => {
  it("length of a list built with list([...])", () => {
    const db = mettaDB();
    const [h, t] = [v("h"), v("t")];
    db.rule(rel("length")(nil()), 0);
    db.rule(rel("length")(rel("::")(h, t)), add(1, rel("length")(t)));
    expect(db.evalJs(rel("length")(list([S.A, S.B, S.C])))).toEqual([3]);
  });
});

describe("types construct as expected", () => {
  it(": and ->", () => {
    expect(String(decl(S.Socrates, S.Human))).toBe("(: Socrates Human)");
    expect(String(decl(S.f, arrow(S.A, S.B, S.C)))).toBe("(: f (-> A B C))");
  });
});

describe("pass a TypeScript object directly into a query/eval (auto-grounded)", () => {
  const db = mettaDB();
  db.op("balance-of", (args) => [
    ValueAtom((args[0] as GroundedAtom).jsValue<{ balance: number }>().balance),
  ]);
  const account = { owner: "Tom", balance: 100 };
  it("via a builder", () => {
    expect(db.evalJs(rel("balance-of")(account))).toEqual([100]);
  });
  it("via a template interpolation", () => {
    expect(db.evalJs(m`(balance-of ${account})`)).toEqual([100]);
  });
});

describe("async grounded operations", () => {
  it("awaits an async op via evalAsync", async () => {
    const db = mettaDB();
    db.asyncOp("fetch-temp", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return [ValueAtom(21)];
    });
    expect(await db.evalJsAsync(rel("fetch-temp")())).toEqual([21]);
  });
});

describe("template surface", () => {
  it("m`...` and builders produce identical atoms", () => {
    const [x, z] = [v("x"), v("z")];
    const built = rule(rel("gp")(x, z), matchSelf(rel("parent")(x, v("y")), z));
    const templated = m`(= (gp $x $z) (match &self (parent $x $y) $z))`;
    expect(String(built)).toBe(String(templated));
  });
  it("ground() and interpolation agree for a TS value", () => {
    expect(String(m`${42}`)).toBe(String(ground(42)));
  });
  it("m throws on a multi-atom template; mAll returns all", () => {
    expect(() => m`(a) (b)`).toThrow(/exactly one atom/);
    expect(mAll`(a) (b)`.map(String)).toEqual(["(a)", "(b)"]);
  });
});

describe("new forms — quote, introspection, asserts, collections", () => {
  it("quote holds an expression as data (no evaluation)", () => {
    const db = mettaDB();
    expect(db.eval(quote(add(2, 3))).map(String)).toEqual(["(quote (+ 2 3))"]);
  });

  it("getType / getMetatype introspect an atom", () => {
    const db = mettaDB();
    expect(db.evalFirst(getType(42))?.toString()).toBe("Number");
    expect(db.evalFirst(getMetatype(42))?.toString()).toBe("Grounded");
    expect(db.evalFirst(getMetatype(S.foo))?.toString()).toBe("Symbol");
  });

  it("assertEqual builds the stdlib form and db.test reports pass/fail", () => {
    const db = mettaDB();
    expect(db.eval(assertEqual(add(1, 2), 3)).map(String)).toEqual(["()"]);
    expect(db.test(add(1, 2), 3)).toBe(true);
    expect(db.test(add(1, 2), 4)).toBe(false);
  });

  it("deconsAtom splits an expression; consAtom rebuilds it", () => {
    const db = mettaDB();
    expect(db.evalFirst(deconsAtom(e(S.a, S.b, S.c)))?.toString()).toBe("(a (b c))");
    expect(db.evalFirst(consAtom(S.a, e(S.b, S.c)))?.toString()).toBe("(a b c)");
  });

  it("unique deduplicates a nondeterministic result set", () => {
    const db = mettaDB();
    db.rule(rel("pick")(), S.a).rule(rel("pick")(), S.b).rule(rel("pick")(), S.a);
    expect(
      db
        .eval(unique(rel("pick")()))
        .map(String)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("sealed alpha-renames a body's variables, leaving the listed ones", () => {
    const db = mettaDB();
    const x = v("x");
    // The body's $x is renamed; the result is structurally (foo <fresh>), not (foo $x).
    expect(db.evalFirst(sealed([], e(S.foo, x)))?.toString()).toMatch(/^\(foo \$/);
  });
});

describe("differential — eDSL matches the raw string API", () => {
  it("factorial via builders equals factorial via source", () => {
    const viaEdsl = mettaDB();
    const x = v<number>("x");
    viaEdsl.rule(rel("fact")(x), iff(gt(x, 0), mul(x, rel("fact")(sub(x, 1))), 1));

    const viaString = mettaDB();
    viaString.run("(= (fact $x) (if (> $x 0) (* $x (fact (- $x 1))) 1))");

    expect(viaEdsl.eval(rel("fact")(6)).map(String)).toEqual(
      viaString.run("!(fact 6)")[0]!.map(String),
    );
  });
});
