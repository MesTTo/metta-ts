<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Concurrency and transactions

Once grounded operations can do [asynchronous I/O](/typescript/async), you can compose them concurrently. MeTTa TS adds a small set of TypeScript-native concurrency primitives and a transaction form. They are opt-in: bring them in with `(import! &self concurrency)`.

## par: run branches concurrently

`par` evaluates its branches concurrently and unions their results. With async operations, the whole thing takes about as long as the slowest branch, not the sum. Here `aw n` is an async operation that resolves to `n` after an `n`-millisecond delay:

```ts
import { runProgramAsync, format, gint, type AsyncGroundFn } from "@metta-ts/core";

const aw: AsyncGroundFn = async (args) => {
  const a = args[0]!;
  const n = a.kind === "gnd" && a.value.g === "int" ? a.value.n : 0;
  await new Promise((r) => setTimeout(r, n));
  return { tag: "ok", results: [gint(n)] };
};

const out = await runProgramAsync(
  "!(collapse (par (aw 3) (aw 4) (aw 2)))",
  new Map([["aw", aw]]),
);
console.log(out.at(-1)!.results.map(format)); // [ '(, 3 4 2)' ]
```

Branch effects (atoms added to a space) are merged back deterministically as a multiset delta, so `par` of three `add-atom`s yields all three additions regardless of finishing order.

## race and once

`race` returns the first branch to produce a result and cancels the losers through an `AbortSignal`, so a cancelled branch's effects never land:

```ts
await runProgramAsync("!(race (aw 40) (aw 3))", new Map([["aw", aw]]));
// the 3 ms branch wins -> [ '3' ]
```

`once` cuts a nondeterministic computation down to its first result. Unlike `par` and `race`, it does not need async and works synchronously too.

## hyperpose: parallel branches across CPU cores

`par` and `race` overlap *asynchronous* work on a single thread; they cannot speed up pure CPU work, because a branch that compiles to a tight native loop runs to completion without ever yielding. `hyperpose` covers that case. On its own, `(hyperpose (b1 b2 …))` behaves like `superpose` — it yields each branch as a nondeterministic result. But `(once (hyperpose …))` is special: on Node it evaluates the branches in parallel worker threads and returns the first to finish.

That is exactly what you want when the branches are CPU-bound and you only need one answer. Suppose you are checking several large numbers for primality and only one of them is cheap:

```metta
!(once (hyperpose ((prime? 535372570000000063)    ; expensive
                   (prime? 537818110000000001)    ; expensive
                   (prime? 5421844300001)         ; cheap
                   (prime? 547344310000000013)))) ; expensive
; -> True, returned as soon as the cheap branch finishes
```

Run sequentially, the engine would grind through the first expensive check before it ever reached the cheap one. With workers the cheap branch settles first, `once` returns immediately, and the rest are cancelled.

Each worker re-evaluates its branch from the program's rules, so the parallel path applies when the branches are pure and ground (they read no atoms added during the run). Otherwise — and in the browser, which has no worker threads — `(once (hyperpose …))` falls back to evaluating the branches in sequence: the same results, just without the parallelism.

## with-mutex: serialize a critical section

`with-mutex` takes a key and a body, and serializes bodies sharing the same key, so concurrent branches enter the critical section one at a time. Use it when several async branches touch the same external resource and must not interleave.

```ts
// Two branches both update "account"; with-mutex makes them run one after the other.
await runProgramAsync(
  `!(par (with-mutex account (deposit 10))
         (with-mutex account (deposit 20)))`,
  ops,
);
// the deposits apply in series, never interleaved
```

## transactions

`transaction` evaluates its body and commits the body's space mutations only on success. If the body throws an `(Error ...)` atom or produces zero results, the world is rolled back (a snapshot/restore of the copy-on-write space, not an undo log). This one is synchronous, so it runs in the sandbox below. Press **Run**:

<MettaRunner>

```metta
!(import! &self concurrency)
!(add-atom &self (cnt 5))

; the body adds (cnt 7) and returns a value -> committed
!(transaction (add-atom &self (cnt 7)))

; the body adds (cnt 6) then yields zero results -> rolled back
!(transaction (let $u (add-atom &self (cnt 6)) (superpose ())))

!(collapse (match &self (cnt $v) $v))
```

</MettaRunner>

The final query shows `(, 5 7)`: the committed `(cnt 7)` is there, and the rolled-back `(cnt 6)` is gone.

## What these are and are not

Most of these give deterministic, STM-style isolation and ordering on top of asynchronous I/O: `par`, `race`, `with-mutex`, and `transaction` are concurrency (overlapping I/O) on a single thread, not parallelism across CPU cores. `hyperpose` is the exception — `(once (hyperpose …))` uses worker threads for genuine cross-core parallelism on Node. For data-parallel matching across cores, see [scaling](/advanced/scaling) and the worker-thread matcher.
