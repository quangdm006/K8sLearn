<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { findLesson } from '../curriculum'
import { useProgress } from '../composables/progress'

const { page } = useData()
const { isDone, toggle, sectionDone } = useProgress()
const lesson = computed(() => findLesson(page.value.relativePath))
const done = computed(() => !!lesson.value && isDone(lesson.value.link))
</script>

<template>
  <div v-if="lesson" class="lesson-complete" :class="{ done }">
    <div class="text">
      <p class="title">
        {{ done ? 'Bạn đã hoàn thành bài này 🎉' : 'Đã nắm vững nội dung bài này?' }}
      </p>
      <p class="sub">
        {{ lesson.section.label }} · {{ lesson.section.title }}: {{ sectionDone(lesson.section) }}/{{
          lesson.section.lessons.length
        }}
        bài đã hoàn thành
      </p>
    </div>
    <button type="button" class="btn" :aria-pressed="done" @click="toggle(lesson.link)">
      {{ done ? 'Bỏ đánh dấu' : '✓ Đánh dấu hoàn thành' }}
    </button>
  </div>
</template>

<style scoped>
.lesson-complete {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 20px;
  margin: 40px 0 24px;
  padding: 18px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  transition: border-color 0.25s, background-color 0.25s;
}
.lesson-complete.done {
  border-color: var(--vp-c-green-2);
  background: var(--vp-c-green-soft);
}
.title {
  margin: 0;
  font-weight: 600;
  font-size: 15px;
}
.sub {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--vp-button-brand-text);
  background: var(--vp-button-brand-bg);
  transition: background-color 0.2s;
}
.btn:hover {
  background: var(--vp-button-brand-hover-bg);
}
.done .btn {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}
.done .btn:hover {
  background: var(--vp-c-default-2);
}
</style>
