; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/logicprogset.metta for MeTTa-TS (Hyperon) conventions.

(= (myf $M)
   (and (and (member a $M)
             (member b $M))
        (== (size-atom $M) 2)))

!(test (if (once (myf $M)) $M)
       (a b))
