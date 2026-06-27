<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Introduction

MeTTa TS is a pure-TypeScript implementation of **MeTTa** (Meta Type Talk), the language of the OpenCog Hyperon project. MeTTa is a multi-paradigm language for computing over knowledge graphs: a program is a set of atoms living in a space, and you compute by rewriting and matching those atoms. It mixes facts, rules, functional code, and types in one self-reflective system.

What makes this implementation different is where it runs. Every other MeTTa lives behind a native or WASM boundary: Rust (hyperon-experimental, MORK), Prolog (PeTTa, MeTTaLog), the JVM (JETTA), or Python (the reference bindings). MeTTa TS is written in TypeScript and runs wherever TypeScript runs, with nothing to compile and nothing native to install. You can import it into a web page, a serverless function, or a TypeScript AI agent and start evaluating MeTTa immediately.

For the language itself, the official home is [metta-lang.dev](https://metta-lang.dev). Start there: its [Learn MeTTa](https://metta-lang.dev/docs/learn/learn.html) tutorials are the canonical introduction, and the Learn track in these docs follows them closely.

## Two ways to read these docs

If you are new to MeTTa the language, start with **[Learn MeTTa](/learn/evaluation/main-concepts)**. It teaches evaluation, pattern matching, recursion, types, and the standard library from the ground up. Every example runs in this engine, so you can follow along.

If you already know MeTTa and want to use it from TypeScript, jump to **[Using MeTTa from TypeScript](/typescript/running-metta)**. It covers running programs, calling your own TypeScript functions as grounded operations, embedding TypeScript objects in the atomspace, async evaluation, and the typed eDSL.

## What you get

The core is a faithful port of hyperon-experimental's minimal interpreter, the nondeterministic stack machine, with the standard library loaded as MeTTa source on top. It passes all 270 assertions of Hyperon's oracle corpus and is cross-checked against [LeaTTa](https://github.com/MesTTo/LeaTTa), the machine-checked (Lean 4) MeTTa semantics. On top of the core you also get transactions, async evaluation, concurrency primitives, clause indexing that scales matching to millions of atoms, a JavaScript interop layer, and a typed eDSL.

Ready to run your first program? Head to **[Getting started](/guide/getting-started)**.
