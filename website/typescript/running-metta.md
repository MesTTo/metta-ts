<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Running MeTTa in TypeScript

Because the engine is TypeScript, there is no boundary to cross: you run MeTTa, build atoms, and call your own functions all in the same language. This page covers the three ways to run a program and how to call TypeScript from MeTTa.

## runProgram: a whole script at once

The simplest entry point is `runProgram` from `@metta-ts/core`. Give it a source string; get back one result group per `!`-query.

```ts
import { runProgram, format } from "@metta-ts/core";

const results = runProgram(`
  (= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))
  !(fact 5)
`);

for (const { query, results: rs } of results) {
  console.log(format(query), "=>", rs.map(format));
}
// (fact 5) => [ '120' ]
```

Each result group is `{ query, results }`, where `results` is an array because MeTTa evaluation is nondeterministic. `format` renders an atom back to MeTTa text.

## The MeTTa runner: incremental and stateful

When you want an object you can feed over time, use the `MeTTa` class from `@metta-ts/hyperon`. Its space is live: atoms you add are visible to later queries.

```ts
import { MeTTa } from "@metta-ts/hyperon";

const metta = new MeTTa();
metta.run("(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))");
console.log(metta.run("!(fact 5)")[0].map(String)); // [ '120' ]
```

`run` returns `Atom[][]`: one `Atom[]` per `!`-query. Atoms have a `toString()`, so `map(String)` gives you readable results.

## Building and evaluating atoms directly

You do not have to go through strings. Build atoms with `S` (symbol), `V` (variable), `E` (expression), and `ValueAtom` (a grounded value), then evaluate them:

```ts
import { MeTTa, S, V, E, ValueAtom } from "@metta-ts/hyperon";

const metta = new MeTTa();
metta.space().addAtom(E(S("parent"), S("Tom"), S("Bob")));

// query the space for bindings
const set = metta.space().query(E(S("parent"), S("Tom"), V("c")));
console.log(set.frames.map((f) => f.resolve(V("c"))!.toString())); // [ 'Bob' ]

// evaluate a constructed atom
console.log(metta.evaluateAtom(E(S("+"), ValueAtom(1), ValueAtom(2))).map(String)); // [ '3' ]
```

## Calling TypeScript from MeTTa

A **grounded operation** is a TypeScript function the evaluator can call by name. Register one with `registerOperation`: it receives the argument atoms and returns result atoms. `jsValue<T>()` unwraps a grounded argument to its JS value.

```ts
import { MeTTa, ValueAtom, type GroundedAtom, type Atom } from "@metta-ts/hyperon";

const metta = new MeTTa();
metta.registerOperation("double", (args: Atom[]) => {
  const n = (args[0] as GroundedAtom).jsValue<number>();
  return [ValueAtom(n * 2)];
});

console.log(metta.run("!(double 21)")[0].map(String)); // [ '42' ]
```

A thrown error becomes a MeTTa `(Error ...)` atom the program can inspect, rather than crashing the run. If instead you want the call left unevaluated so other rules can match (MeTTa's multiple dispatch), throw `IncorrectArgumentError`.

## Where to next

From here you can pass whole TypeScript objects into the atomspace, do asynchronous I/O from MeTTa, and write rules with a typed eDSL. Those build directly on what is above. For the language itself, the **[Learn MeTTa](/learn/evaluation/main-concepts)** track starts from evaluation.
