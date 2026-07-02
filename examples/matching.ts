// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Pattern matching: querying stored facts for variable bindings, and matching with repeated variables.
//
// Run it (after `pnpm build`): npx tsx examples/matching.ts
import { MeTTa, S, V, E } from "@metta-ts/hyperon";

const m = new MeTTa();
for (const [a, b] of [["Tom", "Bob"], ["Pam", "Bob"], ["Tom", "Liz"]])
  m.space().addAtom(E(S("parent"), S(a!), S(b!)));

// match &self: who are Bob's parents?
const parents = m.space().query(E(S("parent"), V("p"), S("Bob")));
console.log("Bob's parents:", parents.frames.map((f) => f.resolve(V("p"))!.toString())); // [ 'Tom', 'Pam' ]

// A repeated variable in a rule's left-hand side only matches when both positions agree.
m.run("(= (same $x $x) yes)");
console.log("same A A:", m.run("!(same A A)")[0]!.map(String)); // [ 'yes' ]
console.log("same A B:", m.run("!(same A B)")[0]!.map(String)); // [ '(same A B)' ] — left unreduced
