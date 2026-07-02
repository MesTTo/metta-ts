; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/letlet.metta for MeTTa-TS (Hyperon) conventions.

(= (f)
   (let* ((($f1 $c1 3) (1 2 $d1)))
         ($f1 $c1 $d1)))

!(test (f)
       (1 2 3))
