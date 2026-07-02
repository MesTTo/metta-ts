; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/meta_types.metta for MeTTa-TS (Hyperon) conventions.

!(test (get-metatype (foo 1 2)) Expression)
!(test (get-metatype (a b)) Expression)
!(test (get-metatype 1) Grounded)
; @metta-ts represents grounded *operators* (+, etc.) as Symbol atoms dispatched to host functions,
; while grounded *values* (numbers, strings, bools) are Grounded as in Hyperon. So `(get-metatype +)`
; is Symbol here. This is the one place the symbol-dispatch representation shows through get-metatype.
!(test (get-metatype +) Symbol)
!(test (get-metatype $x) Variable)
!(test (get-metatype a) Symbol)
