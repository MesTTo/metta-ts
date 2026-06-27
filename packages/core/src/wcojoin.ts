// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Worst-case-optimal join (generic join / NPRR, the same family as Leapfrog Triejoin) for conjunctive
// queries over the atomspace. A cyclic conjunction (a triangle `R($a,$b) S($b,$c) T($c,$a)`) joined
// pairwise materialises an O(N^2) intermediate; this joins one variable at a time, intersecting each
// variable's domain across the relations that mention it, so the work obeys the AGM bound (a triangle
// is N^1.5, not N^2). It is the building block for a cyclic-`match` path. It is NOT wired into the
// default `match`, because variable-at-a-time enumeration reorders results relative to the scan, and
// match result order is observable (like tabling's ordered bag); making it the default needs the same
// ordered-result discipline. Kept standalone and differential-tested so the default engine stays
// byte-identical.

/** A relation: a set of tuples, each a binding of this relation's variables to values. */
export interface Relation<V> {
  readonly vars: readonly string[];
  readonly tuples: ReadonlyArray<ReadonlyMap<string, V>>;
}

/** All variables across the relations, in first-seen order (the default join order). */
function allVars<V>(rels: ReadonlyArray<Relation<V>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rels)
    for (const v of r.vars)
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
  return out;
}

/** A node of a relation's index trie: the value at this level plus the subtrie for the next variable. */
interface TrieNode<V> {
  readonly val: V;
  readonly child: Map<string, TrieNode<V>>;
}

/** The worst-case-optimal join (generic join / leapfrog-triejoin family): all bindings of every variable
 *  satisfying all relations. Each relation is indexed once into a trie over its variables in the join
 *  order, so binding a variable intersects the relations' current trie levels by key lookup rather than
 *  rescanning every tuple. That avoids the naive generic join's repeated tuple scans. `key` maps a
 *  value to a comparable string; pass `varOrder` to fix the elimination order (first-seen otherwise). */
export function wcoJoin<V>(
  rels: ReadonlyArray<Relation<V>>,
  key: (v: V) => string,
  varOrder?: readonly string[],
): Array<Map<string, V>> {
  const order = varOrder ?? allVars(rels);
  // Index each relation into a trie keyed by its variables in `order`. A tuple that does not bind one of
  // the relation's join variables cannot contribute to a full solution, so it is dropped.
  const relInfos = rels.map((r) => {
    const relVars = order.filter((v) => r.vars.includes(v));
    const root = new Map<string, TrieNode<V>>();
    tuple: for (const t of r.tuples) {
      let node = root;
      for (const v of relVars) {
        const val = t.get(v);
        if (val === undefined) continue tuple;
        const k = key(val);
        let e = node.get(k);
        if (e === undefined) {
          e = { val, child: new Map() };
          node.set(k, e);
        }
        node = e.child;
      }
    }
    return { relVars, root };
  });
  // For each variable position, the relations that constrain it (i.e. have it among their join vars).
  const participants = order.map((v) =>
    relInfos.map((ri, r) => (ri.relVars.includes(v) ? r : -1)).filter((r) => r >= 0),
  );

  const out: Array<Map<string, V>> = [];
  const partial = new Map<string, V>();
  // cursors[r] = relation r's current trie level (advanced as that relation's variables get bound).
  const cursors: Array<Map<string, TrieNode<V>>> = relInfos.map((ri) => ri.root);

  const recurse = (i: number): void => {
    if (i === order.length) {
      out.push(new Map(partial));
      return;
    }
    const parts = participants[i]!;
    if (parts.length === 0) return; // a variable no relation constrains: no binding
    // Iterate the smallest cursor and keep only keys present in every participating cursor.
    let smallest = parts[0]!;
    for (const r of parts) if (cursors[r]!.size < cursors[smallest]!.size) smallest = r;
    const v = order[i]!;
    for (const [k, entry] of cursors[smallest]!) {
      const advanced: Array<[number, Map<string, TrieNode<V>>]> = [];
      let ok = true;
      for (const r of parts) {
        const e = cursors[r]!.get(k);
        if (e === undefined) {
          ok = false;
          break;
        }
        advanced.push([r, e.child]);
      }
      if (!ok) continue;
      const saved = advanced.map(([r]) => [r, cursors[r]!] as [number, Map<string, TrieNode<V>>]);
      for (const [r, child] of advanced) cursors[r] = child;
      partial.set(v, entry.val);
      recurse(i + 1);
      for (const [r, c] of saved) cursors[r] = c;
    }
    partial.delete(v);
  };

  recurse(0);
  return out;
}
