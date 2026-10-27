// Danh mục bài học — nguồn dữ liệu duy nhất cho sidebar, tiêu đề bài và theo dõi tiến độ.
// Thêm bài mới: tạo file docs/<section.id>/<slug>.md rồi khai báo ở đây.

export interface LessonDef {
  slug: string
  title: string
  minutes: number
}

export interface SectionDef {
  id: string
  label: string
  title: string
  icon: string
  summary: string
  lessons: LessonDef[]
}

export interface Lesson extends LessonDef {
  link: string
  index: number
  section: SectionDef
}

export const sections: SectionDef[] = [
  {
    id: 'co-ban',
    label: 'Phần 1',
    title: 'Cơ bản',
    icon: '🧱',
    summary:
      'Hiểu container, kiến trúc cluster và các đối tượng cốt lõi: Pod, Deployment, Service, ConfigMap, Secret.',
    lessons: [
      { slug: 'container-va-docker', title: 'Container & Docker — nền tảng', minutes: 20 },
      { slug: 'kubernetes-la-gi', title: 'Kubernetes là gì? Vì sao cần nó', minutes: 15 },
      { slug: 'kien-truc', title: 'Kiến trúc Kubernetes', minutes: 25 },
      { slug: 'cai-dat', title: 'Cài đặt môi trường thực hành', minutes: 30 },
      { slug: 'kubectl', title: 'Làm quen với kubectl', minutes: 25 },
      { slug: 'pod', title: 'Pod — đơn vị nhỏ nhất', minutes: 30 },
      { slug: 'labels-namespace', title: 'Labels, Selectors & Namespace', minutes: 20 },
      { slug: 'deployment', title: 'ReplicaSet & Deployment', minutes: 35 },
      { slug: 'service', title: 'Service & DNS nội bộ', minutes: 35 },
      { slug: 'configmap-secret', title: 'ConfigMap & Secret', minutes: 30 },
    ],
  },
  {
    id: 'trung-cap',
    label: 'Phần 2',
    title: 'Trung cấp',
    icon: '⚙️',
    summary:
      'Chạy ứng dụng ổn định: health check, tài nguyên, lưu trữ, workload đặc thù, định tuyến, autoscaling, Helm & Kustomize.',
    lessons: [
      { slug: 'probes', title: 'Health check với Probes', minutes: 25 },
      { slug: 'resources', title: 'Quản lý tài nguyên CPU & RAM', minutes: 30 },
      { slug: 'storage', title: 'Lưu trữ: Volume, PV, PVC', minutes: 35 },
      { slug: 'statefulset', title: 'StatefulSet — ứng dụng có trạng thái', minutes: 30 },
      { slug: 'daemonset-job-cronjob', title: 'DaemonSet, Job & CronJob', minutes: 25 },
      { slug: 'ingress-gateway', title: 'Ingress & Gateway API', minutes: 35 },
      { slug: 'scheduling', title: 'Lập lịch Pod nâng cao', minutes: 30 },
      { slug: 'autoscaling', title: 'Autoscaling: HPA, VPA & node', minutes: 30 },
      { slug: 'helm', title: 'Helm — trình quản lý gói', minutes: 35 },
      { slug: 'kustomize', title: 'Kustomize & nhiều môi trường', minutes: 25 },
    ],
  },
  {
    id: 'nang-cao',
    label: 'Phần 3',
    title: 'Nâng cao',
    icon: '🛡️',
    summary:
      'Bảo mật, mạng chuyên sâu, observability, xử lý sự cố, mở rộng Kubernetes, GitOps và vận hành cluster production.',
    lessons: [
      { slug: 'rbac', title: 'RBAC & ServiceAccount', minutes: 35 },
      { slug: 'bao-mat', title: 'Bảo mật Pod & chuỗi cung ứng', minutes: 35 },
      { slug: 'network-policy', title: 'NetworkPolicy — tường lửa cho Pod', minutes: 30 },
      { slug: 'networking', title: 'Mạng Kubernetes chuyên sâu', minutes: 40 },
      { slug: 'observability', title: 'Giám sát, logging & tracing', minutes: 35 },
      { slug: 'troubleshooting', title: 'Xử lý sự cố (troubleshooting)', minutes: 40 },
      { slug: 'crd-operator', title: 'CRD, Controller & Operator', minutes: 35 },
      { slug: 'admission-policy', title: 'Admission control & Policy', minutes: 30 },
      { slug: 'gitops', title: 'CI/CD & GitOps với Argo CD', minutes: 35 },
      { slug: 'van-hanh-cluster', title: 'Vận hành cluster với kubeadm', minutes: 40 },
      { slug: 'production', title: 'Checklist cho production', minutes: 30 },
    ],
  },
  {
    id: 'thuc-hanh',
    label: 'Tổng kết',
    title: 'Dự án',
    icon: '🚀',
    summary: 'Ghép mọi thứ lại: tự tay triển khai một ứng dụng nhiều tầng hoàn chỉnh.',
    lessons: [{ slug: 'du-an-cuoi-khoa', title: 'Dự án cuối khóa', minutes: 120 }],
  },
]

export const lessons: Lesson[] = sections.flatMap((section) =>
  section.lessons.map((def, i) => ({
    ...def,
    link: `/${section.id}/${def.slug}`,
    index: i + 1,
    section,
  })),
)

/** Tìm bài học theo `page.relativePath` của VitePress, ví dụ `co-ban/pod.md`. */
export function findLesson(relativePath: string): Lesson | undefined {
  const link = '/' + relativePath.replace(/\.md$/, '')
  return lessons.find((l) => l.link === link)
}

export const totalMinutes = lessons.reduce((sum, l) => sum + l.minutes, 0)
