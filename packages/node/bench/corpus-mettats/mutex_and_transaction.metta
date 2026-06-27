; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/mutex_and_transaction.metta for MeTTa-TS (Hyperon) conventions.
;
; `transaction` is @metta-ts's TS-native concurrency extension (PeTTa has it built in), so the program
; imports the `concurrency` module. The import brings `transaction`'s `(-> Atom …)` signature into scope,
; which makes its body Atom-typed (evaluated lazily under the snapshot) so a failing branch rolls back;
; without it the body would run before the snapshot is taken and the increment would not be undone.
; @metta-ts's real mutex is the async-only `with-mutex`, which the synchronous benchmark cannot drive, so
; `with_mutex` here stays a plain wrapper — single-threaded there is no race and only the increment is tested.
!(import! &self concurrency)

!(add-atom &temp (cnt 37))

;This only works predictable single-threaded, else there is a data race:
(= (sloppyinc)
   (match &temp (cnt $x)
          ((remove-atom &temp (cnt $x))
           (let $inc (+ $x 1)
                     (add-atom &temp (cnt $inc))))))

;To protect from data reace we can use a mutex:
(= (mutexinc)
   (with_mutex testmutex
               (match &temp (cnt $x)
                      ((remove-atom &temp (cnt $x))
                       (let $inc (+ $x 1)
                            (add-atom &temp (cnt $inc)))))))

;Additionally we support transactions, the following illlustrates that remove-atom is undone if the nondet branch fails:
(= (Transaction_rollback_fail_to_inc)
   (transaction (match &temp (cnt $x)
                       ((remove-atom &temp (cnt $x))
                        (let $inc (+ $x 1)
                             (add-atom &temp (cnt $inc)))
                        (empty)))))

;even though swipl is threadsafe and will also not deadlock, this would cause aforementioned race condition between reading and writing:
;!(hyperpose ((sloppyinc) (sloppyinc) (sloppyinc) (sloppyinc) (sloppyinc)))

;while this is fine as all places modifying the (cnt $n) relation simultaneously (mutexinc only in this case) use the same mutex:
!(hyperpose ((mutexinc) (mutexinc) (mutexinc) (mutexinc) (mutexinc)))
!(test (collapse (get-atoms &temp)) ((cnt 42)))

;This won't affect the cnt since the transaction is setup to fail:
!(Transaction_rollback_fail_to_inc)
!(test (collapse (get-atoms &temp)) ((cnt 42)))
