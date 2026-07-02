// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  mettaDB,
  names,
  vars,
  e,
  nil,
  list,
  rule,
  If,
  Match,
  gt,
  lt,
  eq,
  add,
  sub,
  mul,
  mod,
  arrow,
  decl,
  m,
  mAll,
  ground,
  patternVars,
  ValueAtom,
  type GroundedAtom,
  Quote,
  getType,
  getMetatype,
  assertEqual,
  deconsAtom,
  unique,
  Sealed,
  consAtom,
  jsonEncode,
  jsonDecode,
  dictSpace,
  getKeys,
  getValue,
} from "./index";

describe("exercise 1.1 — store facts, query with match (auto-inferred rows)", () => {
  it("returns all things Ada likes", () => {
    const db = mettaDB();
    const { Likes, Ada, Coffee, Chocolate, Tea, Turing } = names();
    db.add(Likes(Ada, Coffee), Likes(Ada, Chocolate), Likes(Turing, Tea));
    const { thing } = vars();
    const rows = db.query(Likes(Ada, thing));
    expect(rows.map((r) => r.thing).sort()).toEqual(["Chocolate", "Coffee"]);
  });

  it("typed rows via an explicit vars map", () => {
    const db = mettaDB();
    const { Likes, Ada, Coffee } = names();
    db.add(Likes(Ada, Coffee));
    const { thing } = vars<{ thing: string }>();
    const rows = db.query(Likes(Ada, thing), { thing });
    const first: string = rows[0]!.thing; // typed as string, not unknown
    expect(first).toBe("Coffee");
  });
});

describe("exercise 2.1 — inc, dec, square via rewrite rules + grounded arithmetic", () => {
  const db = mettaDB();
  const { inc, dec, square } = names();
  const { x } = vars<{ x: number }>();
  db.rule(inc(x), add(x, 1));
  db.rule(dec(x), sub(x, 1));
  db.rule(square(x), mul(x, x));
  it("evaluates", () => {
    expect(db.evalJs(inc(41))).toEqual([42]);
    expect(db.evalJs(dec(10))).toEqual([9]);
    expect(db.evalJs(square(12))).toEqual([144]);
  });
});

describe("exercise 2.2 — classify with If", () => {
  const db = mettaDB();
  const { classify, Positive, Negative, Zero } = names();
  const { x } = vars<{ x: number }>();
  db.rule(classify(x), If(gt(x, 0), Positive, If(lt(x, 0), Negative, Zero)));
  it("guards on sign", () => {
    expect(db.eval(classify(7)).map(String)).toEqual(["Positive"]);
    expect(db.eval(classify(0)).map(String)).toEqual(["Zero"]);
    expect(db.eval(classify(-3)).map(String)).toEqual(["Negative"]);
  });
});

describe("exercise 3.1 — factorial recursion", () => {
  it("computes fact n", () => {
    const db = mettaDB();
    const { fact } = names();
    const { x } = vars<{ x: number }>();
    db.rule(fact(x), If(gt(x, 0), mul(x, fact(sub(x, 1))), 1));
    expect(db.evalJs(fact(0))).toEqual([1]);
    expect(db.evalJs(fact(5))).toEqual([120]);
    expect(db.evalJs(fact(7))).toEqual([5040]);
  });
});

describe("structured patterns and repeated variables (arbitrary LHS)", () => {
  it("swap deconstructs a nested pattern", () => {
    const db = mettaDB();
    const { swap, Pair, A, B } = names();
    const { x, y } = vars();
    db.rule(swap(Pair(x, y)), Pair(y, x));
    expect(db.eval(swap(Pair(A, B))).map(String)).toEqual(["(Pair B A)"]);
  });
  it("a repeated variable in the LHS only matches when both positions agree", () => {
    const db = mettaDB();
    const { check, A, B } = names();
    const { x, y } = vars();
    db.rule(check(e(x, y, x)), e(x, y));
    expect(db.eval(check(e(B, A, B))).map(String)).toEqual(["(B A)"]);
    // (B A A) does not match ($x $y $x), so the call is left unreduced
    expect(db.eval(check(e(B, A, A))).map(String)).toEqual(["(check (B A A))"]);
  });
});

