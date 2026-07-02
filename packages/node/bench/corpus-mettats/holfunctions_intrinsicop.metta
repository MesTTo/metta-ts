; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/holfunctions_intrinsicop.metta for MeTTa-TS (Hyperon) conventions.

(= (mymap $f ()) ())
(= (mymap $f (cons $x $xs)) (cons ($f $x) (mymap $f $xs)))

(= (eq $a $b) (== $a $b))

!(test (mymap (== 1) (1 2 3)) (mymap (eq 1) (1 2 3)))
