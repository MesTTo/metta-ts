// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The hyperon class API (@metta-ts/hyperon): build atoms with S/V/E/G, work with the live space, query
// it for bindings, and evaluate constructed atoms. Modeled on Python's `hyperon`, TypeScript-native.
//
// Run it (after `pnpm build`): npx tsx examples/hyperon-api.ts
import { MeTTa, S, V, E, ValueAtom } from "@metta-ts/hyperon";

const m = new MeTTa();

// Add facts to the runner's live space (the same space the evaluator sees).
m.space().addAtom(E(S("parent"), S("Tom"), S("Bob")));
m.space().addAtom(E(S("parent"), S("Tom"), S("Liz")));

// Query the space: every binding of $c in (parent Tom $c).
const matches = m.space().query(E(S("parent"), S("Tom"), V("c")));
console.log("children of Tom:", matches.frames.map((f) => f.resolve(V("c"))!.toString())); // [ 'Bob', 'Liz' ]

// Evaluate a constructed atom (no source string needed).
console.log("1 + 2 =", m.evaluateAtom(E(S("+"), ValueAtom(1), ValueAtom(2))).map(String)); // [ '3' ]

// The types the runner infers for an atom.
console.log("types of 1:", m.getAtomTypes(ValueAtom(1)).map(String));