describe("nondeterminism — multiple rules per head", () => {
  it("(bin) yields both 0 and 1", () => {
    const db = mettaDB();
    const { bin } = names();
    db.rule(bin(), 0);
    db.rule(bin(), 1);
    expect(db.evalJs(bin()).sort()).toEqual([0, 1]);
  });
});

describe("cons lists and recursion over them", () => {
  it("length of a list built with list([...])", () => {
    const db = mettaDB();
    const { length, A, B, C } = names();
    const cons = names();
    const { h, t } = vars();
    db.rule(length(nil()), 0);
    db.rule(length(cons["::"](h, t)), add(1, length(t)));
    expect(db.evalJs(length(list([A, B, C])))).toEqual([3]);
  });
});

describe("types construct as expected", () => {
  it(": and ->", () => {
    const { Socrates, Human, f, A, B, C } = names();
    expect(String(decl(Socrates, Human))).toBe("(: Socrates Human)");
    expect(String(decl(f, arrow(A, B, C)))).toBe("(: f (-> A B C))");
  });
});

describe("host bridge — MeTTa to TypeScript grounded functions", () => {
  it("db.fn auto-unwraps args and grounds the result", () => {
    const db = mettaDB();
    const { balanceOf } = names();
    db.fn("balanceOf", (a: { balance: number }) => a.balance);
    const account = { owner: "Tom", balance: 100 };
    expect(db.evalJs(balanceOf(account))).toEqual([100]);
  });

  it("db.fns registers several typed functions at once", () => {
    const db = mettaDB();
    const { inc, price } = names();
    db.fns({
      inc: (n: number) => n + 1,
      price: (item: { cost: number }) => item.cost * 2,
    });
    expect(db.evalJs(inc(9))).toEqual([10]);
    expect(db.evalJs(price({ cost: 5 }))).toEqual([10]);
  });

  it("raw db.op still gives full atom control", () => {
    const db = mettaDB();
    const { balanceOf } = names();
    db.op("balanceOf", (args) => [
      ValueAtom((args[0] as GroundedAtom).jsValue<{ balance: number }>().balance),
    ]);
    expect(db.evalJs(balanceOf({ owner: "Tom", balance: 100 }))).toEqual([100]);
  });

  it("db.asyncFn awaits an async typed function", async () => {
    const db = mettaDB();
    const { fetchTemp } = names();
    db.asyncFn("fetchTemp", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 21;
    });
    expect(await db.evalJsAsync(fetchTemp())).toEqual([21]);
  });
});

describe("host bridge — TypeScript to MeTTa (backward import)", () => {
  it("db.call.<name> evaluates and unwraps every result", () => {
    const db = mettaDB();
    const { fact } = names();
    const { x } = vars<{ x: number }>();
    db.rule(fact(x), If(gt(x, 0), mul(x, fact(sub(x, 1))), 1));
    expect(db.call.fact(5)).toEqual([120]);
  });

  it("db.call bracket access handles hyphenated names", () => {
    const db = mettaDB();
    const { mod2 } = names();
    const { n } = vars<{ n: number }>();
    // Define a hyphenated MeTTa function name and reach it through bracket access.
    db.rule(mod2(n), mod(n, 2));
    db.run("(= (is-even $n) (== (mod2 $n) 0))");
    expect(db.call["is-even"](4)).toEqual([true]);
    expect(db.call["is-even"](5)).toEqual([false]);
  });

  it("db.import returns a permissive callable without a schema", () => {
    const db = mettaDB();
    const { fact } = names();
    const { x } = vars<{ x: number }>();
    db.rule(fact(x), If(gt(x, 0), mul(x, fact(sub(x, 1))), 1));
    const factorial = db.import("fact");
    expect(factorial(6)).toBe(720);
  });
});

