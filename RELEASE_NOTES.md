# MeTTa TS 1.0.0

The first public release of MeTTa TS, a pure-TypeScript implementation of [MeTTa](https://metta-lang.dev) (Meta Type Talk), the OpenCog Hyperon language. It runs anywhere TypeScript runs: the browser, Node, Deno, Bun, and edge or serverless functions. No native addons, no WASM, no Rust.

## Tested on Linux

This release is tested on Linux (Node 20, the CI matrix): lint, format, typecheck, the full test suite, and the build all run there. Because the engine is pure TypeScript with no native addon and no WASM, it is meant to be cross-platform and should run unchanged on any JavaScript runtime. Other operating systems are not yet part of the tested matrix.

## Major performance gains

MeTTa TS is fast, from pure TypeScript. A reproducible black-box benchmark runs the PeTTa example corpus through both engines as subprocesses and checks each program's embedded `(test ...)` assertions. On the Hyperon-faithful shared subset, MeTTa TS passes 95 programs and is faster than PeTTa on 92 of them, median 2.18x and up to 6.2x (`fib`), even though PeTTa runs on SWI-Prolog's GMP-backed integers.

The speed comes from general engine work:

- an O(1)-stack reduce-loop trampoline and worklist, so deep recursion does not grow the JS stack;
- deferred rule-RHS freshening with a head-shape candidate pre-filter;
- Prolog-style clause indexing by head functor and by every ground-leaf argument, so a keyed query over a 1,000,000-atom space resolves in about 0.2 to 1.4 ms;
- ground-atom type memoisation and an exact-match ground-fact index;
- automatic tabling of pure functions, including ones defined at runtime;
- a native-code compiler for the pure deterministic int/bool/tuple subset, with tail-recursion compiled to loops and higher-order specialisation;
- worker-thread parallelism: `(once (hyperpose ...))` races branches across CPU cores on Node, and a `SharedArrayBuffer` flat matcher scans large knowledge bases in parallel.

Every optimisation is verified byte-identical against the 270-assertion Hyperon oracle. See [`packages/node/bench/RESULTS-corpus.md`](packages/node/bench/RESULTS-corpus.md) for the full per-program table.

## What is in this release

- `@metta-ts/core` is the interpreter, parser, type system, pattern matching, and standard library, as a single ESM bundle (~23 KB gzipped). It passes all 270 assertions of Hyperon's oracle corpus (the full dependent-type tier, spaces and mutable state, nondeterminism, grounded operations, and documentation), cross-checked against [LeaTTa](https://github.com/MesTTo/LeaTTa), the machine-checked (Lean 4) MeTTa semantics pinned to the same commit.
- `@metta-ts/hyperon` is a TypeScript class API modeled on Python's `hyperon`, with a JavaScript interop layer (`js-atom`, `js-dot`, `js-list`, `js-dict`) that calls into the host runtime directly.
- `@metta-ts/edsl` is a typed eDSL with term builders, special-form combinators, and a tagged-template surface.
- `@metta-ts/node` has the `metta-ts` CLI, file `import!`, and the worker-thread parallel matcher.
- `@metta-ts/browser` is a browser entry with an in-memory virtual file system for `import!`.
- `@metta-ts/das-client` and `@metta-ts/das-gateway` are an optional client to SingularityNET's Distributed AtomSpace, run end to end against a live cluster, with atom handles matching the AtomDB byte for byte.

## Install

```bash
npm install @metta-ts/core        # the interpreter (works in any JS runtime)
npm install -g @metta-ts/node     # the metta-ts CLI
```

## Provenance

- Semantics: [hyperon-experimental](https://github.com/trueagi-io/hyperon-experimental), pinned to commit `3f76dc4`.
- Verified spec and differential oracle: [LeaTTa](https://github.com/MesTTo/LeaTTa) (Lean 4).
- License: [MIT](LICENSE).
