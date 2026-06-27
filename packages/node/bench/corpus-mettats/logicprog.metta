; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/logicprog.metta for MeTTa-TS (Hyperon) conventions.

(= (successor b a) True)
(= (successor c b) True)
(= (successor d c) True)
(= (successor e d) True)
(= (successor f e) True)
(= (successor g f) True)

(= (later-in-alphabet $X $Y)
   (successor $X $Y))

(= (later-in-alphabet $X $Y)
   (and (successor $X $Z) (later-in-alphabet $Z $Y)))

;Alternative formulation of the previous function (still only with PeTTa though)
;(= (later-in-alphabet $X $Y)
;   (let $temp (successor $X $Z)
;        (later-in-alphabet $Z $Y)))

!(test (collapse ((later-in-alphabet d $1) $1))
       ((True c) (True b) (True a)))
