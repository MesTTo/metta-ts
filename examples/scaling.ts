// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Scaling to large knowledge bases. Two tools from the core:
//   - the in-memory matcher indexes &self atoms by functor and by every ground argument, so a keyed
//     query over a million atoms is near-constant-time;
//   - the flat interned KB (FlatKB) stores atoms as Int32 tokens, and williamTopK mines the most
//     compressible repeated subpatterns (MORK / Hyperon whitepaper compression).
//
// Run it (after `pnpm build`): npx tsx examples/scaling.ts
import { runProgram, format, FlatKB, williamTopK, sym, expr, gint, variable, type Atom } from "@metta-ts/core";

const A = (...items: Atom[]): Atom => expr(items);
const hrt = (): number => Number(process.hrtime.bigint()) / 1e6;

// 1) Keyed query over a large &self space via clause indexing.
const facts = Array.from({ length: 200_000 }, (_, i) => `(edge ${i} ${i + 1})`).join("\n");
const t0 = hrt();
const res = runProgram(`${facts}\n!(match &self (edge 150000 $y) $y)`);
console.log(
  `load 200k atoms + a keyed query: ${(hrt() - t0).toFixed(0)} ms total ->`,
  res.at(-1)!.results.map(format),
); // [ '150001' ] — the argument index jumps to the keyed row instead of scanning all 200k

// 2) Flat interned KB + frequent-subpattern mining.
const kb = new FlatKB();
for (let i = 0; i < 50_000; i++) kb.add(A(sym("obs"), gint(i), A(sym("kind"), sym("road"))));
void variable; // (FlatKB also matches patterns; see flat-kb tests)
const heavy = williamTopK(kb, 3, 2);
console.log(
  "heaviest repeated subpatterns:",
  heavy.map((h) => `${format(h.pattern)} x${h.count} (gain ${h.gain})`),
); // (kind road) x50000 ...
