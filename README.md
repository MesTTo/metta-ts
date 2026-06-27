# MeTTa TS

A pure-TypeScript implementation of **MeTTa** (Meta Type Talk), the OpenCog Hyperon language. It runs anywhere TypeScript runs: the browser, Node, Deno, Bun, edge and serverless functions, and inside TypeScript-based AI agents. No native addons, no WASM, no Rust.

## Why this exists

Every other MeTTa implementation is tied to a runtime that cannot drop into a web page or a TypeScript agent without a native or WASM boundary: Rust (hyperon-experimental, MORK), Prolog (PeTTa, MeTTaLog), the JVM (JETTA), Python (the reference bindings). MeTTa TS fills the open lane. You import it and run, from a browser tab to a serverless handler to an agent loop. As more agent tooling is written in TypeScript, a MeTTa that lives natively in that ecosystem, with zero install steps and no build-time native step, is the point.

## Install

```bash
npm install @metta-ts/core        # the interpreter (works in any JS runtime)
# or: pnpm add @metta-ts/core  /  yarn add @metta-ts/core
```

Other packages, add as needed:

```bash
npm install @metta-ts/hyperon     # a Python-hyperon-style class API
npm install @metta-ts/node        # CLI + file import! + a parallel matcher
npm install @metta-ts/browser     # web entry + in-memory virtual file system
```

For the command-line runner, install `@metta-ts/node` globally (or use `npx`):

```bash
npm install -g @metta-ts/node
metta-ts path/to/program.metta

# without a global install:
npx -p @metta-ts/node metta-ts path/to/program.metta
```

## Quick start

Run MeTTa source from TypeScript with the core package:

```ts
import { runProgram, format } from "@metta-ts/core";

const results = runProgram(`
  (= (fact $n) (unify $n 0 1 (* $n (fact (- $n 1)))))
  !(fact 5)
`);

for (const { query, results: rs } of results) {
  console.log(format(query), "=>", rs.map(format));
}
// (fact 5) => [ '120' ]
```

`runProgram` parses the source, adds every non-bang atom to the knowledge base, evaluates each `!`-query, and returns one result group per query.

## Calling TypeScript from MeTTa

The `@metta-ts/hyperon` package is a class API modeled on Python's `hyperon`, but TypeScript-native: no Python, no Rust, no FFI. A grounded operation is a TypeScript function the evaluator can call by name.

```ts
import { MeTTa, ValueAtom, type GroundedAtom, type Atom } from "@metta-ts/hyperon";

const metta = new MeTTa();

metta.registerOperation("double", (args: Atom[]) => {
  const n = (args[0] as GroundedAtom).jsValue<number>();
  return [ValueAtom(n * 2)];
});

console.log(metta.run("!(double 21)")[0].map(String)); // [ '42' ]
```

A thrown error becomes a MeTTa `(Error ...)` atom the program can inspect, rather than crashing the run.

## Calling into JavaScript

Grounded operations let MeTTa call functions you register by name. The interop layer goes one step further: it lets MeTTa reach into the host runtime itself, calling global functions and methods and building JavaScript values, with no glue code. Enable it with `registerJsInterop`.

```ts
import { MeTTa, registerJsInterop } from "@metta-ts/hyperon";

const metta = new MeTTa();
registerJsInterop(metta);

metta.run(`!((js-atom "Math.max") 3 7 2)`); // [ '7' ]             resolve and call a global
metta.run(`!((js-dot "hello world" "toUpperCase"))`); // [ '"HELLO WORLD"' ] call a method on a value
metta.run(`!((js-dot (js-list (5 1 3)) "join") "-")`); // [ '"5-1-3"' ]       build a JS array, then join it
```

## Async MeTTa

MeTTa can be asynchronous. A grounded operation can do I/O (a fetch, a database query, a timer) and the evaluator awaits it. Register it with `registerAsyncOperation` and run with `runAsync`. A synchronous program gives identical results either way.

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

## Concurrency and parallelism

Because the host is JavaScript, MeTTa branches can overlap real I/O and, for CPU-bound work, run across cores. `par` evaluates branches concurrently, `race` returns the first to finish and cancels the losers, `with-mutex` serialises a critical section, and `transaction` commits a body's space mutations only on success.

```ts
import { MeTTa, type GroundedAtom } from "@metta-ts/hyperon";

const metta = new MeTTa();
metta.registerAsyncOperation("aw", async (args) => {
  await new Promise((r) => setTimeout(r, (args[0] as GroundedAtom).jsValue<number>()));
  return [args[0]];
});
// race: the 3 ms branch wins; the 40 ms branch is cancelled
console.log((await metta.runAsync("!(race (aw 40) (aw 3))"))[0].map(String)); // [ '3' ]
```

`(once (hyperpose …))` goes further: on the Node runner it evaluates the branches on worker threads, so synchronous compiled loops run on separate CPU cores. Run it with the CLI (`metta-ts primes.metta`) and the one cheap branch settles first, before the expensive ones finish:

