// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// A flat, interned representation of atoms, the substrate for an out-of-core and parallel matcher.
// Modeled on MORK's tag-byte trie but adapted for TypeScript typed arrays. An atom is a
// preorder sequence of Int32 tokens; symbols and grounded values are interned to ids, so a match is an
// integer scan with no per-atom allocation. This sits beside the verified tree matcher as an additive
// parallel index; correctness is confirmed against the tree matcher on a shared test corpus.
//
// Token layout (Int32): the top nibble is the tag, the low 28 bits the payload.
//   ARITY(n):   an expression of n children follows
//   SYMBOL(id): an interned symbol or grounded value
//   NEWVAR:     a fresh (de Bruijn) variable
//   VARREF(i):  a reference to the i-th introduced variable
import { type Atom, type Ground, sym, variable, expr, gnd } from "./atom";

export const TAG_ARITY = 0;
export const TAG_SYMBOL = 1;
export const TAG_NEWVAR = 2;
export const TAG_VARREF = 3;

const tagOf = (tok: number): number => (tok >>> 28) & 0xf;
const payloadOf = (tok: number): number => tok & 0x0fffffff;
const tok = (tag: number, payload = 0): number => (tag << 28) | payload | 0;

/** Interns symbols and grounded values to dense integer ids, with a reverse map so a flat atom decodes
 *  back exactly. Symbols and grounds share the id space (a ground's id reconstructs the ground). */
export class Interner {
  private readonly byKey = new Map<string, number>();
  private readonly entries: Array<{ kind: "sym"; name: string } | { kind: "gnd"; value: Ground }> =
    [];

  private add(key: string, entry: (typeof this.entries)[number]): number {
    const existing = this.byKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.entries.length;
    // Leaf ids are packed into a 28-bit token payload; past 2^28 the tag bits would be corrupted.
    if (id > 0x0fffffff) throw new Error("flat-kb: interner exceeded 2^28 unique leaves");
    this.entries.push(entry);
    this.byKey.set(key, id);
    return id;
  }

  internSym(name: string): number {
    return this.add("s\x00" + name, { kind: "sym", name });
  }

  internGround(value: Ground): number {
    return this.add(groundKey(value), { kind: "gnd", value });
  }

  /** The id for a symbol/ground if already interned, else undefined (a pattern symbol absent from the
   *  KB can never match, so its lookup short-circuits). */
  lookupSym(name: string): number | undefined {
    return this.byKey.get("s\x00" + name);
  }
  lookupGround(value: Ground): number | undefined {
    return this.byKey.get(groundKey(value));
  }

  /** Reconstruct the atom for a leaf id. */
  decodeLeaf(id: number): Atom {
    const e = this.entries[id]!;
    return e.kind === "sym" ? sym(e.name) : gnd(e.value);
  }

  get size(): number {
    return this.entries.length;
  }
}

/** A canonical string key for a grounded value (so equal grounds share an id). */
function groundKey(v: Ground): string {
  switch (v.g) {
    case "int":
      return "i\x00" + v.n;
    case "float":
      return "f\x00" + v.n;
    case "str":
      return "S\x00" + v.s;
    case "bool":
      return "b\x00" + (v.b ? "1" : "0");
    case "unit":
      return "u";
    case "error":
      return "e\x00" + v.msg;
    case "ext":
      return "x\x00" + v.kind + "\x00" + v.id;
  }
}

/** Encode an atom into the token array `out`, interning leaves. `varMap` assigns de Bruijn indices to
 *  variable names (shared across one atom so repeated variables become VARREF). */
export function encodeInto(
  a: Atom,
  out: number[],
  it: Interner,
  varMap: Map<string, number>,
): void {
  switch (a.kind) {
    case "sym":
      out.push(tok(TAG_SYMBOL, it.internSym(a.name)));
      return;
    case "gnd":
      out.push(tok(TAG_SYMBOL, it.internGround(a.value)));
      return;
    case "var": {
      const existing = varMap.get(a.name);
      if (existing === undefined) {
        varMap.set(a.name, varMap.size);
        out.push(tok(TAG_NEWVAR));
      } else {
        out.push(tok(TAG_VARREF, existing));
      }
      return;
    }
    case "expr":
      out.push(tok(TAG_ARITY, a.items.length));
      for (const child of a.items) encodeInto(child, out, it, varMap);
      return;
  }
}

