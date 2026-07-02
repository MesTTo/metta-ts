// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import {
  type Atom,
  type Ground,
  groundType,
  gnd,
  expr,
  mixHash,
  strHash,
  sym,
  variable,
} from "./atom";

type TermId = number;
type FactId = number;

const TERM_SYM = 1;
const TERM_GND = 2;
const TERM_VAR = 3;
const TERM_EXPR = 4;

const CHUNK_SIZE = 16_384;
const ABSENT = -1;

interface FactRange {
  readonly start: number;
  readonly end: number;
}

class Int32Chunks {
  private readonly chunks: Int32Array[] = [];
  private tail: Int32Array = new Int32Array(CHUNK_SIZE);
  length = 0;

  push(value: number): number {
    const index = this.length;
    const offset = index % CHUNK_SIZE;
    if (offset === 0) {
      if (index > 0) this.chunks.push(this.tail);
      this.tail = new Int32Array(CHUNK_SIZE);
    }
    this.tail[offset] = value | 0;
    this.length = index + 1;
    return index;
  }

  get(index: number): number {
    return index < this.chunks.length * CHUNK_SIZE
      ? this.chunks[Math.floor(index / CHUNK_SIZE)]![index % CHUNK_SIZE]!
      : this.tail[index % CHUNK_SIZE]!;
  }
}

function groundKey(v: Ground): string {
  switch (v.g) {
    case "int":
      return "i\x00" + typeof v.n + "\x00" + String(v.n);
    case "float":
      return "f\x00" + String(v.n);
    case "str":
      return "s\x00" + v.s;
    case "bool":
      return v.b ? "b\x001" : "b\x000";
    case "unit":
      return "u";
    case "error":
      return "e\x00" + v.msg;
    case "ext":
      return "x\x00" + v.kind + "\x00" + v.id;
  }
}

function groundHash(v: Ground): number {
  return strHash(groundKey(v));
}

export function canCompactAtom(a: Atom): boolean {
  switch (a.kind) {
    case "sym":
    case "var":
      return true;
    case "gnd":
      return a.exec === undefined && a.match === undefined;
    case "expr":
      return a.items.every(canCompactAtom);
  }
}

// Thrown by the insert walk on a non-compactable grounded atom and caught in `appendAll`, which
// reports the batch as not flat-storable. Checking compactability inside the one insert walk saves
// the separate canCompactAtom pre-walk every append paid. Terms and facts interned before the bail
// stay in the table but no version's ranges cover the facts, so they are never visible.
const NOT_COMPACT = new Error("flat-atomspace: atom has an executor or custom matcher");

class FlatAtomSpaceTable {
  readonly termKind = new Int32Chunks();
  readonly termStart = new Int32Chunks();
  readonly termLen = new Int32Chunks();
  readonly termHash = new Int32Chunks();
  readonly termGround = new Int32Chunks();
  readonly termData = new Int32Chunks();
  readonly factRoot = new Int32Chunks();
  readonly factHeadSym = new Int32Chunks();

  // Open-addressing intern table (linear probing over a power-of-two Int32Array; a slot holds
  // termId + 1, 0 means empty; append-only, so no tombstones). Replaces a Map<number, TermId[]>
  // whose per-hash bucket arrays were the dominant insert allocation on bulk loads.
  private slots = new Int32Array(1 << 12);
  private slotCount = 0;
  // The empty slot where the last failed lookup probe for `missHash` ended. intern* runs
  // lookup-then-push, so pushTerm claims this slot instead of re-probing the chain. Slots only ever
  // fill (append-only), so a chain never shortens and the recorded slot stays on its hash's chain;
  // pushTerm still re-checks the hash matches and the slot is still empty before trusting it.
  private missSlot = -1;
  private missHash = 0;
  private readonly symByName = new Map<string, number>();
  private readonly groundByKey = new Map<string, number>();
  private readonly varByName = new Map<string, number>();
  private readonly termFacts = new Map<TermId, FactId[]>();
  private readonly symbols: string[] = [];
  private readonly grounds: Ground[] = [];
  private readonly vars: string[] = [];
  // One canonical Atom per term, filled on first decode. Terms are interned and append-only, so a
  // decoded atom is valid forever; without this, candidate enumeration rebuilt a fresh tree per fact
  // per match, which on deep terms (peano's S^n numerals) made matching O(n^3) instead of O(n^2).
  // Children resolve through the cache too, so the cached forest is maximally shared (hash-consed).
  private readonly decoded: Atom[] = [];
  // Reverse intern: an Atom object to its TermId. Weak, so the cache never pins an atom. Match
  // bindings hold decoded (canonical) subterms, so an atom derived from them re-interns in O(new
  // nodes) instead of O(depth), and a ground membership lookup is O(1) after its first walk.
  private readonly termIdOf = new WeakMap<Atom, TermId>();

