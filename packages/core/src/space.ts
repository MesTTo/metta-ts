// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The Space interface (the injected knowledge store) and an in-memory backend.
// Backends: InMemorySpace (&self and named spaces); DAS-backed spaces plug in later.
import { type Atom, atomEq } from "./atom";
import { type Bindings } from "./bindings";
import { matchAtoms } from "./match";

export interface Space {
  add(atom: Atom): void;
  /** Remove the first structurally-equal atom; returns whether one was removed. */
  remove(atom: Atom): boolean;
  /** All binding sets under which `pattern` matches a stored atom. `freshen`, if given, is applied
   *  to each stored atom before matching (rule-variable freshening). */
  query(pattern: Atom, freshen?: (a: Atom) => Atom): Bindings[];
  atoms(): readonly Atom[];
}

/** Linear-scan in-memory space. Indexing is a future extension behind this same interface. */
export class InMemorySpace implements Space {
  private readonly store: Atom[] = [];

  add(atom: Atom): void {
    this.store.push(atom);
  }

  remove(atom: Atom): boolean {
    const i = this.store.findIndex((a) => atomEq(a, atom));
    if (i < 0) return false;
    this.store.splice(i, 1);
    return true;
  }

  query(pattern: Atom, freshen?: (a: Atom) => Atom): Bindings[] {
    const out: Bindings[] = [];
    for (const a of this.store) {
      const target = freshen ? freshen(a) : a;
      for (const b of matchAtoms(pattern, target)) out.push(b);
    }
    return out;
  }

  atoms(): readonly Atom[] {
    return this.store;
  }
}
