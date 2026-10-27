<script setup lang="ts">
import { nextTick, onMounted, watch } from 'vue'
import { useRoute, withBase } from 'vitepress'
import { useProgress } from '../composables/progress'

const route = useRoute()
const { done, completed, percent, total } = useProgress()

// Đánh dấu ✓ cho các bài đã học trong sidebar. Dùng data-attribute vì Vue không quản lý
// thuộc tính này nên sẽ không ghi đè khi render lại link.
function decorateLinks() {
  const doneHrefs = new Set(done.value.map((link) => withBase(link)))
  document.querySelectorAll<HTMLAnchorElement>('.VPSidebar a.VPLink').forEach((a) => {
    const path = new URL(a.href, location.href).pathname.replace(/\.html$/, '')
    if (doneHrefs.has(path)) a.dataset.done = ''
    else delete a.dataset.done
  })
}

onMounted(() => nextTick(decorateLinks))
watch([() => route.path, done], () => nextTick(decorateLinks))
</script>

<template>
  <div class="sidebar-progress">
    <div class="row">
      <span>Tiến độ học</span>
      <span class="count">{{ completed }}/{{ total }} bài</span>
    </div>
    <div
      class="bar"
      role="progressbar"
      aria-label="Tiến độ học"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="fill" :style="{ width: percent + '%' }" />
    </div>
  </div>
</template>

<style scoped>
.sidebar-progress {
  padding: 18px 0 14px;
  border-bottom: 1px solid var(--vp-c-divider);
}
.row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}
.count {
  color: var(--vp-c-brand-1);
}
.bar {
  margin-top: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--vp-c-default-soft);
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--vp-c-brand-3), var(--k8s-c-teal));
  transition: width 0.4s ease;
}
</style>
