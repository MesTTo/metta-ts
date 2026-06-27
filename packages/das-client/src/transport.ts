// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// DAS transport boundary. `DasTransport` speaks to a Distributed AtomSpace.
// The gRPC bus implementation (das-proto stubs plus Python `hyperon_das` choreography) plugs in here.
// `MockTransport` keeps tests and offline flows on the same `DasSpace` path; live-bus validation
// needs a running DAS service. See README.
import { type Atom, type Bindings, matchAtoms } from "@metta-ts/core";

export interface DasTransport {
  /** Pattern-matching query against the remote space; returns binding sets (DAS `query`). */
  query(pattern: Atom): Bindings[];
  /** Insert an atom through DAS `add_link` / atomdb write. */
  add(atom: Atom): void;
  remove(atom: Atom): boolean;
  /** Enumerate atoms (where the backend supports it). */
  atoms(): readonly Atom[];
}

/** In-process transport over a local atom list for tests and offline development.
 *  Uses the same `DasSpace`/grounded-op path as a bus client, without the network. */
export class MockTransport implements DasTransport {
  constructor(private readonly store: Atom[] = []) {}
  query(pattern: Atom): Bindings[] {
    const out: Bindings[] = [];
    for (const a of this.store) for (const b of matchAtoms(pattern, a)) out.push(b);
    return out;
  }
  add(atom: Atom): void {
    this.store.push(atom);
  }
  remove(atom: Atom): boolean {
    const i = this.store.findIndex((a) => JSON.stringify(a) === JSON.stringify(atom));
    if (i < 0) return false;
    this.store.splice(i, 1);
    return true;
  }
  atoms(): readonly Atom[] {
    return this.store;
  }
}
