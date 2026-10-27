// Kiểu dữ liệu của cluster mô phỏng. Chỉ mô phỏng những gì cần cho việc học kubectl,
// không cố tái hiện đầy đủ Kubernetes API.

export type Labels = Record<string, string>

export interface Meta {
  name: string
  /** '' với tài nguyên cấp cluster (Node, Namespace) */
  namespace: string
  uid: string
  labels: Labels
  annotations: Labels
  createdAt: number
}

export interface EnvVar {
  name: string
  value?: string
  configMapKeyRef?: { name: string; key: string; optional?: boolean }
  secretKeyRef?: { name: string; key: string; optional?: boolean }
  fieldPath?: string
}

export interface EnvFrom {
  configMapRef?: string
  secretRef?: string
  prefix?: string
}

export interface ContainerSpec {
  name: string
  image: string
  command?: string[]
  args?: string[]
  ports: { containerPort: number; name?: string }[]
  env: EnvVar[]
  envFrom: EnvFrom[]
  resources?: { requests?: Labels; limits?: Labels }
}

export interface Toleration {
  key?: string
  operator?: string
  value?: string
  effect?: string
}

export interface PodSpec {
  containers: ContainerSpec[]
  restartPolicy: 'Always' | 'OnFailure' | 'Never'
  nodeSelector: Labels
  tolerations: Toleration[]
}

export interface PodTemplate {
  labels: Labels
  annotations: Labels
  spec: PodSpec
}

export type OwnerKind = 'ReplicaSet' | 'DaemonSet' | 'Node'

export interface Pod {
  meta: Meta
  spec: PodSpec
  /** '' = chưa được xếp lịch */
  nodeName: string
  podIP: string
  owner?: { kind: OwnerKind; name: string }
  /** Thời điểm được gán node */
  scheduledAt?: number
  /** Thời điểm container thực sự khởi chạy (đã kéo image, đủ cấu hình) */
  runningSince?: number
  /** Số lần khởi động lại tích lũy trước lần chạy hiện tại (ví dụ khi đổi image tại chỗ) */
  restartOffset: number
  deletedAt?: number
  /** Xóa ngay, không chờ Terminating (--grace-period=0 --force) */
  forceDelete?: boolean
  /** Lý do không xếp lịch được gần nhất */
  schedulingMessage?: string
  /** Log truy cập phát sinh khi Pod nhận request (nginx, httpd...) */
  accessLog: { time: number; line: string }[]
}

export interface ReplicaSet {
  meta: Meta
  replicas: number
  selector: Labels
  template: PodTemplate
  hash: string
  revision: number
  /** Tên Deployment sở hữu, '' nếu ReplicaSet độc lập */
  owner: string
}

export interface Deployment {
  meta: Meta
  replicas: number
  selector: Labels
  template: PodTemplate
  strategy: 'RollingUpdate' | 'Recreate'
  maxSurge: number | string
  maxUnavailable: number | string
  progressDeadlineSeconds: number
  paused: boolean
  /** Lần cuối rollout có tiến triển (để tính ProgressDeadlineExceeded) */
  lastProgressAt: number
  progressSig: string
}

export interface DaemonSet {
  meta: Meta
  selector: Labels
  template: PodTemplate
}

export interface ServicePort {
  name?: string
  port: number
  targetPort: number | string
  nodePort?: number
  protocol: string
}

export interface Service {
  meta: Meta
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer'
  clusterIP: string
  selector: Labels
  ports: ServicePort[]
}

export interface ConfigMap {
  meta: Meta
  data: Record<string, string>
}

export interface Secret {
  meta: Meta
  type: string
  /** Giá trị đã mã hóa base64 như trong Kubernetes */
  data: Record<string, string>
}

export interface Namespace {
  meta: Meta
  deletedAt?: number
}

export interface Taint {
  key: string
  value?: string
  effect: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute'
}

export interface Node {
  meta: Meta
  role: 'control-plane' | 'worker'
  ip: string
  podCIDR: string
  unschedulable: boolean
  taints: Taint[]
  nextIP: number
}

export interface KEvent {
  namespace: string
  type: 'Normal' | 'Warning'
  reason: string
  /** dạng kind/name, ví dụ deployment/web */
  object: string
  source: string
  message: string
  time: number
}

export interface ClusterState {
  schema: number
  currentNamespace: string
  nodes: Node[]
  namespaces: Namespace[]
  pods: Pod[]
  replicasets: ReplicaSet[]
  deployments: Deployment[]
  daemonsets: DaemonSet[]
  services: Service[]
  configmaps: ConfigMap[]
  secrets: Secret[]
  events: KEvent[]
  /** Cờ phục vụ chấm nhiệm vụ (ví dụ đã rollback, đã gọi thử Service...) */
  flags: Record<string, boolean>
  /** Các lệnh đã chạy (giới hạn độ dài) */
  history: string[]
  seq: number
}

export type LineKind = 'out' | 'err' | 'info' | 'ok' | 'cmd' | 'warn'

export interface Line {
  text: string
  kind?: LineKind
}

export interface ExecResult {
  lines: Line[]
  /** Lệnh chạy liên tục (get -w, rollout status, logs -f): trả về hàm dừng */
  stream?: (emit: (lines: Line[]) => void, done: () => void) => () => void
  clear?: boolean
}

export type FileMap = Record<string, string>
