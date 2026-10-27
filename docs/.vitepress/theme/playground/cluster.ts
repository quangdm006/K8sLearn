import type {
  ClusterState,
  ContainerSpec,
  DaemonSet,
  Deployment,
  KEvent,
  Labels,
  Node,
  Pod,
  PodSpec,
  PodTemplate,
  ReplicaSet,
  Service,
  Taint,
} from './types'
import {
  b64decode,
  humanDuration,
  matchLabels,
  parseImage,
  randomSuffix,
  randomUid,
  templateHash,
} from './util'

export const SCHEMA = 2
export const SERVER_VERSION = 'v1.37.0'
export const CLIENT_VERSION = 'v1.37.1'
export const KUSTOMIZE_VERSION = 'v5.7.1'
export const CONTEXT = 'kind-k8s-learn'
export const CP_NODE = 'k8s-learn-control-plane'
/** Cổng NodePort được map ra máy (theo kind-config.yaml của khóa học) */
export const HOST_PORTS = [30080, 30100]

/** Thời gian kéo image + tạo container (thu ngắn để dễ quan sát) */
export const CREATE_MS = 2500
export const TERMINATE_MS = 2500
const RUN_BEFORE_EXIT_MS = 1200
const SHOW_EXIT_MS = 1800
const BACKOFF_START_MS = 5000
const BACKOFF_MAX_MS = 40000
const DAY = 86_400_000

// ---------------------------------------------------------------------------
// Hiểu biết về các image phổ biến
// ---------------------------------------------------------------------------

interface ImageInfo {
  /** Cổng ứng dụng lắng nghe (image dạng server) */
  port?: number
  /** Image chạy lệnh mặc định rồi thoát (busybox, alpine...) */
  shortLived?: boolean
}

const IMAGES: Record<string, ImageInfo> = {
  nginx: { port: 80 },
  httpd: { port: 80 },
  'traefik/whoami': { port: 80 },
  'stefanprodan/podinfo': { port: 9898 },
  'nginxinc/nginx-unprivileged': { port: 8080 },
  redis: { port: 6379 },
  memcached: { port: 11211 },
  mongo: { port: 27017 },
  postgres: { port: 5432 },
  mysql: { port: 3306 },
  mariadb: { port: 3306 },
  rabbitmq: { port: 5672 },
  caddy: { port: 80 },
  traefik: { port: 80 },
  haproxy: { port: 80 },
  wordpress: { port: 80 },
  registry: { port: 5000 },
  'hpa-example': { port: 80 },
  'metrics-server/metrics-server': { port: 10250 },
  busybox: { shortLived: true },
  alpine: { shortLived: true },
  ubuntu: { shortLived: true },
  debian: { shortLived: true },
  'hello-world': { shortLived: true },
  node: { shortLived: true },
  python: { shortLived: true },
  golang: { shortLived: true },
  perl: { shortLived: true },
  centos: { shortLived: true },
  fedora: { shortLived: true },
  bash: { shortLived: true },
  'curlimages/curl': { shortLived: true },
  'nicolaka/netshoot': { shortLived: true },
}

const TRUSTED_REGISTRIES = new Set([
  'registry.k8s.io',
  'ghcr.io',
  'quay.io',
  'gcr.io',
  'mcr.microsoft.com',
  'public.ecr.aws',
  'registry.gitlab.com',
])

/** Tag "rõ ràng là sai" để học viên thực hành lỗi ImagePullBackOff. */
const BAD_TAG =
  /(khong|ton-tai|tontai|doesnotexist|does-not-exist|notexist|not-exist|notfound|invalid|wrong|typo|sai|xxx|404|missing)/i

export function imagePullError(image: string): string | null {
  if (!image.trim()) return 'InvalidImageName'
  const ref = parseImage(image)
  const known =
    TRUSTED_REGISTRIES.has(ref.registry) ||
    (ref.registry === 'docker.io' && ref.short in IMAGES) ||
    (ref.registry === 'docker.io' && /^(kindest|bitnami|grafana|prom|library)\//.test(ref.short))
  if (!known) {
    if (ref.registry !== 'docker.io') {
      return `failed to pull and unpack image "${ref.full}": failed to resolve reference "${ref.full}": failed to do request: Head "https://${ref.registry}/v2/${ref.repo}/manifests/${ref.tag}": dial tcp: lookup ${ref.registry}: no such host`
    }
    return `failed to pull and unpack image "${ref.full}": failed to resolve reference "${ref.full}": pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed`
  }
  if (BAD_TAG.test(ref.tag)) {
    return `rpc error: code = NotFound desc = failed to pull and unpack image "${ref.full}": failed to resolve reference "${ref.full}": ${ref.full}: not found`
  }
  return null
}

export function imageInfo(image: string): ImageInfo {
  const ref = parseImage(image)
  const info = IMAGES[ref.short] ?? IMAGES[ref.short.split('/').pop() ?? '']
  if (info) return info
  return TRUSTED_REGISTRIES.has(ref.registry) ? { port: 8080 } : {}
}

export function nginxVersion(image: string): string {
  const tag = parseImage(image).tag
  if (/^1\.30/.test(tag)) return '1.30.6'
  if (/^1\.(2\d)/.test(tag)) return `${tag.split('-')[0]}${tag.split('.').length < 3 ? '.0' : ''}`
  return '1.31.8'
}

// ---------------------------------------------------------------------------
// Kết quả chạy container
// ---------------------------------------------------------------------------

export type Outcome =
  | { kind: 'pull'; message: string }
  | { kind: 'config'; message: string }
  | { kind: 'run'; port: number }
  | { kind: 'exit'; code: number; reason: 'Completed' | 'Error' | 'OOMKilled'; logs: string[] }

export interface ContainerState {
  name: string
  image: string
  ready: boolean
  restarts: number
  lastRestartAt?: number
  state: 'waiting' | 'running' | 'terminated'
  reason?: string
  exitCode?: number
  startedAt?: number
  finishedAt?: number
  lastState?: { reason: string; exitCode: number; finishedAt: number; startedAt: number }
  outcome: Outcome
}

export interface PodStatus {
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed'
  display: string
  ready: boolean
  readyCount: number
  total: number
  restarts: number
  lastRestartAt?: number
  containers: ContainerState[]
}

/** Lệnh "chạy mãi": server, sleep dài, vòng lặp vô hạn... */
const LONG_RUNNING =
  /(sleep\s+(infinity|inf)\b|tail\s+-[fF]\b|while\s+(true|:)|\bnginx\b(?!.*daemon on)|httpd-foreground|redis-server|podinfo|http\.server|\bsleep\s+\d+[mhd]\b)/

function analyzeCommand(cmd: string, memoryLimited: boolean): Outcome {
  const sleep = /\bsleep\s+(\d+)\b/.exec(cmd)
  if (/tail\s+\/dev\/zero/.test(cmd)) {
    return memoryLimited
      ? { kind: 'exit', code: 137, reason: 'OOMKilled', logs: [] }
      : { kind: 'run', port: 0 }
  }
  if (/daemon\s+on/.test(cmd)) return { kind: 'exit', code: 0, reason: 'Completed', logs: [] }
  const exitCode = /\bexit\s+([1-9]\d*)/.exec(cmd)
  if (exitCode) {
    return { kind: 'exit', code: Number(exitCode[1]), reason: 'Error', logs: echoes(cmd) }
  }
  if (/^\s*false\b/.test(cmd)) return { kind: 'exit', code: 1, reason: 'Error', logs: [] }
  if (LONG_RUNNING.test(cmd) || (sleep && Number(sleep[1]) >= 30)) {
    const port = /--port[= ](\d+)/.exec(cmd)
    return { kind: 'run', port: port ? Number(port[1]) : 0 }
  }
  return { kind: 'exit', code: 0, reason: 'Completed', logs: echoes(cmd) }
}

function echoes(cmd: string): string[] {
  const out: string[] = []
  const re = /\becho\s+("([^"]*)"|'([^']*)'|([^;&|]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd))) out.push((m[2] ?? m[3] ?? m[4] ?? '').trim())
  return out
}

