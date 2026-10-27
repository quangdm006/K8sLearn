// Chuyển qua lại giữa đối tượng trong bộ mô phỏng và manifest Kubernetes (YAML/JSON).
import type { Cluster } from './cluster'
import { SERVER_VERSION } from './cluster'
import type {
  ConfigMap,
  ContainerSpec,
  DaemonSet,
  Deployment,
  Namespace,
  Node,
  Pod,
  PodSpec,
  PodTemplate,
  ReplicaSet,
  Secret,
  Service,
} from './types'
import { isoTime } from './util'

type Obj = Record<string, unknown>

// ---------------------------------------------------------------------------
// Đối tượng → manifest
// ---------------------------------------------------------------------------

function metadata(m: Pod['meta'], extra: Obj = {}): Obj {
  const out: Obj = {
    annotations: Object.keys(m.annotations).length ? m.annotations : undefined,
    creationTimestamp: isoTime(m.createdAt),
    labels: Object.keys(m.labels).length ? m.labels : undefined,
    name: m.name,
    namespace: m.namespace || undefined,
    resourceVersion: String(100000 + (Math.abs(hashCode(m.uid)) % 900000)),
    uid: m.uid,
    ...extra,
  }
  return prune(out)
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

function prune<T extends Obj>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

export function containerManifest(c: ContainerSpec): Obj {
  return prune({
    args: c.args?.length ? c.args : undefined,
    command: c.command?.length ? c.command : undefined,
    env: c.env.length
      ? c.env.map((e) =>
          prune({
            name: e.name,
            value: e.value,
            valueFrom: e.configMapKeyRef
              ? { configMapKeyRef: e.configMapKeyRef }
              : e.secretKeyRef
                ? { secretKeyRef: e.secretKeyRef }
                : e.fieldPath
                  ? { fieldRef: { apiVersion: 'v1', fieldPath: e.fieldPath } }
                  : undefined,
          }),
        )
      : undefined,
    envFrom: c.envFrom.length
      ? c.envFrom.map((f) =>
          prune({
            configMapRef: f.configMapRef ? { name: f.configMapRef } : undefined,
            prefix: f.prefix,
            secretRef: f.secretRef ? { name: f.secretRef } : undefined,
          }),
        )
      : undefined,
    image: c.image,
    imagePullPolicy: /:latest$|^[^:]+$/.test(c.image.split('/').pop() ?? '') ? 'Always' : 'IfNotPresent',
    name: c.name,
    ports: c.ports.length ? c.ports.map((p) => prune({ containerPort: p.containerPort, name: p.name, protocol: 'TCP' })) : undefined,
    resources: c.resources ?? {},
    terminationMessagePath: '/dev/termination-log',
    terminationMessagePolicy: 'File',
  })
}

function podSpecManifest(spec: PodSpec, extra: Obj = {}): Obj {
  return prune({
    containers: spec.containers.map(containerManifest),
    dnsPolicy: 'ClusterFirst',
    enableServiceLinks: true,
    nodeSelector: Object.keys(spec.nodeSelector).length ? spec.nodeSelector : undefined,
    restartPolicy: spec.restartPolicy,
    schedulerName: 'default-scheduler',
    securityContext: {},
    terminationGracePeriodSeconds: 30,
    tolerations: spec.tolerations.length ? spec.tolerations : undefined,
    ...extra,
  })
}

function templateManifest(t: PodTemplate): Obj {
  return {
    metadata: prune({
      annotations: Object.keys(t.annotations).length ? t.annotations : undefined,
      labels: t.labels,
    }),
    spec: podSpecManifest(t.spec),
  }
}

export function podManifest(cluster: Cluster, pod: Pod, now = Date.now()): Obj {
  const st = cluster.podStatus(pod, now)
  const node = cluster.findNode(pod.nodeName)
  const owner = pod.owner
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: metadata(pod.meta, {
      deletionTimestamp: pod.deletedAt ? isoTime(pod.deletedAt) : undefined,
      ownerReferences:
        owner && owner.kind !== 'Node'
          ? [
              {
                apiVersion: 'apps/v1',
                blockOwnerDeletion: true,
                controller: true,
                kind: owner.kind,
                name: owner.name,
                uid: '…',
              },
            ]
          : undefined,
    }),
    spec: podSpecManifest(pod.spec, {
      nodeName: pod.nodeName || undefined,
      preemptionPolicy: 'PreemptLowerPriority',
      priority: 0,
      serviceAccount: 'default',
      serviceAccountName: 'default',
      tolerations: [
        ...pod.spec.tolerations,
        { effect: 'NoExecute', key: 'node.kubernetes.io/not-ready', operator: 'Exists', tolerationSeconds: 300 },
        { effect: 'NoExecute', key: 'node.kubernetes.io/unreachable', operator: 'Exists', tolerationSeconds: 300 },
      ],
    }),
    status: prune({
      conditions: [
        { status: pod.runningSince ? 'True' : 'False', type: 'PodReadyToStartContainers' },
        { status: pod.scheduledAt ? 'True' : 'False', type: 'Initialized' },
        { status: st.ready ? 'True' : 'False', type: 'Ready' },
        { status: st.ready ? 'True' : 'False', type: 'ContainersReady' },
        prune({
          message: pod.schedulingMessage,
          reason: pod.schedulingMessage ? 'Unschedulable' : undefined,
          status: pod.nodeName ? 'True' : 'False',
          type: 'PodScheduled',
        }),
      ],
      containerStatuses: pod.scheduledAt
        ? st.containers.map((c) =>
            prune({
              image: c.image,
              lastState: c.lastState
                ? { terminated: { exitCode: c.lastState.exitCode, reason: c.lastState.reason, finishedAt: isoTime(c.lastState.finishedAt) } }
                : {},
              name: c.name,
              ready: c.ready,
              restartCount: c.restarts,
              started: c.state === 'running',
              state:
                c.state === 'running'
                  ? { running: { startedAt: isoTime(c.startedAt ?? now) } }
                  : c.state === 'terminated'
                    ? { terminated: { exitCode: c.exitCode, reason: c.reason } }
                    : { waiting: { reason: c.reason } },
            }),
          )
        : undefined,
      hostIP: node?.ip,
      phase: st.phase,
      podIP: pod.podIP || undefined,
      podIPs: pod.podIP ? [{ ip: pod.podIP }] : undefined,
      qosClass: qosClass(pod),
      startTime: pod.scheduledAt ? isoTime(pod.scheduledAt) : undefined,
    }),
  }
}

