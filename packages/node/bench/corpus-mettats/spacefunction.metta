; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/spacefunction.metta for MeTTa-TS (Hyperon) conventions.

!(add-atom &self (= (f $x $y) (+ $x $y)))
!(add-atom &self (= (g $x $y) (+ $x $y)))
!(remove-atom &self (= (f $x $y) (+ $x $y)))
!(test (f 3 4) (f 3 4))
!(test (g 3 4) 7)

!(add-atom &self (my test))
!(remove-atom &self (my test))
!(test (collapse (match &self (my test) (my test))) ())
