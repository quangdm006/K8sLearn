<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { CONTEXT, Cluster, SCHEMA, SERVER_VERSION, createInitialState } from '../playground/cluster'
import { DEFAULT_FILES } from '../playground/files'
import { complete, runCommand, type ShellContext, type ShellResult } from '../playground/kubectl'
import { MISSIONS } from '../playground/missions'
import type { ClusterState, FileMap, Line, Pod } from '../playground/types'

const STORAGE_KEY = 'k8s-learn:playground:v1'
const MAX_LINES = 2000
const QUICK = ['kubectl get pods', 'kubectl get all', 'kubectl get nodes -o wide', 'kubectl get events', 'help']

interface Saved {
  state: ClusterState
  files: FileMap
  done: Record<string, boolean>
}

const cluster = shallowRef<Cluster>()
const files = reactive<FileMap>({})
const done = reactive<Record<string, boolean>>({})
const output = ref<Line[]>([])
const input = ref('')
const running = ref(false)
const tab = ref<'missions' | 'files'>('missions')
const activeFile = ref('deployment.yaml')
const openMission = ref<string | null>(null)
const version = ref(0)
const termEl = ref<HTMLElement>()
const inputEl = ref<HTMLInputElement>()
const forwards = new Map<number, { pod: Pod; port: number; label: string }>()
const history: string[] = []
let historyIndex = 0
let stopStream: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined

const doneCount = computed(() => MISSIONS.filter((m) => done[m.id]).length)
const percent = computed(() => Math.round((doneCount.value / MISSIONS.length) * 100))
const fileNames = computed(() => Object.keys(files).sort())
const currentNs = computed(() => {
  void version.value
  return cluster.value?.state.currentNamespace ?? 'default'
})

function ctx(): ShellContext {
  return { cluster: cluster.value!, files, forwards }
}

function print(...lines: Line[]) {
  output.value.push(...lines)
  if (output.value.length > MAX_LINES) output.value.splice(0, output.value.length - MAX_LINES)
  nextTick(() => {
    if (termEl.value) termEl.value.scrollTop = termEl.value.scrollHeight
  })
}

function welcome() {
  print(
    { text: 'Chào mừng tới kubectl Playground! 🎉', kind: 'ok' },
    { text: `Đây là cluster MÔ PHỎNG (kind, 3 node, Kubernetes ${SERVER_VERSION}) chạy hoàn toàn trong trình duyệt.`, kind: 'info' },
    { text: 'Gõ "help" để xem lệnh được hỗ trợ, hoặc làm theo các nhiệm vụ ở khung bên cạnh.', kind: 'info' },
    { text: '' },
  )
}

// ----- lưu / nạp -----

function save() {
  if (!cluster.value) return
  try {
    const data: Saved = { state: cluster.value.state, files: { ...files }, done: { ...done } }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Không lưu được (chế độ riêng tư, hết dung lượng) — playground vẫn chạy bình thường.
  }
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 600)
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Saved
    return data?.state?.schema === SCHEMA ? data : null
  } catch {
    return null
  }
}

// ----- nhiệm vụ -----

function checkMissions() {
  if (!cluster.value) return
  const now = Date.now()
  MISSIONS.forEach((m, i) => {
    if (!done[m.id] && m.check(cluster.value!, now)) {
      done[m.id] = true
      print({ text: `🎯 Hoàn thành nhiệm vụ ${i + 1}: ${m.title}`, kind: 'ok' })
      if (doneCount.value === MISSIONS.length) {
        print({ text: '🏆 Bạn đã hoàn thành toàn bộ nhiệm vụ! Hãy thử các bài thực hành trên cluster kind thật nhé.', kind: 'ok' })
      }
      const next = MISSIONS.find((x) => !done[x.id])
      if (openMission.value === m.id) openMission.value = next?.id ?? null
      scheduleSave()
    }
  })
}

function toggleMission(id: string) {
  openMission.value = openMission.value === id ? null : id
}

function useHint(command: string) {
  input.value = command
  focusInput()
}

// ----- chạy lệnh -----

