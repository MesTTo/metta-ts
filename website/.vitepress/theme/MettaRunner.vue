<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->
<script setup lang="ts">
// A live MeTTa sandbox. Because the whole interpreter is pure TypeScript, it runs entirely in the
// reader's browser: no server, no WASM. The engine and the editor are imported lazily on the client so
// they do not weigh down page load. Authors seed the editor by putting a MeTTa code block in the slot.
import { ref, onMounted, onBeforeUnmount } from "vue";
import { highlightMetta } from "./metta-highlight";

const props = defineProps<{ code?: string }>();
const src = ref(props.code ?? "");
const slot = ref<HTMLElement | null>(null);
const editor = ref<HTMLElement | null>(null);

const ran = ref(false);
const busy = ref(false);
const error = ref("");
const groups = ref<{ query: string; results: string[] }[]>([]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let jar: any;

function seedCode(): string {
  if (props.code) return props.code;
  if (slot.value) {
    const codeEl = slot.value.querySelector("pre code") ?? slot.value;
    const text = codeEl.textContent ?? "";
    if (text.trim()) return text.replace(/\n+$/, "");
  }
  return "";
}

onMounted(async () => {
  const seed = seedCode();
  src.value = seed;
  if (!editor.value) return;
  const { CodeJar } = await import("codejar");
  jar = CodeJar(editor.value, (el: HTMLElement) => {
    el.innerHTML = highlightMetta(el.textContent ?? "");
  });
  jar.updateCode(seed);
  jar.onUpdate((code: string) => {
    src.value = code;
  });
});

onBeforeUnmount(() => {
  if (jar) jar.destroy();
});

async function run(): Promise<void> {
  busy.value = true;
  error.value = "";
  groups.value = [];
  try {
    const { runProgram, format } = await import("@metta-ts/core");
    const results = runProgram(src.value);
    groups.value = results.map((r) => ({ query: format(r.query), results: r.results.map(format) }));
    ran.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    ran.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="metta-runner">
    <div ref="slot" style="display: none"><slot /></div>
    <div ref="editor" class="metta-editor" spellcheck="false"></div>
    <div class="metta-bar">
      <button class="metta-run" :disabled="busy" @click="run">{{ busy ? "Running…" : "Run" }}</button>
    </div>
    <pre v-if="error" class="metta-error">{{ error }}</pre>
    <div v-else-if="ran" class="metta-output">
      <div v-if="groups.length === 0" class="metta-empty">No <code>!</code>-queries to evaluate.</div>
      <div v-for="(g, i) in groups" :key="i" class="metta-line">
        <span class="metta-q">{{ g.query }}</span>
        <span class="metta-arrow">⇒</span>
        <span class="metta-r">[{{ g.results.join(", ") }}]</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.metta-runner {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  margin: 16px 0;
}
.metta-editor {
  padding: 12px 16px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--vp-c-text-1);
  background: var(--vp-code-block-bg);
  white-space: pre;
  overflow-x: auto;
  tab-size: 2;
  min-height: 1.6em;
}
.metta-editor:focus {
  outline: none;
}
.metta-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.metta-run {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
  border-radius: 6px;
  padding: 4px 16px;
  transition: opacity 0.2s;
}
.metta-run:disabled {
  opacity: 0.6;
}
.metta-output,
.metta-error {
  padding: 12px 16px;
  border-top: 1px solid var(--vp-c-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.7;
}
.metta-error {
  color: var(--vp-c-danger-1);
  white-space: pre-wrap;
  margin: 0;
}
.metta-empty {
  color: var(--vp-c-text-3);
}
.metta-arrow {
  color: var(--vp-c-text-3);
  margin: 0 8px;
}
.metta-r {
  color: var(--vp-c-brand-1);
}
</style>

<!-- Token colors for the editor's highlighted spans. Not scoped: CodeJar inserts these spans via
     innerHTML, so they would not carry the component's scope attribute. Colors are extracted from
     metta-lang.dev, which renders MeTTa with the GitHub Light/Dark themes. -->
<style>
:root {
  --mh-comment: #6a737d;
  --mh-string: #032f62;
  --mh-var: #e36209;
  --mh-at: #6f42c1;
  --mh-op: #d73a49;
  --mh-number: #005cc5;
  --mh-paren: #22863a;
}
.dark {
  --mh-comment: #8b949e;
  --mh-string: #a5d6ff;
  --mh-var: #ffa657;
  --mh-at: #d2a8ff;
  --mh-op: #ff7b72;
  --mh-number: #79c0ff;
  --mh-paren: #7ee787;
}
.metta-editor .mh-comment {
  color: var(--mh-comment);
}
.metta-editor .mh-string {
  color: var(--mh-string);
}
.metta-editor .mh-var,
.metta-editor .mh-spaceref {
  color: var(--mh-var);
}
.metta-editor .mh-at {
  color: var(--mh-at);
}
.metta-editor .mh-number {
  color: var(--mh-number);
}
.metta-editor .mh-control,
.metta-editor .mh-operator {
  color: var(--mh-op);
}
.metta-editor .mh-paren {
  color: var(--mh-paren);
}
</style>