describe("typed schema runner — mettaDB<Schema>()", () => {
  interface Schema {
    fact: (n: number) => number;
    isEven: (n: number) => boolean;
  }

  it("call and import are typed from the schema", () => {
    const db = mettaDB<Schema>();
    const { fact, isEven, mod2 } = names();
    const { x, n } = vars<{ x: number; n: number }>();
    db.rule(fact(x), If(gt(x, 0), mul(x, fact(sub(x, 1))), 1));
    db.rule(mod2(n), mod(n, 2));
    db.rule(isEven(n), eq(mod2(n), 0));

    const rows: number[] = db.call.fact(5); // typed number[]
    expect(rows).toEqual([120]);
    const evens: boolean[] = db.call.isEven(4);
    expect(evens).toEqual([true]);

    const factorial = db.import("fact"); // typed (n: number) => number | undefined
    const r: number | undefined = factorial(6);
    expect(r).toBe(720);
  });

  it("fn is checked against the schema signature; off-schema names stay permissive", () => {
    const db = mettaDB<Schema>();
    // In-schema: the function must match the declared signature (checked at compile time).
    db.fn("fact", (nn: number) => nn); // ok shape (identity for the test)
    // Off-schema: any name and function is accepted.
    db.fn("shout", (s: string) => s.toUpperCase());
    const { shout } = names();
    expect(db.evalJs(shout("hi"))).toEqual(["HI"]);
  });

  it("the schema rejects wrong usage at compile time", () => {
    const db = mettaDB<Schema>();
    // @ts-expect-error fact takes a number, not a string
    db.fn("fact", (s: string) => s);
    // @ts-expect-error call.fact returns number[], not string[]
    const _bad: string[] = db.call.fact(5);
    void _bad;
    expect(true).toBe(true);
  });
});

