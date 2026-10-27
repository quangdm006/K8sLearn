import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { defineAsyncComponent, h, onMounted } from 'vue'
import LessonHeader from './components/LessonHeader.vue'
import LessonComplete from './components/LessonComplete.vue'
import SidebarProgress from './components/SidebarProgress.vue'
import Quiz from './components/Quiz.vue'
import Mermaid from './components/Mermaid.vue'
import Roadmap from './components/Roadmap.vue'
import { initProgress } from './composables/progress'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'doc-before': () => h(LessonHeader),
      'doc-footer-before': () => h(LessonComplete),
      'sidebar-nav-before': () => h(SidebarProgress),
    }),
  enhanceApp({ app }) {
    app.component('Quiz', Quiz)
    app.component('Mermaid', Mermaid)
    app.component('Roadmap', Roadmap)
    // Playground khá nặng (bộ mô phỏng + parser YAML) nên chỉ tải ở trang cần dùng.
    app.component(
      'KubectlPlayground',
      defineAsyncComponent(() => import('./components/KubectlPlayground.vue')),
    )
  },
  setup() {
    onMounted(initProgress)
  },
} satisfies Theme