export function qosClass(pod: Pod): string {
  const cs = pod.spec.containers
  const has = (c: ContainerSpec) =>
    !!(c.resources?.requests && Object.keys(c.resources.requests).length) ||
    !!(c.resources?.limits && Object.keys(c.resources.limits).length)
  if (!cs.some(has)) return 'BestEffort'
  const guaranteed = cs.every((c) => {
    const l = c.resources?.limits ?? {}
    const r = { ...l, ...(c.resources?.requests ?? {}) }
    return !!l.cpu && !!l.memory && r.cpu === l.cpu && r.memory === l.memory
  })
  return guaranteed ? 'Guaranteed' : 'Burstable'
}

export function deploymentManifest(cluster: Cluster, dep: Deployment, now = Date.now()): Obj {
  const st = cluster.deploymentStatus(dep, now)
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: metadata(dep.meta, { generation: 1 }),
    spec: {
      progressDeadlineSeconds: dep.progressDeadlineSeconds,
      replicas: dep.replicas,
      revisionHistoryLimit: 10,
      selector: { matchLabels: dep.selector },
      strategy:
        dep.strategy === 'Recreate'
          ? { type: 'Recreate' }
          : { rollingUpdate: { maxSurge: dep.maxSurge, maxUnavailable: dep.maxUnavailable }, type: 'RollingUpdate' },
      template: templateManifest(dep.template),
    },
    status: prune({
      availableReplicas: st.available || undefined,
      conditions: [
        {
          message:
            st.available >= dep.replicas - cluster.maxUnavailableOf(dep)
              ? 'Deployment has minimum availability.'
              : 'Deployment does not have minimum availability.',
          reason:
            st.available >= dep.replicas - cluster.maxUnavailableOf(dep)
              ? 'MinimumReplicasAvailable'
              : 'MinimumReplicasUnavailable',
          status: st.available >= dep.replicas - cluster.maxUnavailableOf(dep) ? 'True' : 'False',
          type: 'Available',
        },
        {
          message: st.deadlineExceeded
            ? `ReplicaSet "${cluster.newReplicaSet(dep)?.meta.name}" has timed out progressing.`
            : st.complete
              ? `ReplicaSet "${cluster.newReplicaSet(dep)?.meta.name}" has successfully progressed.`
              : `ReplicaSet "${cluster.newReplicaSet(dep)?.meta.name}" is progressing.`,
          reason: st.deadlineExceeded ? 'ProgressDeadlineExceeded' : st.complete ? 'NewReplicaSetAvailable' : 'ReplicaSetUpdated',
          status: st.deadlineExceeded ? 'False' : 'True',
          type: 'Progressing',
        },
      ],
      observedGeneration: 1,
      readyReplicas: st.ready || undefined,
      replicas: st.replicas || undefined,
      updatedReplicas: st.updated || undefined,
    }),
  }
}

