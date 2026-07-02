; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/metta4_streams.metta for MeTTa-TS (Hyperon) conventions.

;nondeterministically returning integers withing range:
(= (range $K $N)
   (if (< $K $N)
       (superpose ($K (range (+ $K 1) $N)))
       (empty)))

;add every range item to space &s1 using metta4's for, an item returning False "breaks" the loopo:
!(forall (range 1 5)
         (|-> ($x)
              (add-atom &s1 (num $x)))) ;shortcuts when one returns False

;Add only one commited option: (select)
!(let $x (once (range 1 5))
         (add-atom &s2 (num $x)))

!(test (collapse (get-atoms &s1))
       ((num 1) (num 2) (num 3) (num 4)))

!(test (collapse (get-atoms &s2))
       ((num 1)))

(= (gen) 1)
(= (gen) 2)
(= (gen) 3)

!(test (foldall (|-> ($x $y) (+ $x $y)) (gen) 0) 6)

