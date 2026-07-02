// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// PeTTa-compat stdlib: functions PeTTa auto-loads (src/metta.pl) that Hyperon lacks, added as grounded ops
// so the PeTTa example corpus runs on the same engine. They are a fallback — a program's own `=` rule of the
// same name wins — and the corpus `test` op compares modulo the conventions where MeTTa-TS (Hyperon) and
// PeTTa render the same value differently (`,`-tuples, Bool casing, integer-valued floats).
import { describe, it, expect } from "vitest";
import { runProgram } from "./runner";
import { format } from "./parser";

const one = (src: string): string => runProgram(src)[0]!.results.map(format).join(",");

describe("PeTTa-compat stdlib ops", () => {
  it("list ops match metta.pl semantics", () => {
    expect(one("!(length (a b c))")).toBe("3");
    expect(one("!(append (a b) (c d))")).toBe("(a b c d)");
    expect(one("!(first (a b c))")).toBe("a");
    expect(one("!(last (a b c))")).toBe("c");
    expect(one("!(reverse (a b c))")).toBe("(c b a)");
    expect(one("!(second-from-pair (x y))")).toBe("y");
    expect(one("!(exclude-item b (a b c b))")).toBe("(a c)");
    expect(one("!(list_to_set (a a b a))")).toBe("(a b)");
    expect(one("!(msort (3 1 2 1))")).toBe("(1 1 2 3)");
    expect(one("!(sort (3 1 2 1))")).toBe("(1 2 3)");
  });

  it("type predicates return Bool (metta.pl is-var/is-ground/is-expr/is-space, get-mettatype)", () => {
    expect(one("!(is-var $x)")).toBe("True");
    expect(one("!(is-var a)")).toBe("False");
    expect(one("!(is-ground (a b))")).toBe("True");
    expect(one("!(is-ground (a $x))")).toBe("False");
    expect(one("!(is-expr (a b))")).toBe("True");
    expect(one("!(is-space &self)")).toBe("True");
    expect(one("!(get-mettatype a)")).toBe("Symbol");
    expect(one("!(get-mettatype (a b))")).toBe("Expression");
  });

  it("membership: is-member -> Bool, member -> True or nothing", () => {
    expect(one("!(is-member b (a b c))")).toBe("True");
    expect(one("!(is-member z (a b c))")).toBe("False");
    expect(one("!(member b (a b c))")).toBe("True");
    expect(one("!(member z (a b c))")).toBe(""); // no result, like metta.pl's failing member/3
  });

  it("a program's own `=` rule wins over the grounded op (rules-first fallback)", () => {
    // The user defines `length` for a Cons list; the grounded `length` must not shadow it.
    expect(one("(= (length (Cons $h $t)) custom)\n!(length (Cons 1 Nil))")).toBe("custom");
    // …while a plain tuple with no user rule still uses the grounded op.
    expect(one("(= (length (Cons $h $t)) custom)\n!(length (a b c))")).toBe("3");
  });

  it("the corpus `test` op is strict (no convention forgiving) and uses MeTTa-TS conventions", () => {
    // collapse returns a bare tuple, so this matches exactly.
    expect(one("!(test (collapse (superpose (1 2 3))) (1 2 3))")).toBe("()");
    // Written in MeTTa-TS conventions: grounded Bool `False`, full float `8.0`.
    expect(one("!(test (is-member z (a b)) False)")).toBe("()");
    expect(one("!(test (+ 3.0 5.0) 8.0)")).toBe("()");
    // A genuinely different value fails.
    expect(one("!(test (+ 1 1) 3)")).toContain("test-failed");
    // And the comparison is now strict: a PeTTa-convention expected (`false`, `8`) does NOT pass.
    expect(one("!(test (is-member z (a b)) false)")).toContain("test-failed");
    expect(one("!(test (+ 3.0 5.0) 8)")).toContain("test-failed");
  });
});