export function replicaSetManifest(cluster: Cluster, rs: ReplicaSet, now = Date.now()): Obj {
  const pods = cluster.podsOf(rs)
  const ready = pods.filter((p) => cluster.isPodReady(p, now)).length
  return {
    apiVersion: 'apps/v1',
    kind: 'ReplicaSet',
    metadata: metadata(rs.meta, {
      annotations: {
        ...rs.meta.annotations,
        'deployment.kubernetes.io/revision': String(rs.revision),
      },
      ownerReferences: rs.owner
        ? [{ apiVersion: 'apps/v1', blockOwnerDeletion: true, controller: true, kind: 'Deployment', name: rs.owner, uid: '…' }]
        : undefined,
    }),
    spec: { replicas: rs.replicas, selector: { matchLabels: rs.selector }, template: templateManifest(rs.template) },
    status: prune({ availableReplicas: ready || undefined, readyReplicas: ready || undefined, replicas: pods.length }),
  }
}

export function daemonSetManifest(cluster: Cluster, ds: DaemonSet, now = Date.now()): Obj {
  const pods = cluster.state.pods.filter((p) => p.owner?.kind === 'DaemonSet' && p.owner.name === ds.meta.name && p.meta.namespace === ds.meta.namespace && !p.deletedAt)
  const ready = pods.filter((p) => cluster.isPodReady(p, now)).length
  return {
    apiVersion: 'apps/v1',
    kind: 'DaemonSet',
    metadata: metadata(ds.meta),
    spec: { selector: { matchLabels: ds.selector }, template: templateManifest(ds.template), updateStrategy: { type: 'RollingUpdate' } },
    status: { currentNumberScheduled: pods.length, desiredNumberScheduled: pods.length, numberReady: ready },
  }
}

export function serviceManifest(svc: Service): Obj {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: metadata(svc.meta),
    spec: prune({
      clusterIP: svc.clusterIP,
      clusterIPs: [svc.clusterIP],
      externalTrafficPolicy: svc.type === 'ClusterIP' ? undefined : 'Cluster',
      internalTrafficPolicy: 'Cluster',
      ipFamilies: ['IPv4'],
      ipFamilyPolicy: 'SingleStack',
      ports: svc.ports.map((p) => prune({ name: p.name, nodePort: p.nodePort, port: p.port, protocol: p.protocol, targetPort: p.targetPort })),
      selector: Object.keys(svc.selector).length ? svc.selector : undefined,
      sessionAffinity: 'None',
      type: svc.type,
    }),
    status: { loadBalancer: {} },
  }
}

