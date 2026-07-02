; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/recursive_types.metta for MeTTa-TS (Hyperon) conventions.

(: blacksmith (-> Metal Sword))
(: blacksmith (-> Metal Paperclip))
(: iron Metal)
(: gold Metal)

!(test (get-type iron) Metal)
!(test (collapse (get-type blacksmith)) ((-> Metal Sword) (-> Metal Paperclip)))
!(test (collapse (get-type (blacksmith iron))) (Sword Paperclip))
!(test (collapse (get-type (iron blacksmith))) ((Metal (-> Metal Sword)) (Metal (-> Metal Paperclip))))
