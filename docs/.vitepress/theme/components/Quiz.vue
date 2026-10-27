<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useData } from 'vitepress'
import { findLesson } from '../curriculum'
import { useProgress } from '../composables/progress'

// Câu hỏi khai báo trong frontmatter của bài:
// quiz:
//   - q: "Câu hỏi"
//     options: ["A", "B", "C"]
//     answer: 1          # chỉ số đáp án đúng, bắt đầu từ 0
//     explain: "Giải thích"
interface Question {
  q: string
  options: string[]
  answer: number
  explain?: string
}

const LETTERS = 'ABCDEFGH'

const { frontmatter, page } = useData()
const { saveQuiz, quizResult } = useProgress()

/**
 * Xáo thứ tự đáp án theo một hạt giống lấy từ nội dung câu hỏi: thứ tự ổn định giữa server và
 * trình duyệt (không lệch hydration) và giữa các lần tải trang, nhưng đáp án đúng không còn
 * dồn vào một vị trí như khi viết trong frontmatter.
 */
function shuffledOrder(seedText: string, length: number): number[] {
  let seed = 0x811c9dc5
  for (let i = 0; i < seedText.length; i++) seed = Math.imul(seed ^ seedText.charCodeAt(i), 0x01000193)
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const order = Array.from({ length }, (_, i) => i)
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

const questions = computed<Question[]>(() =>
  (Array.isArray(frontmatter.value.quiz) ? (frontmatter.value.quiz as Question[]) : []).map((q) => {
    const order = shuffledOrder(q.q, q.options.length)
    return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) }
  }),
)
const lesson = computed(() => findLesson(page.value.relativePath))
const best = computed(() => (lesson.value ? quizResult(lesson.value.link) : undefined))

const picked = reactive<Record<number, number>>({})
const answered = (qi: number) => picked[qi] !== undefined

const score = computed(() =>
  questions.value.reduce((sum, q, i) => sum + (picked[i] === q.answer ? 1 : 0), 0),
)
const finished = computed(
  () =>
    questions.value.length > 0 && questions.value.every((_, i) => answered(i)),
)
const verdict = computed(() => {
  const ratio = score.value / questions.value.length
  if (ratio === 1) return 'Xuất sắc! Bạn đã sẵn sàng cho bài tiếp theo.'
  if (ratio >= 0.6) return 'Khá tốt! Xem lại giải thích của những câu sai nhé.'
  return 'Nên đọc lại bài và làm lại quiz một lần nữa.'
})

watch(finished, (isFinished) => {
  if (isFinished && lesson.value) {
    saveQuiz(lesson.value.link, { score: score.value, total: questions.value.length })
  }
})

function pick(qi: number, oi: number) {
  if (!answered(qi)) picked[qi] = oi
}

function reset() {
  for (const key of Object.keys(picked)) delete picked[Number(key)]
}

function optionClass(q: Question, qi: number, oi: number) {
  if (!answered(qi)) return ''
  if (oi === q.answer) return 'correct'
  if (oi === picked[qi]) return 'wrong'
  return 'dim'
}

// Định dạng tối giản cho nội dung quiz: `code` và **đậm**. Escape HTML trước để an toàn.
function fmt(text: unknown) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}
</script>

<template>
  <div v-if="questions.length" class="quiz">
    <div class="head">
      <span>🧠 {{ questions.length }} câu hỏi · chọn một đáp án để xem giải thích</span>
      <span v-if="best" class="best">Tốt nhất: {{ best.score }}/{{ best.total }}</span>
    </div>

    <ol class="questions">
      <li v-for="(q, qi) in questions" :key="qi" class="question">
        <p class="q-text">
          <span class="q-num">Câu {{ qi + 1 }}.</span>
          <span v-html="fmt(q.q)" />
        </p>
        <div class="options" role="group" :aria-label="`Đáp án câu ${qi + 1}`">
          <button
            v-for="(opt, oi) in q.options"
            :key="oi"
            type="button"
            class="option"
            :class="optionClass(q, qi, oi)"
            :disabled="answered(qi)"
            @click="pick(qi, oi)"
          >
            <span class="letter">{{ LETTERS[oi] }}</span>
            <span class="opt-text" v-html="fmt(opt)" />
          </button>
        </div>
        <p
          v-if="answered(qi)"
          class="explain"
          :class="picked[qi] === q.answer ? 'ok' : 'bad'"
          aria-live="polite"
        >
          <strong>{{
            picked[qi] === q.answer ? '✓ Chính xác!' : `✗ Chưa đúng — đáp án là ${LETTERS[q.answer]}.`
          }}</strong>
          <span v-if="q.explain" class="explain-text" v-html="fmt(q.explain)" />
        </p>
      </li>
    </ol>

    <div v-if="finished" class="summary">
      <p>
        Bạn trả lời đúng <strong>{{ score }}/{{ questions.length }}</strong> câu. {{ verdict }}
      </p>
      <button type="button" class="retry" @click="reset">↺ Làm lại</button>
    </div>
  </div>
</template>

<style scoped>
.quiz {
  margin: 16px 0;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}
.head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 16px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.best {
  font-weight: 600;
  color: var(--vp-c-brand-1);
}
.questions {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.question {
  margin: 0;
  padding: 16px 0;
  border-bottom: 1px dashed var(--vp-c-divider);
}
.question:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.q-text {
  margin: 0 0 10px;
  font-weight: 600;
  line-height: 1.6;
}
.q-num {
  color: var(--vp-c-brand-1);
  margin-right: 4px;
}
.options {
  display: grid;
  gap: 8px;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  text-align: left;
  font-size: 14px;
  line-height: 1.5;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  transition: border-color 0.2s, background-color 0.2s;
}
.option:not(:disabled):hover {
  border-color: var(--vp-c-brand-2);
  background: var(--vp-c-brand-soft);
}
.option:disabled {
  cursor: default;
}
.letter {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--vp-c-text-2);
  background: var(--vp-c-default-soft);
}
.option.correct {
  border-color: var(--vp-c-green-2);
  background: var(--vp-c-green-soft);
}
.option.correct .letter {
  color: #fff;
  background: var(--vp-c-green-2);
}
.option.wrong {
  border-color: var(--vp-c-red-2);
  background: var(--vp-c-red-soft);
}
.option.wrong .letter {
  color: #fff;
  background: var(--vp-c-red-2);
}
.option.dim {
  opacity: 0.6;
}
.explain {
  margin: 10px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
}
.explain.ok {
  background: var(--vp-c-green-soft);
}
.explain-text {
  margin-left: 4px;
}
.explain.bad {
  background: var(--vp-c-red-soft);
}
.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--vp-c-brand-soft);
}
.summary p {
  margin: 0;
}
.retry {
  padding: 6px 14px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--vp-button-brand-text);
  background: var(--vp-button-brand-bg);
}
.retry:hover {
  background: var(--vp-button-brand-hover-bg);
}
</style>