export function configMapManifest(cm: ConfigMap): Obj {
  return { apiVersion: 'v1', data: cm.data, kind: 'ConfigMap', metadata: metadata(cm.meta) }
}

export function secretManifest(s: Secret): Obj {
  return { apiVersion: 'v1', data: s.data, kind: 'Secret', metadata: metadata(s.meta), type: s.type }
}

export function namespaceManifest(ns: Namespace): Obj {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: metadata(ns.meta),
    spec: { finalizers: ['kubernetes'] },
    status: { phase: ns.deletedAt ? 'Terminating' : 'Active' },
  }
}

export function nodeManifest(node: Node): Obj {
  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: metadata(node.meta),
    spec: prune({
      podCIDR: node.podCIDR,
      podCIDRs: [node.podCIDR],
      providerID: `kind://docker/k8s-learn/${node.meta.name}`,
      taints: node.taints.length ? node.taints : undefined,
      unschedulable: node.unschedulable || undefined,
    }),
    status: {
      addresses: [
        { address: node.ip, type: 'InternalIP' },
        { address: node.meta.name, type: 'Hostname' },
      ],
      allocatable: { cpu: '8', 'ephemeral-storage': '102626232Ki', memory: '16252928Ki', pods: '110' },
      capacity: { cpu: '8', 'ephemeral-storage': '102626232Ki', memory: '16252928Ki', pods: '110' },
      conditions: [
        { reason: 'KubeletHasSufficientMemory', status: 'False', type: 'MemoryPressure' },
        { reason: 'KubeletHasNoDiskPressure', status: 'False', type: 'DiskPressure' },
        { reason: 'KubeletHasSufficientPID', status: 'False', type: 'PIDPressure' },
        { reason: 'KubeletReady', status: 'True', type: 'Ready' },
      ],
      nodeInfo: {
        architecture: 'amd64',
        containerRuntimeVersion: 'containerd://2.1.4',
        kernelVersion: '6.10.14-linuxkit',
        kubeProxyVersion: '',
        kubeletVersion: SERVER_VERSION,
        operatingSystem: 'linux',
        osImage: 'Debian GNU/Linux 12 (bookworm)',
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Manifest (YAML) → đối tượng: kiểm tra trường lạ, kiểu dữ liệu, giá trị hợp lệ
// ---------------------------------------------------------------------------

/** decode = lỗi giải mã kiểu dữ liệu (BadRequest); ngược lại là lỗi validation (Invalid). */
export class ApplyError extends Error {
  constructor(
    message: string,
    public decode = false,
  ) {
    super(message)
  }
}

/** Lược đồ rút gọn để phát hiện trường gõ sai: 1 = trường lá, '*' = chấp nhận mọi thứ. */
type Schema = 1 | '*' | { [key: string]: Schema } | [Schema]

const META: Schema = {
  name: 1, namespace: 1, labels: '*', annotations: '*', generateName: 1, uid: 1, resourceVersion: 1,
  creationTimestamp: 1, ownerReferences: '*', finalizers: '*', managedFields: '*', generation: 1,
  deletionTimestamp: 1, deletionGracePeriodSeconds: 1, selfLink: 1,
}
const CONTAINER: Schema = {
  name: 1, image: 1, imagePullPolicy: 1, command: '*', args: '*', workingDir: 1,
  ports: [{ containerPort: 1, name: 1, protocol: 1, hostPort: 1, hostIP: 1 }],
  env: [{ name: 1, value: 1, valueFrom: '*' }], envFrom: '*', resources: '*', resizePolicy: '*',
  volumeMounts: '*', volumeDevices: '*', livenessProbe: '*', readinessProbe: '*', startupProbe: '*',
  lifecycle: '*', securityContext: '*', stdin: 1, stdinOnce: 1, tty: 1, terminationMessagePath: 1,
  terminationMessagePolicy: 1, restartPolicy: 1, restartPolicyRules: '*',
}
const POD_SPEC: Schema = {
  containers: [CONTAINER], initContainers: [CONTAINER], ephemeralContainers: '*', restartPolicy: 1,
  nodeSelector: '*', nodeName: 1, tolerations: '*', affinity: '*', volumes: '*', serviceAccountName: 1,
  serviceAccount: 1, automountServiceAccountToken: 1, securityContext: '*', terminationGracePeriodSeconds: 1,
  activeDeadlineSeconds: 1, dnsPolicy: 1, dnsConfig: '*', hostname: 1, subdomain: 1, hostNetwork: 1,
  hostPID: 1, hostIPC: 1, hostUsers: 1, imagePullSecrets: '*', priorityClassName: 1, priority: 1,
  preemptionPolicy: 1, schedulerName: 1, topologySpreadConstraints: '*', enableServiceLinks: 1,
  shareProcessNamespace: 1, runtimeClassName: 1, readinessGates: '*', overhead: '*', os: '*',
  setHostnameAsFQDN: 1, hostAliases: '*', resources: '*', resourceClaims: '*', schedulingGates: '*',
}
const TEMPLATE: Schema = { metadata: META, spec: POD_SPEC }
const SELECTOR: Schema = { matchLabels: '*', matchExpressions: '*' }
const BASE = { apiVersion: 1, kind: 1, metadata: META } as const

const SCHEMAS: Record<string, Schema> = {
  Pod: { ...BASE, spec: POD_SPEC, status: '*' },
  Deployment: {
    ...BASE,
    spec: {
      replicas: 1, selector: SELECTOR, template: TEMPLATE, strategy: '*', minReadySeconds: 1,
      revisionHistoryLimit: 1, progressDeadlineSeconds: 1, paused: 1,
    },
    status: '*',
  },
  ReplicaSet: { ...BASE, spec: { replicas: 1, selector: SELECTOR, template: TEMPLATE, minReadySeconds: 1 }, status: '*' },
  DaemonSet: {
    ...BASE,
    spec: { selector: SELECTOR, template: TEMPLATE, updateStrategy: '*', minReadySeconds: 1, revisionHistoryLimit: 1 },
    status: '*',
  },
  Service: {
    ...BASE,
    spec: {
      type: 1, selector: '*', clusterIP: 1, clusterIPs: '*', externalTrafficPolicy: 1, internalTrafficPolicy: 1,
      sessionAffinity: 1, sessionAffinityConfig: '*', externalName: 1, externalIPs: '*', ipFamilyPolicy: 1,
      ipFamilies: '*', loadBalancerIP: 1, loadBalancerClass: 1, loadBalancerSourceRanges: '*',
      publishNotReadyAddresses: 1, allocateLoadBalancerNodePorts: 1, healthCheckNodePort: 1, trafficDistribution: 1,
      ports: [{ name: 1, port: 1, targetPort: 1, nodePort: 1, protocol: 1, appProtocol: 1 }],
    },
    status: '*',
  },
  ConfigMap: { ...BASE, data: '*', binaryData: '*', immutable: 1 },
  Secret: { ...BASE, data: '*', stringData: '*', type: 1, immutable: 1 },
  Namespace: { ...BASE, spec: '*', status: '*' },
}

export const API_VERSIONS: Record<string, string> = {
  Pod: 'v1',
  Service: 'v1',
  ConfigMap: 'v1',
  Secret: 'v1',
  Namespace: 'v1',
  Deployment: 'apps/v1',
  ReplicaSet: 'apps/v1',
  DaemonSet: 'apps/v1',
}

/** Kind có thật trong Kubernetes nhưng chưa được mô phỏng. */
export const UNSUPPORTED_KINDS: Record<string, string> = {
  StatefulSet: 'apps/v1', Job: 'batch/v1', CronJob: 'batch/v1', Ingress: 'networking.k8s.io/v1',
  NetworkPolicy: 'networking.k8s.io/v1', PersistentVolumeClaim: 'v1', PersistentVolume: 'v1',
  HorizontalPodAutoscaler: 'autoscaling/v2', ServiceAccount: 'v1', Role: 'rbac.authorization.k8s.io/v1',
  RoleBinding: 'rbac.authorization.k8s.io/v1', ClusterRole: 'rbac.authorization.k8s.io/v1',
  ClusterRoleBinding: 'rbac.authorization.k8s.io/v1', PodDisruptionBudget: 'policy/v1',
  LimitRange: 'v1', ResourceQuota: 'v1', StorageClass: 'storage.k8s.io/v1',
  Gateway: 'gateway.networking.k8s.io/v1', HTTPRoute: 'gateway.networking.k8s.io/v1',
}

/** Trả về đường dẫn trường lạ đầu tiên (kiểu kubectl: spec.containers[0].imagee) */
export function unknownField(value: unknown, schema: Schema, path = ''): string | null {
  if (schema === 1 || schema === '*' || value === null || value === undefined) return null
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) return null
    for (let i = 0; i < value.length; i++) {
      const found = unknownField(value[i], schema[0], `${path}[${i}]`)
      if (found) return found
    }
    return null
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null
  for (const [key, child] of Object.entries(value as Obj)) {
    const sub = (schema as Record<string, Schema>)[key]
    const childPath = path ? `${path}.${key}` : key
    if (sub === undefined) return childPath
    const found = unknownField(child, sub, childPath)
    if (found) return found
  }
  return null
}

export function schemaFor(kind: string): Schema | undefined {
  return SCHEMAS[kind]
}

/** Lỗi giải mã kiểu dữ liệu, mô phỏng thông báo của API server (Go). */
export function typeError(kind: string, goField: string, path: string, value: unknown, want: string): ApplyError {
  const got = typeof value === 'number' ? 'number' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value
  return new ApplyError(
    `${kind} in version "v1" cannot be handled as a ${kind}: json: cannot unmarshal ${got} into Go struct field ${goField}.${path.replace(/\[\d+\]/g, '')} of type ${want}`,
    true,
  )
}

export function asObj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
}

export function stringMap(kind: string, v: unknown, path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(asObj(v))) {
    if (typeof val !== 'string') throw typeError(kind, 'ObjectMeta', path, val, 'string')
    out[k] = val
  }
  return out
}

