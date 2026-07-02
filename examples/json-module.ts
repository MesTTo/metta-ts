// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The JSON module (opt-in): dict-spaces and JSON encode/decode, mirroring hyperon-experimental's
// experimental JSON support.
//
// Run it (after `pnpm build`): npx tsx examples/json-module.ts
import { MeTTa, registerJsonModule } from "@metta-ts/hyperon";

const m = new MeTTa();
registerJsonModule(m);

const run1 = (q: string): string[] => m.run(q)[0]!.map((a) => a.toString());

// a dict-space: key/value atoms you can query
m.run("(= (d) (dict-space ((a 1) (b 2))))");
console.log("keys:", run1("!(get-keys (d))").sort()); // [ 'a', 'b' ]
console.log("value of a:", run1("!(get-value (d) a)")); // [ '1' ]

// JSON decode/encode
console.log("decode array:", run1('!(json-decode "[1, 2, 3]")')); // [ '(1 2 3)' ]
console.log("decode number:", run1('!(json-decode "42")')); // [ '42' ]
console.log("encode:", run1('!(json-encode (json-decode "[1, 2, 3]"))')); // [ '"[1,2,3]"' ]