function execute(line: string) {
  if (!cluster.value || running.value) return
  print({ text: line, kind: 'cmd' })
  if (line.trim()) {
    if (history[history.length - 1] !== line) history.push(line)
  }
  historyIndex = history.length
  let res: ShellResult
  try {
    res = runCommand(line, ctx())
  } catch (e) {
    console.error(e)
    print({ text: `(playground) Lỗi mô phỏng: ${(e as Error).message}`, kind: 'err' })
    return
  }
  if (res.reset) {
    resetCluster()
    return
  }
  if (res.clear) output.value = []
  if (res.lines.length) print(...res.lines)
  if (res.openFile) {
    tab.value = 'files'
    activeFile.value = res.openFile
  }
  if (res.stream) {
    running.value = true
    stopStream = res.stream(
      (lines) => print(...lines),
      () => finishStream(),
    )
  }
  version.value++
  checkMissions()
  scheduleSave()
}

function finishStream() {
  stopStream?.()
  stopStream = null
  running.value = false
  version.value++
  checkMissions()
  focusInput()
}

function interrupt() {
  if (running.value) {
    print({ text: '^C' })
    finishStream()
  } else {
    print({ text: `${input.value}^C`, kind: 'cmd' })
    input.value = ''
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    const line = input.value
    input.value = ''
    execute(line)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (historyIndex > 0) input.value = history[--historyIndex] ?? ''
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (historyIndex < history.length) input.value = history[++historyIndex] ?? ''
  } else if (e.key === 'Tab') {
    e.preventDefault()
    const r = complete(input.value, ctx())
    if (r.options.length) {
      print({ text: input.value, kind: 'cmd' }, { text: r.options.join('   ') })
    }
    input.value = r.value
  } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
    e.preventDefault()
    interrupt()
  } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
    e.preventDefault()
    output.value = []
  }
}

function onGlobalKey(e: KeyboardEvent) {
  if (running.value && e.ctrlKey && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
    e.preventDefault()
    interrupt()
  }
}

function runQuick(command: string) {
  execute(command)
  focusInput()
}

function focusInput() {
  if (window.getSelection()?.toString()) return
  nextTick(() => inputEl.value?.focus({ preventScroll: true }))
}

// ----- tệp YAML -----

function insertSpaces(e: KeyboardEvent) {
  const area = e.target as HTMLTextAreaElement
  const { selectionStart: start, selectionEnd: end, value } = area
  files[activeFile.value] = `${value.slice(0, start)}  ${value.slice(end)}`
  nextTick(() => {
    area.selectionStart = area.selectionEnd = start + 2
  })
}

function applyActive() {
  execute(`kubectl apply -f ${activeFile.value}`)
}

function newFile() {
  const name = window.prompt('Tên tệp mới (ví dụ: my-app.yaml):', 'my-app.yaml')?.trim()
  if (!name) return
  if (!/^[\w.-]+$/.test(name)) {
    window.alert('Tên tệp chỉ gồm chữ, số, dấu chấm, gạch ngang và gạch dưới.')
    return
  }
  if (files[name] === undefined) files[name] = ''
  activeFile.value = name
}

function deleteFile() {
  if (!window.confirm(`Xóa tệp "${activeFile.value}"?`)) return
  delete files[activeFile.value]
  activeFile.value = fileNames.value[0] ?? ''
}

function restoreFiles() {
  if (!window.confirm('Khôi phục toàn bộ tệp mẫu? Các thay đổi trong tệp mẫu sẽ bị ghi đè.')) return
  Object.assign(files, DEFAULT_FILES)
  activeFile.value = 'deployment.yaml'
}

// ----- vòng đời -----

function resetCluster() {
  stopStream?.()
  stopStream = null
  running.value = false
  forwards.clear()
  cluster.value = new Cluster(createInitialState(Date.now()))
  for (const key of Object.keys(done)) delete done[key]
  openMission.value = MISSIONS[0].id
  output.value = []
  print({ text: 'Cluster đã được đặt lại về trạng thái ban đầu.', kind: 'ok' })
  welcome()
  save()
}