  get factCount(): number {
    return this.factRoot.length;
  }

  insertFact(atom: Atom): FactId {
    const root = this.insertAtom(atom);
    const id = this.factRoot.push(root);
    this.factHeadSym.push(this.headSymOf(root));
    const facts = this.termFacts.get(root);
    if (facts === undefined) this.termFacts.set(root, [id]);
    else facts.push(id);
    return id;
  }

  factsForTerm(term: TermId): readonly FactId[] {
    return this.termFacts.get(term) ?? [];
  }

  insertAtom(atom: Atom): TermId {
    // The reverse intern makes repeat encounters of the same object O(1): derived facts structure-share
    // subtrees (instantiate reuses unchanged subterms), so the same subterm object is inserted over and
    // over across facts, and a derived atom built over decoded (canonical) subterms re-interns in
    // O(new nodes). Exprs only: a leaf re-interns in one Map probe anyway, and WeakMap.set installs an
    // identity hash on the key (a per-object shape mutation), which cost more than it saved on leaves.
    if (atom.kind !== "expr") return this.insertAtomUncached(atom);
    const known = this.termIdOf.get(atom);
    if (known !== undefined) return known;
    const term = this.insertAtomUncached(atom);
    this.termIdOf.set(atom, term);
    return term;
  }

  private insertAtomUncached(atom: Atom): TermId {
    switch (atom.kind) {
      case "sym":
        return this.internLeaf(
          TERM_SYM,
          this.internSym(atom.name),
          strHash("s\x00" + atom.name),
          true,
        );
      case "gnd": {
        if (atom.exec !== undefined || atom.match !== undefined) throw NOT_COMPACT;
        const key = groundKey(atom.value);
        return this.internLeaf(
          TERM_GND,
          this.internGround(key, atom.value),
          groundHash(atom.value),
          true,
        );
      }
      case "var":
        return this.internLeaf(
          TERM_VAR,
          this.internVar(atom.name),
          strHash("v\x00" + atom.name),
          false,
        );
      case "expr": {
        const children = atom.items.map((child) => this.insertAtom(child));
        return this.internExpr(children);
      }
    }
  }

  lookupAtom(atom: Atom): TermId | undefined {
    const known = this.termIdOf.get(atom);
    if (known !== undefined) return known;
    const term = this.lookupAtomUncached(atom);
    if (term !== undefined) this.termIdOf.set(atom, term);
    return term;
  }

  private lookupAtomUncached(atom: Atom): TermId | undefined {
    switch (atom.kind) {
      case "sym": {
        const leaf = this.symByName.get(atom.name);
        return leaf === undefined
          ? undefined
          : this.lookupLeaf(TERM_SYM, leaf, strHash("s\x00" + atom.name));
      }
      case "gnd": {
        if (!canCompactAtom(atom)) return undefined;
        const key = groundKey(atom.value);
        const leaf = this.groundByKey.get(key);
        return leaf === undefined
          ? undefined
          : this.lookupLeaf(TERM_GND, leaf, groundHash(atom.value));
      }
      case "var": {
        const leaf = this.varByName.get(atom.name);
        return leaf === undefined
          ? undefined
          : this.lookupLeaf(TERM_VAR, leaf, strHash("v\x00" + atom.name));
      }
      case "expr": {
        const children: number[] = [];
        for (const child of atom.items) {
          const term = this.lookupAtom(child);
          if (term === undefined) return undefined;
          children.push(term);
        }
        return this.lookupExpr(children);
      }
    }
  }