export function parseCpu(q: string | undefined): number {
  if (!q) return 0
  const s = String(q)
  return s.endsWith('m') ? Number(s.slice(0, -1)) / 1000 : Number(s)
}

export function parseMemory(q: string | undefined): number {
  if (!q) return 0
  const m = /^([\d.]+)\s*(Ki|Mi|Gi|Ti|k|K|M|G|T|m)?$/.exec(String(q))
  if (!m) return 0
  const n = Number(m[1])
  const unit: Record<string, number> = {
    Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4,
    k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, m: 1e-3,
  }
  return n * (m[2] ? unit[m[2]] : 1)
}

const NODE_CPU = 8
const NODE_MEMORY = 15.5 * 1024 ** 3

// ---------------------------------------------------------------------------
// Trạng thái ban đầu: cluster kind 3 node
// ---------------------------------------------------------------------------

function meta(name: string, namespace: string, createdAt: number, labels: Labels = {}): Pod['meta'] {
  return { name, namespace, uid: randomUid(), labels, annotations: {}, createdAt }
}

function container(name: string, image: string, extra: Partial<ContainerSpec> = {}): ContainerSpec {
  return { name, image, ports: [], env: [], envFrom: [], ...extra }
}

function podSpec(containers: ContainerSpec[], extra: Partial<PodSpec> = {}): PodSpec {
  return { containers, restartPolicy: 'Always', nodeSelector: {}, tolerations: [], ...extra }
}

const TOLERATE_ALL = [{ operator: 'Exists' }]

