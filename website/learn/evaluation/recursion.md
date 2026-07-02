<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Recursion and control

MeTTa has no loops. Repetition is recursion, just as in other functional languages, and it pairs naturally with recursive data.

## Recursion over a list

A common list encoding is a cons list: the empty list is `()`, and a cons cell is `(:: head tail)`. So `[A, B, C]` is `(:: A (:: B (:: C ())))`. Counting its elements is two rules, a base case and a recursive case:

<MettaRunner>

```metta
(= (length ()) 0)
(= (length (:: $x $xs)) (+ 1 (length $xs)))
!(length (:: A (:: B (:: C ()))))   ; 3
```

</MettaRunner>

The two rules are mutually exclusive in practice, so together they act like a conditional. Notice we never declared a list type; `::` and `()` are just atoms we chose. `length` works on this shape and is simply left unreduced on anything else.

## Higher-order functions

A rule can take another function as an argument, because to MeTTa it is all just atoms to assemble into an expression:

<MettaRunner>

```metta
(= (apply-twice $f $x) ($f ($f $x)))
(= (square $x) (* $x $x))
!(apply-twice square 2)   ; 16
```

</MettaRunner>

That makes `map` over a cons list straightforward:

<MettaRunner>

```metta
(= (map $f ()) ())
(= (map $f (:: $x $xs)) (:: ($f $x) (map $f $xs)))
(= (square $x) (* $x $x))
!(map square (:: 1 (:: 2 (:: 3 ()))))   ; (:: 1 (:: 4 (:: 9 ())))
```

</MettaRunner>

## Conditionals with if

Grounded numbers cannot be taken apart by pattern matching, so for arithmetic recursion you reach for `if`, which works like if-then-else anywhere:

<MettaRunner>

```metta
(= (factorial $n)
   (if (> $n 0)
       (* $n (factorial (- $n 1)))
       1))
!(factorial 5)   ; 120
```

</MettaRunner>

Crucially, `if` does not evaluate both branches; only the taken one runs. That is what stops `factorial` from recursing forever, and it is easy to see here:

<MettaRunner>

```metta
(= (loop) (loop))         ; an infinite loop
!(if True done (loop))    ; done — the (loop) branch is never evaluated
```

</MettaRunner>

## Pattern matching with case

`case` matches an atom against a sequence of patterns, in order and mutually exclusively:

<MettaRunner>

```metta
(= (factorial $n)
   (case $n
     ((0 1)
      ($_ (* $n (factorial (- $n 1)))))))
!(factorial 5)   ; 120
```

</MettaRunner>

Where `if` checks a boolean condition, `case` matches structure. That makes it handy when several shapes need different handling, for example zipping two lists and treating "both empty", "both non-empty", and "anything else" as distinct cases:

<MettaRunner>

```metta
(= (zip $a $b)
   (case ($a $b)
     (((() ()) ())
      (((:: $x $xs) (:: $y $ys)) (:: ($x $y) (zip $xs $ys)))
      ($else ERROR))))
!(zip (:: A (:: B ())) (:: 1 (:: 2 ())))   ; (:: (A 1) (:: (B 2) ()))
```

</MettaRunner>

Both `if` and `case` are ordinary MeTTa functions, not magic syntax. Next we look at what happens when patterns and nondeterminism meet: **[Free variables and nondeterminism](/learn/evaluation/nondeterminism)**.
