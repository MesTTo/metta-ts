// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// DAS atom-handle hashing, a faithful port of the Python reference `hyperon_das/hasher.py`.
// Handles are deterministic MD5 hashes of joined strings; getting these byte-identical to the
// Python/Rust clients is the prerequisite for every query (a wrong handle means every match misses).
// Node-only (uses node:crypto), like the rest of the bus client.
import { createHash } from "node:crypto";

const JOINING_CHAR = " ";
const MAX_LITERAL_OR_SYMBOL_SIZE = 10000;
const MAX_HASHABLE_STRING_SIZE = 100000;

export function computeHash(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/** Hash of a named type (`named_type_hash`). */
export function namedTypeHash(name: string): string {
  return computeHash(name);
}

/** Hash of a terminal node `(type, name)` (`terminal_hash`). */
export function terminalHash(type: string, name: string): string {
  if (type.length + name.length >= MAX_HASHABLE_STRING_SIZE)
    throw new Error("Invalid (too large) terminal name");
  return computeHash(`${type}${JOINING_CHAR}${name}`);
}

/** Hash of a composite of element handles (`composite_hash`). */
export function compositeHash(elements: readonly string[]): string {
  let total = 0;
  for (const e of elements) {
    if (e.length > MAX_LITERAL_OR_SYMBOL_SIZE)
      throw new Error("Invalid (too large) composite elements");
    total += e.length;
  }
  if (total >= MAX_HASHABLE_STRING_SIZE) throw new Error("Invalid (too large) composite elements");
  return computeHash(elements.join(JOINING_CHAR));
}

/** Hash of an expression: the type hash followed by the element handles (`expression_hash`). */
export function expressionHash(typeHash: string, elements: readonly string[]): string {
  return compositeHash([typeHash, ...elements]);
}