export function createInitialState(now: number): ClusterState {
  const created = now - 3 * DAY
  const nodeLabels = (name: string, cp: boolean): Labels => ({
    'beta.kubernetes.io/arch': 'amd64',
    'beta.kubernetes.io/os': 'linux',
    'kubernetes.io/arch': 'amd64',
    'kubernetes.io/hostname': name,
    'kubernetes.io/os': 'linux',
    ...(cp ? { 'node-role.kubernetes.io/control-plane': '' } : {}),
  })
  const nodes: Node[] = [
    {
      meta: meta(CP_NODE, '', created, nodeLabels(CP_NODE, true)),
      role: 'control-plane',
      ip: '172.18.0.2',
      podCIDR: '10.244.0.0/24',
      unschedulable: false,
      taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }],
      nextIP: 2,
    },
    ...['k8s-learn-worker', 'k8s-learn-worker2'].map((name, i) => ({
      meta: meta(name, '', created + 15_000, nodeLabels(name, false)),
      role: 'worker' as const,
      ip: `172.18.0.${3 + i}`,
      podCIDR: `10.244.${1 + i}.0/24`,
      unschedulable: false,
      taints: [],
      nextIP: 2,
    })),
  ]

  const nsNames = ['default', 'kube-node-lease', 'kube-public', 'kube-system', 'local-path-storage']
  const state: ClusterState = {
    schema: SCHEMA,
    currentNamespace: 'default',
    nodes,
    namespaces: nsNames.map((n) => ({
      meta: meta(n, '', created, { 'kubernetes.io/metadata.name': n }),
    })),
    pods: [],
    replicasets: [],
    deployments: [],
    daemonsets: [],
    services: [],
    configmaps: [],
    secrets: [],
    events: [],
    flags: {},
    history: [],
    seq: 0,
  }

  // Static Pod của control plane
  const staticPods: [string, string, string][] = [
    ['etcd', 'registry.k8s.io/etcd:3.6.4-0', 'etcd'],
    ['kube-apiserver', `registry.k8s.io/kube-apiserver:${SERVER_VERSION}`, 'kube-apiserver'],
    ['kube-controller-manager', `registry.k8s.io/kube-controller-manager:${SERVER_VERSION}`, 'kube-controller-manager'],
    ['kube-scheduler', `registry.k8s.io/kube-scheduler:${SERVER_VERSION}`, 'kube-scheduler'],
  ]
  for (const [component, image] of staticPods) {
    state.pods.push(
      newPod(
        meta(`${component}-${CP_NODE}`, 'kube-system', created, { component, tier: 'control-plane' }),
        podSpec([container(component, image)], { tolerations: TOLERATE_ALL }),
        { kind: 'Node', name: CP_NODE },
        CP_NODE,
        '172.18.0.2',
        created,
      ),
    )
  }

  const tpl = (labels: Labels, spec: PodSpec): PodTemplate => ({ labels, annotations: {}, spec })
  state.daemonsets.push(
    {
      meta: meta('kindnet', 'kube-system', created, { app: 'kindnet', 'k8s-app': 'kindnet', tier: 'node' }),
      selector: { app: 'kindnet' },
      template: tpl(
        { app: 'kindnet', 'k8s-app': 'kindnet', tier: 'node' },
        podSpec([container('kindnet-cni', 'docker.io/kindest/kindnetd:v20260915-8f2e1c0b')], {
          tolerations: TOLERATE_ALL,
        }),
      ),
    },
    {
      meta: meta('kube-proxy', 'kube-system', created, { 'k8s-app': 'kube-proxy' }),
      selector: { 'k8s-app': 'kube-proxy' },
      template: tpl(
        { 'k8s-app': 'kube-proxy' },
        podSpec([container('kube-proxy', `registry.k8s.io/kube-proxy:${SERVER_VERSION}`)], {
          tolerations: TOLERATE_ALL,
          nodeSelector: { 'kubernetes.io/os': 'linux' },
        }),
      ),
    },
  )

  const dep = (
    name: string,
    namespace: string,
    replicas: number,
    labels: Labels,
    spec: PodSpec,
  ): Deployment => ({
    meta: meta(name, namespace, created, labels),
    replicas,
    selector: labels,
    template: tpl(labels, spec),
    strategy: 'RollingUpdate',
    maxSurge: '25%',
    maxUnavailable: '25%',
    progressDeadlineSeconds: 600,
    paused: false,
    lastProgressAt: created,
    progressSig: '',
  })
  state.deployments.push(
    dep(
      'coredns',
      'kube-system',
      2,
      { 'k8s-app': 'kube-dns' },
      podSpec(
        [
          container('coredns', 'registry.k8s.io/coredns/coredns:v1.12.3', {
            ports: [{ containerPort: 53, name: 'dns' }],
          }),
        ],
        {
          tolerations: [
            { key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' },
            { key: 'CriticalAddonsOnly', operator: 'Exists' },
          ],
        },
      ),
    ),
    dep(
      'local-path-provisioner',
      'local-path-storage',
      1,
      { app: 'local-path-provisioner' },
      podSpec([container('local-path-provisioner', 'docker.io/kindest/local-path-provisioner:v20260915-a7c2f1e3')], {
        tolerations: TOLERATE_ALL,
      }),
    ),
  )

  state.services.push(
    {
      meta: meta('kubernetes', 'default', created, { component: 'apiserver', provider: 'kubernetes' }),
      type: 'ClusterIP',
      clusterIP: '10.96.0.1',
      selector: {},
      ports: [{ name: 'https', port: 443, targetPort: 6443, protocol: 'TCP' }],
    },
    {
      meta: meta('kube-dns', 'kube-system', created, {
        'k8s-app': 'kube-dns',
        'kubernetes.io/cluster-service': 'true',
        'kubernetes.io/name': 'CoreDNS',
      }),
      type: 'ClusterIP',
      clusterIP: '10.96.0.10',
      selector: { 'k8s-app': 'kube-dns' },
      ports: [
        { name: 'dns', port: 53, targetPort: 53, protocol: 'UDP' },
        { name: 'dns-tcp', port: 53, targetPort: 53, protocol: 'TCP' },
        { name: 'metrics', port: 9153, targetPort: 9153, protocol: 'TCP' },
      ],
    },
  )

  for (const ns of nsNames) {
    state.configmaps.push({
      meta: meta('kube-root-ca.crt', ns, created),
      data: { 'ca.crt': '-----BEGIN CERTIFICATE-----\nMIIDBTCCAe2gAwIBAgIIK8s...\n-----END CERTIFICATE-----\n' },
    })
  }
  state.configmaps.push(
    {
      meta: meta('coredns', 'kube-system', created),
      data: {
        Corefile:
          '.:53 {\n    errors\n    health {\n       lameduck 5s\n    }\n    ready\n    kubernetes cluster.local in-addr.arpa ip6.arpa {\n       pods insecure\n       fallthrough in-addr.arpa ip6.arpa\n       ttl 30\n    }\n    prometheus :9153\n    forward . /etc/resolv.conf {\n       max_concurrent 1000\n    }\n    cache 30\n    loop\n    reload\n    loadbalance\n}\n',
      },
    },
    { meta: meta('kube-proxy', 'kube-system', created), data: { 'config.conf': 'mode: iptables\n' } },
    { meta: meta('kubeadm-config', 'kube-system', created), data: { ClusterConfiguration: `kubernetesVersion: ${SERVER_VERSION}\n` } },
    { meta: meta('kubelet-config', 'kube-system', created), data: { kubelet: 'cgroupDriver: systemd\n' } },
    { meta: meta('cluster-info', 'kube-public', created), data: { kubeconfig: 'apiVersion: v1\nkind: Config\n' } },
    { meta: meta('local-path-config', 'local-path-storage', created), data: { 'config.json': '{"nodePathMap":[]}' } },
  )

  // Chạy controller một lượt để tạo Pod hệ thống, rồi coi như chúng đã chạy từ lâu.
  const cluster = new Cluster(state)
  cluster.tick(created + 1000)
  cluster.tick(created + 2000)
  for (const pod of state.pods) {
    pod.scheduledAt = pod.scheduledAt ?? created
    pod.runningSince = (pod.scheduledAt ?? created) + CREATE_MS
  }
  state.events = []
  return state
}