describe("template surface", () => {
  it("m`...` and builders produce identical atoms", () => {
    const { gp, parent } = names();
    const { x, y, z } = vars();
    const built = rule(gp(x, z), Match(parent(x, y), z));
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
  it("a template interpolation auto-grounds a TS object", () => {
    const db = mettaDB();
    db.fn("balanceOf", (a: { balance: number }) => a.balance);
    const account = { owner: "Tom", balance: 100 };
    expect(db.evalJs(m`(balanceOf ${account})`)).toEqual([100]);
  });
});

describe("typed source queries — db.q(...) with type-level $var extraction", () => {
  it("infers row keys from the source's $-variables and returns matches", () => {
    const db = mettaDB();
    const { Likes, Ada, Coffee, Chocolate } = names();
    db.add(Likes(Ada, Coffee), Likes(Ada, Chocolate));
    const rows = db.q("(Likes Ada $thing)");
    // `thing` is a statically-known key (autocompleted); other keys are compile errors.
    expect(rows.map((r) => r.thing).sort()).toEqual(["Chocolate", "Coffee"]);
  });

  it("handles multiple variables and matches the builder query", () => {
    const db = mettaDB();
    const { edge, a, b, c } = names();
    db.add(edge(a, b), edge(b, c));
    const rows = db.q("(edge $from $to)");
    const pairs = rows.map((r) => [r.from, r.to]).sort();
    expect(pairs).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("the row type rejects a variable not in the source", () => {
    const db = mettaDB();
    const rows = db.q("(edge $from $to)");
    const r = rows[0];
    // @ts-expect-error `nope` is not a variable in the query source
    void r?.nope;
    expect(true).toBe(true);
  });

  it("db.q agrees with the builder query and with raw source", () => {
    const db = mettaDB();
    const { parent, tom, bob, liz } = names();
    db.add(parent(tom, bob), parent(tom, liz));
    const { child } = vars();
    const viaQ = db.q("(parent tom $child)").map((r) => r.child);
    const viaBuilder = db.query(parent(tom, child)).map((r) => r.child);
    expect(viaQ.sort()).toEqual(viaBuilder.sort());
    expect(viaQ.sort()).toEqual(["bob", "liz"]);
  });
});

describe("JSON / dict-space surface (db.useJson + builders)", () => {
  it("json-encode / json-decode round-trip a value", () => {
    const db = mettaDB().useJson();
    expect(db.evalJs(jsonEncode(42))).toEqual(["42"]);
    expect(db.evalFirst(jsonDecode("[1, 2, 3]"))?.toString()).toBe("(1 2 3)");
  });

  it("dict-space stores pairs; get-value reads one; get-keys enumerates", () => {
    const db = mettaDB().useJson();
    const { a, b } = names();
    const d = dictSpace([
      [a, 1],
      [b, 2],
    ]);
    expect(db.evalFirst(getValue(d, a))?.toString()).toBe("1");
    expect(db.eval(getKeys(d)).map(String).sort()).toEqual(["a", "b"]);
  });

  it("json-decode builds a dict-space readable by get-value", () => {
    const db = mettaDB().useJson();
    const space = jsonDecode('{"name": "Ada", "age": 36}');
    // Bind the decoded space to a functor, then read a key from it. JSON object keys decode to
    // grounded strings, so the key is the JS string "name" (auto-grounded), not a symbol.
    db.add(m`(= (doc) ${space})`);
    expect(db.evalFirst(getValue(m`(doc)`, "name"))?.toString()).toBe('"Ada"');
  });
});

describe("bare names ground to symbols; patternVars finds the columns", () => {
  it("a bare name is its symbol", () => {
    const { Ada } = names();
    expect(String(ground(Ada))).toBe("Ada");
  });
  it("patternVars returns the distinct free variables in first-seen order", () => {
    const { parent } = names();
    const { x, y } = vars();
    expect(patternVars(parent(x, y)).map((v) => v.name())).toEqual(["x", "y"]);
    expect(patternVars(parent(x, x)).map((v) => v.name())).toEqual(["x"]);
  });
});

describe("new forms — Quote, introspection, asserts, collections", () => {
  it("Quote holds an expression as data (no evaluation)", () => {
    const db = mettaDB();
    expect(db.eval(Quote(add(2, 3))).map(String)).toEqual(["(quote (+ 2 3))"]);
  });

  it("getType / getMetatype introspect an atom", () => {
    const db = mettaDB();
    const { foo } = names();
    expect(db.evalFirst(getType(42))?.toString()).toBe("Number");
    expect(db.evalFirst(getMetatype(42))?.toString()).toBe("Grounded");
    expect(db.evalFirst(getMetatype(foo))?.toString()).toBe("Symbol");
  });

  it("assertEqual builds the stdlib form and db.test reports pass/fail", () => {
    const db = mettaDB();
    expect(db.eval(assertEqual(add(1, 2), 3)).map(String)).toEqual(["()"]);
    expect(db.test(add(1, 2), 3)).toBe(true);
    expect(db.test(add(1, 2), 4)).toBe(false);
  });

  it("deconsAtom splits an expression; consAtom rebuilds it", () => {
    const db = mettaDB();
    const { a, b, c } = names();
    expect(db.evalFirst(deconsAtom(e(a, b, c)))?.toString()).toBe("(a (b c))");
    expect(db.evalFirst(consAtom(a, e(b, c)))?.toString()).toBe("(a b c)");
  });

  it("unique deduplicates a nondeterministic result set", () => {
    const db = mettaDB();
    const { pick, a, b } = names();
    db.rule(pick(), a).rule(pick(), b).rule(pick(), a);
    expect(db.eval(unique(pick())).map(String).sort()).toEqual(["a", "b"]);
  });

  it("Sealed alpha-renames a body's variables, leaving the listed ones", () => {
    const db = mettaDB();
    const { foo } = names();
    const { x } = vars();
    expect(db.evalFirst(Sealed([], e(foo, x)))?.toString()).toMatch(/^\(foo \$/);
  });
});

describe("differential — eDSL matches the raw string API", () => {
  it("factorial via builders equals factorial via source", () => {
    const viaEdsl = mettaDB();
    const { fact } = names();
    const { x } = vars<{ x: number }>();
    viaEdsl.rule(fact(x), If(gt(x, 0), mul(x, fact(sub(x, 1))), 1));

    const viaString = mettaDB();
    viaString.run("(= (fact $x) (if (> $x 0) (* $x (fact (- $x 1))) 1))");

    expect(viaEdsl.eval(fact(6)).map(String)).toEqual(viaString.run("!(fact 6)")[0]!.map(String));
  });
});
