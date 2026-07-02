// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The worker-thread parallel matcher (@metta-ts/node): a flat KB's tokens live in a SharedArrayBuffer
// and a pool of worker_threads scan it in parallel. Worth it for a large KB scanned by a non-selective
// query whose result set is small (a keyed query is already near-constant-time, so do not parallelise
// that).
//
// Run it (after `pnpm build`): npx tsx examples/parallel-matcher.ts
import { FlatKB, sym, expr, gint, variable, format, type Atom } from "@metta-ts/core";
import { ParallelFlatMatcher } from "@metta-ts/node";

const A = (...items: Atom[]): Atom => expr(items);

const kb = new FlatKB();
const N = 200_000;
// half the atoms are tagged `hot`, half `cold`; a query bound only on the tag is non-selective.
for (let i = 0; i < N; i++) kb.add(A(sym(i % 2 === 0 ? "hot" : "cold"), gint(i)));

const matcher = new ParallelFlatMatcher(kb, 4);
const hits = await matcher.match(A(sym("hot"), variable("x")));
console.log(`found ${hits.length} hot atoms across 4 workers`); // 100000
console.log("first binding:", format(hits[0]!.get("x")!));
await matcher.close();
