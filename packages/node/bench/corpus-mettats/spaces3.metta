; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/spaces3.metta for MeTTa-TS (Hyperon) conventions.

!(add-atom &wuspace (wu))
!(add-atom &wuspace (wu 42))

!(test (collapse (match &wuspace ($1) ($1))) ((wu)))
!(test (collapse (match &wuspace ($1) (hu $1))) ((hu wu)))
!(test (collapse (match &wuspace ($1) $1)) (wu))
!(test (msort (collapse (match &wuspace $1 $1))) (msort (collapse (get-atoms &wuspace))))
!(test (msort (collapse (match &wuspace $1 (wu $1)))) ((wu (wu)) (wu (wu 42))))
