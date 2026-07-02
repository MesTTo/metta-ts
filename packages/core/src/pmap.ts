// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// A persistent (immutable, structurally-shared) map from string keys to values, used as the ground-atom
// exact-match index threaded through the World. Every update returns a new map sharing all untouched
// structure, so a World snapshot for transaction rollback is O(1) and branches stay independent under the same
// immutability contract the AtomLog relies on. Lookup/update are O(log32 n).
//
// Structure: a hash array mapped trie keyed by a 32-bit FNV-1a hash of the key, 5 bits (32-way) per level.
// A slot is null, a Leaf, or a Collision bucket (rare full-32-bit-hash clash). Branch arrays are copied on
// write (O(32) per touched level), sharing every other slot.

const BITS = 5;
const WIDTH = 1 << BITS; // 32
const MASK = WIDTH - 1;
const DEPTH = 7; // ceil(32 / 5)

interface Leaf<V> {
  readonly kind: "leaf";
  readonly key: string;
  readonly val: V;
}
interface Collision<V> {
  readonly kind: "collision";
  readonly entries: ReadonlyArray<Leaf<V>>;
}
type Branch<V> = ReadonlyArray<PNode<V>>; // exactly WIDTH slots
type PNode<V> = Leaf<V> | Collision<V> | Branch<V> | null;

/** A persistent string -> V map. `null` is the empty map. */
export type PMap<V> = Branch<V> | null;

export const emptyPMap = null;

function keyHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const isBranch = <V>(n: PNode<V>): n is Branch<V> => Array.isArray(n);

/** The value for `key`, or `undefined` if absent. */
export function pmGet<V>(map: PMap<V>, key: string): V | undefined {
  let node: PNode<V> = map;
  let h = keyHash(key);
  for (let level = 0; level < DEPTH && isBranch(node); level++) {
    node = node[h & MASK] ?? null;
    h >>>= BITS;
  }
  if (node === null || isBranch(node)) return undefined;
  if (node.kind === "leaf") return node.key === key ? node.val : undefined;
  for (const e of node.entries) if (e.key === key) return e.val;
  return undefined;
}

const newBranch = <V>(): PNode<V>[] => new Array<PNode<V>>(WIDTH).fill(null);

/** A new leaf/collision for a fully-consumed-hash slot. */
function setLeaf<V>(node: PNode<V>, key: string, val: V | undefined): PNode<V> {
  if (node === null) return val === undefined ? null : { kind: "leaf", key, val };
  if (isBranch(node)) return node; // unreachable for well-formed maps
  if (node.kind === "leaf") {
    if (node.key === key) return val === undefined ? null : { kind: "leaf", key, val };
    if (val === undefined) return node;
    return { kind: "collision", entries: [node, { kind: "leaf", key, val }] };
  }
  const kept = node.entries.filter((e) => e.key !== key);
  if (val !== undefined) kept.push({ kind: "leaf", key, val });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]!;
  return { kind: "collision", entries: kept };
}

/** Set `key` to `val`, or remove it when `val` is `undefined`. Returns a new map sharing untouched nodes. */
export function pmSet<V>(map: PMap<V>, key: string, val: V | undefined): PMap<V> {
  const h = keyHash(key);
  const go = (node: PNode<V>, level: number): PNode<V> => {
    if (level >= DEPTH) return setLeaf(node, key, val);
    const idx = (h >>> (level * BITS)) & MASK;
    if (node === null) {
      if (val === undefined) return null;
      const b = newBranch<V>();
      b[idx] = go(null, level + 1);
      return b;
    }
    // Unreachable for well-formed maps: leaves/collisions are created only at level >= DEPTH (the base case
    // above), so a node reached here at level < DEPTH is always a Branch or null. Kept as a defensive guard.
    if (!isBranch(node)) return setLeaf(node, key, val);
    const child = go(node[idx] ?? null, level + 1);
    if (child === (node[idx] ?? null)) return node;
    const copy = node.slice() as PNode<V>[];
    copy[idx] = child;
    return copy;
  };
  return go(map, 0) as PMap<V>;
}
