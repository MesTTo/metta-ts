// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { canonInt, addInt, subInt, mulInt, intDiv, intMod, intAbs, toF64 } from "./number";

describe("integer helpers (number | bigint)", () => {
  it("canonInt keeps small values as number, large as bigint", () => {
    expect(canonInt(5n)).toBe(5);
    expect(typeof canonInt(5n)).toBe("number");
    const big = 9007199254740993n; // 2^53 + 1, not a safe integer
    expect(canonInt(big)).toBe(big);
    expect(typeof canonInt(big)).toBe("bigint");
  });

  it("addInt promotes on overflow and stays exact (fib(90) scale)", () => {
    expect(addInt(2, 3)).toBe(5);
    // 2^53-1 + 2 overflows the safe range -> bigint, exact
    expect(addInt(9007199254740991, 2)).toBe(9007199254740993n);
    expect(mulInt(3037000500n, 3037000500n)).toBe(9223372037000250000n);
  });

  it("subtraction back into range canonicalises to number", () => {
    expect(subInt(9007199254740993n, 9007199254740993n)).toBe(0);
    expect(typeof subInt(9007199254740993n, 9007199254740993n)).toBe("number");
  });

  it("intDiv truncates toward zero; intMod and intAbs are exact for bigint", () => {
    expect(intDiv(7, 2)).toBe(3);
    expect(intDiv(-7, 2)).toBe(-3);
    expect(intMod(7, 3)).toBe(1);
    expect(intAbs(-5)).toBe(5);
    expect(intAbs(-9007199254740993n)).toBe(9007199254740993n);
  });

  it("toF64 coerces either representation to a double", () => {
    expect(toF64(5)).toBe(5);
    expect(toF64(5n)).toBe(5);
  });
});
