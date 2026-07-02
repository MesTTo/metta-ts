<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Free variables and nondeterminism

Two features make MeTTa feel different from ordinary functional languages: you can call a function with a **free variable**, and a function can return **many results**. Put together, they let you solve search problems by describing them.

## Querying by calling

You can pass a variable where a value would go, and MeTTa returns every right-hand side that matches, keeping the binding:

<MettaRunner>

```metta
(= (brother Mike) Tom)
(= (brother Sam) Bob)
!(brother $x)                      ; Tom and Bob
!((brother $x) is-brother-of $x)   ; (Tom is-brother-of Mike) and (Bob is-brother-of Sam)
```

</MettaRunner>

The second query is the interesting one: the binding for `$x` is not lost, so each result carries both the brother and who they are a brother of. A call with a free variable is, in effect, a query.

## Logic with free variables

Now combine that with boolean rules. Some facts and a rule about frogs:

<MettaRunner>

```metta
(= (croaks Fritz) True)
(= (eats-flies Fritz) True)
(= (croaks Sam) True)
(= (eats-flies Sam) False)

(= (frog $x) (and (croaks $x) (eats-flies $x)))
!(if (frog $x) ($x is-a-frog) ($x is-not-a-frog))
```

</MettaRunner>

Asking `(frog $x)` infers that Fritz is a frog and Sam is not. This is logic programming: you state rules and facts, then ask a question with a variable in it.

## Choosing and collecting

A nondeterministic value is just an expression with several results. `superpose` turns a tuple into such a choice, and `collapse` gathers all results back into one tuple:

<MettaRunner>

```metta
!(superpose (0 1))              ; 0 and 1
!(collapse (superpose (0 1)))   ; (, 0 1)
```

</MettaRunner>

`(empty)` is the opposite of a result: it evaluates to *no* results, which is how you prune a branch. It is the same as a function having no matching rule.

Nondeterminism flows through other calls. If you feed a nondeterministic argument to a function, the function runs once per value:

<MettaRunner>

```metta
(= (triple $x) ($x $x $x))
(= (bin) 0)
(= (bin) 1)
!(triple (bin))    ; (0 0 0) and (1 1 1)
```

</MettaRunner>

But beware where the choice happens. Each occurrence is evaluated independently, so two `(bin)` calls in a body multiply out:

<MettaRunner>

```metta
(= (bin) 0)
(= (bin) 1)
(= (bin2) ((bin) (bin)))
!(bin2)            ; (0 0), (0 1), (1 0), (1 1)
```

</MettaRunner>

## Search by generate-and-test

Recursion plus nondeterminism gives you search almost for free. A function that builds all binary lists of a given length:

<MettaRunner>

```metta
(= (bin) 0)
(= (bin) 1)
(= (gen-bin $n)
   (if (> $n 0)
       (:: (bin) (gen-bin (- $n 1)))
       ()))
!(gen-bin 3)       ; every binary list of length 3
```

</MettaRunner>

From there, the subset-sum problem is just "generate every selection, keep the ones that hit the target". A candidate is a binary list saying which numbers are taken; the sum of taken numbers is a scalar product:

<MettaRunner>

```metta
(= (bin) 0)
(= (bin) 1)
(= (gen-bin-list ()) ())
(= (gen-bin-list (:: $x $xs)) (:: (bin) (gen-bin-list $xs)))

(= (dot () ()) 0)
(= (dot (:: $x $xs) (:: $y $ys)) (+ (* $x $y) (dot $xs $ys)))

(= (solve $nums $sel $target)
   (if (== (dot $nums $sel) $target) $sel (empty)))

(= (nums) (:: 8 (:: 3 (:: 10 (:: 17 ())))))
!(solve (nums) (gen-bin-list (nums)) 20)   ; the selections summing to 20
```

</MettaRunner>

`gen-bin-list` proposes every selection nondeterministically, `solve` keeps a selection when its sum matches and prunes it with `(empty)` otherwise. You described the problem and got the search.

That completes the introduction to evaluation. From here you can dig into the standard library, types, or move to **[using MeTTa from TypeScript](/typescript/running-metta)**.
