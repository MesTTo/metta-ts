; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/selfprog.metta for MeTTa-TS (Hyperon) conventions.

(= (function1) OK)

!(remove-atom &self (= (function1) OK))

!(test (repr (function1)) "(function1)")

!(add-atom &self (= (function1) (OK)))

!(test (repr (function1)) "(OK)")
