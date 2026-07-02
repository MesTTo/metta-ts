// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// A Space backed by a Distributed AtomSpace. Implements the same `Space` interface as `InMemorySpace`,
// delegating every operation to a `DasTransport`.
import { type Atom, type Bindings, type Space } from "@metta-ts/core";
import { type DasTransport } from "./transport";

export class DasSpace implements Space {
  constructor(private readonly transport: DasTransport) {}
  add(atom: Atom): void {
    this.transport.add(atom);
  }
  remove(atom: Atom): boolean {
    return this.transport.remove(atom);
  }
  query(pattern: Atom): Bindings[] {
    return this.transport.query(pattern);
  }
  atoms(): readonly Atom[] {
    return this.transport.atoms();
  }
}
