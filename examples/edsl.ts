// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The ergonomic, typed eDSL (@metta-ts/edsl): write MeTTa with typed term builders, special-form
// combinators, and a tagged-template surface, and run it on the real interpreter. JS values drop in as
// grounded atoms automatically.
//
// Run it (after `pnpm build`): npx tsx examples/edsl.ts
import {
  mettaDB, S, v, rel, iff, gt, lt, add, sub, mul, m,
  ValueAtom, type GroundedAtom,
} from "@metta-ts/edsl";

const db = mettaDB();

// --- Facts + a typed match query (returns typed binding rows) ---
db.add(rel("Likes")(S.Ada, S.Coffee), rel("Likes")(S.Ada, S.Chocolate), rel("Likes")(S.Turing, S.Tea));
const thing = v<string>("thing");
console.log("Ada likes:", db.query(rel("Likes")(S.Ada, thing), { thing }).map((r) => r.thing));
// Ada likes: [ 'Coffee', 'Chocolate' ]

// --- Rewrite rules + grounded arithmetic, evaluated to JS values ---
const x = v<number>("x");
db.rule(rel("classify")(x), iff(gt(x, 0), S.Positive, iff(lt(x, 0), S.Negative, S.Zero)));
db.rule(rel("fact")(x), iff(gt(x, 0), mul(x, rel("fact")(sub(x, 1))), 1)); // recursion
db.rule(rel("inc")(x), add(x, 1));
console.log("classify -3:", db.eval(rel("classify")(-3)).map(String)); // [ 'Negative' ]
console.log("fact 5:", db.evalJs(rel("fact")(5))); // [ 120 ]

// --- Nondeterminism: two rules for one head ---
db.rule(rel("bin")(), 0);
db.rule(rel("bin")(), 1);
console.log("bin:", db.evalJs(rel("bin")()).sort()); // [ 0, 1 ]

// --- Pass a TypeScript object straight in (auto-grounded), operated on by a TS function ---
db.op("balance-of", (args) => [ValueAtom((args[0] as GroundedAtom).jsValue<{ balance: number }>().balance)]);
const account = { owner: "Tom", balance: 100 };
console.log("balance (builder):", db.evalJs(rel("balance-of")(account))); // [ 100 ]
console.log("balance (template):", db.evalJs(m`(balance-of ${account})`)); // [ 100 ]

// --- Async grounded op, awaited ---
db.asyncOp("fetch-temp", async () => {
  await new Promise((r) => setTimeout(r, 10)); // any real I/O
  return [ValueAtom(21)];
});
console.log("temperature:", await db.evalJsAsync(rel("fetch-temp")())); // [ 21 ]