```metta
!(once (hyperpose ((prime? 535372570000000063)     ; expensive
                   (prime? 5421844300001)           ; cheap
                   (prime? 547344310000000013))))   ; -> True
```

## Ergonomic typed eDSL

For writing MeTTa in idiomatic TypeScript, [`@metta-ts/edsl`](packages/edsl) gives typed term builders, special-form combinators (`iff`, `caseOf`, `matchSelf`, arithmetic, ...), and a tagged-template surface. It builds ordinary atoms and runs on the same engine, so you get MeTTa's full semantics: rewrite rules, nondeterminism, pattern matching, and types. Any TypeScript value drops in as a grounded atom automatically.

```ts
import {
  mettaDB,
  S,
  v,
  rel,
  iff,
  gt,
  lt,
  mul,
  sub,
  m,
  ValueAtom,
  type GroundedAtom,
} from "@metta-ts/edsl";

const db = mettaDB();

// Facts + a typed match query.
db.add(rel("Likes")(S.Ada, S.Coffee), rel("Likes")(S.Ada, S.Chocolate));
const thing = v<string>("thing");
db.query(rel("Likes")(S.Ada, thing), { thing }); // [{ thing: "Coffee" }, { thing: "Chocolate" }]

// Recursive rewrite rule + grounded arithmetic.
const x = v<number>("x");
db.rule(rel("fact")(x), iff(gt(x, 0), mul(x, rel("fact")(sub(x, 1))), 1));
db.evalJs(rel("fact")(5)); // [120]

// Pass a TypeScript object straight into a query (auto-grounded).
db.op("balance-of", (args) => [
  ValueAtom((args[0] as GroundedAtom).jsValue<{ balance: number }>().balance),
]);
db.evalJs(rel("balance-of")({ owner: "Tom", balance: 100 })); // [100]
db.evalJs(m`(balance-of ${{ owner: "Tom", balance: 100 }})`); // [100], via the template
```

More runnable examples are in [`examples/`](examples/): [`quickstart.ts`](examples/quickstart.ts), [`grounded-ops.ts`](examples/grounded-ops.ts), [`async.ts`](examples/async.ts), [`edsl.ts`](examples/edsl.ts), plus `.metta` source files. Run one with `npx tsx examples/quickstart.ts`.

## Connecting to a Distributed AtomSpace

A space does not have to be in memory. [`@metta-ts/das-client`](packages/das-client) connects to SingularityNET's **Distributed AtomSpace (DAS)** ([singnet/das](https://github.com/singnet/das)), a remote, shared atomspace, and presents it as a `Space` you query like any other. A DAS query is a network round-trip, so it is asynchronous; `matchAsync` is the async analogue of `(match space pattern template)`.

```ts
import { DasLiveSpace, matchAsync } from "@metta-ts/das-client";
import { sym, expr, variable } from "@metta-ts/core";

const A = (...xs) => expr(xs);

// connect to a running DAS (a Query Agent over gRPC)
const das = new DasLiveSpace(/* connection */);

// "which concepts are animals?" against the remote knowledge base
const animals = await matchAsync(
  das,
  A(sym("EVALUATION"), A(sym("PREDICATE"), sym("is_animal")), A(sym("CONCEPT"), variable("C"))),
  variable("C"),
);
console.log(animals.map(String));
// monkey human triceratops earthworm chimp ent rhino snake
```

This has been run end to end against a live DAS cluster (see [`@metta-ts/das-client`](packages/das-client) for the setup). The same atom handles MeTTa TS computes match the AtomDB byte for byte, so a TypeScript program, in Node today and the browser through [`@metta-ts/das-gateway`](packages/das-gateway), can query the same distributed knowledge base the Rust and Python agents use.

## What is implemented

A faithful port of hyperon-experimental's minimal interpreter (the nondeterministic stack machine), with the standard library loaded as MeTTa source on top. The core passes **all 270 assertions** of Hyperon's oracle corpus: the full dependent-type tier (GADTs, dependent types, types-as-propositions), spaces and mutable state, nondeterminism, grounded operations, and documentation. Correctness is also cross-checked against [LeaTTa](https://github.com/MesTTo/LeaTTa), the machine-checked (Lean 4) MeTTa semantics, pinned to the same commit.

Beyond the core: transactions, async evaluation, concurrency primitives (`par`, `race`, `once`, `hyperpose`, `with-mutex`), clause indexing that scales matching to millions of atoms, a flat interned knowledge base with a worker-thread parallel matcher, and a JavaScript interop layer (`js-atom`, `js-dot`, `js-list`, `js-dict`) that calls into the host runtime directly.

The whole thing is pure TypeScript. The core builds to a single ESM bundle (~23 KB gzipped) that runs in Node and the browser with no native addon and no WASM.

```bash
pnpm install
pnpm build
pnpm test          # 270/270 Hyperon oracle gate + unit and property tests
node packages/node/dist/cli.js examples/factorial.metta
```

## Packages

| Package                                       | What it is                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`@metta-ts/core`](packages/core)             | The interpreter, parser, type system, and standard library. Zero platform dependencies.       |
| [`@metta-ts/hyperon`](packages/hyperon)       | A TypeScript class API over the core, modeled on Python's `hyperon`.                          |
| [`@metta-ts/edsl`](packages/edsl)             | An ergonomic, typed eDSL: term builders, special-form combinators, and a tagged template.     |
| [`@metta-ts/node`](packages/node)             | The `metta-ts` CLI, file `import!`, and a `SharedArrayBuffer` worker-thread parallel matcher. |
| [`@metta-ts/browser`](packages/browser)       | Browser entry point with an in-memory virtual file system for `import!`.                      |
| [`@metta-ts/das-client`](packages/das-client) | Optional client to SingularityNET's Distributed AtomSpace via a Connect gateway.              |

