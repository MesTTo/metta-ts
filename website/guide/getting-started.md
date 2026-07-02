<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Getting started

Let us install MeTTa TS and run a first program three ways: from a MeTTa file, from a TypeScript string, and through the class API.

## Install

The interpreter lives in `@metta-ts/core` and works in any JavaScript runtime:

```bash
npm install @metta-ts/core
# or: pnpm add @metta-ts/core  /  yarn add @metta-ts/core
```

For the command-line runner, install `@metta-ts/node`:

```bash
npm install -g @metta-ts/node
```

## Your first program

Here is a small MeTTa program. Press **Run** to evaluate it in your browser, or save it as `hello.metta` to run from the command line:

<MettaRunner>

```metta
(= (greet $name) (Hello $name))
!(greet World)
```

</MettaRunner>

Run it with the CLI:

```bash
metta-ts hello.metta
```

You will see the result of the one `!`-query:

```
[(Hello World)]
```

A MeTTa script is read atom by atom. Atoms without a leading `!` are added to the program space; atoms with `!` are evaluated immediately and their results printed. So the `=` rule above is stored, and `!(greet World)` rewrites to `(Hello World)`. The block above is live: press **Run** to evaluate it here, or edit it and run again.

## Run from TypeScript

The same program, evaluated from TypeScript with `runProgram`:

```ts
import { runProgram, format } from "@metta-ts/core";

const results = runProgram(`
  (= (greet $name) (Hello $name))
  !(greet World)
`);

for (const { query, results: rs } of results) {
  console.log(format(query), "=>", rs.map(format));
}
// (greet World) => [ '(Hello World)' ]
```

`runProgram` returns one result group per `!`-query. Each group has the `query` atom and the list of `results` it evaluated to (a list, because MeTTa evaluation is nondeterministic).

## Run through the class API

If you prefer an object you can hold and feed incrementally, use the `MeTTa` runner from `@metta-ts/hyperon`:

```ts
import { MeTTa } from "@metta-ts/hyperon";

const metta = new MeTTa();
metta.run("(= (greet $name) (Hello $name))"); // add a rule
console.log(metta.run("!(greet World)")[0].map(String)); // [ '(Hello World)' ]
```

## Write MeTTa in typed TypeScript

If you would rather not write MeTTa as strings, `@metta-ts/edsl` builds the same atoms from typed TypeScript:

```ts
import { mettaDB, names, vars, If, gt, mul, sub } from "@metta-ts/edsl";

const db = mettaDB();
const { fact } = names();
const { n } = vars();
db.rule(fact(n), If(gt(n, 0), mul(n, fact(sub(n, 1))), 1));
db.evalJs(fact(5)); // [120]
```

See the **[typed eDSL](/edsl/overview)** for builders, the tagged template, and typed queries.

## Where to next

You now have MeTTa running. To learn the language, start with **[Main concepts](/learn/evaluation/main-concepts)**. To go deeper on the TypeScript side, see **[Running MeTTa in TypeScript](/typescript/running-metta)**.
