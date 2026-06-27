---
# SPDX-FileCopyrightText: 2026 MesTTo
# SPDX-License-Identifier: MIT
layout: home

hero:
  name: MeTTa
  text: MeTTa, in pure TypeScript
  tagline: A complete implementation of the OpenCog Hyperon language that runs anywhere TypeScript runs — the browser, Node, Deno, Bun, edge functions, and inside TypeScript AI agents. No native addons, no WASM.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Learn MeTTa
      link: /learn/evaluation/main-concepts
    - theme: alt
      text: GitHub
      link: https://github.com/MesTTo/Meta-TypeScript-Talk

features:
  - title: Run it anywhere
    details: One ESM bundle, ~23 KB gzipped. No native addon, no WASM, no Rust. Import it in a web page, a serverless handler, or an agent loop and go.
  - title: Faithful semantics
    details: A port of hyperon-experimental's minimal interpreter, validated 270/270 against Hyperon's oracle corpus and cross-checked against the Lean-verified LeaTTa semantics.
  - title: TypeScript-native interop
    details: Call your TypeScript functions from MeTTa, drop TypeScript objects straight into the atomspace as grounded atoms, and write rules with a typed eDSL — no FFI, same language end to end.
  - title: Async and concurrent
    details: Grounded operations can do I/O and the evaluator awaits them. Concurrency primitives (par, race, once, with-mutex) and transactions build on top.
  - title: Scales to millions of atoms
    details: Prolog-style clause indexing keys queries by functor and every ground argument, plus a flat interned KB with a worker-thread parallel matcher.
  - title: A typed eDSL
    details: Write MeTTa in idiomatic TypeScript with typed term builders and a tagged template, or stay in plain MeTTa source. Same engine, same semantics.
---
