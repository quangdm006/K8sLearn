import { computed, ref } from 'vue'
import { lessons, type SectionDef } from '../curriculum'

// Tiến độ chỉ lưu trên trình duyệt của người học (localStorage).
// Dữ liệu được nạp sau khi app mount để HTML render phía server và client khớp nhau.

const DONE_KEY = 'k8s-learn:done:v1'
const QUIZ_KEY = 'k8s-learn:quiz:v1'

export interface QuizResult {
  score: number
  total: number
}

const done = ref<string[]>([])
const quiz = ref<Record<string, QuizResult>>({})
let initialized = false

function read<T>(key: string, isValid: (v: unknown) => v is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    return isValid(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Trình duyệt chặn storage (chế độ riêng tư...): tiến độ chỉ tồn tại trong phiên này.
  }
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

const isQuizMap = (v: unknown): v is Record<string, QuizResult> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function load() {
  done.value = read(DONE_KEY, isStringArray, [])
  quiz.value = read(QUIZ_KEY, isQuizMap, {})
}

export function initProgress() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  load()
  // Đồng bộ khi người học mở nhiều tab cùng lúc.
  window.addEventListener('storage', (e) => {
    if (e.key === DONE_KEY || e.key === QUIZ_KEY) load()
  })
}

const doneSet = computed(() => new Set(done.value))

export function useProgress() {
  const isDone = (link: string) => doneSet.value.has(link)

  function setDone(link: string, value: boolean) {
    const next = new Set(done.value)
    if (value) next.add(link)
    else next.delete(link)
    done.value = [...next]
    write(DONE_KEY, done.value)
  }

  function toggle(link: string) {
    setDone(link, !isDone(link))
  }

  function quizResult(link: string): QuizResult | undefined {
    return quiz.value[link]
  }

  /** Lưu điểm quiz, chỉ giữ lại kết quả tốt nhất. */
  function saveQuiz(link: string, result: QuizResult) {
    const prev = quiz.value[link]
    if (prev && prev.score >= result.score) return
    quiz.value = { ...quiz.value, [link]: result }
    write(QUIZ_KEY, quiz.value)
  }

  function resetAll() {
    done.value = []
    quiz.value = {}
    write(DONE_KEY, [])
    write(QUIZ_KEY, {})
  }

  const completed = computed(() => lessons.filter((l) => doneSet.value.has(l.link)).length)
  const percent = computed(() => Math.round((completed.value / lessons.length) * 100))
  const nextLesson = computed(() => lessons.find((l) => !doneSet.value.has(l.link)))

  const sectionDone = (section: SectionDef) =>
    section.lessons.filter((l) => doneSet.value.has(`/${section.id}/${l.slug}`)).length

  return {
    done,
    isDone,
    setDone,
    toggle,
    quizResult,
    saveQuiz,
    resetAll,
    completed,
    percent,
    nextLesson,
    sectionDone,
    total: lessons.length,
  }
}
