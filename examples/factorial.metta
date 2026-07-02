; SPDX-FileCopyrightText: 2026 MesTTo
;
; SPDX-License-Identifier: MIT

; Factorial via the minimal `unify` instruction (single rule, no divergence).
; `unify` and the arithmetic ops come from the standard prelude.
(= (fact $n) (unify $n 0 1 (* $n (fact (- $n 1)))))

!(fact 5)    ; [120]
!(fact 10)   ; [3628800]
