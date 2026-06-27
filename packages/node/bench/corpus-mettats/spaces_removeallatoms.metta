; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/spaces_removeallatoms.metta for MeTTa-TS (Hyperon) conventions.

!(import! &self (library lib_spaces))

(friend tim tom)

(= (f $x) 42)

!(remove-all-atoms &self)

!(test (repr (remove-all-atoms &self))
       "(remove-all-atoms &self)")

!(test (repr (f 42))
       "(f 42)")

!(test (collapse (get-atoms &self))
       ())
