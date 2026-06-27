; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/spaces.metta for MeTTa-TS (Hyperon) conventions.

(= (matchtrickery)
   (let* (($t1 (add-atom &self (foo a)))
          ($t2 (add-atom &self (foo b))))
         (match &self (foo $1) (bar $1))))

!(test (collapse (matchtrickery))
       ((bar a) (bar b)))
