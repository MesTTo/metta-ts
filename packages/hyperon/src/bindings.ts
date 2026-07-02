// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

/**
 * Variable bindings, modeled on Hyperon's `Bindings` and `BindingsSet`. A {@link Bindings} is one
 * variable-to-atom frame; a {@link BindingsSet} is the set of frames produced by a match. They wrap the
 * core's immutable binding relations behind a small mutable API.
 */
import * as core from "@metta-ts/core";
import { Atom, V, VariableAtom } from "./atoms";

/** One frame of variable-to-atom associations. */
export class Bindings {
  /** The underlying immutable core relations. Replaced (not mutated) by the mutating methods. */
  constructor(private rels: core.Bindings = core.emptyBindings) {}

  /** The core relations backing this frame. */
  raw(): core.Bindings {
    return this.rels;
  }

  /** The atom bound to a variable, if any. */
  resolve(variable: VariableAtom): Atom | undefined {
    const a = core.lookupVal(this.rels, variable.name());
    return a === undefined ? undefined : Atom.fromCAtom(a);
  }

  /** Bind a variable to an atom; returns `true` (the binding is recorded). */
  addVarBinding(variable: VariableAtom, atom: Atom): boolean {
    this.rels = core.addValRaw(this.rels, variable.name(), atom.catom);
    return true;
  }
  /** Python alias of {@link addVarBinding}. */
  add_var_binding(variable: VariableAtom, atom: Atom): boolean {
    return this.addVarBinding(variable, atom);
  }

  /** Assert that two variables are equal (`$a = $b`); returns `true`. */
  addVarEquality(a: VariableAtom, b: VariableAtom): boolean {
    this.rels = core.addEqRaw(this.rels, a.name(), b.name());
    return true;
  }
  /** Python alias of {@link addVarEquality}. */
  add_var_equality(a: VariableAtom, b: VariableAtom): boolean {
    return this.addVarEquality(a, b);
  }

  /** True when this frame has no associations. */
  isEmpty(): boolean {
    return this.rels.length === 0;
  }
  /** Python alias of {@link isEmpty}. */
  is_empty(): boolean {
    return this.isEmpty();
  }

  /** The variable-atom pairs in this frame. */
  pairs(): [VariableAtom, Atom][] {
    const out: [VariableAtom, Atom][] = [];
    for (const r of this.rels) if (r.tag === "val") out.push([V(r.x), Atom.fromCAtom(r.a)]);
    return out;
  }
  /** Python alias of {@link pairs}. */
  iterator(): [VariableAtom, Atom][] {
    return this.pairs();
  }

  /** Keep only the associations for the given variables. */
  narrowVars(vars: VariableAtom[]): Bindings {
    const keep = new Set(vars.map((v) => v.name()));
    const kept = this.rels.filter((r) => r.tag === "val" && keep.has(r.x));
    return new Bindings(kept);
  }
  /** Python alias of {@link narrowVars}. */
  narrow_vars(vars: VariableAtom[]): Bindings {
    return this.narrowVars(vars);
  }

  /** Merge with another frame, yielding the consistent combinations as a {@link BindingsSet}. */
  merge(other: Bindings): BindingsSet {
    return new BindingsSet(core.merge(this.rels, other.rels).map((b) => new Bindings(b)));
  }

  /** A copy of this frame (the core relations are immutable, so the copy is independent). */
  clone(): Bindings {
    return new Bindings(this.rels);
  }

  equals(other: Bindings): boolean {
    const a = this.pairs();
    const b = other.pairs();
    if (a.length !== b.length) return false;
    return a.every(([v, at]) => {
      const m = b.find(([v2]) => v2.name() === v.name());
      return m !== undefined && core.atomEq(at.catom, m[1].catom);
    });
  }

  toString(): string {
    return `{ ${this.pairs()
      .map(([v, a]) => `${v.toString()}: ${a.toString()}`)
      .join(", ")} }`;
  }
}

/** A set of binding frames; the result of a match. An empty set means no match; a set with one
 *  empty frame means a match that binds nothing (variables may take any value). */
export class BindingsSet {
  constructor(readonly frames: Bindings[] = [new Bindings()]) {}

  /** A set with no frames (no valid match). */
  static empty(): BindingsSet {
    return new BindingsSet([]);
  }
  /** A set with a single empty frame (a match binding nothing). */
  static single(): BindingsSet {
    return new BindingsSet([new Bindings()]);
  }

  /** True when there are no frames. */
  isEmpty(): boolean {
    return this.frames.length === 0;
  }
  /** Python alias of {@link isEmpty}. */
  is_empty(): boolean {
    return this.isEmpty();
  }

  /** True when there is exactly one frame and it binds nothing. */
  isSingle(): boolean {
    return this.frames.length === 1 && this.frames[0]!.isEmpty();
  }
  /** Python alias of {@link isSingle}. */
  is_single(): boolean {
    return this.isSingle();
  }

  /** The frame at an index. */
  get(index: number): Bindings | undefined {
    return this.frames[index];
  }

  /** Iterate the frames. */
  iterator(): Bindings[] {
    return this.frames;
  }

  /** Add a frame to the set. */
  push(bindings: Bindings): void {
    this.frames.push(bindings);
  }

  /** Bind a variable to an atom in every frame; returns `true`. */
  addVarBinding(variable: VariableAtom, value: Atom): boolean {
    for (const f of this.frames) f.addVarBinding(variable, value);
    return true;
  }
  /** Python alias of {@link addVarBinding}. */
  add_var_binding(variable: VariableAtom, value: Atom): boolean {
    return this.addVarBinding(variable, value);
  }

  /** Assert that two variables are equal in every frame; returns `true`. */
  addVarEquality(a: VariableAtom, b: VariableAtom): boolean {
    for (const f of this.frames) f.addVarEquality(a, b);
    return true;
  }
  /** Python alias of {@link addVarEquality}. */
  add_var_equality(a: VariableAtom, b: VariableAtom): boolean {
    return this.addVarEquality(a, b);
  }

  /** Merge another set (or frame) into this one (cartesian merge of frames). */
  mergeInto(input: BindingsSet | Bindings): void {
    const others = input instanceof BindingsSet ? input.frames : [input];
    const merged: Bindings[] = [];
    for (const a of this.frames) for (const b of others) merged.push(...a.merge(b).frames);
    this.frames.length = 0;
    this.frames.push(...merged);
  }
  /** Python alias of {@link mergeInto}. */
  merge_into(input: BindingsSet | Bindings): void {
    this.mergeInto(input);
  }

  /** A copy of this set. */
  clone(): BindingsSet {
    return new BindingsSet(this.frames.map((f) => f.clone()));
  }

  toString(): string {
    return `[ ${this.frames.map((f) => f.toString()).join(", ")} ]`;
  }
}
