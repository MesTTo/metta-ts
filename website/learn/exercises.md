<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Exercises

A few exercises to practice the evaluation model. Each has a worked solution you can run in this engine (paste it into a `.metta` file and run `metta-ts file.metta`, or pass it to `runProgram`). Try them before peeking.

A reminder on the list encoding used below: the empty list is `()` and a cons cell is `(:: head tail)`, so `[A, B, C]` is `(:: A (:: B (:: C ())))`.

## 1. Store facts, then query them

Store that Ada likes coffee and chocolate and Turing likes tea, then ask what Ada likes.

<MettaRunner>

```metta
(Likes Ada Coffee)
(Likes Ada Chocolate)
(Likes Turing Tea)

!(match &self (Likes Ada $thing) $thing)   ; Coffee and Chocolate
```

</MettaRunner>

`match` searches the stored atoms (not sub-expressions) for the pattern and returns the template `$thing` for each match.

## 2. inc, dec, square

Define `(inc $x)`, `(dec $x)`, and `(square $x)` with grounded arithmetic.

<MettaRunner>

```metta
(= (inc $x) (+ $x 1))
(= (dec $x) (- $x 1))
(= (square $x) (* $x $x))

!(inc 41)      ; 42
!(dec 10)      ; 9
!(square 12)   ; 144
```

</MettaRunner>

## 3. classify by sign

Define `(classify $x)` returning `Positive`, `Negative`, or `Zero`. Nested `if` does it:

<MettaRunner>

```metta
(= (classify $x)
   (if (> $x 0) Positive
       (if (< $x 0) Negative Zero)))

!(classify 7)    ; Positive
!(classify -3)   ; Negative
!(classify 0)    ; Zero
```

</MettaRunner>

## 4. factorial

Grounded numbers cannot be deconstructed by pattern matching, so use `if` for the base case:

<MettaRunner>

```metta
(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))

!(fact 0)   ; 1
!(fact 5)   ; 120
!(fact 7)   ; 5040
```

</MettaRunner>

## 5. length of a list

Two rules, a base case and a recursive case:

<MettaRunner>

```metta
(= (length ()) 0)
(= (length (:: $x $xs)) (+ 1 (length $xs)))

!(length (:: A (:: B (:: C ()))))   ; 3
```

</MettaRunner>

## Doing the same from TypeScript

Every exercise above can be written with the [typed eDSL](/edsl/overview) instead of source strings. Factorial, for example:

```ts
import { mettaDB, v, rel, iff, gt, mul, sub } from "@metta-ts/edsl";

const db = mettaDB();
const x = v<number>("x");
db.rule(rel("fact")(x), iff(gt(x, 0), mul(x, rel("fact")(sub(x, 1))), 1));
db.evalJs(rel("fact")(5)); // [120]
```
