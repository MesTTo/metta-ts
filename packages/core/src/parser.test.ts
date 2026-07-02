// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { parse, parseAll, format } from "./parser";
import { Tokenizer } from "./tokenizer";
import { gint, gfloat, atomEq } from "./atom";

const tk = (): Tokenizer => {
  const t = new Tokenizer();
  t.register(/^-?\d+$/, (s) => gint(Number(s)));
  t.register(/^-?\d+\.\d+$/, (s) => gfloat(Number(s)));
  return t;
};

describe("parser", () => {
  it("parses and round-trips a function definition", () => {
    expect(format(parse("(= (f $x) (+ $x 1))", tk())!)).toBe("(= (f $x) (+ $x 1))");
  });

  it("treats a non-tokenized word as a Symbol", () => {
    expect(format(parse("foo", tk())!)).toBe("foo");
  });

  it("parses strings as grounded String atoms and round-trips quotes", () => {
    expect(format(parse('"hi there"', tk())!)).toBe('"hi there"');
  });

  it("skips comments and reads a program atom-by-atom, tracking the bang flag", () => {
    const atoms = parseAll("; a comment\n(a b)\n!(+ 1 2)", tk());
    expect(atoms.length).toBe(2);
    expect(atoms[0]!.bang).toBe(false);
    expect(atoms[1]!.bang).toBe(true);
  });

  it("round-trips a type declaration", () => {
    const src = "(: if (-> Bool Atom Atom $t))";
    expect(format(parse(src, tk())!)).toBe(src);
  });

  it("parse∘format is identity up to atomEq for a nested program", () => {
    const t = tk();
    for (const { atom } of parseAll('(a (b $c) 3)\n!(g "s")', t)) {
      expect(atomEq(parse(format(atom), t)!, atom)).toBe(true);
    }
  });

  it("strings with control characters round-trip through format (readString inverts JSON escapes)", () => {
    const t = tk();
    // format prints strings via JSON.stringify, so readString must invert \r \b \f and \uXXXX, not just \n \t.
    for (const s of [
      "a\rb",
      "tab\tend",
      "line\nbreak",
      "bellhere",
      'quote"and\\backslash',
      "\b\f\r",
    ]) {
      const atom = parse(`(s ${JSON.stringify(s)})`, t)!;
      const back = parse(format(atom), t)!;
      expect(atomEq(back, atom)).toBe(true);
      expect(
        back.kind === "expr" && back.items[1]!.kind === "gnd" && back.items[1]!.value.g === "str"
          ? back.items[1]!.value.s
          : null,
      ).toBe(s);
    }
  });
});
