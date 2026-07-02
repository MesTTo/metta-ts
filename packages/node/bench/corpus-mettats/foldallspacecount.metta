; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/foldallspacecount.metta for MeTTa-TS (Hyperon) conventions.

(foo 1)
(foo 2)
(foo 3)

(= (countitem) (let $x (match &self (foo $1) (foo $1)) 1))
(= (merge $a $b) (+ $a $b))
(= (spacecount $x) (foldall merge (countitem) 0))

!(test (foldall merge (countitem) 0) 3)
