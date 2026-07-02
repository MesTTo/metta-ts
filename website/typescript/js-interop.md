<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# JavaScript interop

Grounded operations let MeTTa call *your* TypeScript functions. The JavaScript interop layer goes one step further: it lets MeTTa reach into the host runtime itself, calling global functions and methods and building JavaScript values, with no glue code. Enable it with `registerJsInterop`.

```ts
import { MeTTa, registerJsInterop } from "@metta-ts/hyperon";

const metta = new MeTTa();
registerJsInterop(metta);
```

## js-atom: resolve and call a global

`js-atom` takes a dotted path to a global and gives you back something callable:

```metta
!((js-atom "Math.abs") -5)        ; 5
!((js-atom "Math.max") 3 7 2)     ; 7
```

An unresolvable path is a hard error (a MeTTa `(Error ...)` atom), not a silent `undefined`, so a typo surfaces immediately.

## js-dot: call a method on a value

`js-dot` reads a method bound to its receiver and calls it:

```metta
!((js-dot "hello world" "toUpperCase"))   ; "HELLO WORLD"
```

## js-list and js-dict: build JavaScript values

`js-list` builds a JavaScript array and `js-dict` a JavaScript object, both usable by host methods:

```metta
; Array.prototype.join over a js-list
!((js-dot (js-list (5 1 3)) "join") "-")    ; "5-1-3"

; read a field of a js-dict
!(js-dot (js-dict (("a" 1) ("b" 2))) "b")   ; 2
```

## When to use which

Use a **grounded operation** (`registerOperation`) when you want to expose a specific, named TypeScript function to MeTTa with control over its behavior. Use **js interop** when you want MeTTa scripts to drive arbitrary host APIs directly, for quick glue or scripting. Both convert between atoms and JavaScript values with `atomToJs` / `jsToAtom`, which you can also call yourself.

That covers the TypeScript interop story. To write MeTTa in idiomatic, typed TypeScript rather than source strings, see the **[typed eDSL](/edsl/overview)**.
