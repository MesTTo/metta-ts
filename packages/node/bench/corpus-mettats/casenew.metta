; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/casenew.metta for MeTTa-TS (Hyperon) conventions.

(= (wu1)
   (empty))

(= (wu2)
   (full))

(= (wu)
   (superpose ((wu1)
               (wu2))))

!(test (wu)
       (full))