  decodeTerm(term: TermId): Atom {
    const hit = this.decoded[term];
    if (hit !== undefined) return hit;
    const atom = this.decodeTermUncached(term);
    this.decoded[term] = atom;
    this.termIdOf.set(atom, term);
    return atom;
  }

  private decodeTermUncached(term: TermId): Atom {
    const kind = this.termKind.get(term);
    const start = this.termStart.get(term);
    switch (kind) {
      case TERM_SYM:
        return sym(this.symbols[start]!);
      case TERM_GND: {
        const ground = this.grounds[start]!;
        return gnd(ground, groundType(ground));
      }
      case TERM_VAR:
        return variable(this.vars[start]!);
      case TERM_EXPR: {
        const len = this.termLen.get(term);
        const items: Atom[] = [];
        for (let i = 0; i < len; i++) items.push(this.decodeTerm(this.termData.get(start + i)));
        return expr(items);
      }
      default:
        throw new Error(`flat-atomspace: bad term kind ${kind}`);
    }
  }

  isTermGround(term: TermId): boolean {
    return this.termGround.get(term) === 1;
  }

  headSymOf(term: TermId): number {
    const kind = this.termKind.get(term);
    if (kind === TERM_SYM) return this.termStart.get(term);
    if (kind !== TERM_EXPR || this.termLen.get(term) === 0) return ABSENT;
    const head = this.termData.get(this.termStart.get(term));
    return this.termKind.get(head) === TERM_SYM ? this.termStart.get(head) : ABSENT;
  }

  lookupHeadSym(name: string): number | undefined {
    return this.symByName.get(name);
  }

  private internSym(name: string): number {
    const existing = this.symByName.get(name);
    if (existing !== undefined) return existing;
    const id = this.symbols.length;
    this.symbols.push(name);
    this.symByName.set(name, id);
    return id;
  }

  private internGround(key: string, value: Ground): number {
    const existing = this.groundByKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.grounds.length;
    this.grounds.push(value);
    this.groundByKey.set(key, id);
    return id;
  }

  private internVar(name: string): number {
    const existing = this.varByName.get(name);
    if (existing !== undefined) return existing;
    const id = this.vars.length;
    this.vars.push(name);
    this.varByName.set(name, id);
    return id;
  }

  private internLeaf(kind: number, leaf: number, hash: number, ground: boolean): TermId {
    const existing = this.lookupLeaf(kind, leaf, hash);
    if (existing !== undefined) return existing;
    return this.pushTerm(kind, leaf, 1, hash, ground);
  }

  private lookupLeaf(kind: number, leaf: number, hash: number): TermId | undefined {
    // strHash/mixHash are unsigned 32-bit; the termHash column stores signed int32. Compare in int32.
    hash |= 0;
    const slots = this.slots;
    const mask = slots.length - 1;
    let i = hash & mask;
    for (;;) {
      const s = slots[i]!;
      if (s === 0) {
        this.missSlot = i;
        this.missHash = hash;
        return undefined;
      }
      const term = s - 1;
      if (
        this.termHash.get(term) === hash &&
        this.termKind.get(term) === kind &&
        this.termStart.get(term) === leaf
      )
        return term;
      i = (i + 1) & mask;
    }
  }

  private internExpr(children: readonly TermId[]): TermId {
    const existing = this.lookupExpr(children);
    if (existing !== undefined) return existing;
    let hash = mixHash(0x45585052, children.length);
    let ground = true;
    const start = this.termData.length;
    for (const child of children) {
      hash = mixHash(hash, child);
      if (!this.isTermGround(child)) ground = false;
      this.termData.push(child);
    }
    return this.pushTerm(TERM_EXPR, start, children.length, hash, ground);
  }