export function parseContainer(kind: string, raw: unknown, path: string): ContainerSpec {
  const c = asObj(raw)
  const strings = (v: unknown, field: string): string[] | undefined => {
    if (v === undefined) return undefined
    if (!Array.isArray(v)) throw typeError(kind, 'Container', `${path}.${field}`, v, '[]string')
    return v.map((x) => {
      if (typeof x !== 'string') throw typeError(kind, 'Container', `${path}.${field}`, x, 'string')
      return x
    })
  }
  const env = (Array.isArray(c.env) ? c.env : []).map((e: unknown, i: number) => {
    const o = asObj(e)
    if (o.value !== undefined && typeof o.value !== 'string') {
      throw typeError(kind, 'EnvVar', `${path}.env.value`, o.value, 'string')
    }
    const from = asObj(o.valueFrom)
    const cm = asObj(from.configMapKeyRef)
    const sec = asObj(from.secretKeyRef)
    const field = asObj(from.fieldRef)
    if (!o.name) throw new ApplyError(`${path}.env[${i}].name: Required value`)
    return {
      name: String(o.name),
      value: o.value as string | undefined,
      configMapKeyRef: from.configMapKeyRef ? { name: String(cm.name), key: String(cm.key), optional: !!cm.optional } : undefined,
      secretKeyRef: from.secretKeyRef ? { name: String(sec.name), key: String(sec.key), optional: !!sec.optional } : undefined,
      fieldPath: from.fieldRef ? String(field.fieldPath) : undefined,
    }
  })
  const envFrom = (Array.isArray(c.envFrom) ? c.envFrom : []).map((f: unknown) => {
    const o = asObj(f)
    return {
      configMapRef: o.configMapRef ? String(asObj(o.configMapRef).name) : undefined,
      secretRef: o.secretRef ? String(asObj(o.secretRef).name) : undefined,
      prefix: o.prefix ? String(o.prefix) : undefined,
    }
  })
  const ports = (Array.isArray(c.ports) ? c.ports : []).map((p: unknown) => {
    const o = asObj(p)
    if (typeof o.containerPort !== 'number') {
      throw typeError(kind, 'ContainerPort', `${path}.ports.containerPort`, o.containerPort, 'int32')
    }
    return { containerPort: o.containerPort, name: o.name ? String(o.name) : undefined }
  })
  const res = asObj(c.resources)
  return {
    name: String(c.name ?? ''),
    image: String(c.image ?? ''),
    command: strings(c.command, 'command'),
    args: strings(c.args, 'args'),
    ports,
    env,
    envFrom,
    resources: c.resources
      ? {
          requests: res.requests ? stringValues(asObj(res.requests)) : undefined,
          limits: res.limits ? stringValues(asObj(res.limits)) : undefined,
        }
      : undefined,
  }
}

