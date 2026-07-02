// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { namedTypeHash, terminalHash, compositeHash, expressionHash } from "./handle";

// Parity vectors: MD5 of the exact strings the Python reference (`hyperon_das/hasher.py`) hashes,
// computed independently via `md5sum`. Matching these guarantees handle parity with the Python/Rust
// DAS clients (a wrong handle makes every query miss).
describe("DAS atom-handle hashing (parity with hyperon_das/hasher.py)", () => {
  it("named_type_hash", () => {
    expect(namedTypeHash("Concept")).toBe("d99a604c79ce3c2e76a2f43488d5d4c3");
  });
  it("terminal_hash joins type and name with a space", () => {
    expect(terminalHash("Concept", "human")).toBe("af12f10f9ae2002a1607ba0b47ba8407");
  });
  it("composite_hash joins element handles with a space", () => {
    expect(compositeHash(["a", "b", "c"])).toBe("06f0760ec7f18687a7fbc0ddbf1b1722");
  });
  it("expression_hash = composite of [typeHash, ...elements]", () => {
    // expression_hash("a", ["b","c"]) === composite_hash(["a","b","c"])
    expect(expressionHash("a", ["b", "c"])).toBe(compositeHash(["a", "b", "c"]));
  });
});
