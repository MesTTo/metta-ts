<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Main concepts

> This Learn MeTTa track follows the official tutorials at [metta-lang.dev](https://metta-lang.dev/docs/learn/learn.html). It teaches the same concepts (main concepts, basic evaluation, recursion, nondeterminism) adapted to run in this engine. For the canonical material, read the originals there.

A MeTTa program lives inside a **space**: a database of atoms with a query engine over it. A program holds both knowledge (facts) and code (rules), and because code is just atoms too, a program can inspect and rewrite itself. If you have used Prolog, the idea of a program as a queryable knowledge base will feel familiar; MeTTa takes it further and makes everything, including the rules, ordinary data.

## The four kinds of atoms

Everything in a space is an atom, and there are exactly four kinds.

A **Symbol** is a name standing for some concept: `A`, `f`, `parent`, `known?`. Two symbols with the same name are the same concept. Almost any string can be a symbol.

An **Expression** groups other atoms in parentheses, Scheme-style: `(f A)`, `(parent Tom Bob)`, `(implies (human Socrates) (mortal Socrates))`. Expressions nest freely, so an expression is really a tree.

A **Variable** is written with a leading `$`: `$x`, `$_`, `$thing`. Variables turn an expression into a pattern. A pattern like `(parent $x Bob)` gets its meaning when it is matched against other atoms, binding `$x` to whatever makes the match succeed.

A **Grounded** atom wraps sub-symbolic data: a concrete value, a collection, or an operation. The numbers and arithmetic you use are grounded: in `(+ 1 2)`, the `+` is a grounded operation and `1` and `2` are grounded values. Grounded atoms are how MeTTa reaches into the host language, and in MeTTa TS that host is TypeScript, so a grounded atom can hold any TypeScript value.

## Facts versus evaluation

A MeTTa script is read one atom at a time. An atom on its own is **added to the space**. An atom prefixed with `!` is **evaluated immediately**, and its result is printed rather than stored. Comments start with `;`.

<MettaRunner>

```metta
; added to the space (a fact)
(Likes Alice Pizza)

; evaluated and printed
!(+ 1 2)        ; 3
```

</MettaRunner>

The first line stores a fact. The second computes `3` and shows it. Nothing about `(Likes Alice Pizza)` is evaluated; it just sits in the space as knowledge you can query later.

## Special symbols

Three symbols are not grounded operations but are still treated specially by the interpreter, because they shape how a program is evaluated and typed.

The **equality** symbol `=` defines evaluation rules. Read `(= lhs rhs)` as "`lhs` can be reduced to `rhs`". This is how you define what amounts to a function.

The **colon** symbol `:` declares a type, as in `(: Socrates Human)`.

The **arrow** symbol `->` builds a function type, as in `(: greet (-> Symbol Symbol))`.

You will use `=` constantly, and meet `:` and `->` when you reach [types](/learn/evaluation/main-concepts). They are ordinary symbols, but the interpreter knows what to do with them.

## Types and metatypes

MeTTa has optional typing, close to gradual dependent types. Untyped expressions have the type `%Undefined%`; other types are just symbols and expressions you declare. On top of that sit four **metatypes**, `Symbol`, `Variable`, `Grounded`, and `Expression`, which let a program reason about the shape of atoms themselves. Types are covered in their own track; for now it is enough to know they are optional and that you can write plenty of MeTTa without them.

Next, let us actually evaluate things: **[Basic evaluation](/learn/evaluation/basic-evaluation)**.
