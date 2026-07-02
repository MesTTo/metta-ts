<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Scaling to millions of atoms

A naive `match` over a space is a linear scan, which does not scale. MeTTa TS has three tools for large knowledge bases, in increasing specialization.

## Clause indexing (automatic)

The in-memory matcher indexes `&self` atoms as you add them: by head functor, and by every ground argument at every position. A query then jumps to the most selective bound position instead of scanning. This is automatic; you do nothing.

The effect over a 1,000,000-atom knowledge base: a functor-selective query like `(Parent $x Bob)` skips the unrelated-functor atoms; a query keyed on any ground argument, like `(edge 500000 $y)` or `(edge $x 7)`, resolves in roughly 0.2 to 1.4 ms instead of a full scan. A fully unbound, variable-headed query still scans everything, by necessity.

```ts
import { runProgram, format } from "@metta-ts/core";

const facts = Array.from({ length: 200_000 }, (_, i) => `(edge ${i} ${i + 1})`).join("\n");
const res = runProgram(`${facts}\n!(match &self (edge 150000 $y) $y)`);
console.log(res.at(-1)!.results.map(format)); // [ '150001' ] — the index jumps to the keyed row
```

## The flat interned KB

For very large, mostly-ground knowledge bases, `FlatKB` (from `@metta-ts/core`) stores atoms as a contiguous array of `Int32` tokens with symbols and grounds interned to ids (modeled on MORK's representation). Equality becomes an integer compare and traversal is a cache-friendly linear scan. It matches a pattern with one-sided flat unification:

```ts
import { FlatKB, sym, expr, gint, variable, format, type Atom } from "@metta-ts/core";

const A = (...items: Atom[]): Atom => expr(items);
const kb = new FlatKB();
for (let i = 0; i < 100_000; i++) kb.add(A(sym("edge"), gint(i), gint(i + 1)));

const hits = kb.match(A(sym("edge"), gint(5000), variable("y")));
console.log(hits.map((m) => format(m.get("y")!))); // [ '5001' ]
```

### Frequent-subpattern mining

`williamTopK` mines the most compressible repeated subpatterns from a flat KB, ranked by compression gain `(count - 1) * len - count * refCost` (the MORK / Hyperon whitepaper scheme). It surfaces the structure most worth abstracting:

```ts
import { FlatKB, williamTopK, sym, expr, gint, format, type Atom } from "@metta-ts/core";

const A = (...items: Atom[]): Atom => expr(items);
const kb = new FlatKB();
for (let i = 0; i < 50_000; i++) kb.add(A(sym("obs"), gint(i), A(sym("kind"), sym("road"))));

const heavy = williamTopK(kb, 3, 2);
console.log(heavy.map((h) => `${format(h.pattern)} x${h.count} (gain ${h.gain})`));
// (kind road) x50000 ...
```

## The worker-thread parallel matcher

When you have a *large* KB and a *non-selective* query whose *result set is small* (a needle in a haystack), `ParallelFlatMatcher` (from `@metta-ts/node`) puts the flat KB's tokens in a `SharedArrayBuffer` and scans them across a pool of `worker_threads`, claiming work via an `Atomics` counter:

```ts
import { FlatKB, sym, expr, gint, variable, type Atom } from "@metta-ts/core";
import { ParallelFlatMatcher } from "@metta-ts/node";

const A = (...items: Atom[]): Atom => expr(items);
const kb = new FlatKB();
for (let i = 0; i < 200_000; i++) kb.add(A(sym(i % 2 === 0 ? "hot" : "cold"), gint(i)));

const matcher = new ParallelFlatMatcher(kb, 4);
const hits = await matcher.match(A(sym("hot"), variable("x")));
console.log(hits.length); // 100000
await matcher.close();
```

This is a niche tool: returning hundreds of thousands of matches from workers costs more than the saved scan, so it pays off only for the needle-in-a-haystack shape. A keyed query is already near-constant-time via the clause index, so do not parallelise that. It is Node-first; the same `Int32` layout ports to Web Workers and `SharedArrayBuffer` under cross-origin isolation.

## Which to reach for

Start with nothing: the clause index handles keyed queries over millions of atoms automatically. Use `FlatKB` when memory and scan speed over a mostly-ground KB matter, and `ParallelFlatMatcher` only for large, non-selective, small-result scans.