## Performance

Pure TypeScript throughout, no escape to native code. The interpreter uses a precomputed-ground short-circuit, structural sharing in substitution, a cons-list instruction stack, and Prolog-style clause indexing (by head functor and by every ground-leaf argument position). A functor-and-argument-keyed query over a 1,000,000-atom knowledge base resolves in about 0.2 to 1.4 ms. See [`packages/node/bench/RESULTS.md`](packages/node/bench/RESULTS.md) for the full benchmark log.

### Head-to-head with PeTTa

A reproducible benchmark ([`packages/node/bench/corpus-bench.mjs`](packages/node/bench/corpus-bench.mjs)) runs the PeTTa example corpus through both engines as subprocesses and checks each program's embedded `(test …)` assertions. On the Hyperon-faithful subset (host-FFI examples and PeTTa-only execution-model examples are excluded, with the reason recorded for each), MeTTa TS passes 95 of the shared programs and is **faster than PeTTa on 92 of the 95**, median ~2x, on SWI-Prolog's GMP-backed integers, from pure TypeScript.

A representative slice (wall-clock, subprocess including startup; `speedup` = PeTTa / MeTTa TS):

| Program                                          |   PeTTa | MeTTa TS |  Speedup |
| ------------------------------------------------ | ------: | -------: | -------: |
| `fib`                                            |  471 ms |    76 ms | **6.2×** |
| `fibadd` (rule added at runtime, then tabled)    |  467 ms |    80 ms | **5.9×** |
| `he_minimalmetta`                                | 1789 ms |   495 ms |     3.6× |
| `factorial`                                      |  175 ms |    77 ms |     2.3× |
| `patrick_iterate_fib` (higher-order specialised) |  174 ms |    84 ms |     2.1× |
| `hyperpose_primes` (worker threads)              | 1101 ms |  1023 ms |     1.1× |
| `peano`                                          | 1641 ms |  3163 ms |     0.5× |
| `permutations`                                   |  830 ms |  3601 ms |     0.2× |
| `nilbc`                                          |  740 ms |  3322 ms |     0.2× |
| `matespace`                                      | 4109 ms |  timeout |      n/a |

The full per-program table is in [`RESULTS-corpus.md`](packages/node/bench/RESULTS-corpus.md).

That speed comes from general engine work, not test-specific shortcuts:

- an O(1)-stack reduce-loop trampoline;
- a Set-based (O(n)) variable/binding path;
- deferred rule-RHS freshening with a head-shape candidate pre-filter;
- an O(1)-stack worklist for nondeterminism;
- ground-atom type memoisation;
- an exact-match ground-fact index;
- automatic tabling of pure functions, including ones defined at runtime (via rule-set-versioned keys);
- a native-code compiler for the pure deterministic int/bool/tuple subset, with tail-recursion compiled to loops and PeTTa-style **higher-order specialisation** so a function passed as an argument (e.g. `iterate`'s `$step`) is bound and compiled rather than interpreted.

Every one of these is verified byte-identical against the 270-assertion Hyperon oracle.

`hyperpose_primes` is now crossed: `(once (hyperpose …))` races its branches on Node worker threads, so the synchronous compiled loops that cooperative concurrency cannot preempt run on separate cores instead. Still slower than PeTTa are `matespace`/`tilepuzzle` (large symbolic atomspace search at the interpreter's per-reduction floor, which times out) and a few allocation-bound programs that pass but trail (`nilbc`, `permutations`, `peano`). Crossing those needs streamed, structure-sharing result emit, the documented next architectural step. These are tracked in [`packages/node/bench/TODO-parity.md`](packages/node/bench/TODO-parity.md).

## Provenance

- **Semantics:** [hyperon-experimental](https://github.com/trueagi-io/hyperon-experimental), pinned to commit `3f76dc4`.
- **Verified spec and differential oracle:** [LeaTTa](https://github.com/MesTTo/LeaTTa) (Lean 4).
- **Distributed AtomSpace:** optional client to SingularityNET DAS via a Connect gateway (Node), reachable from the browser.

## License

[MIT](LICENSE).
