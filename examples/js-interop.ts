// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// JavaScript interop: because the engine is TypeScript, MeTTa can call straight into the host runtime,
// no FFI. `js-atom` resolves a global, `js-dot` calls a method, `js-list`/`js-dict` build JS values.
//
// Run it (after `pnpm build`): npx tsx examples/js-interop.ts
import { MeTTa } from "@metta-ts/hyperon";
import { registerJsInterop } from "@metta-ts/hyperon";

const m = new MeTTa();
registerJsInterop(m);

const run1 = (q: string): string[] => m.run(q)[0]!.map((a) => a.toString());

console.log("Math.abs(-5):", run1(`!((js-atom "Math.abs") -5)`)); // [ '5' ]
console.log("Math.max:", run1(`!((js-atom "Math.max") 3 7 2)`)); // [ '7' ]
console.log("toUpperCase:", run1(`!((js-dot "hello world" "toUpperCase"))`)); // [ '"HELLO WORLD"' ]
console.log("array join:", run1(`!((js-dot (js-list (5 1 3)) "join") "-")`)); // [ '"5-1-3"' ]
console.log("dict read:", run1(`!(js-dot (js-dict (("a" 1) ("b" 2))) "b")`)); // [ '2' ]
