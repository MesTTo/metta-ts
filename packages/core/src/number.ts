// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Integer arithmetic over `number | bigint`. Small integers stay `number` (V8 Smi, no allocation);
// only values outside the safe-integer range become `bigint`. The `typeof` branch sits upstream of
// every operator so each operator's inline cache stays monomorphic. `canonInt` keeps the
// representation canonical (a value in safe range is always `number`), so structural equality and
// the clause index never see the same integer in two forms.
export type IntVal = number | bigint;

const MAX = BigInt(Number.MAX_SAFE_INTEGER); // 9007199254740991n
const MIN = BigInt(Number.MIN_SAFE_INTEGER);

/** A bigint that fits the safe-integer range collapses to a number; everything else stays bigint. */
export function canonInt(n: IntVal): IntVal {
  if (typeof n === "bigint") return n >= MIN && n <= MAX ? Number(n) : n;
  return n;
}

export function addInt(x: IntVal, y: IntVal): IntVal {
  if (typeof x === "number" && typeof y === "number") {
    const r = x + y;
    return Number.isSafeInteger(r) ? r : canonInt(BigInt(x) + BigInt(y));
  }
  return canonInt(BigInt(x) + BigInt(y));
}

export function subInt(x: IntVal, y: IntVal): IntVal {
  if (typeof x === "number" && typeof y === "number") {
    const r = x - y;
    return Number.isSafeInteger(r) ? r : canonInt(BigInt(x) - BigInt(y));
  }
  return canonInt(BigInt(x) - BigInt(y));
}

export function mulInt(x: IntVal, y: IntVal): IntVal {
  if (typeof x === "number" && typeof y === "number") {
    const r = x * y;
    return Number.isSafeInteger(r) ? r : canonInt(BigInt(x) * BigInt(y));
  }
  return canonInt(BigInt(x) * BigInt(y));
}

/** Integer division truncating toward zero (matches the existing `Math.trunc(a/b)` semantics). */
export function intDiv(x: IntVal, y: IntVal): IntVal {
  if (typeof x === "number" && typeof y === "number") return Math.trunc(x / y);
  return canonInt(BigInt(x) / BigInt(y));
}

export function intMod(x: IntVal, y: IntVal): IntVal {
  if (typeof x === "number" && typeof y === "number") return x % y;
  return canonInt(BigInt(x) % BigInt(y));
}

export function intAbs(n: IntVal): IntVal {
  if (typeof n === "bigint") return n < 0n ? -n : n;
  return Math.abs(n);
}

export function isZero(n: IntVal): boolean {
  return typeof n === "bigint" ? n === 0n : n === 0;
}

/** Coerce either representation to a double for the f64 math ops (precision loss is acceptable there). */
export function toF64(n: IntVal): number {
  return typeof n === "bigint" ? Number(n) : n;
}

/** Three-way compare of two integer values, exact (promotes to bigint when needed). Value-level
 *  analogue of `compareNumbers`, used by the deterministic-core compiler on unwrapped ints. */
export function cmpIntVal(a: IntVal, b: IntVal): number {
  if (typeof a === "bigint" || typeof b === "bigint") {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
