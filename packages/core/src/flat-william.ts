// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// William compression (MORK / Hyperon whitepaper §5.12): find the heaviest repeated subpatterns in a
// flat interned KB, ranked by compression gain. Factoring `count` copies of a `len`-token subpattern
// into one definition plus `count` references saves
//   gain(count, len) = (count - 1) * len - count * ref_cost
// tokens. The top-k by gain are the patterns most worth abstracting (and the most informative frequent
// structure). This is MORK's slice S1: the correct brute-force top-k, an oracle for a later
// branch-and-bound / streaming index. It runs over the same Int32 token layout as the flat matcher.
import { type Atom } from "./atom";
import { type FlatKB, decodeAt, _internals, TAG_ARITY } from "./flat-kb";

const { tagOf, payloadOf } = _internals as {
  tagOf: (t: number) => number;
  payloadOf: (t: number) => number;
};

/** A frequent subpattern and its compression economics. */
export interface HeavyPattern {
  /** The repeated subpattern (decoded for inspection). */
  readonly pattern: Atom;
  /** How many times it occurs across the KB. */
  readonly count: number;
  /** Its size in tokens. */
  readonly len: number;
  /** Tokens saved by factoring it: `(count - 1) * len - count * refCost`. */
  readonly gain: number;
}

/** Visit every subterm `[start, end)` of the fact at `factStart` (the fact itself and all descendants). */
function eachSubterm(
  tokens: ArrayLike<number>,
  factStart: number,
  cb: (s: number, e: number) => void,
): void {
  const go = (pos: number): number => {
    const t = tokens[pos]!;
    const start = pos;
    if (tagOf(t) === TAG_ARITY) {
      let p = pos + 1;
      for (let i = 0; i < payloadOf(t); i++) p = go(p);
      cb(start, p);
      return p;
    }
    cb(start, pos + 1);
    return pos + 1;
  };
  go(factStart);
}

/**
 * The top-`k` heaviest repeated subpatterns in `kb`, by compression gain. `refCost` is the token cost of
 * a reference to a factored definition (MORK starts at ~4–8). Only subpatterns occurring ≥2 times with
 * positive gain are returned (single symbols never pay to factor). Brute-force and exact; the oracle
 * for any future output-sensitive index.
 */
export function williamTopK(kb: FlatKB, k: number, refCost = 4): HeavyPattern[] {
  const tokens = kb.tokenArray as number[]; // read-only access; decodeAt/eachSubterm never mutate
  // key (the subpattern's exact token sequence) -> { count, len, a representative start offset }.
  const counts = new Map<string, { count: number; len: number; start: number }>();
  for (const factStart of kb.factOffsets) {
    eachSubterm(tokens, factStart, (s, e) => {
      let key = "";
      for (let i = s; i < e; i++) key += tokens[i]! + ",";
      const info = counts.get(key);
      if (info !== undefined) info.count++;
      else counts.set(key, { count: 1, len: e - s, start: s });
    });
  }

  const scored: Array<{ count: number; len: number; start: number; gain: number }> = [];
  for (const info of counts.values()) {
    if (info.count < 2 || info.len < 2) continue; // a single token never pays to factor
    const gain = (info.count - 1) * info.len - info.count * refCost;
    if (gain > 0) scored.push({ ...info, gain });
  }
  scored.sort((a, b) => b.gain - a.gain || b.count - a.count);
  return scored.slice(0, k).map((s) => ({
    pattern: decodeAt(tokens, s.start, kb.interner)[0],
    count: s.count,
    len: s.len,
    gain: s.gain,
  }));
}
