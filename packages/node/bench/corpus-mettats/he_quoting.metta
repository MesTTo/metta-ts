; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/he_quoting.metta for MeTTa-TS (Hyperon) conventions.


!(test (quote (+ 1 2)) (quote (+ 1 2)))

!(test (eval (+ 1 2)) 3)

!(test (unquote (quote (+ 1 2))) 3)

!(test (repr (unquote 42)) "(unquote 42)")

!(test (noreduce-eq (+ 1 2) (+ 1 2)) True)

!(test (noreduce-eq (+ 1 2) 3) False)