/** Encode a single atom to a token array. */
export function encodeAtom(a: Atom, it: Interner): number[] {
  const out: number[] = [];
  encodeInto(a, out, it, new Map());
  return out;
}

/** Decode the token at `pos`, returning the atom and the position after it. Variables are reconstructed
 *  with de Bruijn names `$0`, `$1`, … (so a decoded atom is alpha-equivalent to the original). */
export function decodeAt(tokens: Int32Array | number[], pos: number, it: Interner): [Atom, number] {
  // Fresh variables (NEWVAR) carry no index in their token, so name them by preorder appearance:
  // the k-th NEWVAR becomes $k, which matches the de Bruijn index a later VARREF(k) refers back to.
  let nextVar = 0;
  const go = (p: number): [Atom, number] => {
    const t = tokens[p]!;
    const tag = tagOf(t);
    const payload = payloadOf(t);
    switch (tag) {
      case TAG_SYMBOL:
        return [it.decodeLeaf(payload), p + 1];
      case TAG_NEWVAR:
        return [variable(String(nextVar++)), p + 1];
      case TAG_VARREF:
        return [variable(String(payload)), p + 1];
      case TAG_ARITY: {
        const items: Atom[] = [];
        let q = p + 1;
        for (let i = 0; i < payload; i++) {
          const [child, nq] = go(q);
          items.push(child);
          q = nq;
        }
        return [expr(items), q];
      }
      default:
        throw new Error(`flat-kb: bad token tag ${tag}`);
    }
  };
  return go(pos);
}

/** Decode a full token array to an atom. */
export function decodeAtom(tokens: Int32Array | number[], it: Interner): Atom {
  return decodeAt(tokens, 0, it)[0];
}

/** The number of tokens in the subterm starting at `pos`. */
function subtermLen(tokens: Int32Array | number[], pos: number): number {
  const t = tokens[pos]!;
  if (tagOf(t) === TAG_ARITY) {
    let len = 1;
    let p = pos + 1;
    for (let i = 0; i < payloadOf(t); i++) {
      const l = subtermLen(tokens, p);
      len += l;
      p += l;
    }
    return len;
  }
  return 1;
}

/** Equality of two subterm token ranges (within possibly different arrays). */
function rangeEq(
  a: Int32Array | number[],
  as: number,
  b: Int32Array | number[],
  bs: number,
): boolean {
  const len = subtermLen(a, as);
  if (len !== subtermLen(b, bs)) return false;
  for (let i = 0; i < len; i++) if (a[as + i] !== b[bs + i]) return false;
  return true;
}

/** Encode a query pattern using lookup (not interning): returns the tokens and the variable names in de
 *  Bruijn order, or `null` if a pattern symbol/ground is absent from the interner (fast fail; it can
 *  never match any stored fact). */
export function encodePattern(
  a: Atom,
  it: Interner,
): { tokens: number[]; varNames: string[] } | null {
  const tokens: number[] = [];
  const varNames: string[] = [];
  const varMap = new Map<string, number>();
  const go = (x: Atom): boolean => {
    switch (x.kind) {
      case "sym": {
        const id = it.lookupSym(x.name);
        if (id === undefined) return false;
        tokens.push(tok(TAG_SYMBOL, id));
        return true;
      }
      case "gnd": {
        const id = it.lookupGround(x.value);
        if (id === undefined) return false;
        tokens.push(tok(TAG_SYMBOL, id));
        return true;
      }
      case "var": {
        const existing = varMap.get(x.name);
        if (existing === undefined) {
          varMap.set(x.name, varNames.length);
          varNames.push(x.name);
          tokens.push(tok(TAG_NEWVAR));
        } else {
          tokens.push(tok(TAG_VARREF, existing));
        }
        return true;
      }
      case "expr":
        tokens.push(tok(TAG_ARITY, x.items.length));
        for (const c of x.items) if (!go(c)) return false;
        return true;
    }
  };
  return go(a) ? { tokens, varNames } : null;
}

/** One-sided match of an encoded pattern against an encoded ground fact in a (possibly shared) token
 *  array. Returns the variable bindings (de Bruijn index -> the matched fact subterm's [start, end)
 *  token range), or `null` on mismatch. Pure integer work over the token array, so a worker can run it
 *  against a `SharedArrayBuffer`-backed `Int32Array` with no copying. */
