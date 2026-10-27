import { defineConfig, type DefaultTheme } from 'vitepress'
import { sections } from './theme/curriculum'
import { mermaidFence, taskLists } from './markdown'

// Khi deploy vào thư mục con (ví dụ GitHub Pages: /K8sLearn/), đặt BASE_PATH=/K8sLearn/
const base = process.env.BASE_PATH || '/'

function buildSidebar(): DefaultTheme.SidebarItem[] {
  const levels = sections
    .filter((s) => s.id !== 'thuc-hanh')
    .map((s) => ({
      text: `${s.icon} ${s.label} · ${s.title}`,
      // Nhóm chứa trang đang xem sẽ tự mở ra.
      collapsed: true,
      items: s.lessons.map((l, i) => ({
        text: `${i + 1}. ${l.title}`,
        link: `/${s.id}/${l.slug}`,
      })),
    }))

  return [
    {
      text: '📍 Bắt đầu',
      items: [{ text: 'Giới thiệu & lộ trình', link: '/gioi-thieu' }],
    },
    ...levels,
    {
      text: '🚀 Thực hành',
      items: [
        { text: 'Dự án cuối khóa', link: '/thuc-hanh/du-an-cuoi-khoa' },
        { text: 'Kubectl Playground', link: '/thuc-hanh/playground' },
      ],
    },
    {
      text: '📚 Tham khảo',
      collapsed: true,
      items: [
        { text: 'kubectl cheat sheet', link: '/tham-khao/cheatsheet' },
        { text: 'Thuật ngữ', link: '/tham-khao/thuat-ngu' },
        { text: 'Chứng chỉ & tài nguyên', link: '/tham-khao/chung-chi' },
      ],
    },
  ]
}

export default defineConfig({
  lang: 'vi-VN',
  title: 'K8s Learn',
  titleTemplate: ':title · K8s Learn',
  description:
    'Tự học Kubernetes bằng tiếng Việt từ cơ bản đến nâng cao: lộ trình rõ ràng, ví dụ YAML, bài tập, quiz và kubectl playground.',
  base,
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#326ce5' }],
  ],

  vite: {
    // Các chunk lớn nhất là của Mermaid (chỉ tải khi trang có sơ đồ) — không ảnh hưởng tải trang ban đầu.
    build: { chunkSizeWarningLimit: 800 },
  },

  markdown: {
    container: {
      tipLabel: 'Mẹo',
      infoLabel: 'Thông tin',
      noteLabel: 'Ghi chú',
      warningLabel: 'Lưu ý',
      dangerLabel: 'Cảnh báo',
      detailsLabel: 'Chi tiết',
      importantLabel: 'Quan trọng',
      cautionLabel: 'Thận trọng',
    },
    config(md) {
      md.use(mermaidFence)
      md.use(taskLists)
    },
  },

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Lộ trình', link: '/gioi-thieu' },
      { text: 'Cơ bản', link: '/co-ban/container-va-docker', activeMatch: '^/co-ban/' },
      { text: 'Trung cấp', link: '/trung-cap/probes', activeMatch: '^/trung-cap/' },
      { text: 'Nâng cao', link: '/nang-cao/rbac', activeMatch: '^/nang-cao/' },
      { text: 'Playground', link: '/thuc-hanh/playground' },
      {
        text: 'Tham khảo',
        activeMatch: '^/tham-khao/',
        items: [
          { text: 'kubectl cheat sheet', link: '/tham-khao/cheatsheet' },
          { text: 'Thuật ngữ', link: '/tham-khao/thuat-ngu' },
          { text: 'Chứng chỉ & tài nguyên', link: '/tham-khao/chung-chi' },
        ],
      },
    ],
    sidebar: buildSidebar(),
    outline: { level: [2, 3], label: 'Trong bài này' },
    docFooter: { prev: 'Bài trước', next: 'Bài tiếp theo' },
    darkModeSwitchLabel: 'Giao diện',
    lightModeSwitchTitle: 'Chuyển sang nền sáng',
    darkModeSwitchTitle: 'Chuyển sang nền tối',
    sidebarMenuLabel: 'Danh mục bài học',
    returnToTopLabel: 'Lên đầu trang',
    langMenuLabel: 'Ngôn ngữ',
    notFound: {
      title: 'KHÔNG TÌM THẤY TRANG',
      quote: 'Có vẻ Pod này đã bị xóa — hoặc nó chưa từng được tạo ra.',
      linkLabel: 'Về trang chủ',
      linkText: 'Về trang chủ',
    },
    footer: {
      message:
        'Tài liệu phục vụ mục đích học tập. Kubernetes® là thương hiệu đã đăng ký của The Linux Foundation.',
      copyright: 'K8s Learn — tự học Kubernetes bằng tiếng Việt',
    },
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          options: {
            // Cho phép gõ không dấu: "trien khai" vẫn tìm thấy "triển khai".
            processTerm: (term: string) =>
              term
                .toLowerCase()
                .normalize('NFD')
                .replace(/[̀-ͯ]/g, '')
                .replace(/đ/g, 'd'),
          },
        },
        translations: {
          button: { buttonText: 'Tìm kiếm', buttonAriaLabel: 'Tìm kiếm' },
          modal: {
            displayDetails: 'Hiện chi tiết',
            resetButtonTitle: 'Xóa từ khóa',
            backButtonTitle: 'Đóng',
            noResultsText: 'Không có kết quả cho',
            footer: {
              selectText: 'mở',
              selectKeyAriaLabel: 'enter',
              navigateText: 'di chuyển',
              navigateUpKeyAriaLabel: 'mũi tên lên',
              navigateDownKeyAriaLabel: 'mũi tên xuống',
              closeText: 'đóng',
              closeKeyAriaLabel: 'escape',
            },
          },
        },
      },
    },
  },
})
