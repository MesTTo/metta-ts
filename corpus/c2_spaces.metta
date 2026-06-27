; SPDX-FileCopyrightText: 2026 TrueAGI Inc. and the hyperon-experimental contributors
;
; SPDX-License-Identifier: MIT

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; Spaces are also represented as grounded symbols in the program.
; Importing another script into a separate space
; TODO: replace symbol by string
!(import! &kb c2_spaces_kb)
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; We can `match` over `&self` or another space
!(assertEqualToResult
  (match &kb
    (, ($obj is $prop)
       ($prop is-a Color)
       ($obj is-a Planet))
    (Color of Planet $obj is $prop))
  ((Color of Planet Mars is Red)))

; The knowledge in `&kb` is not in `&self`
!(assertEqualToResult
  (match &self ($p is-a Color) $p)
  ())

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; Checking that grounded symbols from different spaces are compatible
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
!(assertEqual
  (match &kb
    (, (Venus orbit $x au)
       (Mars orbit $y au))
    (- $y $x))
  0.8)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; Different spaces can be used
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
(Ball is Red)
(Chair is High)

!(assertEqualToResult
  (match &kb ($prop is-a Color)
    (match &self ($obj is $prop)
       $obj))
  (Ball))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; We can import into `&self`
; TODO: replace symbol by string
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
!(import! &self c2_spaces_kb)
!(assertEqualToResult
  (match &self
    (, ($obj is $prop)
       ($prop is-a Color)
       ($obj is-a Planet))
    (Color of Planet $obj is $prop))
  ((Color of Planet Mars is Red)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; `fork-space` creates an independent child copy
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
!(bind! &fork_parent (new-space))
!(add-atom &fork_parent (fork-default A))
!(bind! &fork_child (fork-space &fork_parent))
!(add-atom &fork_child (fork-default B))
!(bind! &fork_grandchild (fork-space &fork_child))
!(remove-atom &fork_grandchild (fork-default B))
!(assertEqualToResult
  (match &fork_parent (fork-default $x) $x)
  (A))
!(assertEqualToResult
  (match &fork_child (fork-default $x) $x)
  (A B))
!(assertEqualToResult
  (match &fork_grandchild (fork-default $x) $x)
  (A))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; The same isolation contract holds for MORK-backed spaces
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
!(bind! &mork_fork_parent (new-mork-space))
!(add-atom &mork_fork_parent (fork-mork A))
!(bind! &mork_fork_child (fork-space &mork_fork_parent))
!(add-atom &mork_fork_child (fork-mork B))
!(bind! &mork_fork_grandchild (fork-space &mork_fork_child))
!(remove-atom &mork_fork_grandchild (fork-mork B))
!(assertEqualToResult
  (match &mork_fork_parent (fork-mork $x) $x)
  (A))
!(assertEqualToResult
  (match &mork_fork_child (fork-mork $x) $x)
  (A B))
!(assertEqualToResult
  (match &mork_fork_grandchild (fork-mork $x) $x)
  (A))
