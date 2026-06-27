// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Persistent append-only atom store backing a space's runtime additions (`add-atom`/`import! &self`).
//
// The atomspace was a flat `Atom[]` copied wholesale on every `add-atom` (`[...selfExtra, ...atoms]`),
// so a program that adds N atoms paid O(N^2): the matespace/peano benchmarks add up to ~1.5M atoms and
// never finished. A space only ever needs append, full ordered iteration, and an O(1) snapshot for the
// immutable-World backtracking model. A singly-linked log gives append and snapshot in O(1) with full
// structural sharing; iteration is O(n) (already unavoidable for a full scan) and reconstructs insertion
// order. The node carries a running `size` so length is O(1).
//
// Each node also carries a persistent EXACT-MATCH INDEX over the ground atoms appended so far: a map from
// `String(hashOf(atom))` to the bucket of distinct ground atoms (with counts) at that hash. This lets an
// exact ground-membership `match` answer in O(1) instead of scanning the whole log (the cost that made the
// peano benchmark O(K^3)). The index is persistent too, so it shares structure across snapshots and
// transaction rollback exactly like the log. `nonGround` counts the non-ground atoms, so the fast path is
// only valid when every runtime atom is ground (otherwise a ground pattern could also unify a non-ground
// atom and must fall back to the scan).

import { type Atom, hashOf, atomEq } from "./atom";
import { type PMap, emptyPMap, pmGet, pmSet } from "./pmap";

/** Distinct ground atoms sharing one 32-bit hash, each with its multiplicity in the log. */
export type Bucket = ReadonlyArray<{ readonly atom: Atom; readonly count: number }>;

const idxAdd = (idx: PMap<Bucket>, atom: Atom): PMap<Bucket> => {
  const key = String(hashOf(atom));
  const bucket = pmGet(idx, key) ?? [];
  const i = bucket.findIndex((e) => atomEq(e.atom, atom));
  const next =
    i < 0
      ? [...bucket, { atom, count: 1 }]
      : bucket.map((e, j) => (j === i ? { atom: e.atom, count: e.count + 1 } : e));
  return pmSet(idx, key, next);
};

/** How many copies of the exact ground atom `atom` are in the index (0 if absent). */
export const idxCount = (idx: PMap<Bucket>, atom: Atom): number => {
  const bucket = pmGet(idx, String(hashOf(atom)));
  if (bucket === undefined) return 0;
  for (const e of bucket) if (atomEq(e.atom, atom)) return e.count;
  return 0;
};

export interface LogNode {
  readonly atom: Atom;
  readonly prev: AtomLog;
  readonly size: number;
  /** Exact-match index over the ground atoms in this log (and all earlier nodes). */
  readonly groundIdx: PMap<Bucket>;
  /** Count of non-ground atoms in this log; the index fast path is valid only when this is 0. */
  readonly nonGround: number;
}
/** An atom log: `null` is empty; otherwise the most recently appended atom and the rest. */
export type AtomLog = LogNode | null;

export const emptyLog: AtomLog = null;

export const logSize = (log: AtomLog): number => (log === null ? 0 : log.size);

/** The ground-atom exact-match index for a log (empty when the log is). */
export const logGroundIdx = (log: AtomLog): PMap<Bucket> =>
  log === null ? emptyPMap : log.groundIdx;
/** Number of non-ground atoms in a log. */
export const logNonGround = (log: AtomLog): number => (log === null ? 0 : log.nonGround);

/** Append one atom (O(log n), shares the existing log and index). */
export const logAppend = (log: AtomLog, atom: Atom): AtomLog => ({
  atom,
  prev: log,
  size: (log === null ? 0 : log.size) + 1,
  groundIdx: atom.ground ? idxAdd(logGroundIdx(log), atom) : logGroundIdx(log),
  nonGround: (log === null ? 0 : log.nonGround) + (atom.ground ? 0 : 1),
});

/** Append several atoms in order (newest stays at the head). */
export function logAppendAll(log: AtomLog, atoms: readonly Atom[]): AtomLog {
  let out = log;
  for (const a of atoms) out = logAppend(out, a);
  return out;
}

/** Materialize in insertion order (oldest first). O(n). */
export function logToArray(log: AtomLog): Atom[] {
  const n = logSize(log);
  const out = new Array<Atom>(n);
  let i = n - 1;
  for (let p = log; p !== null; p = p.prev) out[i--] = p.atom;
  return out;
}

/** Rebuild a log from atoms in insertion order (used by remove/merge, which are not on the hot path). */
export const logFromArray = (atoms: readonly Atom[]): AtomLog => logAppendAll(emptyLog, atoms);
