// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

/** Compile-time exhaustiveness guard (convention C2). Reaching it at runtime is a bug. */
export function assertNever(x: never): never {
  throw new Error("unreachable: " + JSON.stringify(x));
}

/** Interpreter invariant guard (convention C6: throw only for bugs, never for program errors). */
export function invariant(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("invariant violated: " + msg);
}
