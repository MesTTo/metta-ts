; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/he_atomspace.metta for MeTTa-TS (Hyperon) conventions.


!(add-atom &self (= (addnormal) (+ 1 3)))
!(add-reduct &self (= (addreduct) (+ 1 3)))

; The two match tests are omitted: they rely on PeTTa wrapping a matched body in `quote` (PeTTa's match
; auto-quotes its result). In Hyperon the matched template is returned as data and evaluates in the test's
; actual position, with no quote.

!(get-type 1)

(: a A)
!(test (get-type-space &self a) A)

(hello world)
; PeTTa's lib_he redefines `unify` to query a space (is the pattern present?). Hyperon's `unify` is the
; minimal-MeTTa structural unifier — `&self` (a space) does not structurally unify with `(hello world)`.
; Written structurally, unify takes the then-branch on a match and the else-branch otherwise.
!(test (unify (hello world) (hello world) Yes No) Yes)
!(test (unify (hello world) (hello dream) Yes No) No)