function newPod(
  m: Pod['meta'],
  spec: PodSpec,
  owner: Pod['owner'],
  nodeName = '',
  podIP = '',
  now = Date.now(),
): Pod {
  return {
    meta: m,
    spec,
    nodeName,
    podIP,
    owner,
    scheduledAt: nodeName ? now : undefined,
    restartOffset: 0,
    accessLog: [],
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

// ---------------------------------------------------------------------------
// Cluster: các controller, scheduler và truy vấn
// ---------------------------------------------------------------------------

export class Cluster {
  constructor(public state: ClusterState) {}

  // ----- truy vấn chung -----

  namespaceExists(ns: string): boolean {
    return this.state.namespaces.some((n) => n.meta.name === ns && !n.deletedAt)
  }

  findNode(name: string): Node | undefined {
    return this.state.nodes.find((n) => n.meta.name === name)
  }

  findPod(ns: string, name: string): Pod | undefined {
    return this.state.pods.find((p) => p.meta.namespace === ns && p.meta.name === name)
  }

  findDeployment(ns: string, name: string): Deployment | undefined {
    return this.state.deployments.find((d) => d.meta.namespace === ns && d.meta.name === name)
  }

  findService(ns: string, name: string): Service | undefined {
    return this.state.services.find((s) => s.meta.namespace === ns && s.meta.name === name)
  }

  replicaSetsOf(dep: Deployment): ReplicaSet[] {
    return this.state.replicasets.filter(
      (rs) => rs.meta.namespace === dep.meta.namespace && rs.owner === dep.meta.name,
    )
  }

  podsOf(rs: ReplicaSet, includeDeleting = false): Pod[] {
    return this.state.pods.filter(
      (p) =>
        p.meta.namespace === rs.meta.namespace &&
        p.owner?.kind === 'ReplicaSet' &&
        p.owner.name === rs.meta.name &&
        (includeDeleting || !p.deletedAt),
    )
  }

  podsOfDeployment(dep: Deployment, includeDeleting = false): Pod[] {
    return this.replicaSetsOf(dep).flatMap((rs) => this.podsOf(rs, includeDeleting))
  }

  newReplicaSet(dep: Deployment): ReplicaSet | undefined {
    const hash = templateHash(dep.template)
    return this.replicaSetsOf(dep).find((rs) => rs.hash === hash)
  }

  event(e: Omit<KEvent, 'time'>, now = Date.now()) {
    this.state.events.push({ ...e, time: now })
    if (this.state.events.length > 300) this.state.events.splice(0, this.state.events.length - 300)
  }

  // ----- trạng thái Pod -----

  resolveEnv(pod: Pod, c: ContainerSpec): { env: Record<string, string>; error?: string } {
    const env: Record<string, string> = {}
    const ns = pod.meta.namespace
    for (const from of c.envFrom) {
      if (from.configMapRef) {
        const cm = this.state.configmaps.find((x) => x.meta.namespace === ns && x.meta.name === from.configMapRef)
        if (!cm) return { env, error: `configmap "${from.configMapRef}" not found` }
        for (const [k, v] of Object.entries(cm.data)) env[(from.prefix ?? '') + k] = v
      }
      if (from.secretRef) {
        const s = this.state.secrets.find((x) => x.meta.namespace === ns && x.meta.name === from.secretRef)
        if (!s) return { env, error: `secret "${from.secretRef}" not found` }
        for (const [k, v] of Object.entries(s.data)) env[(from.prefix ?? '') + k] = safeDecode(v)
      }
    }
    for (const e of c.env) {
      if (e.value !== undefined) env[e.name] = e.value
      else if (e.configMapKeyRef) {
        const ref = e.configMapKeyRef
        const cm = this.state.configmaps.find((x) => x.meta.namespace === ns && x.meta.name === ref.name)
        if (!cm) {
          if (!ref.optional) return { env, error: `configmap "${ref.name}" not found` }
        } else if (!(ref.key in cm.data)) {
          if (!ref.optional) return { env, error: `couldn't find key ${ref.key} in ConfigMap ${ns}/${ref.name}` }
        } else env[e.name] = cm.data[ref.key]
      } else if (e.secretKeyRef) {
        const ref = e.secretKeyRef
        const s = this.state.secrets.find((x) => x.meta.namespace === ns && x.meta.name === ref.name)
        if (!s) {
          if (!ref.optional) return { env, error: `secret "${ref.name}" not found` }
        } else if (!(ref.key in s.data)) {
          if (!ref.optional) return { env, error: `couldn't find key ${ref.key} in Secret ${ns}/${ref.name}` }
        } else env[e.name] = safeDecode(s.data[ref.key])
      } else if (e.fieldPath) {
        const fields: Record<string, string> = {
          'metadata.name': pod.meta.name,
          'metadata.namespace': ns,
          'spec.nodeName': pod.nodeName,
          'status.podIP': pod.podIP,
          'status.hostIP': this.findNode(pod.nodeName)?.ip ?? '',
        }
        env[e.name] = fields[e.fieldPath] ?? ''
      }
    }
    return { env }
  }

  containerOutcome(pod: Pod, c: ContainerSpec): Outcome {
    const pull = imagePullError(c.image)
    if (pull) return { kind: 'pull', message: pull }
    const { env, error } = this.resolveEnv(pod, c)
    if (error && !pod.runningSince) return { kind: 'config', message: error }

    const info = imageInfo(c.image)
    const short = parseImage(c.image).short
    const memoryLimited = !!c.resources?.limits?.memory
    if (c.command?.length) return analyzeCommand([...c.command, ...(c.args ?? [])].join(' '), memoryLimited)
    if (info.shortLived) {
      if (c.args?.length) return analyzeCommand(c.args.join(' '), memoryLimited)
      return {
        kind: 'exit',
        code: 0,
        reason: 'Completed',
        logs: short === 'hello-world' ? HELLO_WORLD : [],
      }
    }
    if (short === 'postgres' && !env.POSTGRES_PASSWORD && env.POSTGRES_HOST_AUTH_METHOD !== 'trust') {
      return { kind: 'exit', code: 1, reason: 'Error', logs: POSTGRES_NO_PASSWORD }
    }
    if (
      (short === 'mysql' || short === 'mariadb') &&
      !['MYSQL_ROOT_PASSWORD', 'MYSQL_ALLOW_EMPTY_PASSWORD', 'MYSQL_RANDOM_ROOT_PASSWORD', 'MARIADB_ROOT_PASSWORD', 'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD', 'MARIADB_RANDOM_ROOT_PASSWORD'].some((k) => env[k])
    ) {
      return { kind: 'exit', code: 1, reason: 'Error', logs: MYSQL_NO_PASSWORD }
    }
    return { kind: 'run', port: info.port ?? 0 }
  }

  podStatus(pod: Pod, now = Date.now()): PodStatus {
    const containers = pod.spec.containers.map((c) => this.containerState(pod, c, now))
    const total = containers.length
    const readyCount = containers.filter((c) => c.ready).length
    const restarts = containers.reduce((s, c) => s + c.restarts, 0)
    const lastRestartAt = containers.reduce<number | undefined>(
      (max, c) => (c.lastRestartAt && (!max || c.lastRestartAt > max) ? c.lastRestartAt : max),
      undefined,
    )

    let phase: PodStatus['phase'] = 'Running'
    if (!pod.runningSince) phase = 'Pending'
    else if (containers.every((c) => c.state === 'terminated' && c.exitCode === 0)) phase = 'Succeeded'
    else if (containers.every((c) => c.state === 'terminated')) phase = 'Failed'

    let display: string
    if (pod.deletedAt) display = 'Terminating'
    else if (!pod.nodeName) display = 'Pending'
    else {
      const notRunning = containers.find((c) => c.state !== 'running')
      display = notRunning?.reason ?? 'Running'
    }
    return {
      phase,
      display,
      ready: !pod.deletedAt && total > 0 && readyCount === total,
      readyCount: pod.deletedAt ? 0 : readyCount,
      total,
      restarts,
      lastRestartAt,
      containers,
    }
  }

  private containerState(pod: Pod, c: ContainerSpec, now: number): ContainerState {
    const outcome = this.containerOutcome(pod, c)
    const base = { name: c.name, image: c.image, outcome, restarts: pod.restartOffset }
    if (!pod.nodeName || !pod.scheduledAt) {
      return { ...base, ready: false, state: 'waiting', reason: 'Pending' }
    }
    if (!pod.runningSince) {
      const t = now - pod.scheduledAt
      let reason = 'ContainerCreating'
      if (outcome.kind === 'pull' && t >= CREATE_MS) reason = t < CREATE_MS + 4000 ? 'ErrImagePull' : 'ImagePullBackOff'
      if (outcome.kind === 'config' && t >= 1500) reason = 'CreateContainerConfigError'
      return { ...base, ready: false, state: 'waiting', reason }
    }
    if (outcome.kind === 'run' || outcome.kind === 'pull' || outcome.kind === 'config') {
      return { ...base, ready: true, state: 'running', startedAt: pod.runningSince }
    }

    // Container thoát: mô phỏng chu kỳ chạy → kết thúc → (CrashLoop)BackOff → khởi động lại
    const restartable =
      pod.spec.restartPolicy === 'Always' || (pod.spec.restartPolicy === 'OnFailure' && outcome.code !== 0)
    let t = now - pod.runningSince
    let restarts = pod.restartOffset
    let lastRestartAt: number | undefined
    let backoff = BACKOFF_START_MS
    let cycleStart = pod.runningSince
    let lastState: ContainerState['lastState']
    for (let guard = 0; guard < 100_000; guard++) {
      if (t < RUN_BEFORE_EXIT_MS) {
        return { ...base, ready: false, state: 'running', startedAt: cycleStart, restarts, lastRestartAt, lastState }
      }
      t -= RUN_BEFORE_EXIT_MS
      const finishedAt = cycleStart + RUN_BEFORE_EXIT_MS
      const terminated = {
        ...base,
        ready: false,
        state: 'terminated' as const,
        reason: outcome.reason,
        exitCode: outcome.code,
        startedAt: cycleStart,
        finishedAt,
        restarts,
        lastRestartAt,
        lastState,
      }
      if (!restartable || t < SHOW_EXIT_MS) return terminated
      t -= SHOW_EXIT_MS
      lastState = { reason: outcome.reason, exitCode: outcome.code, finishedAt, startedAt: cycleStart }
      if (t < backoff) {
        return {
          ...base,
          ready: false,
          state: 'waiting',
          reason: 'CrashLoopBackOff',
          restarts,
          lastRestartAt,
          lastState,
        }
      }
      t -= backoff
      cycleStart = finishedAt + SHOW_EXIT_MS + backoff
      restarts++
      lastRestartAt = cycleStart
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
    }
    return { ...base, ready: false, state: 'waiting', reason: 'CrashLoopBackOff', restarts, lastRestartAt }
  }

  isPodReady(pod: Pod, now = Date.now()): boolean {
    return !pod.deletedAt && this.podStatus(pod, now).ready
  }

  /** Cổng mà container của Pod đang thực sự lắng nghe (null nếu container không chạy). */
  listeningPorts(pod: Pod, now = Date.now()): number[] {
    const st = this.podStatus(pod, now)
    return st.containers
      .filter((c) => c.state === 'running' && c.outcome.kind === 'run')
      .map((c) => (c.outcome as { port: number }).port)
      .filter((p) => p > 0)
  }

  serviceEndpoints(svc: Service, now = Date.now()): { pod: Pod; port: number }[] {
    if (!Object.keys(svc.selector).length) return []
    const pods = this.state.pods.filter(
      (p) =>
        p.meta.namespace === svc.meta.namespace &&
        p.podIP &&
        matchLabels(svc.selector, p.meta.labels) &&
        this.isPodReady(p, now),
    )
    const sp = svc.ports[0]
    return pods.map((pod) => ({ pod, port: this.resolveTargetPort(pod, sp?.targetPort ?? 80) }))
  }

  resolveTargetPort(pod: Pod, target: number | string): number {
    if (typeof target === 'number') return target
    for (const c of pod.spec.containers) {
      const named = c.ports.find((p) => p.name === target)
      if (named) return named.containerPort
    }
    return Number(target) || 0
  }

  // ----- vòng lặp điều khiển -----

  tick(now = Date.now()) {
    const s = this.state
    // Namespace đang xóa: sau thời gian Terminating thì dọn sạch
    for (const ns of s.namespaces.filter((n) => n.deletedAt && now - n.deletedAt >= TERMINATE_MS)) {
      this.purgeNamespace(ns.meta.name)
    }
    // Dọn Pod đã hết thời gian Terminating
    for (const pod of [...s.pods]) {
      if (pod.deletedAt && (pod.forceDelete || now - pod.deletedAt >= TERMINATE_MS)) {
        s.pods.splice(s.pods.indexOf(pod), 1)
        if (pod.owner?.kind === 'Node' && this.namespaceExists(pod.meta.namespace)) {
          // kubelet tạo lại static Pod (mirror pod) với cùng tên
          const again = newPod(
            { ...pod.meta, uid: randomUid(), createdAt: now },
            pod.spec,
            pod.owner,
            pod.nodeName,
            pod.podIP,
            now,
          )
          s.pods.push(again)
        }
      }
    }
    for (const dep of s.deployments) if (!dep.paused) this.reconcileDeployment(dep, now)
    for (const rs of s.replicasets) this.reconcileReplicaSet(rs, now)
    for (const ds of s.daemonsets) this.reconcileDaemonSet(ds, now)

    for (const pod of s.pods) {
      if (pod.deletedAt) continue
      if (!pod.nodeName) this.trySchedule(pod, now)
      else this.evictIfNoExecute(pod, now)
      if (pod.nodeName && pod.scheduledAt && !pod.runningSince && !pod.deletedAt) {
        if (now - pod.scheduledAt >= CREATE_MS) {
          const blocked = pod.spec.containers
            .map((c) => this.containerOutcome(pod, c))
            .some((o) => o.kind === 'pull' || o.kind === 'config')
          if (!blocked) pod.runningSince = Math.max(pod.scheduledAt + CREATE_MS, now - 1000)
        }
      }
    }
  }

  purgeNamespace(ns: string) {
    const s = this.state
    const keep = <T extends { meta: { namespace: string } }>(arr: T[]) => arr.filter((x) => x.meta.namespace !== ns)
    s.pods = keep(s.pods)
    s.replicasets = keep(s.replicasets)
    s.deployments = keep(s.deployments)
    s.daemonsets = keep(s.daemonsets)
    s.services = keep(s.services)
    s.configmaps = keep(s.configmaps)
    s.secrets = keep(s.secrets)
    s.events = s.events.filter((e) => e.namespace !== ns)
    s.namespaces = s.namespaces.filter((n) => n.meta.name !== ns)
  }

  private intOrPercent(value: number | string, replicas: number, roundUp: boolean): number {
    if (typeof value === 'number') return value
    const m = /^(\d+)%$/.exec(value)
    if (!m) return Number(value) || 0
    const raw = (Number(m[1]) * replicas) / 100
    return roundUp ? Math.ceil(raw) : Math.floor(raw)
  }

  maxSurgeOf(dep: Deployment): number {
    return this.intOrPercent(dep.maxSurge, dep.replicas, true)
  }

  maxUnavailableOf(dep: Deployment): number {
    return this.intOrPercent(dep.maxUnavailable, dep.replicas, false)
  }

  private scaleReplicaSet(dep: Deployment | undefined, rs: ReplicaSet, to: number, now: number) {
    if (rs.replicas === to) return
    const from = rs.replicas
    rs.replicas = to
    if (dep) {
      this.event(
        {
          namespace: dep.meta.namespace,
          type: 'Normal',
          reason: 'ScalingReplicaSet',
          object: `deployment/${dep.meta.name}`,
          source: 'deployment-controller',
          message: `Scaled ${to > from ? 'up' : 'down'} replica set ${rs.meta.name} from ${from} to ${to}`,
        },
        now,
      )
    }
  }

  reconcileDeployment(dep: Deployment, now: number) {
    const s = this.state
    const ns = dep.meta.namespace
    const hash = templateHash(dep.template)
    const all = this.replicaSetsOf(dep)
    const maxRevision = all.reduce((m, rs) => Math.max(m, rs.revision), 0)
    let newRS = all.find((rs) => rs.hash === hash)
    if (!newRS) {
      newRS = {
        meta: {
          name: `${dep.meta.name}-${hash}`,
          namespace: ns,
          uid: randomUid(),
          labels: { ...dep.template.labels, 'pod-template-hash': hash },
          annotations: {},
          createdAt: now,
        },
        replicas: 0,
        selector: { ...dep.selector, 'pod-template-hash': hash },
        template: clone({
          ...dep.template,
          labels: { ...dep.template.labels, 'pod-template-hash': hash },
        }),
        hash,
        revision: maxRevision + 1,
        owner: dep.meta.name,
      }
      s.replicasets.push(newRS)
    } else if (newRS.revision < maxRevision) {
      newRS.revision = maxRevision + 1 // rollback dùng lại ReplicaSet cũ với revision mới
    }
    const cause = dep.meta.annotations['kubernetes.io/change-cause']
    if (cause) newRS.meta.annotations['kubernetes.io/change-cause'] = cause
    dep.meta.annotations['deployment.kubernetes.io/revision'] = String(newRS.revision)

    const olds = all.filter((rs) => rs !== newRS).sort((a, b) => a.revision - b.revision)
    const desired = dep.replicas
    const available = (rs: ReplicaSet) => this.podsOf(rs).filter((p) => this.isPodReady(p, now)).length

    if (dep.strategy === 'Recreate') {
      for (const old of olds) this.scaleReplicaSet(dep, old, 0, now)
      const oldAlive = olds.some((old) => this.podsOf(old, true).length > 0)
      if (!oldAlive) this.scaleReplicaSet(dep, newRS, desired, now)
    } else {
      const oldTotal = olds.reduce((sum, rs) => sum + rs.replicas, 0)
      if (oldTotal === 0 || desired === 0) {
        for (const old of olds) this.scaleReplicaSet(dep, old, 0, now)
        this.scaleReplicaSet(dep, newRS, desired, now)
      } else {
        const maxSurge = Math.max(this.maxSurgeOf(dep), this.maxUnavailableOf(dep) === 0 ? 1 : 0)
        const maxUnavailable = this.maxUnavailableOf(dep)
        if (newRS.replicas > desired) this.scaleReplicaSet(dep, newRS, desired, now)
        const total = newRS.replicas + oldTotal
        const room = desired + maxSurge - total
        if (newRS.replicas < desired && room > 0) {
          this.scaleReplicaSet(dep, newRS, newRS.replicas + Math.min(room, desired - newRS.replicas), now)
        }
        // Dọn bản sao cũ không khỏe trước (chúng không phục vụ được traffic)
        for (const old of olds) {
          const unhealthy = old.replicas - available(old)
          if (unhealthy > 0) this.scaleReplicaSet(dep, old, old.replicas - unhealthy, now)
        }
        const totalAvailable = available(newRS) + olds.reduce((sum, rs) => sum + available(rs), 0)
        let canRemove = totalAvailable - (desired - maxUnavailable)
        for (const old of olds) {
          if (canRemove <= 0) break
          const n = Math.min(old.replicas, canRemove)
          if (n > 0) {
            this.scaleReplicaSet(dep, old, old.replicas - n, now)
            canRemove -= n
          }
        }
      }
    }

    const sig = `${newRS.revision}:${newRS.replicas}:${available(newRS)}:${olds.map((o) => o.replicas).join(',')}`
    if (sig !== dep.progressSig) {
      dep.progressSig = sig
      dep.lastProgressAt = now
    }
  }

  reconcileReplicaSet(rs: ReplicaSet, now: number) {
    const s = this.state
    if (!this.namespaceExists(rs.meta.namespace)) return
    // Nhận nuôi Pod "mồ côi" khớp selector
    for (const pod of s.pods) {
      if (
        !pod.owner &&
        !pod.deletedAt &&
        pod.meta.namespace === rs.meta.namespace &&
        matchLabels(rs.selector, pod.meta.labels)
      ) {
        pod.owner = { kind: 'ReplicaSet', name: rs.meta.name }
      }
    }
    const pods = this.podsOf(rs)
    if (pods.length < rs.replicas) {
      for (let i = pods.length; i < rs.replicas; i++) {
        const name = `${rs.meta.name}-${randomSuffix()}`
        s.pods.push(
          newPod(
            {
              name,
              namespace: rs.meta.namespace,
              uid: randomUid(),
              labels: { ...rs.template.labels },
              annotations: { ...rs.template.annotations },
              createdAt: now,
            },
            clone(rs.template.spec),
            { kind: 'ReplicaSet', name: rs.meta.name },
            '',
            '',
            now,
          ),
        )
        this.event(
          {
            namespace: rs.meta.namespace,
            type: 'Normal',
            reason: 'SuccessfulCreate',
            object: `replicaset/${rs.meta.name}`,
            source: 'replicaset-controller',
            message: `Created pod: ${name}`,
          },
          now,
        )
      }
    } else if (pods.length > rs.replicas) {
      // Ưu tiên xóa Pod chưa xếp lịch → chưa sẵn sàng → mới nhất
      const ranked = [...pods].sort((a, b) => {
        const score = (p: Pod) => (p.nodeName ? 0 : 2) + (this.isPodReady(p, now) ? 0 : 1)
        return score(b) - score(a) || b.meta.createdAt - a.meta.createdAt
      })
      for (const pod of ranked.slice(0, pods.length - rs.replicas)) {
        this.markDeleted(pod, now)
        this.event(
          {
            namespace: rs.meta.namespace,
            type: 'Normal',
            reason: 'SuccessfulDelete',
            object: `replicaset/${rs.meta.name}`,
            source: 'replicaset-controller',
            message: `Deleted pod: ${pod.meta.name}`,
          },
          now,
        )
      }
    }
  }

  reconcileDaemonSet(ds: DaemonSet, now: number) {
    const s = this.state
    for (const node of s.nodes) {
      const eligible =
        matchLabels(ds.template.spec.nodeSelector, node.meta.labels) &&
        node.taints.every(
          (t) => t.effect === 'PreferNoSchedule' || tolerates(ds.template.spec.tolerations, t),
        )
      const existing = s.pods.find(
        (p) =>
          p.owner?.kind === 'DaemonSet' &&
          p.owner.name === ds.meta.name &&
          p.meta.namespace === ds.meta.namespace &&
          p.nodeName === node.meta.name &&
          !p.deletedAt,
      )
      if (eligible && !existing) {
        const hostNetwork = ds.meta.namespace === 'kube-system'
        const pod = newPod(
          {
            name: `${ds.meta.name}-${randomSuffix()}`,
            namespace: ds.meta.namespace,
            uid: randomUid(),
            labels: { ...ds.template.labels, 'controller-revision-hash': templateHash(ds.template).slice(0, 8) },
            annotations: {},
            createdAt: now,
          },
          clone(ds.template.spec),
          { kind: 'DaemonSet', name: ds.meta.name },
          node.meta.name,
          hostNetwork ? node.ip : this.allocatePodIP(node),
          now,
        )
        s.pods.push(pod)
        this.event(
          {
            namespace: ds.meta.namespace,
            type: 'Normal',
            reason: 'SuccessfulCreate',
            object: `daemonset/${ds.meta.name}`,
            source: 'daemonset-controller',
            message: `Created pod: ${pod.meta.name}`,
          },
          now,
        )
      } else if (!eligible && existing) {
        this.markDeleted(existing, now)
      }
    }
  }

  allocatePodIP(node: Node): string {
    const octet = node.podCIDR.split('.')[2]
    const ip = `10.244.${octet}.${node.nextIP}`
    node.nextIP = node.nextIP >= 254 ? 2 : node.nextIP + 1
    return ip
  }

  podRequests(pod: Pod): { cpu: number; memory: number } {
    return pod.spec.containers.reduce(
      (acc, c) => ({
        cpu: acc.cpu + parseCpu(c.resources?.requests?.cpu ?? c.resources?.limits?.cpu),
        memory: acc.memory + parseMemory(c.resources?.requests?.memory ?? c.resources?.limits?.memory),
      }),
      { cpu: 0, memory: 0 },
    )
  }

  nodeRejectReason(node: Node, pod: Pod): string | null {
    if (node.unschedulable) return 'node(s) were unschedulable'
    for (const taint of node.taints) {
      if (taint.effect !== 'PreferNoSchedule' && !tolerates(pod.spec.tolerations, taint)) {
        return `node(s) had untolerated taint {${taint.key}: ${taint.value ?? ''}}`
      }
    }
    if (!matchLabels(pod.spec.nodeSelector, node.meta.labels)) {
      return "node(s) didn't match Pod's node affinity/selector"
    }
    const req = this.podRequests(pod)
    const used = this.state.pods
      .filter((p) => p.nodeName === node.meta.name && !p.deletedAt && p !== pod)
      .reduce(
        (acc, p) => {
          const r = this.podRequests(p)
          return { cpu: acc.cpu + r.cpu, memory: acc.memory + r.memory }
        },
        { cpu: 0, memory: 0 },
      )
    if (req.cpu > 0 && used.cpu + req.cpu > NODE_CPU) return 'Insufficient cpu'
    if (req.memory > 0 && used.memory + req.memory > NODE_MEMORY) return 'Insufficient memory'
    return null
  }

  trySchedule(pod: Pod, now: number): boolean {
    const nodes = this.state.nodes
    const reasons = new Map<string, number>()
    const candidates: Node[] = []
    for (const node of nodes) {
      const reason = this.nodeRejectReason(node, pod)
      if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
      else candidates.push(node)
    }
    if (!candidates.length) {
      const detail = [...reasons.entries()].map(([r, c]) => `${c} ${r}`).join(', ')
      const message =
        `0/${nodes.length} nodes are available: ${detail}. preemption: 0/${nodes.length} nodes are available: ` +
        `${nodes.length} Preemption is not helpful for scheduling.`
      if (pod.schedulingMessage !== message) {
        pod.schedulingMessage = message
        this.event(
          {
            namespace: pod.meta.namespace,
            type: 'Warning',
            reason: 'FailedScheduling',
            object: `pod/${pod.meta.name}`,
            source: 'default-scheduler',
            message,
          },
          now,
        )
      }
      return false
    }
    const load = (n: Node) => this.state.pods.filter((p) => p.nodeName === n.meta.name && !p.deletedAt).length
    const node = candidates.sort((a, b) => load(a) - load(b) || a.meta.name.localeCompare(b.meta.name))[0]
    pod.nodeName = node.meta.name
    pod.scheduledAt = now
    pod.podIP = this.allocatePodIP(node)
    pod.schedulingMessage = undefined
    return true
  }

  evictIfNoExecute(pod: Pod, now: number) {
    const node = this.findNode(pod.nodeName)
    if (!node || pod.owner?.kind === 'Node') return
    const taint = node.taints.find((t) => t.effect === 'NoExecute' && !tolerates(pod.spec.tolerations, t))
    if (taint) {
      this.markDeleted(pod, now)
      this.event(
        {
          namespace: pod.meta.namespace,
          type: 'Normal',
          reason: 'TaintManagerEviction',
          object: `pod/${pod.meta.name}`,
          source: 'taint-eviction-controller',
          message: `Marking for deletion Pod ${pod.meta.namespace}/${pod.meta.name}`,
        },
        now,
      )
    }
  }

  markDeleted(pod: Pod, now: number, force = false) {
    if (pod.deletedAt) {
      if (force) pod.forceDelete = true
      return
    }
    pod.deletedAt = now
    pod.forceDelete = force
    if (pod.nodeName && !force) {
      for (const c of pod.spec.containers) {
        this.event(
          {
            namespace: pod.meta.namespace,
            type: 'Normal',
            reason: 'Killing',
            object: `pod/${pod.meta.name}`,
            source: 'kubelet',
            message: `Stopping container ${c.name}`,
          },
          now,
        )
      }
    }
  }

  // ----- trạng thái Deployment -----

  deploymentStatus(dep: Deployment, now = Date.now()) {
    const newRS = this.newReplicaSet(dep)
    const pods = this.podsOfDeployment(dep)
    const updated = newRS ? this.podsOf(newRS).length : 0
    const ready = pods.filter((p) => this.isPodReady(p, now)).length
    const updatedAvailable = newRS ? this.podsOf(newRS).filter((p) => this.isPodReady(p, now)).length : 0
    const oldReplicas = this.replicaSetsOf(dep)
      .filter((rs) => rs !== newRS)
      .reduce((s, rs) => s + this.podsOf(rs).length, 0)
    const complete =
      updated === dep.replicas && updatedAvailable === dep.replicas && oldReplicas === 0 && pods.length === dep.replicas
    const deadlineExceeded = !complete && now - dep.lastProgressAt > dep.progressDeadlineSeconds * 1000
    return {
      replicas: pods.length,
      updated,
      ready,
      available: ready,
      updatedAvailable,
      oldReplicas,
      complete,
      deadlineExceeded,
    }
  }

  rolloutMessage(dep: Deployment, now = Date.now()): { text: string; done: boolean; error?: boolean } {
    const st = this.deploymentStatus(dep, now)
    const name = dep.meta.name
    if (st.deadlineExceeded) return { text: `error: deployment "${name}" exceeded its progress deadline`, done: true, error: true }
    if (st.updated < dep.replicas) {
      return {
        text: `Waiting for deployment "${name}" rollout to finish: ${st.updated} out of ${dep.replicas} new replicas have been updated...`,
        done: false,
      }
    }
    if (st.replicas > st.updated) {
      return {
        text: `Waiting for deployment "${name}" rollout to finish: ${st.replicas - st.updated} old replicas are pending termination...`,
        done: false,
      }
    }
    if (st.updatedAvailable < st.updated) {
      return {
        text: `Waiting for deployment "${name}" rollout to finish: ${st.updatedAvailable} of ${st.updated} updated replicas are available...`,
        done: false,
      }
    }
    return { text: `deployment "${name}" successfully rolled out`, done: true }
  }

  // ----- sự kiện của Pod (tính từ dấu thời gian) -----

  podEvents(pod: Pod, now = Date.now()): KEvent[] {
    const out: KEvent[] = []
    const ns = pod.meta.namespace
    const object = `pod/${pod.meta.name}`
    const add = (time: number, type: KEvent['type'], reason: string, source: string, message: string) => {
      if (time <= now) out.push({ namespace: ns, type, reason, source, message, object, time })
    }
    if (!pod.scheduledAt) return out
    if (pod.owner?.kind !== 'Node') {
      add(pod.scheduledAt, 'Normal', 'Scheduled', 'default-scheduler', `Successfully assigned ${ns}/${pod.meta.name} to ${pod.nodeName}`)
    }
    const st = this.podStatus(pod, now)
    for (const c of st.containers) {
      const o = c.outcome
      add(pod.scheduledAt + 300, 'Normal', 'Pulling', 'kubelet', `Pulling image "${c.image}"`)
      if (o.kind === 'pull') {
        add(pod.scheduledAt + CREATE_MS, 'Warning', 'Failed', 'kubelet', `Failed to pull image "${c.image}": ${o.message}`)
        add(pod.scheduledAt + CREATE_MS, 'Warning', 'Failed', 'kubelet', 'Error: ErrImagePull')
        add(pod.scheduledAt + CREATE_MS + 4000, 'Normal', 'BackOff', 'kubelet', `Back-off pulling image "${c.image}"`)
        add(pod.scheduledAt + CREATE_MS + 4000, 'Warning', 'Failed', 'kubelet', 'Error: ImagePullBackOff')
        continue
      }
      add(
        pod.scheduledAt + 2000,
        'Normal',
        'Pulled',
        'kubelet',
        `Successfully pulled image "${c.image}" in 1.68s (1.68s including waiting). Image size: 72223947 bytes.`,
      )
      if (o.kind === 'config' && !pod.runningSince) {
        add(pod.scheduledAt + 1500, 'Warning', 'Failed', 'kubelet', `Error: ${o.message}`)
        continue
      }
      if (pod.runningSince) {
        add(pod.runningSince, 'Normal', 'Created', 'kubelet', `Created container: ${c.name}`)
        add(pod.runningSince, 'Normal', 'Started', 'kubelet', `Started container ${c.name}`)
      }
      if (c.reason === 'CrashLoopBackOff' || (c.lastState && c.restarts > 0)) {
        add(
          (c.lastState?.finishedAt ?? now) + SHOW_EXIT_MS,
          'Warning',
          'BackOff',
          'kubelet',
          `Back-off restarting failed container ${c.name} in pod ${pod.meta.name}_${ns}(${pod.meta.uid})`,
        )
      }
    }
    if (pod.schedulingMessage) {
      add(pod.meta.createdAt, 'Warning', 'FailedScheduling', 'default-scheduler', pod.schedulingMessage)
    }
    return out
  }

  allEvents(now = Date.now()): KEvent[] {
    const podEvents = this.state.pods.filter((p) => p.owner?.kind !== 'Node').flatMap((p) => this.podEvents(p, now))
    return [...this.state.events, ...podEvents].sort((a, b) => a.time - b.time)
  }
}

export function tolerates(tolerations: PodSpec['tolerations'], taint: Taint): boolean {
  return tolerations.some((t) => {
    const effectOk = !t.effect || t.effect === taint.effect
    if (!effectOk) return false
    if (t.operator === 'Exists') return !t.key || t.key === taint.key
    return t.key === taint.key && (t.value ?? '') === (taint.value ?? '')
  })
}

function safeDecode(value: string): string {
  try {
    return b64decode(value)
  } catch {
    return value
  }
}

export function ageOf(createdAt: number, now = Date.now()): string {
  return humanDuration(now - createdAt)
}

// ---------------------------------------------------------------------------
// Log mẫu
// ---------------------------------------------------------------------------

const HELLO_WORLD = [
  '',
  'Hello from Docker!',
  'This message shows that your installation appears to be working correctly.',
  '',
  'To generate this message, Docker took the following steps:',
  ' 1. The Docker client contacted the Docker daemon.',
  ' 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.',
  ' 3. The Docker daemon created a new container from that image which runs the',
  '    executable that produces the output you are currently reading.',
  ' 4. The Docker daemon streamed that output to the Docker client, which sent it',
  '    to your terminal.',
]

const POSTGRES_NO_PASSWORD = [
  'Error: Database is uninitialized and superuser password is not specified.',
  '       You must specify POSTGRES_PASSWORD to a non-empty value for the',
  '       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".',
  '',
  '       You may also use "POSTGRES_HOST_AUTH_METHOD=trust" to allow all',
  '       connections without a password. This is *not* recommended.',
  '',
  '       See PostgreSQL documentation about "trust":',
  '       https://www.postgresql.org/docs/current/auth-trust.html',
]

const MYSQL_NO_PASSWORD = [
  '[ERROR] [Entrypoint]: Database is uninitialized and password option is not specified',
  '    You need to specify one of the following as an environment variable:',
  '    - MYSQL_ROOT_PASSWORD',
  '    - MYSQL_ALLOW_EMPTY_PASSWORD',
  '    - MYSQL_RANDOM_ROOT_PASSWORD',
]
