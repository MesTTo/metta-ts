; SPDX-FileCopyrightText: 2026 MesTTo
;
; SPDX-License-Identifier: MIT

; A tiny knowledge base queried with `match` over the &self space, plus nondeterminism.
(Parent Tom Bob)
(Parent Bob Ann)
(Parent Bob Pat)

; Grandparent via a conjunctive match.
(= (grandparent $g $c)
   (match &self (, (Parent $g $p) (Parent $p $c)) ($g $c)))

!(match &self (Parent Bob $child) $child)   ; [Bob's children: Ann, Pat]
!(grandparent Tom $who)                     ; [(Tom Ann) (Tom Pat)]
