; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/matespace2.metta for MeTTa-TS (Hyperon) conventions.

(= (add-atom-no-duplicate $Space $Atom)
   (if (== () (collapse (once (match $Space $Atom $Atom))))
       (add-atom $Space $Atom)
       (empty)))

;Rewrite rules:
(= (expand)
   (case (superpose (collapse (match &self (num $t) $t)))
         (($t ((add-atom-no-duplicate &self (num (M $t)))
               (add-atom-no-duplicate &self (num (W $t))))))))

(= (mate)
   (case (superpose (collapse (match &self (num (M $t)) $t)))
         (($t (case (once (match &self (num (W $t)) $t))
                    (($t (add-atom-no-duplicate &self (num (C $t))))))))))

;Apply expand and mate K times:
(= (rewriteK $n)
   (if (== $n 0)
       done
       (let* (($temp1 (expand))
              ($temp2 (mate)))
             (rewriteK (- $n 1)))))

;Apply the rewrites K times, then match:
(= (mate-space-demo $K)
   (let* (($s (add-atom &self (num Z)))
          ($g (rewriteK $K)))
          (match &self (num $1) (num $1))))

!(test (length (collapse (mate-space-demo 80))) 1297533)
