# @metta-ts/edsl

A typed TypeScript eDSL for [MeTTa TS](https://github.com/MesTTo/Meta-TypeScript-Talk). Mint symbols, functors, and logic variables from proxies, build MeTTa with combinators or a tagged template, and run it on the real interpreter. Any TypeScript value drops in as a grounded atom automatically, and TypeScript functions bridge in both directions.

It is a thin layer over [`@metta-ts/hyperon`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/hyperon): every builder produces an ordinary atom that runs on the existing engine, so you get MeTTa's full semantics: rewrite rules, nondeterminism, pattern matching, and types.

## Install

```bash
npm install @metta-ts/edsl
```

## Usage

```ts
import { mettaDB, names, vars, If, gt, lt, mul, sub, m } from "@metta-ts/edsl";

const db = mettaDB();

// `names()` mints symbols and functors on demand; `vars()` mints logic variables. No name is written
// twice: the JS binding IS the name. A bare name grounds to its symbol; a called name applies it.
const { Likes, fact, Ada, Coffee, Chocolate } = names();
const { thing, x } = vars();

// Facts + a match query. With no explicit vars, the row keys are inferred from the pattern.
db.add(Likes(Ada, Coffee), Likes(Ada, Chocolate));
db.query(Likes(Ada, thing)); // [{ thing: "Coffee" }, { thing: "Chocolate" }]

// Rewrite rules + grounded arithmetic, recursion, nondeterminism.
db.rule(fact(x), If(gt(x, 0), mul(x, fact(sub(x, 1))), 1));
db.evalJs(fact(5)); // [120]

// Grounded functions: a plain typed function, args auto-unwrapped, result auto-grounded.
db.fn("balance-of", (a: { balance: number }) => a.balance);
db.evalJs(m`(balance-of ${{ owner: "Tom", balance: 100 }})`); // [100]

// Call MeTTa functions from TypeScript, quick or typed.
db.call.fact(5); // [120]
const factorial = db.import<[number], number>("fact");
factorial(6); // 720
```

## The two term surfaces

- **Proxies + combinators.** `names()` and `vars()` mint names and variables (`const { parent, x } = ...`), and the capitalized combinators build the special forms: `If`, `Case`, `Let`, `LetStar`, `Match`, `Superpose`, `Collapse`, `Empty`, `Unify`, `Sealed`, `Quote`. Lowercase builders cover the grounded ops: `add`/`sub`/`mul`/`div`/`mod`, `eq`/`gt`/`lt`/`ge`/`le`, `and`/`or`/`not`, `carAtom`/`cdrAtom`/`consAtom`/`deconsAtom`, and `list`/`nil`/`e`. Builders compose, so nested patterns and repeated variables are just nested calls.
- **The tagged template `m\`...\`` (and `mAll` for several atoms)** runs the real parser, so it expresses every MeTTa form, and `${value}` auto-grounds, which is the easiest way to drop a TS object in.

## The runner and the host bridge

`mettaDB()` keeps MeTTa's two query mechanisms distinct: `query(pattern)` does `match &self` over stored atoms and returns binding rows (keys inferred from the pattern, or typed by an explicit `vars` map); `eval(atom)` (and `evalJs`, `evalAsync`, `evalJsAsync`) rewrites with the `=` rules and returns the nondeterministic results.

The host bridge runs both directions:

- **TypeScript into MeTTa (grounded functions).** `db.fn("name", fn)` registers a plain typed function with arguments auto-unwrapped to JS and the result auto-grounded; `db.fns({ ... })` registers several at once keyed by name; `db.asyncFn` awaits an async function. The raw `db.op`/`db.asyncOp` stay for full atom control (multiple results, custom matching).
- **MeTTa into TypeScript (backward import).** `db.call.<name>(...)` builds and evaluates `(<name> ...args)` and returns every result unwrapped to JS; use bracket access for hyphenated names (`db.call["is-even"](4)`). `db.import("name")` returns a callable.

### Typing the host bridge

Pass a schema to `mettaDB` and `call`, `import`, and `fn` become statically typed; with no schema they stay permissive. Both an `interface` and a `type` schema work.

```ts
interface Api {
  fact: (n: number) => number;
  isEven: (n: number) => boolean;
}
const db = mettaDB<Api>();
db.call.fact(5); // number[]
const factorial = db.import("fact"); // (n: number) => number | undefined
db.fn("fact", (n: number) => n + 1); // checked against the schema
// db.fn("fact", (s: string) => s)  // compile error: wrong signature
```

`ground(x)` is the primitive behind auto-grounding, and `patternVars(atom)` returns the free variables of a pattern (what `query` uses to infer row keys).

## Typed source queries

`db.q("...")` runs `match &self` from a plain MeTTa source string and types the result rows by the pattern's `$`-variables, extracted at compile time. The keys are known and autocompleted, and a key that is not a variable in the source is a compile error.

```ts
const rows = db.q("(Likes Ada $thing)"); // Array<{ thing: unknown }>
rows[0]!.thing; // ok, autocompleted
// rows[0]!.other  // compile error: not a variable in the source
```

This types the variable *structure*, not the result *values* (those come from runtime rewriting, which the type system cannot evaluate), so values are `unknown`. It works on a plain string, not the `m\`\`` tag: TypeScript widens a tagged template's text to `string`, which discards the literal the type-level parser needs. For a builder-form query with the same auto-inferred keys, use `db.query(pattern)`.

## JSON and dict-spaces

`db.useJson()` enables the JSON module, then the `jsonEncode`/`jsonDecode`/`dictSpace`/`getKeys`/`getValue` builders bridge JSON and MeTTa spaces. `json-decode` turns a JSON object into a dict-space of `(key value)` pairs, so a fetched payload becomes a queryable space.

```ts
const db = mettaDB().useJson();
db.evalJs(jsonEncode(42)); // ["42"]
const doc = jsonDecode('{"name": "Ada", "age": 36}'); // a dict-space
db.evalFirst(getValue(doc, "name")); // "Ada"  (JSON keys decode to strings)
```

## License

[MIT](https://github.com/MesTTo/Meta-TypeScript-Talk/blob/main/LICENSE).
