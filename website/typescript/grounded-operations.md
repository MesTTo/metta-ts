<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Grounded operations

A grounded operation is a TypeScript function the MeTTa evaluator can call by name. It is how you extend the language: arithmetic, I/O, and your own domain logic all enter MeTTa as grounded operations. Register one with `registerOperation` on a `MeTTa` runner.

```ts
import { MeTTa, ValueAtom, type GroundedAtom, type Atom } from "@metta-ts/hyperon";

const metta = new MeTTa();
metta.registerOperation("double", (args: Atom[]) => {
  const n = (args[0] as GroundedAtom).jsValue<number>();
  return [ValueAtom(n * 2)];
});

console.log(metta.run("!(double 21)")[0].map(String)); // [ '42' ]
```

The function receives the argument atoms and returns an array of result atoms (an array, because a MeTTa operation may be nondeterministic). `jsValue<T>()` unwraps a grounded argument to its TypeScript value, and `ValueAtom` wraps a TypeScript value back into a grounded atom.

## Errors are values

If your function throws, the error does not crash the run. It becomes a MeTTa `(Error ...)` atom that the program can inspect:

```ts
metta.registerOperation("checked-sqrt", (args: Atom[]) => {
  const n = (args[0] as GroundedAtom).jsValue<number>();
  if (n < 0) throw new Error("negative input");
  return [ValueAtom(Math.sqrt(n))];
});

metta.run("!(checked-sqrt -1)"); // [ (Error (checked-sqrt -1) "negative input") ]
```

## Falling through to other rules

Sometimes the right behavior on the wrong argument is not an error but "this rule does not apply, let another one try". That is MeTTa's multiple dispatch. Throw `IncorrectArgumentError` to leave the expression unevaluated instead of producing an error atom:

```ts
import { IncorrectArgumentError } from "@metta-ts/hyperon";

metta.registerOperation("only-positive", (args: Atom[]) => {
  const n = (args[0] as GroundedAtom).jsValue<number>();
  if (n <= 0) throw new IncorrectArgumentError("not for me");
  return [ValueAtom(n)];
});
```

Now `(only-positive -3)` is left as-is, so a separate `=` rule for non-positive inputs can match it.

## Returning several results

Because the return type is `Atom[]`, an operation can be nondeterministic. Return more than one atom and each becomes a result:

```ts
metta.registerOperation("pair", (args: Atom[]) => [args[0]!, args[1]!]);
metta.run("!(pair A B)")[0].map(String); // [ 'A', 'B' ]
```

Next: pass whole TypeScript objects, not just primitives, into the atomspace. See **[Embedding TypeScript objects](/typescript/embedding-objects)**.
