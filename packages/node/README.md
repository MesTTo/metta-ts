# @metta-ts/node

Node.js entry for [MeTTa TS](https://github.com/MesTTo/Meta-TypeScript-Talk): the `metta-ts` command-line runner, file-based `import!`, and a `SharedArrayBuffer` worker-thread parallel matcher. Re-exports everything from [`@metta-ts/core`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/core).

## Install

```bash
npm install @metta-ts/node
# for the CLI on your PATH:
npm install -g @metta-ts/node
```

## CLI

```bash
metta-ts path/to/program.metta
# or without a global install:
npx -p @metta-ts/node metta-ts path/to/program.metta
```

## Usage

```ts
import { runFile, ParallelFlatMatcher } from "@metta-ts/node";

// Run a .metta file (resolves import! against the file system).
for (const { query, results } of runFile("program.metta")) {
  console.log(query, results);
}
```

`ParallelFlatMatcher` scans a large flat knowledge base across `worker_threads` over a shared token buffer. It pays off only for a large KB scanned by a non-selective query whose result set is small; a keyed query is already near-constant-time via the in-memory argument index.

## License

[MIT](https://github.com/MesTTo/Meta-TypeScript-Talk/blob/main/LICENSE).
