// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The persistent map is validated DIFFERENTIALLY against a plain Map reference over long random op
// sequences (with a small key space to force trie depth and collisions), plus a persistence check, because
// it backs a correctness-critical index. No Math.random (a seeded LCG) so the test is deterministic.
import { describe, it, expect } from "vitest";
import { emptyPMap, pmGet, pmSet, type PMap } from "./pmap";

describe("PMap (persistent string map)", () => {
  it("matches a plain Map over a long random op sequence", () => {
    let seed = 0x2545f491;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed % n;
    };
    const keys = Array.from({ length: 50 }, (_, i) => "k" + i);
    let pm: PMap<number> = emptyPMap;
    const ref = new Map<string, number>();
    for (let step = 0; step < 6000; step++) {
      const key = keys[rnd(keys.length)]!;
      if (rnd(3) === 0) {
        pm = pmSet(pm, key, undefined);
        ref.delete(key);
      } else {
        const v = rnd(1000);
        pm = pmSet(pm, key, v);
        ref.set(key, v);
      }
      if (step % 300 === 0) for (const k of keys) expect(pmGet(pm, k)).toBe(ref.get(k));
    }
    for (const k of keys) expect(pmGet(pm, k)).toBe(ref.get(k));
  });

  it("is persistent: an old snapshot is unaffected by later updates", () => {
    const a = pmSet(pmSet(emptyPMap, "x", 1), "y", 1);
    const b = pmSet(pmSet(a, "x", undefined), "y", 9);
    expect(pmGet(a, "x")).toBe(1);
    expect(pmGet(a, "y")).toBe(1);
    expect(pmGet(b, "x")).toBeUndefined();
    expect(pmGet(b, "y")).toBe(9);
  });

  it("absent reads undefined; many distinct keys spread the trie", () => {
    expect(pmGet(emptyPMap, "nope")).toBeUndefined();
    let pm: PMap<string> = emptyPMap;
    for (let i = 0; i < 3000; i++) pm = pmSet(pm, "atom-" + i, "v" + i);
    for (let i = 0; i < 3000; i++) expect(pmGet(pm, "atom-" + i)).toBe("v" + i);
    expect(pmGet(pm, "atom-3000")).toBeUndefined();
  });
});