function confirmReset() {
  if (window.confirm('Đặt lại cluster? Mọi tài nguyên bạn đã tạo và tiến độ nhiệm vụ sẽ bị xóa (các tệp YAML được giữ nguyên).')) {
    resetCluster()
    focusInput()
  }
}

function fmt(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

watch(files, scheduleSave, { deep: true })

onMounted(() => {
  const saved = load()
  cluster.value = new Cluster(saved?.state ?? createInitialState(Date.now()))
  Object.assign(files, saved?.files ?? DEFAULT_FILES)
  Object.assign(done, saved?.done ?? {})
  openMission.value = MISSIONS.find((m) => !done[m.id])?.id ?? null
  if (files[activeFile.value] === undefined) activeFile.value = fileNames.value[0] ?? ''
  welcome()
  if (saved) print({ text: '(Đã khôi phục cluster và tiến độ từ lần trước — gõ "reset" hoặc bấm "Đặt lại cluster" để làm lại từ đầu.)', kind: 'info' }, { text: '' })
  timer = setInterval(() => {
    cluster.value?.tick()
    version.value++
    checkMissions()
  }, 1000)
  window.addEventListener('keydown', onGlobalKey)
  focusInput()
})

onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(saveTimer)
  stopStream?.()
  window.removeEventListener('keydown', onGlobalKey)
  save()
})
</script>

