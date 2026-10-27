<script setup lang="ts">
import { withBase } from 'vitepress'
import { sections, totalMinutes } from '../curriculum'
import { useProgress } from '../composables/progress'

const { isDone, quizResult, sectionDone, completed, percent, nextLesson, resetAll, total } =
  useProgress()

const hours = Math.round(totalMinutes / 60)
const sectionPercent = (s: (typeof sections)[number]) =>
  Math.round((sectionDone(s) / s.lessons.length) * 100)

function confirmReset() {
  if (window.confirm('Xóa toàn bộ tiến độ và điểm quiz đã lưu trên trình duyệt này?')) resetAll()
}
</script>

<template>
  <div class="roadmap">
    <div class="summary">
      <div class="summary-text">
        <p class="big">
          {{ completed }}<span>/{{ total }} bài · {{ percent }}%</span>
        </p>
        <p class="sub">Tổng thời lượng ước tính khoảng {{ hours }} giờ học và thực hành.</p>
        <div class="bar" aria-hidden="true"><div :style="{ width: percent + '%' }" /></div>
      </div>
      <div class="summary-actions">
        <a v-if="nextLesson" class="continue" :href="withBase(nextLesson.link)">
          {{ completed ? 'Học tiếp' : 'Bắt đầu' }}: {{ nextLesson.title }} →
        </a>
        <p v-else class="finished">🎉 Bạn đã hoàn thành toàn bộ lộ trình!</p>
        <button v-if="completed" type="button" class="reset" @click="confirmReset">
          Xóa tiến độ
        </button>
      </div>
    </div>

    <div class="sections">
      <section v-for="s in sections" :key="s.id" class="section" :data-section="s.id">
        <div class="section-head">
          <span class="icon" aria-hidden="true">{{ s.icon }}</span>
          <div class="section-title">
            <span class="label">{{ s.label }}</span>
            <span class="name">{{ s.title }}</span>
          </div>
          <span class="count">{{ sectionDone(s) }}/{{ s.lessons.length }}</span>
        </div>
        <p class="desc">{{ s.summary }}</p>
        <div class="bar small" aria-hidden="true">
          <div :style="{ width: sectionPercent(s) + '%' }" />
        </div>
        <ol class="lessons">
          <li v-for="(l, i) in s.lessons" :key="l.slug">
            <a
              :href="withBase(`/${s.id}/${l.slug}`)"
              :class="{ done: isDone(`/${s.id}/${l.slug}`) }"
            >
              <span class="check">{{ isDone(`/${s.id}/${l.slug}`) ? '✓' : i + 1 }}</span>
              <span class="title">{{ l.title }}</span>
              <span v-if="quizResult(`/${s.id}/${l.slug}`)" class="quiz">
                quiz {{ quizResult(`/${s.id}/${l.slug}`)!.score }}/{{
                  quizResult(`/${s.id}/${l.slug}`)!.total
                }}
              </span>
              <span class="min">{{ l.minutes }}′</span>
            </a>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>

<style scoped>
.roadmap {
  margin: 24px 0;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  padding: 20px 22px;
  border-radius: 14px;
  border: 1px solid var(--vp-c-divider);
  background: linear-gradient(135deg, var(--vp-c-brand-soft), transparent 70%), var(--vp-c-bg-soft);
}
.summary-text {
  flex: 1 1 260px;
}
.big {
  margin: 0;
  font-size: 34px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--vp-c-brand-1);
}
.big span {
  font-size: 15px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}
.sub {
  margin: 6px 0 10px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.bar {
  height: 8px;
  border-radius: 999px;
  background: var(--vp-c-default-soft);
  overflow: hidden;
}
.bar.small {
  height: 5px;
  margin: 10px 0 6px;
}
.bar > div {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--vp-c-brand-3), var(--k8s-c-teal));
  transition: width 0.4s ease;
}
.summary-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.continue {
  display: inline-block;
  padding: 10px 18px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 14px;
  text-decoration: none !important;
  color: var(--vp-button-brand-text) !important;
  background: var(--vp-button-brand-bg);
  transition: background-color 0.2s;
}
.continue:hover {
  background: var(--vp-button-brand-hover-bg);
}
.finished {
  margin: 0;
  font-weight: 600;
}
.reset {
  font-size: 12px;
  color: var(--vp-c-text-3);
  text-decoration: underline;
}
.reset:hover {
  color: var(--vp-c-danger-1);
}
.sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.section {
  padding: 18px 18px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
}
.section-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.icon {
  font-size: 26px;
}
.section-title {
  display: flex;
  flex-direction: column;
  flex: 1;
}
.label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-3);
}
.name {
  font-size: 18px;
  font-weight: 700;
}
.count {
  font-weight: 700;
  color: var(--vp-c-brand-1);
}
.desc {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}
.lessons {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
}
.lessons li {
  margin: 0;
}
.lessons a {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 6px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  text-decoration: none !important;
  color: var(--vp-c-text-1) !important;
  transition: background-color 0.2s;
}
.lessons a:hover {
  background: var(--vp-c-default-soft);
}
.check {
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
.lessons a.done .check {
  color: #fff;
  border-color: var(--vp-c-green-2);
  background: var(--vp-c-green-2);
}
.lessons a.done .title {
  color: var(--vp-c-text-2);
}
.title {
  flex: 1;
}
.quiz {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.min {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
</style>