  // The probe skeleton repeats lookupLeaf's on purpose: sharing it would take a per-call equality
  // closure, and avoiding that allocation on the intern path is why the open table exists.
  private lookupExpr(children: readonly TermId[]): TermId | undefined {
    let hash = mixHash(0x45585052, children.length);
    for (const child of children) hash = mixHash(hash, child);
    hash |= 0;
    const slots = this.slots;
    const mask = slots.length - 1;
    let i = hash & mask;
    probe: for (;;) {
      const s = slots[i]!;
      if (s === 0) {
        this.missSlot = i;
        this.missHash = hash;
        return undefined;
      }
      const term = s - 1;
      if (
        this.termHash.get(term) === hash &&
        this.termKind.get(term) === TERM_EXPR &&
        this.termLen.get(term) === children.length
      ) {
        const start = this.termStart.get(term);
        for (let j = 0; j < children.length; j++)
          if (this.termData.get(start + j) !== children[j]) {
            i = (i + 1) & mask;
            continue probe;
          }
        return term;
      }
      i = (i + 1) & mask;
    }
  }

  private pushTerm(
    kind: number,
    start: number,
    len: number,
    hash: number,
    ground: boolean,
  ): TermId {
    hash |= 0;
    const term = this.termKind.length;
    this.termKind.push(kind);
    this.termStart.push(start);
    this.termLen.push(len);
    this.termHash.push(hash);
    this.termGround.push(ground ? 1 : 0);
    // Grow at 3/4 load, then claim the slot the failed lookup already found (or re-probe).
    if ((this.slotCount + 1) * 4 > this.slots.length * 3) {
      this.growSlots();
      this.missSlot = -1;
    }
    let i = this.missSlot;
    this.missSlot = -1;
    if (i < 0 || this.missHash !== hash || this.slots[i] !== 0) {
      const mask = this.slots.length - 1;
      i = hash & mask;
      while (this.slots[i] !== 0) i = (i + 1) & mask;
    }
    this.slots[i] = term + 1;
    this.slotCount += 1;
    return term;
  }

  private growSlots(): void {
    const next = new Int32Array(this.slots.length * 2);
    const mask = next.length - 1;
    for (const s of this.slots) {
      if (s === 0) continue;
      let i = this.termHash.get(s - 1) & mask;
      while (next[i] !== 0) i = (i + 1) & mask;
      next[i] = s;
    }
    this.slots = next;
  }
}

export class FlatAtomSpace {
  // toArray memo for this version (see toArray).
  private arr: Atom[] | undefined;

  private constructor(
    private readonly table: FlatAtomSpaceTable,
    private readonly ranges: readonly FactRange[],
    private readonly dead: ReadonlySet<FactId>,
    readonly liveCount: number,
    readonly nonGroundCount: number,
  ) {}

  static empty(): FlatAtomSpace {
    return new FlatAtomSpace(new FlatAtomSpaceTable(), [], new Set(), 0, 0);
  }

  static fromAtoms(atoms: readonly Atom[]): FlatAtomSpace | undefined {
    return FlatAtomSpace.empty().appendAll(atoms);
  }

  get size(): number {
    return this.liveCount;
  }

  /** Append a batch as new visible facts. Returns undefined when some atom is not flat-storable (a
   *  grounded executor/matcher); the caller keeps such a batch on the plain log instead. */
  appendAll(atoms: readonly Atom[]): FlatAtomSpace | undefined {
    if (atoms.length === 0) return this;
    const start = this.table.factCount;
    let nonGround = this.nonGroundCount;
    try {
      for (const atom of atoms) {
        const fact = this.table.insertFact(atom);
        if (!this.table.isTermGround(this.table.factRoot.get(fact))) nonGround += 1;
      }
    } catch (e) {
      if (e === NOT_COMPACT) return undefined;
      throw e;
    }
    const end = this.table.factCount;
    return new FlatAtomSpace(
      this.table,
      appendRange(this.ranges, start, end),
      this.dead,
      this.liveCount + atoms.length,
      nonGround,
    );
  }

  removeOne(atom: Atom): FlatAtomSpace {
    const term = this.table.lookupAtom(atom);
    if (term === undefined) return this;
    // The per-term fact index lists this term's fact ids in insertion order, so the first visible
    // live one is the same fact a front-to-back scan of the whole space would remove.
    for (const fact of this.table.factsForTerm(term)) {
      if (!this.factVisible(fact) || this.dead.has(fact)) continue;
      const dead = new Set(this.dead);
      dead.add(fact);
      const nonGround = this.table.isTermGround(term)
        ? this.nonGroundCount
        : this.nonGroundCount - 1;
      return new FlatAtomSpace(this.table, this.ranges, dead, this.liveCount - 1, nonGround);
    }
    return this;
  }

