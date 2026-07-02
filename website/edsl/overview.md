<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# The typed eDSL

`@metta-ts/edsl` lets you write MeTTa in idiomatic, typed TypeScript instead of source strings. It is a thin layer over the engine: every builder produces an ordinary atom, so you get MeTTa's full semantics: rewrite rules, nondeterminism, pattern matching, and types.

```bash
npm install @metta-ts/edsl
```

## A first taste

```ts
import { mettaDB, S, v, rel, iff, gt, lt, mul, sub } from "@metta-ts/edsl";

const db = mettaDB();
const x = v<number>("x");

// a recursive rewrite rule, built from typed combinators
db.rule(rel("fact")(x), iff(gt(x, 0), mul(x, rel("fact")(sub(x, 1))), 1));

db.evalJs(rel("fact")(5)); // [120]
```

`rel("fact")(x)` builds the expression `(fact $x)`; `iff`, `gt`, `mul`, `sub` build the standard forms `if`, `>`, `*`, `-`. The result runs on the same interpreter as any MeTTa program.

## Two surfaces

There are two ways to construct atoms, and you mix them freely.

**Typed builders** give you static types and autocompletion. `S` makes symbols (`S("Tom")` or `S.Tom`), `v<T>` a typed variable, `e` a raw tuple, and `rel` a functor. The special forms and grounded operations have combinators too: `rule`, `decl`, `arrow`, `iff`, `caseOf`, `lett`, `matchSelf`, `superpose`, `collapse`, `empty`, `unify`, the arithmetic and comparison ops, `and`/`or`/`not`, and the list ops. Builders compose, so nested patterns and repeated variables are just nested calls:

```ts
import { rel, e, v, rule, S } from "@metta-ts/edsl";
const [a, b] = [v("a"), v("b")];
rule(rel("swap")(rel("Pair")(a, b)), rel("Pair")(b, a)); // (= (swap (Pair $a $b)) (Pair $b $a))
rule(rel("check")(e(a, b, a)), e(a, b));                  // repeated variable in the pattern
```

**A tagged template** `m\`...\`` is the general escape hatch. It runs the real parser, so it expresses every MeTTa form, and `${value}` interpolations are auto-grounded:

```ts
import { mettaDB, m } from "@metta-ts/edsl";
const db = mettaDB();
db.add(m`(= (gp $x $z) (match &self (parent $x $y) (match &self (parent $y $z) $z)))`);
```

## Passing TypeScript values straight in

Any value that is not already an atom is grounded automatically, by every builder and by template interpolation. So a TypeScript object drops directly into a query:

```ts
import { mettaDB, rel, m, ValueAtom, type GroundedAtom } from "@metta-ts/edsl";

const db = mettaDB();
db.op("balance-of", (args) => [ValueAtom((args[0] as GroundedAtom).jsValue<{ balance: number }>().balance)]);

const account = { owner: "Tom", balance: 100 };
db.evalJs(rel("balance-of")(account));   // [100] — via a builder
db.evalJs(m`(balance-of ${account})`);   // [100] — via the template
```

## The runner

`mettaDB()` keeps MeTTa's two query mechanisms distinct:

- `query(pattern, vars)` does `match &self` over stored atoms and returns typed binding rows.
- `eval(atom)` rewrites with the `=` rules and returns the (nondeterministic) result atoms. `evalJs` unwraps each result to a JavaScript value.

```ts
import { mettaDB, S, v, rel } from "@metta-ts/edsl";

const db = mettaDB();
db.add(rel("Likes")(S.Ada, S.Coffee), rel("Likes")(S.Ada, S.Chocolate));
const thing = v<string>("thing");
db.query(rel("Likes")(S.Ada, thing), { thing }); // [{ thing: "Coffee" }, { thing: "Chocolate" }]
```

Register grounded operations with `op` (sync) and `asyncOp` (async), and await results with `evalAsync` / `evalJsAsync`:

```ts
db.asyncOp("fetch-temp", async () => [ValueAtom(21)]);
await db.evalJsAsync(rel("fetch-temp")()); // [21]
```

The eDSL is the most ergonomic way to drive MeTTa from TypeScript. When a script is easier to read as plain MeTTa, reach for `m\`...\`` or `db.run(source)`; the two always interoperate.
