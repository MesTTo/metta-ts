// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Concurrency primitives (async): par runs branches concurrently and unions their results, race returns
// the first branch to produce a result (cancelling the losers), with-mutex serializes a critical
// section. These are async, so use runProgramAsync.
//
// Run it (after `pnpm build`): npx tsx examples/concurrency.ts
import { runProgramAsync, format, gint, type AsyncGroundFn } from "@metta-ts/core";

// `aw n` resolves to n after an n-millisecond delay, so timing is observable.
const aw: AsyncGroundFn = async (args) => {
  const a = args[0]!;
  const n = a.kind === "gnd" && a.value.g === "int" ? a.value.n : 0;
  await new Promise((r) => setTimeout(r, Number(n)));
  return { tag: "ok", results: [gint(n)] };
};
const last = async (src: string): Promise<string[]> =>
  (await runProgramAsync(src, new Map([["aw", aw]]))).at(-1)!.results.map(format);

// par: three branches run concurrently; collapse gathers the union.
console.log("par:", await last("!(collapse (par (aw 3) (aw 4) (aw 2)))")); // [ '(3 4 2)' ]

// race: the fast branch (3ms) wins over the slow one (40ms).
console.log("race:", await last("!(race (aw 40) (aw 3))")); // [ '3' ]

// concurrency is real: three 40ms branches finish in ~40ms, not ~120ms.
const t = Date.now();
await last("!(par (aw 40) (aw 40) (aw 40))");
console.log("3x40ms par took ~", Date.now() - t, "ms"); // ~40ms