  exactCount(atom: Atom): number {
    if (!atom.ground) return 0;
    const term = this.table.lookupAtom(atom);
    if (term === undefined) return 0;
    let count = 0;
    for (const fact of this.table.factsForTerm(term))
      if (this.factVisible(fact) && !this.dead.has(fact)) count += 1;
    return count;
  }

  *candidatesFor(patternHead: string | undefined): Iterable<Atom> {
    if (patternHead === undefined) {
      for (const fact of this.visibleFactIds()) yield this.decodeFact(fact);
      return;
    }
    const head = this.table.lookupHeadSym(patternHead);
    if (head === undefined) {
      for (const fact of this.visibleFactIds())
        if (this.table.factHeadSym.get(fact) === ABSENT) yield this.decodeFact(fact);
      return;
    }
    for (const fact of this.visibleFactIds()) {
      const factHead = this.table.factHeadSym.get(fact);
      if (factHead === ABSENT || factHead === head) yield this.decodeFact(fact);
    }
  }

  toArray(): Atom[] {
    // Memoized per version: `&self` enumeration (selfAtoms) can ask for the same snapshot's atoms on
    // every type/candidate lookup, and a version's visible facts never change. Callers must not
    // mutate the result (the same contract as selfAtoms).
    if (this.arr === undefined) {
      const out: Atom[] = [];
      for (const fact of this.visibleFactIds()) out.push(this.decodeFact(fact));
      this.arr = out;
    }
    return this.arr;
  }

  /** Columnar mirror of the `&self` direct tally in eval.ts: over the visible facts the head filter
   *  admits (head symbol `patternHead` or no symbol head, same filter as `candidatesFor`), count the
   *  ones an all-distinct-variable pattern `(k $v..)` of `arity` items unifies with, without decoding
   *  any fact. `iterated` is the admitted total (it advances the candidate counter). */
  countHeadArity(patternHead: string, arity: number): { count: number; iterated: number } {
    const t = this.table;
    // Unknown head symbol: no fact can have it as head, so only ABSENT-headed facts are admitted,
    // which the `fh !== headId` test below gets right (a number is never equal to undefined).
    const headId = t.lookupHeadSym(patternHead);
    let count = 0;
    let iterated = 0;
    for (const fact of this.visibleFactIds()) {
      const fh = t.factHeadSym.get(fact);
      if (fh !== ABSENT && fh !== headId) continue;
      iterated += 1;
      const root = t.factRoot.get(fact);
      const kind = t.termKind.get(root);
      if (kind === TERM_VAR) {
        count += 1;
        continue;
      }
      if (kind !== TERM_EXPR || t.termLen.get(root) !== arity) continue;
      // A same-arity expr unifies iff its head is the pattern's symbol or a variable.
      if (fh !== ABSENT) count += 1;
      else if (arity > 0 && t.termKind.get(t.termData.get(t.termStart.get(root))) === TERM_VAR)
        count += 1;
    }
    return { count, iterated };
  }

  roundTrip(atom: Atom): Atom {
    return this.table.decodeTerm(this.table.insertAtom(atom));
  }

  private decodeFact(fact: FactId): Atom {
    return this.table.decodeTerm(this.table.factRoot.get(fact));
  }

  private *visibleFactIds(): Iterable<FactId> {
    for (const range of this.ranges)
      for (let fact = range.start; fact < range.end; fact++) if (!this.dead.has(fact)) yield fact;
  }

  private factVisible(fact: FactId): boolean {
    for (const range of this.ranges) {
      if (fact < range.start) return false;
      if (fact < range.end) return true;
    }
    return false;
  }
}

function appendRange(
  ranges: readonly FactRange[],
  start: number,
  end: number,
): readonly FactRange[] {
  if (start === end) return ranges;
  const last = ranges[ranges.length - 1];
  if (last !== undefined && last.end === start)
    return [...ranges.slice(0, -1), { start: last.start, end }];
  return [...ranges, { start, end }];
}