function stringValues(o: Obj): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]))
}

export function parsePodSpec(kind: string, raw: unknown, path: string): PodSpec {
  const s = asObj(raw)
  const containers = Array.isArray(s.containers) ? s.containers : []
  if (!containers.length) throw new ApplyError(`${path}.containers: Required value`)
  const parsed = containers.map((c: unknown, i: number) => parseContainer(kind, c, `${path}.containers[${i}]`))
  parsed.forEach((c, i) => {
    if (!c.name) throw new ApplyError(`${path}.containers[${i}].name: Required value`)
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(c.name)) {
      throw new ApplyError(
        `${path}.containers[${i}].name: Invalid value: "${c.name}": a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')`,
      )
    }
    if (!c.image) throw new ApplyError(`${path}.containers[${i}].image: Required value`)
  })
  const restart = String(s.restartPolicy ?? 'Always')
  if (!['Always', 'OnFailure', 'Never'].includes(restart)) {
    throw new ApplyError(`${path}.restartPolicy: Unsupported value: "${restart}": supported values: "Always", "Never", "OnFailure"`)
  }
  return {
    containers: parsed,
    restartPolicy: restart as PodSpec['restartPolicy'],
    nodeSelector: stringValues(asObj(s.nodeSelector)),
    tolerations: (Array.isArray(s.tolerations) ? s.tolerations : []).map((t: unknown) => {
      const o = asObj(t)
      return {
        key: o.key ? String(o.key) : undefined,
        operator: o.operator ? String(o.operator) : undefined,
        value: o.value !== undefined ? String(o.value) : undefined,
        effect: o.effect ? String(o.effect) : undefined,
      }
    }),
  }
}

export function parseTemplate(kind: string, raw: unknown, path: string): PodTemplate {
  const t = asObj(raw)
  const m = asObj(t.metadata)
  return {
    labels: stringMap(kind, m.labels, `${path}.metadata.labels`),
    annotations: stringMap(kind, m.annotations, `${path}.metadata.annotations`),
    spec: parsePodSpec(kind, t.spec, `${path}.spec`),
  }
}

export function parseSelector(raw: unknown): Record<string, string> {
  return stringValues(asObj(asObj(raw).matchLabels))
}