<template>
  <div class="kp">
    <header class="kp-header">
      <div>
        <h1 class="kp-title">kubectl Playground</h1>
        <p class="kp-sub">
          Cluster kind 3 node <strong>mô phỏng</strong> ngay trong trình duyệt: gõ lệnh như trên máy thật,
          quan sát Kubernetes phản ứng và hoàn thành các nhiệm vụ. Không cần cài đặt gì.
        </p>
      </div>
      <div class="kp-header-actions">
        <span class="kp-chip" title="Context hiện tại">⎈ {{ CONTEXT }}</span>
        <span class="kp-chip" title="Namespace mặc định">ns: {{ currentNs }}</span>
        <button type="button" class="kp-btn ghost" @click="confirmReset">↺ Đặt lại cluster</button>
      </div>
    </header>

    <div class="kp-main">
      <section class="kp-terminal" aria-label="Terminal">
        <div class="kp-term-bar">
          <span class="dot red" /><span class="dot yellow" /><span class="dot green" />
          <span class="kp-term-title">hocvien@may-cua-ban: ~ — kubectl ({{ CONTEXT }})</span>
        </div>
        <div ref="termEl" class="kp-term" @click="focusInput">
          <div role="log" aria-live="polite" aria-label="Kết quả lệnh">
            <div v-for="(line, i) in output" :key="i" class="kp-line" :class="line.kind">
              <template v-if="line.kind === 'cmd'"><span class="kp-prompt">$</span> {{ line.text }}</template>
              <template v-else>{{ line.text || ' ' }}</template>
            </div>
          </div>
          <div v-show="!running" class="kp-input-row">
            <span class="kp-prompt">$</span>
            <input
              ref="inputEl"
              v-model="input"
              class="kp-input"
              type="text"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="off"
              aria-label="Nhập lệnh"
              @keydown="onKey"
            />
          </div>
          <div v-if="running" class="kp-running">
            <span>Đang chạy… nhấn Ctrl+C để dừng</span>
            <button type="button" @click.stop="interrupt">■ Dừng</button>
          </div>
        </div>
        <div class="kp-quick">
          <span class="kp-quick-label">Thử nhanh:</span>
          <button v-for="q in QUICK" :key="q" type="button" :disabled="running" @click="runQuick(q)">{{ q }}</button>
        </div>
      </section>

      <aside class="kp-side">
        <div class="kp-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="tab === 'missions'" :class="{ active: tab === 'missions' }" @click="tab = 'missions'">
            🎯 Nhiệm vụ <span class="kp-count">{{ doneCount }}/{{ MISSIONS.length }}</span>
          </button>
          <button type="button" role="tab" :aria-selected="tab === 'files'" :class="{ active: tab === 'files' }" @click="tab = 'files'">
            📄 Tệp YAML <span class="kp-count">{{ fileNames.length }}</span>
          </button>
        </div>

        <div v-if="tab === 'missions'" class="kp-panel" role="tabpanel">
          <div class="kp-progress" aria-hidden="true"><div :style="{ width: percent + '%' }" /></div>
          <ol class="kp-missions">
            <li v-for="(m, i) in MISSIONS" :key="m.id" :class="{ done: done[m.id], open: openMission === m.id }">
              <button type="button" class="kp-m-head" :aria-expanded="openMission === m.id" @click="toggleMission(m.id)">
                <span class="kp-m-check">{{ done[m.id] ? '✓' : i + 1 }}</span>
                <span class="kp-m-title">{{ m.title }}</span>
                <span class="kp-m-caret" aria-hidden="true">›</span>
              </button>
              <div v-if="openMission === m.id" class="kp-m-body">
                <p v-html="fmt(m.detail)" />
                <p class="kp-m-hint-label">Gợi ý — bấm để chép vào terminal:</p>
                <div class="kp-hints">
                  <button v-for="h in m.hints" :key="h" type="button" @click="useHint(h)">
                    <code>{{ h }}</code>
                  </button>
                </div>
              </div>
            </li>
          </ol>
        </div>

        <div v-else class="kp-panel kp-files" role="tabpanel">
          <div class="kp-file-tabs">
            <button
              v-for="name in fileNames"
              :key="name"
              type="button"
              :class="{ active: name === activeFile }"
              @click="activeFile = name"
            >
              {{ name }}
            </button>
            <button type="button" class="kp-new" @click="newFile">+ Tệp mới</button>
          </div>
          <textarea
            v-if="activeFile && files[activeFile] !== undefined"
            v-model="files[activeFile]"
            class="kp-editor"
            spellcheck="false"
            :aria-label="`Nội dung tệp ${activeFile}`"
            @keydown.tab.exact.prevent="insertSpaces"
            @keydown.esc="($event.target as HTMLTextAreaElement).blur()"
          />
          <div class="kp-file-actions">
            <button type="button" class="kp-btn" :disabled="!activeFile || running" @click="applyActive">
              ▶ kubectl apply -f {{ activeFile }}
            </button>
            <button type="button" class="kp-btn ghost" :disabled="!activeFile" @click="deleteFile">Xóa tệp</button>
            <button type="button" class="kp-btn ghost" @click="restoreFiles">Khôi phục tệp mẫu</button>
          </div>
          <p class="kp-tip">
            Phím Tab chèn 2 dấu cách (YAML không chấp nhận ký tự Tab); Esc để rời khung soạn thảo.
            Tệp được lưu tự động trên trình duyệt.
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.kp {
  --kp-term-bg: #0d1117;
  --kp-term-fg: #e6edf3;
  --kp-term-dim: #8b949e;
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px 24px 48px;
}
.kp-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 24px;
  margin-bottom: 18px;
}
.kp-title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
}
.kp-sub {
  margin: 6px 0 0;
  max-width: 760px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}
