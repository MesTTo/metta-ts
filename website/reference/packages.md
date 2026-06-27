<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Packages

MeTTa TS is a small set of packages under the `@metta-ts` scope. Install only what you need; everything builds on the core. For the full API of each, see the detailed reference: [core](/reference/core), [hyperon](/reference/hyperon), [edsl](/reference/edsl), and [node and browser](/reference/node-browser).

| Package | What it is |
|---------|------------|
| [`@metta-ts/core`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/core) | The interpreter, parser, type system, and standard library. Zero platform dependencies, runs in any JavaScript runtime. |
| [`@metta-ts/hyperon`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/hyperon) | A TypeScript class API over the core (atoms, spaces, grounded operations). |
| [`@metta-ts/edsl`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/edsl) | An ergonomic, typed eDSL: term builders, special-form combinators, and a tagged template. |
| [`@metta-ts/node`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/node) | The `metta-ts` CLI, file `import!`, and the `SharedArrayBuffer` worker-thread parallel matcher. |
| [`@metta-ts/browser`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/browser) | Browser entry point with an in-memory virtual file system for `import!`. |
| [`@metta-ts/das-client`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/das-client) | Client for SingularityNET's Distributed AtomSpace. |
| [`@metta-ts/das-gateway`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/das-gateway) | A transport-agnostic gateway bridging the browser to a Distributed AtomSpace. |

## How they fit together

`@metta-ts/core` is the whole language: parse, evaluate, match, type-check, and the standard library. If you only want to run MeTTa, this is all you need.

`@metta-ts/hyperon` and `@metta-ts/edsl` are two TypeScript-facing layers over the core. The hyperon package mirrors the Python API (a `MeTTa` runner, `S`/`V`/`E`/`G` atom constructors, grounded operations). The eDSL is the more idiomatic, typed way to build and run MeTTa from TypeScript.

`@metta-ts/node` and `@metta-ts/browser` are platform entry points: the Node package adds the CLI, file imports, and the worker-thread matcher; the browser package adds an in-memory file system. Both re-export the core.

`@metta-ts/das-client` and `@metta-ts/das-gateway` are optional, for querying a remote Distributed AtomSpace.

## Versioning and license

All packages are released together under the `@metta-ts` scope and the MIT license.
