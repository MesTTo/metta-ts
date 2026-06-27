# @metta-ts/browser

Browser entry for [MeTTa TS](https://github.com/MesTTo/Meta-TypeScript-Talk). Re-exports everything from [`@metta-ts/core`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/core) and adds an in-memory virtual file system so `import!` works without disk access.

## Install

```bash
npm install @metta-ts/browser
```

## Usage

```ts
import { run } from "@metta-ts/browser";

// A virtual file system: module name -> MeTTa source.
const files = new Map([["math", "(= (double $x) (* 2 $x))"]]);

const results = run(
  `
  !(import! &self math)
  !(double 21)
`,
  files,
);
```

`run(src, files?, fuel?)` evaluates a program, resolving `import!` against the in-memory files. The whole interpreter is pure TypeScript, so it runs in any browser with no native addon and no WASM.

## License

[MIT](https://github.com/MesTTo/Meta-TypeScript-Talk/blob/main/LICENSE).
