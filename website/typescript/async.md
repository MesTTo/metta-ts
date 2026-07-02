<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Async MeTTa

MeTTa evaluation is synchronous by default. But a grounded operation often wants to do I/O, a fetch, a database lookup, a timer, and for that the evaluator needs to wait. MeTTa TS lets you register asynchronous grounded operations and evaluate a program along an async path that awaits them.

## Registering an async operation

Use `registerAsyncOperation`: the function returns a `Promise` of result atoms. Then run the program with `runAsync` (or evaluate a single atom with `evaluateAtomAsync`):

```ts
import { MeTTa, ValueAtom } from "@metta-ts/hyperon";

const metta = new MeTTa();
metta.registerAsyncOperation("fetch-temperature", async () => {
  const res = await fetch("https://example.com/temp"); // any real I/O
  return [ValueAtom(await res.json())];
});

const out = await metta.runAsync("!(fetch-temperature)");
console.log(out[0].map(String));
```

A program with no async operations gives identical results whether you call `run` or `runAsync`; the async path only differs once an async operation is actually reached. So you can write ordinary MeTTa and only pay for asynchrony where you use it.

## How it works, briefly

The interpreter's drivers are generators. The synchronous `run` advances them to completion in one tick; `runAsync` awaits at each suspension point. This is the generator-based dual-driver pattern (the same idea behind libraries like gensync), and it means there is a single evaluator, not two copies, so sync and async stay in lockstep. Making the whole core `async` would have taxed every step and is unsound to run to completion on a single tick, so the engine keeps a fast synchronous path and suspends only when an async operation is hit.

## From the core package

If you are using `@metta-ts/core` directly rather than the class API, the async entry point is `runProgramAsync`, which takes a map of async operations:

```ts
import { runProgramAsync, format, gint, type AsyncGroundFn } from "@metta-ts/core";

const wait: AsyncGroundFn = async (args) => {
  const n = args[0]!.kind === "gnd" && args[0]!.value.g === "int" ? args[0]!.value.n : 0;
  await new Promise((r) => setTimeout(r, n));
  return { tag: "ok", results: [gint(n)] };
};

const results = await runProgramAsync("!(wait 10)", new Map([["wait", wait]]));
console.log(results[0]!.results.map(format)); // [ '10' ]
```

Async operations are the foundation for the **[concurrency primitives](/typescript/running-metta)** (`par`, `race`, `once`, `with-mutex`), which run branches concurrently and combine their results.

Next: call straight into the host runtime with **[JavaScript interop](/typescript/js-interop)**.
