<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Embedding TypeScript objects

In the Python bindings you reach for `py-atom` to put a Python object into the atomspace across the FFI. Here there is no FFI: the engine is TypeScript, so a TypeScript object can be a grounded atom directly. This is the analogue of `py-atom`, `py-list`, and `py-dict`, but without any boundary to cross.

## A value as an atom

`ValueAtom` wraps any TypeScript value as a grounded atom. Primitives become MeTTa primitives; anything else (an object, a `Map`, a class instance) rides as an opaque grounded value:

```ts
import { MeTTa, S, E, ValueAtom, type GroundedAtom, type Atom } from "@metta-ts/hyperon";

const metta = new MeTTa();
const account = { owner: "Tom", balance: 100 }; // a plain TS object

metta.registerOperation("balance-of", (args: Atom[]) =>
  [ValueAtom((args[0] as GroundedAtom).jsValue<{ balance: number }>().balance)]);

// pass the object straight into a query
const accAtom = ValueAtom(account);
console.log(metta.evaluateAtom(E(S("balance-of"), accAtom)).map(String)); // [ '100' ]
```

`jsValue<T>()` gives you the object back, typed. The object is the same reference you put in, not a copy or a serialization.

## Storing objects in the space

A grounded object is an atom like any other, so it can live in the space and be retrieved by a query:

```ts
import { MeTTa, S, E, V, ValueAtom, type GroundedAtom } from "@metta-ts/hyperon";

const metta = new MeTTa();
metta.space().addAtom(E(S("account"), S("tom"), ValueAtom({ owner: "Tom", balance: 100 })));

const set = metta.space().query(E(S("account"), S("tom"), V("a")));
const obj = (set.frames[0]!.resolve(V("a")) as GroundedAtom).jsValue<{ balance: number }>();
console.log(obj.balance); // 100
```

## Custom unification

An embedded object is opaque to the matcher by default: it unifies by equality, not by its fields. If you want the engine to match *into* a TypeScript type, subclass `MatchableObject` and override `match_`. The core matcher will call it. For example, a `Range` that matches any integer within its bounds:

```ts
import { G, MatchableObject, type Atom, type GroundedAtom } from "@metta-ts/hyperon";
import { gint, matchAtoms } from "@metta-ts/core";

class Range extends MatchableObject {
  constructor(readonly lo: number, readonly hi: number) { super({ lo, hi }); }
  override match_(other: Atom): unknown[] {
    const n = (other as GroundedAtom).object?.().content;
    return typeof n === "number" && n >= this.lo && n <= this.hi ? [[]] : [];
  }
}

const range = G(new Range(1, 10));
matchAtoms(range.catom, gint(5)).length;  // 1 — matches
matchAtoms(range.catom, gint(20)).length; // 0 — does not
```

Return one (empty) binding to signal a match, or none to signal no match. This is the same hook the standard library's grounded values use for custom matching.

Next: do real I/O from MeTTa with **[Async MeTTa](/typescript/async)**.