.kp-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.kp-chip {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.kp-btn {
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-button-brand-text);
  background: var(--vp-button-brand-bg);
  transition: background-color 0.2s;
}
.kp-btn:hover:not(:disabled) {
  background: var(--vp-button-brand-hover-bg);
}
.kp-btn.ghost {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}
.kp-btn.ghost:hover:not(:disabled) {
  background: var(--vp-c-default-2);
}
.kp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.kp-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  align-items: start;
}
@media (max-width: 1100px) {
  .kp-main {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* Terminal */
.kp-terminal {
  min-width: 0;
  border-radius: 12px;
  overflow: hidden;
  background: var(--kp-term-bg);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.kp-term-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
}
.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}
.dot.red {
  background: #ff5f57;
}
.dot.yellow {
  background: #febc2e;
}
.dot.green {
  background: #28c840;
}
.kp-term-title {
  margin-left: 8px;
  font-size: 12px;
  color: var(--kp-term-dim);
  font-family: var(--vp-font-family-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kp-term {
  height: 560px;
  overflow: auto;
  padding: 12px 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.55;
  color: var(--kp-term-fg);
  cursor: text;
}
@media (max-width: 640px) {
  .kp {
    padding: 16px 16px 40px;
  }
  .kp-term {
    height: 440px;
    font-size: 12px;
  }
}
.kp-line {
  white-space: pre;
  min-height: 1.55em;
}
.kp-line.cmd {
  color: #ffffff;
  margin-top: 6px;
}
.kp-line.err {
  color: #ff7b72;
}
.kp-line.info {
  color: #79c0ff;
}
.kp-line.warn {
  color: #e3b341;
}
.kp-line.ok {
  color: #7ee787;
  white-space: pre-wrap;
}
.kp-prompt {
  color: #7ee787;
  font-weight: 700;
  user-select: none;
}
.kp-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.kp-input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #ffffff;
  font: inherit;
  caret-color: #7ee787;
}
@media (max-width: 640px) {
  .kp-input {
    font-size: 16px; /* tránh iOS tự phóng to khi gõ */
  }
}
.kp-running {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  color: #e3b341;
}
.kp-running button {
  padding: 2px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: #ffffff;
  background: #30363d;
}
.kp-quick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: #161b22;
  border-top: 1px solid #30363d;
}
.kp-quick-label {
  font-size: 12px;
  color: var(--kp-term-dim);
}
.kp-quick button {
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  color: #c9d1d9;
  background: #21262d;
  border: 1px solid #30363d;
}
.kp-quick button:hover:not(:disabled) {
  border-color: #58a6ff;
}
.kp-quick button:disabled {
  opacity: 0.5;
}

/* Khung bên */
.kp-side {
  min-width: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  overflow: hidden;
}
.kp-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--vp-c-divider);
}
.kp-tabs button {
  padding: 12px 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  border-bottom: 2px solid transparent;
}
.kp-tabs button.active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
}
.kp-count {
  margin-left: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--vp-c-default-soft);
}
.kp-panel {
  padding: 14px;
  max-height: 640px;
  overflow: auto;
}
.kp-progress {
  height: 6px;
  margin-bottom: 12px;
  border-radius: 999px;
  background: var(--vp-c-default-soft);
  overflow: hidden;
}
.kp-progress div {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--vp-c-brand-3), var(--k8s-c-teal));
  transition: width 0.4s ease;
}
.kp-missions {
  list-style: none;
  margin: 0;
  padding: 0;
}
.kp-missions li {
  margin-bottom: 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
}
.kp-missions li.done {
  border-color: var(--vp-c-green-2);
}
.kp-m-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  text-align: left;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.kp-m-check {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
}
li.done .kp-m-check {
  color: #fff;
  border-color: var(--vp-c-green-2);
  background: var(--vp-c-green-2);
}
.kp-m-title {
  flex: 1;
}
li.done .kp-m-title {
  color: var(--vp-c-text-2);
}
.kp-m-caret {
  color: var(--vp-c-text-3);
  transition: transform 0.2s;
}
li.open .kp-m-caret {
  transform: rotate(90deg);
}
.kp-m-body {
  padding: 0 12px 12px 42px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}
.kp-m-body p {
  margin: 0 0 8px;
}
.kp-m-body :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}
.kp-m-hint-label {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.kp-hints {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kp-hints button {
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px dashed var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  overflow-wrap: anywhere;
}
.kp-hints button:hover {
  border-color: var(--vp-c-brand-1);
}
.kp-hints code {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-brand-1);
  background: none !important;
  padding: 0 !important;
}
.kp-file-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.kp-file-tabs button {
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
  background: var(--vp-c-default-soft);
}
.kp-file-tabs button.active {
  color: var(--vp-button-brand-text);
  background: var(--vp-button-brand-bg);
}
.kp-file-tabs .kp-new {
  color: var(--vp-c-brand-1);
  background: transparent;
  border: 1px dashed var(--vp-c-brand-1);
}
.kp-editor {
  display: block;
  width: 100%;
  min-height: 360px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.55;
  color: var(--kp-term-fg);
  background: var(--kp-term-bg);
  resize: vertical;
  tab-size: 2;
  white-space: pre;
}
.kp-editor:focus {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 1px;
}
.kp-file-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.kp-tip {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--vp-c-text-3);
}
</style>
