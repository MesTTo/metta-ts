# @metta-ts/core

The MeTTa (OpenCog Hyperon) interpreter in pure TypeScript: atoms, spaces, the type system, pattern matching, evaluation, and the standard library. No native addons, no WASM. Runs in any JavaScript runtime (browser, Node, Deno, Bun, edge).

Part of [MeTTa TS](https://github.com/MesTTo/Meta-TypeScript-Talk).

## Install

```bash
npm install @metta-ts/core
```

## Usage

```ts
import { runProgram, format } from "@metta-ts/core";

const results = runProgram(`
  (= (fact $n) (unify $n 0 1 (* $n (fact (- $n 1)))))
  !(fact 5)
`);

for (const { query, results: rs } of results) {
  console.log(format(query), "=>", rs.map(format));
}
// (fact 5) => [ '120' ]
```

`runProgram` parses the source, adds every non-bang atom to the knowledge base, evaluates each `!`-query, and returns one result group per query. For a higher-level class API modeled on Python's `hyperon`, see [`@metta-ts/hyperon`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/hyperon).

## License

[MIT](https://github.com/MesTTo/Meta-TypeScript-Talk/blob/main/LICENSE).