export function matchFlatAt(
  pat: ArrayLike<number>,
  fact: Int32Array | number[],
  factStart: number,
): Map<number, [number, number]> | null {
  const binds = new Map<number, [number, number]>();
  let varCounter = 0;
  let pp = 0;
  let fp = factStart;
  // Lockstep preorder walk: both streams are well-formed, so matching the structure keeps them aligned.
  const go = (): boolean => {
    const pt = pat[pp]!;
    const ptag = tagOf(pt);
    if (ptag === TAG_NEWVAR) {
      const len = subtermLen(fact, fp);
      binds.set(varCounter++, [fp, fp + len]);
      pp += 1;
      fp += len;
      return true;
    }
    if (ptag === TAG_VARREF) {
      const ref = binds.get(payloadOf(pt));
      if (ref === undefined) return false;
      if (!rangeEq(fact, ref[0], fact, fp)) return false;
      pp += 1;
      fp += subtermLen(fact, fp);
      return true;
    }
    if (ptag === TAG_SYMBOL) {
      if (fact[fp] !== pt) return false;
      pp += 1;
      fp += 1;
      return true;
    }
    // ARITY
    if (fact[fp] !== pt) return false;
    const n = payloadOf(pt);
    pp += 1;
    fp += 1;
    for (let i = 0; i < n; i++) if (!go()) return false;
    return true;
  };
  return go() ? binds : null;
}

/** A flat, interned knowledge base: facts are appended as token runs into one array, indexed by head
 *  functor id, and matched against an encoded pattern by integer scan. */
export class FlatKB {
  readonly interner = new Interner();
  private readonly tokens: number[] = [];
  // functor id -> list of fact start offsets. Facts whose head is not a symbol (var-headed or non-expr)
  // are not keyed here; they go in `other`.
  private readonly byFunctor = new Map<number, number[]>();
  private readonly other: number[] = [];
  private readonly offsets: number[] = [];

  /** The token array (for packing into a SharedArrayBuffer). */
  get tokenArray(): readonly number[] {
    return this.tokens;
  }
  /** Every fact's start offset, in insertion order (for sharding across workers). */
  get factOffsets(): readonly number[] {
    return this.offsets;
  }

  /** Add a (typically ground) atom to the KB. */
  add(a: Atom): void {
    const start = this.tokens.length;
    this.offsets.push(start);
    encodeInto(a, this.tokens, this.interner, new Map());
    const head = this.tokens[start]!;
    if (tagOf(head) === TAG_ARITY) {
      const fid = this.tokens[start + 1]!;
      if (tagOf(fid) === TAG_SYMBOL) {
        const k = payloadOf(fid);
        const cur = this.byFunctor.get(k);
        if (cur === undefined) this.byFunctor.set(k, [start]);
        else cur.push(start);
        return;
      }
    } else if (tagOf(head) === TAG_SYMBOL) {
      const k = payloadOf(head);
      const cur = this.byFunctor.get(k);
      if (cur === undefined) this.byFunctor.set(k, [start]);
      else cur.push(start);
      return;
    }
    this.other.push(start);
  }

  /** Candidate fact offsets for a pattern, using the functor index when the pattern head is a known
   *  symbol; otherwise every fact. */
  private candidates(pattern: Atom): number[] | "all" {
    const head = pattern.kind === "expr" && pattern.items.length > 0 ? pattern.items[0] : pattern;
    if (head !== undefined && head.kind === "sym") {
      const fid = this.interner.lookupSym(head.name);
      if (fid === undefined) return []; // unknown functor -> no match
      return [...(this.byFunctor.get(fid) ?? []), ...this.other];
    }
    return "all";
  }

  /** Match `pattern` against the KB, returning a binding map (variable name -> matched atom) per match. */
  match(pattern: Atom): Array<Map<string, Atom>> {
    const enc = encodePattern(pattern, this.interner);
    if (enc === null) return []; // a pattern leaf absent from the KB -> no match
    const cand = this.candidates(pattern);
    const offsets = cand === "all" ? this.offsets : cand;
    const out: Array<Map<string, Atom>> = [];
    for (const off of offsets) {
      const binds = matchFlatAt(enc.tokens, this.tokens, off);
      if (binds === null) continue;
      const m = new Map<string, Atom>();
      for (const [idx, [s]] of binds)
        m.set(enc.varNames[idx]!, decodeAt(this.tokens, s, this.interner)[0]);
      out.push(m);
    }
    return out;
  }

  get size(): number {
    return this.offsets.length;
  }
}

export const _internals = { tok, tagOf, payloadOf, subtermLen };
