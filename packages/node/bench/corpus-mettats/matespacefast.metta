; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/matespacefast.metta for MeTTa-TS (Hyperon) conventions.

(= (rewriteK $t $n)
   (if (== $n 0)
       done
       (let* (($_1 (add-atom &self (num (M $t))))
              ($_2 (add-atom &self (num (W $t))))
              ($_3 (add-atom &self (num (C $t)))))
             ((rewriteK (M $t) (- $n 1))
              (rewriteK (W $t) (- $n 1))))))

;Apply the rewrites K times, then match:
(= (mate-space-demo $K)
   (let* (($s (add-atom &self (num Z)))
          ($g (rewriteK Z $K)))
          (match &self (num $1) (num $1))))

!(test (length (collapse (mate-space-demo 19))) 1572862)
