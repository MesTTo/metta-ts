<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Basic evaluation

Let us see how MeTTa turns one expression into another. The whole language is built on a single idea: an expression is reduced by applying equality rules until none apply.

## Programs are atoms

A script is parsed atom by atom into the space. An atom on its own is stored; an atom with `!` is evaluated and its result printed. Here both happen:

<MettaRunner>

```metta
; This line is a comment, ignored by the parser.
Hello              ; a symbol, added to the space
(Hello World)      ; an expression, added to the space
!(+ 1 2)           ; evaluated immediately -> 3
!(Hi there)        ; evaluated immediately -> (Hi there)
```

</MettaRunner>

`(+ 1 2)` reduces to `3` because `+` is a grounded operation that runs on its arguments. But `(Hi there)` reduces to itself: `Hi` is just a symbol, not an operation, so there is nothing to run. A bare symbol heading an expression behaves like a data constructor, the way `Cons` does in a functional language. This is why facts like `(Likes Alice Pizza)` are values, not computations.

## Equalities are your functions

To make an expression reduce to something other than itself, define an equality with `=`:

<MettaRunner>

```metta
(= (greet) (Hello World))
!(greet)           ; (Hello World)
```

</MettaRunner>

`(= (greet) (Hello World))` says "`(greet)` can be reduced to `(Hello World)`". Equalities look like function definitions, but they differ in important ways.

**They need not be total.** A rule can match only some inputs, and an unmatched call is simply left alone:

<MettaRunner>

```metta
(= (only-a A) accepted)
!(only-a A)        ; accepted
!(only-a B)        ; (only-a B)  — no rule matches, so it is left unreduced
```

</MettaRunner>

There is no error for `(only-a B)`; it is just a value the interpreter could not reduce. In MeTTa there is no hard line between a function and a data constructor.

**Order matters relative to definition.** A call is reduced using the rules that exist at that point in the program:

<MettaRunner>

```metta
!(respond me)              ; (respond me) — no rule yet
(= (respond me) ok)
!(respond me)              ; ok
```

</MettaRunner>

## Parameters and patterns

Rules take variables, and the bound values are substituted into the right-hand side:

<MettaRunner>

```metta
(= (duplicate $x) ($x $x))
!(duplicate A)     ; (A A)
```

</MettaRunner>

The left-hand side can have structure, so you get pattern matching for free:

<MettaRunner>

```metta
(= (swap (Pair $x $y)) (Pair $y $x))
!(swap (Pair A B)) ; (Pair B A)
```

</MettaRunner>

It is more general than functional-language matching, because the pattern can be any shape, and a variable may even repeat. A repeated variable only matches when both positions are equal:

<MettaRunner>

```metta
(= (check ($x $y $x)) ($x $y))
!(check (B A B))   ; (B A)
!(check (B A A))   ; (check (B A A)) — does not match, left unreduced
```

</MettaRunner>

## Several results

A head can have more than one rule, and they are not mutually exclusive. Evaluation is **nondeterministic**: every applicable rule contributes a result.

<MettaRunner>

```metta
(= (bin) 0)
(= (bin) 1)
!(bin)             ; 0 and 1, both
```

</MettaRunner>

This even applies when a specific rule and a general rule both match:

<MettaRunner>

```metta
(= (f special) caught)
(= (f $x) $x)
!(f A)             ; A
!(f special)       ; caught and special — both
```

</MettaRunner>

## Evaluation keeps going

A result is reduced further, for both symbolic and grounded steps:

<MettaRunner>

```metta
(= (square $x) (* $x $x))
!(square 3)        ; (square 3) -> (* 3 3) -> 9
```

</MettaRunner>

Arguments are normally evaluated before the call, just like in most languages:

<MettaRunner>

```metta
!(* (+ 1 2) (- 8 3))   ; 15
(= (square $x) (* $x $x))
!(square (+ 2 3))      ; 25
```

</MettaRunner>

That is the whole evaluation model: match a rule, substitute, reduce the result, repeat. Next we use it for repetition and choices: **[Recursion and control](/learn/evaluation/recursion)**.
