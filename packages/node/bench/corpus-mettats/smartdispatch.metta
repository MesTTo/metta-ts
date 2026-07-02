; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/smartdispatch.metta for MeTTa-TS (Hyperon) conventions.

(= (f $x)
   (* $x 2))

(= (g $f $x)
   (justdata $f $x))

(= (h $f $x)
   ($f $x))

(= (notjustdata $x)
   f)

(= (datawithnondatacomponent)
   ((lol (f 42))))

!(test ((f 21) (g f 2) (h f 2) ((notjustdata 42) 21) (datawithnondatacomponent))
       (42 (justdata f 2) 4 42 ((lol 84))))
