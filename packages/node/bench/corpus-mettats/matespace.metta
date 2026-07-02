; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/matespace.metta for MeTTa-TS (Hyperon) conventions.

(= (add-atom-no-duplicate $Space $Atom)
   (if (== () (collapse (once (match $Space $Atom $Atom))))
       (add-atom $Space $Atom)
       (empty)))

;Rewrite rules:
(= (expand)
   (case (match &self (num $t) $t) 
         (($t ((add-atom-no-duplicate &self (num (M $t)))
               (add-atom-no-duplicate &self (num (W $t))))))))

(= (mate)
   (case (match &self (num (M $t)) $t)
         (($t (case (once (match &self (num (W $t)) $t))
                    (($t (add-atom-no-duplicate &self (num (C $t))))))))))

;Apply expand K times:
(= (expandK $n)
   (if (== $n 0)
       done
       (let $temp1 (expand)
            (expandK (- $n 1)))))

;Apply expand K times then mate, then match:
(= (mate-space-demo $K)
   (let* (($s (add-atom &self (num Z)))
          ($g (expandK $K))
          ($h (mate)))
          (match &self (num $1) (num $1))))

!(test (length (collapse (mate-space-demo 390))) 1063919)
