<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { findLesson } from '../curriculum'
import { useProgress } from '../composables/progress'

const { page } = useData()
const { isDone } = useProgress()
const lesson = computed(() => findLesson(page.value.relativePath))
</script>

<template>
  <div v-if="lesson" class="lesson-header">
    <span class="badge" :data-section="lesson.section.id">
      {{ lesson.section.icon }} {{ lesson.section.label }} · {{ lesson.section.title }}
    </span>
    <span v-if="lesson.section.lessons.length > 1" class="meta">
      Bài {{ lesson.index }}/{{ lesson.section.lessons.length }}
    </span>
    <span class="meta">⏱ khoảng {{ lesson.minutes }} phút</span>
    <span v-if="isDone(lesson.link)" class="done">✓ Đã hoàn thành</span>
  </div>
</template>

<style scoped>
.lesson-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-bottom: 20px;
  font-size: 13px;
  line-height: 1.4;
}
.badge {
  padding: 3px 10px;
  border-radius: 999px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.badge[data-section='trung-cap'] {
  color: var(--k8s-c-mid);
  background: var(--k8s-c-mid-soft);
}
.badge[data-section='nang-cao'] {
  color: var(--k8s-c-adv);
  background: var(--k8s-c-adv-soft);
}
.badge[data-section='thuc-hanh'] {
  color: var(--k8s-c-proj);
  background: var(--k8s-c-proj-soft);
}
.meta {
  color: var(--vp-c-text-2);
}
.done {
  color: var(--vp-c-green-1);
  font-weight: 600;
}
</style>
