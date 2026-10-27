<script lang="ts">
// Mermaid không chịu được nhiều lần render song song, nên xếp hàng các lần vẽ.
let queue: Promise<unknown> = Promise.resolve()
let seq = 0

const palette = {
  light: {
    primaryColor: '#e8effd',
    primaryBorderColor: '#326ce5',
    primaryTextColor: '#1b1b1f',
    secondaryColor: '#e3f6f3',
    tertiaryColor: '#f6f6f7',
    lineColor: '#67676c',
    background: '#ffffff',
  },
  dark: {
    darkMode: true,
    primaryColor: '#1f2b47',
    primaryBorderColor: '#6b98f7',
    primaryTextColor: '#dfdfd6',
    secondaryColor: '#173430',
    tertiaryColor: '#202127',
    lineColor: '#98989f',
    background: '#1b1b1f',
  },
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

const props = defineProps<{ code: string }>()
const { isDark } = useData()
const svg = ref('')
const failed = ref(false)
const zoomed = ref(false)
const closeBtn = ref<HTMLButtonElement>()

// SVG của mermaid có width="100%" + max-width = kích thước gốc. Khi phóng to, đặt chiều rộng
// rõ ràng (gấp 1,5 lần kích thước gốc, tối đa bằng màn hình) để SVG không co về 0.
const overlayWidth = computed(() => {
  const match = /max-width:\s*([\d.]+)px/.exec(svg.value)
  const natural = match ? parseFloat(match[1]) : 800
  return `${Math.round(natural * 1.5)}px`
})

function render() {
  const source = decodeURIComponent(props.code)
  const dark = isDark.value
  const job = queue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      themeVariables: { ...(dark ? palette.dark : palette.light), fontSize: '15px' },
      flowchart: { nodeSpacing: 32, rankSpacing: 40, padding: 10 },
    })
    const { svg } = await mermaid.render(`mermaid-${++seq}`, source)
    return svg
  })
  queue = job.catch(() => undefined)
  job.then(
    (out) => {
      svg.value = out
      failed.value = false
    },
    (err) => {
      failed.value = true
      console.error('[mermaid]', err)
    },
  )
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') zoomed.value = false
}

watch(zoomed, async (open) => {
  document.documentElement.style.overflow = open ? 'hidden' : ''
  if (open) {
    window.addEventListener('keydown', onKey)
    await nextTick()
    closeBtn.value?.focus()
  } else {
    window.removeEventListener('keydown', onKey)
  }
})

onMounted(render)
watch(isDark, render)
onBeforeUnmount(() => {
  if (zoomed.value) zoomed.value = false
  window.removeEventListener('keydown', onKey)
  document.documentElement.style.overflow = ''
})
</script>

<template>
  <div class="mermaid-diagram">
    <template v-if="svg">
      <button type="button" class="zoom" title="Phóng to sơ đồ" @click="zoomed = true">
        ⤢ Phóng to
      </button>
      <div class="svg" v-html="svg" />
    </template>
    <pre v-else-if="failed" class="error">Không vẽ được sơ đồ này.</pre>
    <div v-else class="loading">Đang vẽ sơ đồ…</div>

    <Teleport to="body">
      <div
        v-if="zoomed"
        class="mermaid-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Sơ đồ phóng to"
        @click.self="zoomed = false"
      >
        <button ref="closeBtn" type="button" class="close" @click="zoomed = false">
          ✕ Đóng (Esc)
        </button>
        <div class="overlay-svg" :style="{ width: overlayWidth }" v-html="svg" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mermaid-diagram {
  position: relative;
  margin: 16px 0;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  overflow-x: auto;
}
.svg {
  display: flex;
  justify-content: center;
}
.svg :deep(svg) {
  max-width: 100%;
  height: auto;
}
/* Mermaid đo kích thước nhãn bên ngoài .vp-doc; trả lại style gốc để chữ không bị cắt. */
.svg :deep(p),
.overlay-svg :deep(p) {
  margin: 0;
  line-height: inherit;
}
.zoom {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  opacity: 0;
  transition: opacity 0.2s;
}
.mermaid-diagram:hover .zoom,
.zoom:focus-visible {
  opacity: 1;
}
@media (hover: none) {
  .zoom {
    opacity: 1;
  }
}
.loading,
.error {
  display: grid;
  place-items: center;
  min-height: 120px;
  margin: 0;
  font-size: 13px;
  color: var(--vp-c-text-3);
  background: transparent;
}
.mermaid-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px 16px 16px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
}
.overlay-svg {
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  padding: 24px;
  border-radius: 12px;
  background: var(--vp-c-bg);
}
.overlay-svg :deep(svg) {
  display: block;
  width: 100% !important;
  max-width: none !important;
  height: auto;
}
.close {
  position: absolute;
  top: 12px;
  right: 16px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
}
.close:hover {
  background: rgba(255, 255, 255, 0.25);
}
</style>
