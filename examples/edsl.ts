// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The ergonomic, typed eDSL (@metta-ts/edsl): mint symbols/functors/variables from proxies, build MeTTa
// with combinators or a tagged template, and bridge TypeScript functions both ways. JS values drop in as
// grounded atoms automatically.
//
// Run it (after `pnpm build`): npx tsx examples/edsl.ts
import { mettaDB, names, vars, If, gt, lt, add, sub, mul, m } from "@metta-ts/edsl";

const db = mettaDB();

// `names()` mints symbols and functors on demand; `vars()` mints logic variables. No name is written
// twice: the JS binding IS the name. A bare name grounds to its symbol; a called name applies it.
const { Likes, classify, fact, inc, bin } = names();
const { Ada, Coffee, Chocolate, Tea, Turing, Positive, Negative, Zero } = names();
const { thing, x } = vars();

// --- Facts + a match query. With no explicit vars, the row keys are inferred from the pattern. ---
db.add(Likes(Ada, Coffee), Likes(Ada, Chocolate), Likes(Turing, Tea));
console.log("Ada likes:", db.query(Likes(Ada, thing)).map((r) => r.thing));
// Ada likes: [ 'Coffee', 'Chocolate' ]

// --- Typed source query: the row keys are the source's $-variables, inferred at compile time. ---
console.log("Ada likes (q):", db.q("(Likes Ada $thing)").map((r) => r.thing));
// Ada likes (q): [ 'Coffee', 'Chocolate' ]

// --- Rewrite rules + grounded arithmetic, evaluated to JS values ---
db.rule(classify(x), If(gt(x, 0), Positive, If(lt(x, 0), Negative, Zero)));
db.rule(fact(x), If(gt(x, 0), mul(x, fact(sub(x, 1))), 1)); // recursion
db.rule(inc(x), add(x, 1));
console.log("classify -3:", db.eval(classify(-3)).map(String)); // [ 'Negative' ]
console.log("fact 5:", db.evalJs(fact(5))); // [ 120 ]

// --- Nondeterminism: two rules for one head ---
db.rule(bin(), 0);
db.rule(bin(), 1);
console.log("bin:", db.evalJs(bin()).sort()); // [ 0, 1 ]

// --- Host bridge: a plain typed function in (args auto-unwrapped, result auto-grounded) ---
db.fn("balance-of", (a: { balance: number }) => a.balance);
const account = { owner: "Tom", balance: 100 };
console.log("balance (builder):", db.evalJs(m`(balance-of ${account})`)); // [ 100 ]

// --- Host bridge: call MeTTa functions from TypeScript ---
console.log("call fact 5:", db.call.fact(5)); // [ 120 ]
const factorial = db.import("fact"); // typed from a schema; permissive here (no schema)
console.log("import fact 6:", factorial(6)); // 720

// --- Async grounded op, awaited ---
db.asyncFn("fetch-temp", async () => {
  await new Promise((r) => setTimeout(r, 10)); // any real I/O
  return 21;
});
console.log("temperature:", await db.evalJsAsync(m`(fetch-temp)`)); // [ 21 ]
