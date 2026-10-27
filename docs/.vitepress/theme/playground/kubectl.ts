// Trình thông dịch lệnh của playground: shell tối giản + kubectl mô phỏng.
import { dump as yamlDump, loadAll as yamlLoadAll } from 'js-yaml'
import type { Cluster } from './cluster'
import {
  CLIENT_VERSION,
  CONTEXT,
  CREATE_MS,
  HOST_PORTS,
  KUSTOMIZE_VERSION,
  SERVER_VERSION,
  imagePullError,
} from './cluster'
import { JsonPathError, evalPath, jsonPath } from './jsonpath'
import {
  API_VERSIONS,
  ApplyError,
  UNSUPPORTED_KINDS,
  asObj,
  configMapManifest,
  daemonSetManifest,
  deploymentManifest,
  namespaceManifest,
  nodeManifest,
  parsePodSpec,
  parseSelector as parseMatchLabels,
  parseTemplate,
  podManifest,
  qosClass,
  replicaSetManifest,
  schemaFor,
  secretManifest,
  serviceManifest,
  stringMap,
  typeError,
  unknownField,
} from './manifest'
import { containerLogs, curlError, execInPod, httpRequest } from './podexec'
import type {
  ConfigMap,
  ContainerSpec,
  DaemonSet,
  Deployment,
  ExecResult,
  FileMap,
  KEvent,
  Labels,
  Line,
  Meta,
  Namespace,
  Node,
  Pod,
  PodTemplate,
  ReplicaSet,
  Secret,
  Service,
} from './types'
import {
  b64decode,
  b64encode,
  describeTime,
  formatLabels,
  humanDuration,
  isDnsLabel,
  isDnsSubdomain,
  isValidBase64,
  isoTime,
  levenshtein,
  matchLabels,
  parseImage,
  parseSelector,
  randomUid,
  table,
  tokenize,
} from './util'

export interface ShellContext {
  cluster: Cluster
  files: FileMap
  forwards: Map<number, { pod: Pod; port: number; label: string }>
}

export interface ShellResult extends ExecResult {
  reset?: boolean
  openFile?: string
  filesChanged?: boolean
}

type Obj = Record<string, unknown>

const out = (text: string): Line => ({ text })
const err = (text: string): Line => ({ text, kind: 'err' })
const note = (text: string): Line => ({ text, kind: 'info' })
const warn = (text: string): Line => ({ text, kind: 'warn' })
const lines = (...ls: (Line | Line[])[]): ShellResult => ({ lines: ls.flat() })
const textLines = (text: string, kind?: Line['kind']): Line[] => text.split('\n').map((t) => ({ text: t, kind }))

// ---------------------------------------------------------------------------
// Phân tích tham số
// ---------------------------------------------------------------------------

interface Args {
  pos: string[]
  flags: Map<string, string[]>
  dash: string[]
}

const SHORT: Record<string, string> = {
  n: 'namespace', o: 'output', l: 'selector', f: 'filename', c: 'container', A: 'all-namespaces',
  w: 'watch', i: 'stdin', t: 'tty', p: 'previous', L: 'label-columns', q: 'quiet', a: 'all',
}

const BOOLEAN = new Set([
  'all-namespaces', 'watch', 'stdin', 'tty', 'rm', 'show-labels', 'overwrite', 'force', 'ignore-daemonsets',
  'delete-emptydir-data', 'previous', 'follow', 'all', 'prefix', 'no-headers', 'current', 'recursive', 'client',
  'list', 'now', 'timestamps', 'command', 'expose', 'local', 'server-side', 'quiet', 'minify', 'raw',
  'containers', 'watch-only', 'force-conflicts', 'record',
])

function parseArgs(tokens: string[], verb: string): Args {
  const a: Args = { pos: [], flags: new Map(), dash: [] }
  const set = (k: string, v: string) => a.flags.set(k, [...(a.flags.get(k) ?? []), v])
  const shortName = (ch: string) => {
    if (verb === 'logs' && ch === 'f') return 'follow'
    if (verb === 'patch' && ch === 'p') return 'patch'
    if (verb === 'exec' && ch === 'p') return 'pod'
    return SHORT[ch]
  }
  const isBool = (name: string) => BOOLEAN.has(name)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--') {
      a.dash = tokens.slice(i + 1)
      break
    }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=')
      const name = eq >= 0 ? t.slice(2, eq) : t.slice(2)
      if (eq >= 0) set(name, t.slice(eq + 1))
      else if (isBool(name)) set(name, 'true')
      else if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) set(name, tokens[++i])
      else set(name, 'true')
      continue
    }
    if (t.startsWith('-') && t.length > 1 && !/^-\d/.test(t)) {
      const body = t.slice(1)
      const first = shortName(body[0])
      if (body.length > 1) {
        const letters = [...body].map(shortName)
        if (letters.every((l) => l && isBool(l))) letters.forEach((l) => set(l!, 'true'))
        else if (first) set(first, body.slice(1).replace(/^=/, ''))
        else a.pos.push(t)
      } else if (!first) a.pos.push(t)
      else if (isBool(first)) set(first, 'true')
      else if (i + 1 < tokens.length) set(first, tokens[++i])
      else set(first, '')
      continue
    }
    a.pos.push(t)
  }
  return a
}

const flag = (a: Args, name: string) => a.flags.get(name)?.at(-1)
const flagAll = (a: Args, name: string) => a.flags.get(name) ?? []
const has = (a: Args, name: string) => {
  const v = flag(a, name)
  return v !== undefined && v !== 'false'
}

// ---------------------------------------------------------------------------
// Danh mục loại tài nguyên
// ---------------------------------------------------------------------------

interface Res<T> {
  plural: string
  singular: string
  kind: string
  group: string
  namespaced: boolean
  aliases: string[]
  items(c: Cluster, ns: string | null): T[]
  meta(o: T): Meta
  headers(wide: boolean): string[]
  row(c: Cluster, o: T, now: number, wide: boolean): string[]
  manifest(c: Cluster, o: T, now: number): Obj
}

const age = (m: Meta, now: number) => humanDuration(now - m.createdAt)
const inNs = <T extends { meta: Meta }>(arr: T[], ns: string | null) => (ns === null ? arr : arr.filter((x) => x.meta.namespace === ns))
const containersOf = (t: PodTemplate) => t.spec.containers.map((c) => c.name).join(',')
const imagesOf = (t: PodTemplate) => t.spec.containers.map((c) => c.image).join(',')

function servicePorts(svc: Service): string {
  return svc.ports.map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ''}/${p.protocol}`).join(',')
}

const PODS: Res<Pod> = {
  plural: 'pods', singular: 'pod', kind: 'Pod', group: '', namespaced: true, aliases: ['po', 'pod', 'pods'],
  items: (c, ns) => inNs(c.state.pods, ns),
  meta: (o) => o.meta,
  headers: (wide) => ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE', ...(wide ? ['IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'] : [])],
  row: (c, p, now, wide) => {
    const st = c.podStatus(p, now)
    const restarts = st.restarts && st.lastRestartAt ? `${st.restarts} (${humanDuration(now - st.lastRestartAt)} ago)` : String(st.restarts)
    return [
      p.meta.name, `${st.readyCount}/${st.total}`, st.display, restarts, age(p.meta, now),
      ...(wide ? [p.podIP || '<none>', p.nodeName || '<none>', '<none>', '<none>'] : []),
    ]
  },
  manifest: (c, p, now) => podManifest(c, p, now),
}

const DEPLOYMENTS: Res<Deployment> = {
  plural: 'deployments', singular: 'deployment', kind: 'Deployment', group: 'apps', namespaced: true,
  aliases: ['deploy', 'deployment', 'deployments'],
  items: (c, ns) => inNs(c.state.deployments, ns),
  meta: (o) => o.meta,
  headers: (wide) => ['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : [])],
  row: (c, d, now, wide) => {
    const st = c.deploymentStatus(d, now)
    return [
      d.meta.name, `${st.ready}/${d.replicas}`, String(st.updated), String(st.available), age(d.meta, now),
      ...(wide ? [containersOf(d.template), imagesOf(d.template), formatLabels(d.selector)] : []),
    ]
  },
  manifest: (c, d, now) => deploymentManifest(c, d, now),
}

const REPLICASETS: Res<ReplicaSet> = {
  plural: 'replicasets', singular: 'replicaset', kind: 'ReplicaSet', group: 'apps', namespaced: true,
  aliases: ['rs', 'replicaset', 'replicasets'],
  items: (c, ns) => inNs(c.state.replicasets, ns),
  meta: (o) => o.meta,
  headers: (wide) => ['NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : [])],
  row: (c, rs, now, wide) => {
    const pods = c.podsOf(rs)
    return [
      rs.meta.name, String(rs.replicas), String(pods.length), String(pods.filter((p) => c.isPodReady(p, now)).length), age(rs.meta, now),
      ...(wide ? [containersOf(rs.template), imagesOf(rs.template), formatLabels(rs.selector)] : []),
    ]
  },
  manifest: (c, rs, now) => replicaSetManifest(c, rs, now),
}

const DAEMONSETS: Res<DaemonSet> = {
  plural: 'daemonsets', singular: 'daemonset', kind: 'DaemonSet', group: 'apps', namespaced: true,
  aliases: ['ds', 'daemonset', 'daemonsets'],
  items: (c, ns) => inNs(c.state.daemonsets, ns),
  meta: (o) => o.meta,
  headers: (wide) => ['NAME', 'DESIRED', 'CURRENT', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'NODE SELECTOR', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : [])],
  row: (c, ds, now, wide) => {
    const pods = c.state.pods.filter((p) => p.owner?.kind === 'DaemonSet' && p.owner.name === ds.meta.name && p.meta.namespace === ds.meta.namespace && !p.deletedAt)
    const ready = String(pods.filter((p) => c.isPodReady(p, now)).length)
    const n = String(pods.length)
    const sel = Object.keys(ds.template.spec.nodeSelector).length ? formatLabels(ds.template.spec.nodeSelector) : '<none>'
    return [ds.meta.name, n, n, ready, n, ready, sel, age(ds.meta, now), ...(wide ? [containersOf(ds.template), imagesOf(ds.template), formatLabels(ds.selector)] : [])]
  },
  manifest: (c, ds, now) => daemonSetManifest(c, ds, now),
}

const SERVICES: Res<Service> = {
  plural: 'services', singular: 'service', kind: 'Service', group: '', namespaced: true, aliases: ['svc', 'service', 'services'],
  items: (c, ns) => inNs(c.state.services, ns),
  meta: (o) => o.meta,
  headers: (wide) => ['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE', ...(wide ? ['SELECTOR'] : [])],
  row: (_c, s, now, wide) => [
    s.meta.name, s.type, s.clusterIP, s.type === 'LoadBalancer' ? '<pending>' : '<none>', servicePorts(s), age(s.meta, now),
    ...(wide ? [Object.keys(s.selector).length ? formatLabels(s.selector) : '<none>'] : []),
  ],
  manifest: (_c, s) => serviceManifest(s),
}

const NODES: Res<Node> = {
  plural: 'nodes', singular: 'node', kind: 'Node', group: '', namespaced: false, aliases: ['no', 'node', 'nodes'],
  items: (c) => c.state.nodes,
  meta: (o) => o.meta,
  headers: (wide) => ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION', ...(wide ? ['INTERNAL-IP', 'EXTERNAL-IP', 'OS-IMAGE', 'KERNEL-VERSION', 'CONTAINER-RUNTIME'] : [])],
  row: (_c, n, now, wide) => [
    n.meta.name, n.unschedulable ? 'Ready,SchedulingDisabled' : 'Ready', n.role === 'control-plane' ? 'control-plane' : '<none>', age(n.meta, now), SERVER_VERSION,
    ...(wide ? [n.ip, '<none>', 'Debian GNU/Linux 12 (bookworm)', '6.10.14-linuxkit', 'containerd://2.1.4'] : []),
  ],
  manifest: (_c, n) => nodeManifest(n),
}

const NAMESPACES: Res<Namespace> = {
  plural: 'namespaces', singular: 'namespace', kind: 'Namespace', group: '', namespaced: false, aliases: ['ns', 'namespace', 'namespaces'],
  items: (c) => c.state.namespaces,
  meta: (o) => o.meta,
  headers: () => ['NAME', 'STATUS', 'AGE'],
  row: (_c, n, now) => [n.meta.name, n.deletedAt ? 'Terminating' : 'Active', age(n.meta, now)],
  manifest: (_c, n) => namespaceManifest(n),
}

const CONFIGMAPS: Res<ConfigMap> = {
  plural: 'configmaps', singular: 'configmap', kind: 'ConfigMap', group: '', namespaced: true, aliases: ['cm', 'configmap', 'configmaps'],
  items: (c, ns) => inNs(c.state.configmaps, ns),
  meta: (o) => o.meta,
  headers: () => ['NAME', 'DATA', 'AGE'],
  row: (_c, cm, now) => [cm.meta.name, String(Object.keys(cm.data).length), age(cm.meta, now)],
  manifest: (_c, cm) => configMapManifest(cm),
}

const SECRETS: Res<Secret> = {
  plural: 'secrets', singular: 'secret', kind: 'Secret', group: '', namespaced: true, aliases: ['secret', 'secrets'],
  items: (c, ns) => inNs(c.state.secrets, ns),
  meta: (o) => o.meta,
  headers: () => ['NAME', 'TYPE', 'DATA', 'AGE'],
  row: (_c, s, now) => [s.meta.name, s.type, String(Object.keys(s.data).length), age(s.meta, now)],
  manifest: (_c, s) => secretManifest(s),
}

type EndpointRow = { meta: Meta; svc: Service }

const ENDPOINTS: Res<EndpointRow> = {
  plural: 'endpoints', singular: 'endpoints', kind: 'Endpoints', group: '', namespaced: true, aliases: ['ep', 'endpoints'],
  items: (c, ns) => inNs(c.state.services, ns).map((svc) => ({ meta: svc.meta, svc })),
  meta: (o) => o.meta,
  headers: () => ['NAME', 'ENDPOINTS', 'AGE'],
  row: (c, { svc }, now) => {
    const eps = svc.meta.name === 'kubernetes' && svc.meta.namespace === 'default'
      ? ['172.18.0.2:6443']
      : c.serviceEndpoints(svc, now).map((e) => `${e.pod.podIP}:${e.port}`)
    const shown = eps.length > 3 ? `${eps.slice(0, 3).join(',')} + ${eps.length - 3} more...` : eps.join(',') || '<none>'
    return [svc.meta.name, shown, age(svc.meta, now)]
  },
  manifest: (c, { svc }, now) => ({
    apiVersion: 'v1',
    kind: 'Endpoints',
    metadata: { name: svc.meta.name, namespace: svc.meta.namespace },
    subsets: [{ addresses: c.serviceEndpoints(svc, now).map((e) => ({ ip: e.pod.podIP, targetRef: { kind: 'Pod', name: e.pod.meta.name } })) }],
  }),
}

const ENDPOINTSLICES: Res<EndpointRow> = {
  plural: 'endpointslices', singular: 'endpointslice', kind: 'EndpointSlice', group: 'discovery.k8s.io', namespaced: true,
  aliases: ['endpointslice', 'endpointslices'],
  items: (c, ns) =>
    inNs(c.state.services, ns).map((svc) => ({
      meta: {
        ...svc.meta,
        name: `${svc.meta.name}-${svc.meta.uid.slice(0, 5).replace(/[^a-z0-9]/g, 'x')}`,
        labels: {
          'endpointslice.kubernetes.io/managed-by': 'endpointslice-controller.k8s.io',
          'kubernetes.io/service-name': svc.meta.name,
        },
      },
      svc,
    })),
  meta: (o) => o.meta,
  headers: () => ['NAME', 'ADDRESSTYPE', 'PORTS', 'ENDPOINTS', 'AGE'],
  row: (c, { meta, svc }, now) => {
    const eps = svc.meta.name === 'kubernetes' && svc.meta.namespace === 'default' ? [{ pod: { podIP: '172.18.0.2' }, port: 6443 }] : c.serviceEndpoints(svc, now)
    const ips = eps.map((e) => e.pod.podIP)
    const ports = eps.length ? [...new Set(eps.map((e) => e.port))].join(',') : '<unset>'
    const shown = ips.length > 3 ? `${ips.slice(0, 3).join(',')} + ${ips.length - 3} more...` : ips.join(',') || '<unset>'
    return [meta.name, 'IPv4', ports, shown, age(svc.meta, now)]
  },
  manifest: (c, { meta, svc }, now) => ({
    addressType: 'IPv4',
    apiVersion: 'discovery.k8s.io/v1',
    endpoints: c.serviceEndpoints(svc, now).map((e) => ({ addresses: [e.pod.podIP], conditions: { ready: true }, nodeName: e.pod.nodeName, targetRef: { kind: 'Pod', name: e.pod.meta.name } })),
    kind: 'EndpointSlice',
    metadata: { labels: { 'kubernetes.io/service-name': svc.meta.name }, name: meta.name, namespace: svc.meta.namespace },
  }),
}

type EventRow = KEvent & { meta: Meta }

const EVENTS: Res<EventRow> = {
  plural: 'events', singular: 'event', kind: 'Event', group: '', namespaced: true, aliases: ['ev', 'event', 'events'],
  items: (c, ns) => c.allEvents().filter((e) => ns === null || e.namespace === ns).map((e, i) => ({
    ...e,
    meta: { name: `${e.object.split('/')[1]}.${(e.time + i).toString(16)}`, namespace: e.namespace, uid: '', labels: {}, annotations: {}, createdAt: e.time },
  })),
  meta: (o) => o.meta,
  headers: () => ['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'],
  row: (_c, e, now) => [humanDuration(now - e.time), e.type, e.reason, e.object, e.message],
  manifest: (_c, e) => ({
    apiVersion: 'v1',
    involvedObject: { kind: e.object.split('/')[0], name: e.object.split('/')[1] },
    kind: 'Event',
    lastTimestamp: isoTime(e.time),
    message: e.message,
    metadata: { name: e.meta.name, namespace: e.namespace },
    reason: e.reason,
    source: { component: e.source },
    type: e.type,
  }),
}

type Synthetic = { meta: Meta; cols: string[] }

function synthetic(plural: string, singular: string, kind: string, group: string, aliases: string[], namespaced: boolean, headers: string[], make: (c: Cluster, ns: string | null) => Synthetic[]): Res<Synthetic> {
  return {
    plural, singular, kind, group, namespaced, aliases,
    items: make,
    meta: (o) => o.meta,
    headers: () => headers,
    row: (_c, o) => o.cols,
    manifest: (_c, o) => ({ apiVersion: group ? `${group}/v1` : 'v1', kind, metadata: { name: o.meta.name, namespace: o.meta.namespace || undefined } }),
  }
}

const SERVICEACCOUNTS = synthetic('serviceaccounts', 'serviceaccount', 'ServiceAccount', '', ['sa', 'serviceaccount', 'serviceaccounts'], true, ['NAME', 'SECRETS', 'AGE'], (c, ns) =>
  c.state.namespaces.filter((n) => ns === null || n.meta.name === ns).map((n) => ({
    meta: { name: 'default', namespace: n.meta.name, uid: '', labels: {}, annotations: {}, createdAt: n.meta.createdAt },
    cols: ['default', '0', humanDuration(Date.now() - n.meta.createdAt)],
  })),
)

const STORAGECLASSES = synthetic('storageclasses', 'storageclass', 'StorageClass', 'storage.k8s.io', ['sc', 'storageclass', 'storageclasses'], false, ['NAME', 'PROVISIONER', 'RECLAIMPOLICY', 'VOLUMEBINDINGMODE', 'ALLOWVOLUMEEXPANSION', 'AGE'], (c) => [
  {
    meta: { name: 'standard', namespace: '', uid: '', labels: {}, annotations: {}, createdAt: c.state.nodes[0].meta.createdAt },
    cols: ['standard (default)', 'rancher.io/local-path', 'Delete', 'WaitForFirstConsumer', 'false', humanDuration(Date.now() - c.state.nodes[0].meta.createdAt)],
  },
])

const RESOURCES: Res<any>[] = [PODS, DEPLOYMENTS, REPLICASETS, DAEMONSETS, SERVICES, NODES, NAMESPACES, CONFIGMAPS, SECRETS, ENDPOINTS, ENDPOINTSLICES, EVENTS, SERVICEACCOUNTS, STORAGECLASSES]

/** Loại có thật trong Kubernetes nhưng playground không mô phỏng → luôn rỗng. */
const EMPTY_TYPES: Record<string, string[]> = {
  statefulsets: ['sts', 'statefulset', 'statefulsets'],
  jobs: ['job', 'jobs'],
  cronjobs: ['cj', 'cronjob', 'cronjobs'],
  ingresses: ['ing', 'ingress', 'ingresses'],
  persistentvolumeclaims: ['pvc', 'persistentvolumeclaim', 'persistentvolumeclaims'],
  persistentvolumes: ['pv', 'persistentvolume', 'persistentvolumes'],
  horizontalpodautoscalers: ['hpa', 'horizontalpodautoscaler', 'horizontalpodautoscalers'],
  networkpolicies: ['netpol', 'networkpolicy', 'networkpolicies'],
  poddisruptionbudgets: ['pdb', 'poddisruptionbudget', 'poddisruptionbudgets'],
  roles: ['role', 'roles'],
  rolebindings: ['rolebinding', 'rolebindings'],
  resourcequotas: ['quota', 'resourcequota', 'resourcequotas'],
  limitranges: ['limits', 'limitrange', 'limitranges'],
  gateways: ['gtw', 'gateway', 'gateways'],
  httproutes: ['httproute', 'httproutes'],
}

function findRes(name: string): Res<any> | 'empty' | null {
  const n = name.toLowerCase().replace(/\.(apps|v1|batch|networking\.k8s\.io|discovery\.k8s\.io)$/, '')
  const res = RESOURCES.find((r) => r.aliases.includes(n) || r.plural === n)
  if (res) return res
  if (Object.values(EMPTY_TYPES).some((aliases) => aliases.includes(n))) return 'empty'
  return null
}

const qualified = (r: Res<any>) => (r.group ? `${r.plural}.${r.group}` : r.plural)
const typePrefix = (r: Res<any>) => (r.group ? `${r.singular}.${r.group}` : r.singular)
const notFound = (r: Res<any>, name: string) => err(`Error from server (NotFound): ${qualified(r)} "${name}" not found`)
const noResources = (ns: string | null) => note(ns === null ? 'No resources found' : `No resources found in ${ns} namespace.`)

// ---------------------------------------------------------------------------
// Định dạng output
// ---------------------------------------------------------------------------

function yaml(value: unknown): string {
  return yamlDump(value, { seqNoIndent: true, lineWidth: -1, quoteStyle: 'double', noRefs: true }).trimEnd()
}

function listOf(items: Obj[]): Obj {
  return { apiVersion: 'v1', items, kind: 'List', metadata: { resourceVersion: '' } }
}

function renderOutput(format: string, data: Obj, single: boolean, items: Obj[]): Line[] {
  const value = single ? items[0] : listOf(items)
  if (format === 'yaml') return textLines(yaml(value))
  if (format === 'json') return textLines(JSON.stringify(value, null, 4))
  const jp = /^jsonpath(?:-as-json)?=(.*)$/s.exec(format)
  if (jp) {
    try {
      return textLines(jsonPath(jp[1], single ? items[0] : data))
    } catch (e) {
      return [err(`error: error parsing jsonpath ${jp[1]}, ${(e as Error).message}`)]
    }
  }
  const cc = /^custom-columns=(.*)$/.exec(format)
  if (cc) {
    const cols = cc[1].split(',').map((spec) => {
      const i = spec.indexOf(':')
      return { name: spec.slice(0, i), path: spec.slice(i + 1).replace(/^\{|\}$/g, '') }
    })
    const rows = items.map((it) =>
      cols.map((col) => {
        const vals = evalPath(col.path, it)
        return vals.length ? vals.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(',') : '<none>'
      }),
    )
    return table(cols.map((c) => c.name), rows).map(out)
  }
  return [err(`error: unable to match a printer suitable for the output format "${format}", allowed formats are: custom-columns,go-template,json,jsonpath,name,wide,yaml`)]
}

// ---------------------------------------------------------------------------
// kubectl get
// ---------------------------------------------------------------------------

interface Target {
  res: Res<any>
  names: string[]
}

function parseTargets(pos: string[]): { targets: Target[]; error?: Line } {
  if (!pos.length) {
    return { targets: [], error: err('You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.\n\nerror: Required resource not specified.') }
  }
  // Dạng type/name type/name ...
  if (pos.every((p) => p.includes('/'))) {
    const targets: Target[] = []
    for (const p of pos) {
      const [type, name] = p.split('/')
      const res = findRes(type)
      if (!res || res === 'empty') return { targets: [], error: err(`error: the server doesn't have a resource type "${type}"`) }
      const t = targets.find((x) => x.res === res)
      if (t) t.names.push(name)
      else targets.push({ res, names: [name] })
    }
    return { targets }
  }
  const [typeArg, ...names] = pos
  const targets: Target[] = []
  for (const type of typeArg.split(',')) {
    if (type === 'all') {
      targets.push(...[PODS, SERVICES, DAEMONSETS, DEPLOYMENTS, REPLICASETS].map((res) => ({ res, names })))
      continue
    }
    const res = findRes(type)
    if (res === null) {
      return { targets: [], error: err(`error: the server doesn't have a resource type "${type}"`) }
    }
    if (res === 'empty') continue
    targets.push({ res, names })
  }
  return { targets }
}

function fieldSelector(expr: string | undefined, manifest: Obj): boolean {
  if (!expr) return true
  return expr.split(',').every((part) => {
    const m = /^([\w.]+)\s*(!=|==|=)\s*(.*)$/.exec(part.trim())
    if (!m) return true
    const value = String(evalPath(`.${m[1]}`, manifest)[0] ?? '')
    return m[2] === '!=' ? value !== m[3] : value === m[3]
  })
}

function cmdGet(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const allNs = has(a, 'all-namespaces')
  const ns = allNs ? null : (flag(a, 'namespace') ?? c.state.currentNamespace)
  const format = flag(a, 'output') ?? ''
  const wide = format === 'wide'
  const selectorText = flag(a, 'selector')
  let selector: ((l: Labels) => boolean) | undefined
  try {
    selector = selectorText ? parseSelector(selectorText) : undefined
  } catch (e) {
    return lines(err(`error: ${(e as Error).message}`))
  }
  const { targets, error } = parseTargets(a.pos)
  if (error) return lines(error)
  if (a.pos[0] && /^(nodes?|no)$/.test(a.pos[0])) c.state.flags['get-nodes'] = true

  const multi = targets.length > 1 || a.pos[0] === 'all'
  const result: Line[] = []
  const errors: Line[] = []
  const collected: { res: Res<any>; items: any[] }[] = []

  for (const { res, names } of targets) {
    const scopeNs = res.namespaced ? ns : null
    let items = res.items(c, scopeNs)
    if (names.length) {
      const found: any[] = []
      for (const name of names) {
        const item = items.find((i) => res.meta(i).name === name)
        if (item) found.push(item)
        else errors.push(notFound(res, name))
      }
      items = found
    }
    if (selector) items = items.filter((i) => selector!(res.meta(i).labels))
    const fs = flag(a, 'field-selector')
    if (fs) items = items.filter((i) => fieldSelector(fs, res.manifest(c, i, now)))
    const sortBy = flag(a, 'sort-by')
    if (sortBy) {
      const path = sortBy.replace(/^\{|\}$/g, '')
      const key = (i: any) => evalPath(path, res.manifest(c, i, now))[0]
      items = [...items].sort((x, y) => {
        const kx = key(x)
        const ky = key(y)
        return typeof kx === 'number' && typeof ky === 'number' ? kx - ky : String(kx ?? '').localeCompare(String(ky ?? ''))
      })
    } else if (res === EVENTS) {
      items = [...items].sort((x, y) => x.time - y.time)
    }
    collected.push({ res, items })
  }

  const total = collected.reduce((s, x) => s + x.items.length, 0)
  if (!total) {
    return lines(errors.length ? errors : [noResources(ns)])
  }

  if (format && !wide) {
    if (format === 'name') {
      for (const { res, items } of collected) for (const i of items) result.push(out(`${typePrefix(res)}/${res.meta(i).name}`))
      return lines(result, errors)
    }
    const manifests = collected.flatMap(({ res, items }) => items.map((i) => res.manifest(c, i, now)))
    const single = targets.length === 1 && targets[0].names.length === 1 && manifests.length === 1
    return lines(renderOutput(format, listOf(manifests), single, manifests), errors)
  }

  const labelCols = (flag(a, 'label-columns') ?? '').split(',').filter(Boolean)
  for (const { res, items } of collected) {
    if (!items.length) continue
    const headers = [...(ns === null && res.namespaced ? ['NAMESPACE'] : []), ...res.headers(wide), ...labelCols.map((l) => l.toUpperCase()), ...(has(a, 'show-labels') ? ['LABELS'] : [])]
    const rows = items.map((i) => {
      const m = res.meta(i)
      const row = res.row(c, i, now, wide)
      if (multi) row[0] = `${typePrefix(res)}/${row[0]}`
      return [
        ...(ns === null && res.namespaced ? [m.namespace] : []),
        ...row,
        ...labelCols.map((l) => m.labels[l] ?? ''),
        ...(has(a, 'show-labels') ? [formatLabels(m.labels)] : []),
      ]
    })
    const rendered = table(headers, rows)
    result.push(...(has(a, 'no-headers') ? rendered.slice(1) : rendered).map(out))
    if (multi) result.push(out(''))
  }
  if (multi && result.at(-1)?.text === '') result.pop()
  if (collected.some((x) => x.res === ENDPOINTS)) result.unshift(warn('Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice'))

  const res: ShellResult = lines(result, errors)
  if (has(a, 'watch') && targets.length === 1) {
    const { res: r, names } = targets[0]
    const snapshot = new Map<string, string>()
    const key = (i: any) => `${r.meta(i).namespace}/${r.meta(i).name}`
    const widths = rows0Widths(result)
    for (const i of collected[0].items) snapshot.set(key(i), JSON.stringify(r.row(c, i, now, wide)))
    res.stream = (emit, done) => {
      const started = Date.now()
      const timer = setInterval(() => {
        const t = Date.now()
        c.tick(t)
        let items = r.items(c, r.namespaced ? ns : null)
        if (names.length) items = items.filter((i) => names.includes(r.meta(i).name))
        if (selector) items = items.filter((i) => selector!(r.meta(i).labels))
        const changed: Line[] = []
        for (const i of items) {
          const row = r.row(c, i, t, wide)
          const sig = JSON.stringify(row)
          if (snapshot.get(key(i)) !== sig) {
            snapshot.set(key(i), sig)
            const cells = [...(ns === null && r.namespaced ? [r.meta(i).namespace] : []), ...row]
            changed.push(out(cells.map((cell, idx) => (idx === cells.length - 1 ? cell : cell.padEnd(widths[idx] ?? cell.length + 3))).join('').trimEnd()))
          }
        }
        if (changed.length) emit(changed)
        if (t - started > 90_000) {
          emit([note('(playground) Tự dừng theo dõi sau 90 giây.')])
          done()
        }
      }, 500)
      return () => clearInterval(timer)
    }
  }
  return res
}

/** Ước lượng độ rộng cột từ dòng tiêu đề để các dòng của --watch thẳng hàng. */
function rows0Widths(rendered: Line[]): number[] {
  const header = rendered[0]?.text ?? ''
  const widths: number[] = []
  const re = /(\S+(?: \S+)*)(\s*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(header)) && m[0]) widths.push(m[0].length)
  return widths
}

// ---------------------------------------------------------------------------
// kubectl describe
// ---------------------------------------------------------------------------

/**
 * Khối "Khóa:  giá trị" căn thẳng cột như kubectl describe. Dòng tiếp theo bắt đầu bằng khoảng
 * trắng là khối con (thụt theo lề trái); các dòng còn lại căn theo cột giá trị.
 */
function block(pairs: [string, string][], indent = ''): string[] {
  const width = Math.max(...pairs.map(([k]) => k.length)) + 2
  return pairs.flatMap(([k, v]) => {
    const [first, ...rest] = v.split('\n')
    return [
      `${indent}${`${k}:`.padEnd(width)}${first}`,
      ...rest.map((r) => (r.startsWith(' ') ? `${indent}${r}` : `${indent}${' '.repeat(width)}${r}`)),
    ]
  })
}

const labelLines = (labels: Labels) => (Object.keys(labels).length ? Object.entries(labels).map(([k, v]) => `${k}=${v}`).join('\n') : '<none>')
const annotationLines = (ann: Labels) => (Object.keys(ann).length ? Object.entries(ann).map(([k, v]) => `${k}: ${v}`).join('\n') : '<none>')

function eventsSection(events: KEvent[], now: number): string[] {
  if (!events.length) return ['Events:                   <none>']
  const rows = events.slice(-12).map((e) => ['  ' + e.type, e.reason, humanDuration(now - e.time), e.source, e.message])
  return ['Events:', ...table(['  Type', 'Reason', 'Age', 'From', 'Message'], [['  ----', '------', '----', '----', '-------'], ...rows])]
}

function containerBlock(c: ContainerSpec, extra: [string, string][] = [], nameIndent = '   '): string[] {
  const env = c.env.map((e) => {
    if (e.value !== undefined) return `${e.name}:  ${e.value}`
    if (e.configMapKeyRef) return `${e.name}:  <set to the key '${e.configMapKeyRef.key}' of config map '${e.configMapKeyRef.name}'>`
    if (e.secretKeyRef) return `${e.name}:  <set to the key '${e.secretKeyRef.key}' in secret '${e.secretKeyRef.name}'>`
    return `${e.name}:   (v1:${e.fieldPath})`
  })
  const envFrom = c.envFrom.map((f) => (f.configMapRef ? `${f.configMapRef}  ConfigMap  Optional: false` : `${f.secretRef}  Secret  Optional: false`))
  const port = c.ports[0] ? `${c.ports[0].containerPort}/TCP${c.ports[0].name ? ` (${c.ports[0].name})` : ''}` : '<none>'
  const res = c.resources
  const resLines: [string, string][] = []
  if (res?.limits && Object.keys(res.limits).length) resLines.push(['Limits', Object.entries(res.limits).map(([k, v]) => `${k}:  ${v}`).join('\n')])
  if (res?.requests && Object.keys(res.requests).length) resLines.push(['Requests', Object.entries(res.requests).map(([k, v]) => `${k}:  ${v}`).join('\n')])
  return [
    `${nameIndent}${c.name}:`,
    ...block(
      [
        ['Image', c.image],
        ...extra.slice(0, 1),
        ['Port', port],
        ['Host Port', c.ports[0] ? '0/TCP' : '<none>'],
        ...(c.command?.length ? ([['Command', c.command.join('\n')]] as [string, string][]) : []),
        ...(c.args?.length ? ([['Args', c.args.join('\n')]] as [string, string][]) : []),
        ...extra.slice(1),
        ...resLines,
        ...(envFrom.length ? ([['Environment Variables from', envFrom.join('\n')]] as [string, string][]) : []),
        ['Environment', env.length ? env.join('\n') : '<none>'],
        ['Mounts', '<none>'],
      ],
      '    ',
    ),
  ]
}

function describePod(c: Cluster, pod: Pod, now: number): string[] {
  const st = c.podStatus(pod, now)
  const node = c.findNode(pod.nodeName)
  const lines: string[] = block([
    ['Name', pod.meta.name],
    ['Namespace', pod.meta.namespace],
    ['Priority', '0'],
    ['Service Account', 'default'],
    ['Node', node ? `${node.meta.name}/${node.ip}` : '<none>'],
    ['Start Time', pod.scheduledAt ? describeTime(pod.scheduledAt) : '<unset>'],
    ['Labels', labelLines(pod.meta.labels)],
    ['Annotations', annotationLines(pod.meta.annotations)],
    ['Status', pod.deletedAt ? 'Terminating (lasts <invalid>)' : st.phase],
    ['IP', pod.podIP || ''],
  ])
  if (pod.podIP) lines.push('IPs:', `  IP:  ${pod.podIP}`)
  if (pod.owner && pod.owner.kind !== 'Node') lines.push(...block([['Controlled By', `${pod.owner.kind}/${pod.owner.name}`]]))
  lines.push('Containers:')
  for (const cs of st.containers) {
    const spec = pod.spec.containers.find((x) => x.name === cs.name)!
    const state: [string, string][] =
      cs.state === 'running'
        ? [['State', `Running\n  Started:      ${describeTime(cs.startedAt ?? now)}`]]
        : cs.state === 'terminated'
          ? [['State', `Terminated\n  Reason:       ${cs.reason}\n  Exit Code:    ${cs.exitCode}\n  Started:      ${describeTime(cs.startedAt ?? now)}\n  Finished:     ${describeTime(cs.finishedAt ?? now)}`]]
          : [['State', `Waiting\n  Reason:       ${cs.reason}`]]
    if (cs.lastState) {
      state.push(['Last State', `Terminated\n  Reason:       ${cs.lastState.reason}\n  Exit Code:    ${cs.lastState.exitCode}\n  Started:      ${describeTime(cs.lastState.startedAt)}\n  Finished:     ${describeTime(cs.lastState.finishedAt)}`])
    }
    lines.push(
      ...containerBlock(
        spec,
        [
          ['Image ID', cs.outcome.kind === 'pull' ? '' : `docker.io/library/${parseImage(spec.image).short}@sha256:${pod.meta.uid.replace(/-/g, '').slice(0, 16)}…`],
          ...state,
          ['Ready', cs.ready ? 'True' : 'False'],
          ['Restart Count', String(cs.restarts)],
        ],
        '  ',
      ),
    )
  }
  lines.push(
    'Conditions:',
    ...table(['  Type', 'Status'], [
      ['  PodReadyToStartContainers', pod.runningSince ? 'True ' : 'False '],
      ['  Initialized', pod.scheduledAt ? 'True ' : 'False '],
      ['  Ready', st.ready ? 'True ' : 'False '],
      ['  ContainersReady', st.ready ? 'True ' : 'False '],
      ['  PodScheduled', pod.nodeName ? 'True ' : 'False '],
    ]),
    ...block([
      ['Volumes', 'kube-api-access (projected token, kube-root-ca.crt, namespace)'],
      ['QoS Class', qosClass(pod)],
      ['Node-Selectors', Object.keys(pod.spec.nodeSelector).length ? labelLines(pod.spec.nodeSelector) : '<none>'],
      ['Tolerations', [...pod.spec.tolerations.map((t) => `${t.key ?? ''}${t.value ? `=${t.value}` : ''}${t.effect ? `:${t.effect}` : ''}${t.operator === 'Exists' ? ' op=Exists' : ''}`), 'node.kubernetes.io/not-ready:NoExecute op=Exists for 300s', 'node.kubernetes.io/unreachable:NoExecute op=Exists for 300s'].join('\n')],
    ]),
    ...eventsSection(c.allEvents(now).filter((e) => e.object === `pod/${pod.meta.name}` && e.namespace === pod.meta.namespace), now),
  )
  return lines
}

function describeDeployment(c: Cluster, d: Deployment, now: number): string[] {
  const st = c.deploymentStatus(d, now)
  const newRS = c.newReplicaSet(d)
  const olds = c.replicaSetsOf(d).filter((rs) => rs !== newRS && rs.replicas + c.podsOf(rs).length > 0)
  const available = st.available >= d.replicas - c.maxUnavailableOf(d)
  return [
    ...block([
      ['Name', d.meta.name],
      ['Namespace', d.meta.namespace],
      ['CreationTimestamp', describeTime(d.meta.createdAt)],
      ['Labels', labelLines(d.meta.labels)],
      ['Annotations', annotationLines(d.meta.annotations)],
      ['Selector', formatLabels(d.selector)],
      ['Replicas', `${d.replicas} desired | ${st.updated} updated | ${st.replicas} total | ${st.available} available | ${Math.max(0, st.replicas - st.available)} unavailable`],
      ['StrategyType', d.strategy],
      ['MinReadySeconds', '0'],
      ...(d.strategy === 'RollingUpdate' ? ([['RollingUpdateStrategy', `${d.maxUnavailable} max unavailable, ${d.maxSurge} max surge`]] as [string, string][]) : []),
    ]),
    'Pod Template:',
    ...block([['Labels', labelLines(d.template.labels)]], '  '),
    '  Containers:',
    ...d.template.spec.containers.flatMap((ct) => containerBlock(ct)),
    ...block([
      ['Volumes', '<none>'],
      ['Node-Selectors', Object.keys(d.template.spec.nodeSelector).length ? labelLines(d.template.spec.nodeSelector) : '<none>'],
      ['Tolerations', '<none>'],
    ], '  '),
    'Conditions:',
    ...table(['  Type', 'Status', 'Reason'], [
      ['  ----', '------', '------'],
      ['  Available', available ? 'True' : 'False', available ? 'MinimumReplicasAvailable' : 'MinimumReplicasUnavailable'],
      ['  Progressing', st.deadlineExceeded ? 'False' : 'True', st.deadlineExceeded ? 'ProgressDeadlineExceeded' : st.complete ? 'NewReplicaSetAvailable' : 'ReplicaSetUpdated'],
    ]),
    ...block([
      ['OldReplicaSets', olds.length ? olds.map((rs) => `${rs.meta.name} (${c.podsOf(rs).length}/${rs.replicas} replicas created)`).join(', ') : '<none>'],
      ['NewReplicaSet', newRS ? `${newRS.meta.name} (${c.podsOf(newRS).length}/${newRS.replicas} replicas created)` : '<none>'],
    ]),
    ...eventsSection(c.state.events.filter((e) => e.object === `deployment/${d.meta.name}` && e.namespace === d.meta.namespace), now),
  ]
}

function describeReplicaSet(c: Cluster, rs: ReplicaSet, now: number): string[] {
  const pods = c.podsOf(rs)
  const counts = { running: 0, waiting: 0, succeeded: 0, failed: 0 }
  for (const p of pods) {
    const ph = c.podStatus(p, now).phase
    if (ph === 'Running') counts.running++
    else if (ph === 'Pending') counts.waiting++
    else if (ph === 'Succeeded') counts.succeeded++
    else counts.failed++
  }
  return [
    ...block([
      ['Name', rs.meta.name],
      ['Namespace', rs.meta.namespace],
      ['Selector', formatLabels(rs.selector)],
      ['Labels', labelLines(rs.meta.labels)],
      ['Annotations', `deployment.kubernetes.io/revision: ${rs.revision}${rs.meta.annotations['kubernetes.io/change-cause'] ? `\nkubernetes.io/change-cause: ${rs.meta.annotations['kubernetes.io/change-cause']}` : ''}`],
      ['Controlled By', rs.owner ? `Deployment/${rs.owner}` : '<none>'],
      ['Replicas', `${pods.length} current / ${rs.replicas} desired`],
      ['Pods Status', `${counts.running} Running / ${counts.waiting} Waiting / ${counts.succeeded} Succeeded / ${counts.failed} Failed`],
    ]),
    'Pod Template:',
    ...block([['Labels', labelLines(rs.template.labels)]], '  '),
    '  Containers:',
    ...rs.template.spec.containers.flatMap((ct) => containerBlock(ct)),
    ...eventsSection(c.state.events.filter((e) => e.object === `replicaset/${rs.meta.name}` && e.namespace === rs.meta.namespace), now),
  ]
}

function describeService(c: Cluster, s: Service, now: number): string[] {
  const eps = s.meta.name === 'kubernetes' ? ['172.18.0.2:6443'] : c.serviceEndpoints(s, now).map((e) => `${e.pod.podIP}:${e.port}`)
  return [
    ...block([
      ['Name', s.meta.name],
      ['Namespace', s.meta.namespace],
      ['Labels', labelLines(s.meta.labels)],
      ['Annotations', annotationLines(s.meta.annotations)],
      ['Selector', Object.keys(s.selector).length ? formatLabels(s.selector) : '<none>'],
      ['Type', s.type],
      ['IP Family Policy', 'SingleStack'],
      ['IP Families', 'IPv4'],
      ['IP', s.clusterIP],
      ['IPs', s.clusterIP],
      ...(s.type === 'LoadBalancer' ? ([['LoadBalancer Ingress', '<pending>']] as [string, string][]) : []),
      ...s.ports.flatMap((p): [string, string][] => [
        ['Port', `${p.name ?? '<unset>'}  ${p.port}/${p.protocol}`],
        ['TargetPort', `${p.targetPort}/${p.protocol}`],
        ...(p.nodePort ? ([['NodePort', `${p.name ?? '<unset>'}  ${p.nodePort}/${p.protocol}`]] as [string, string][]) : []),
        ['Endpoints', eps.join(',') || '<none>'],
      ]),
      ['Session Affinity', 'None'],
      ...(s.type !== 'ClusterIP' ? ([['External Traffic Policy', 'Cluster']] as [string, string][]) : []),
      ['Internal Traffic Policy', 'Cluster'],
    ]),
    'Events:                   <none>',
  ]
}

function describeNode(c: Cluster, n: Node, now: number): string[] {
  const pods = c.state.pods.filter((p) => p.nodeName === n.meta.name && !p.deletedAt)
  const req = pods.reduce((acc, p) => {
    const r = c.podRequests(p)
    return { cpu: acc.cpu + r.cpu, memory: acc.memory + r.memory }
  }, { cpu: 0, memory: 0 })
  const rows = pods.map((p) => {
    const r = c.podRequests(p)
    return [`  ${p.meta.namespace}`, p.meta.name, `${Math.round(r.cpu * 1000)}m (${Math.round((r.cpu / 8) * 100)}%)`, `${Math.round(r.memory / 1024 ** 2)}Mi (${Math.round((r.memory / (15.5 * 1024 ** 3)) * 100)}%)`, humanDuration(now - p.meta.createdAt)]
  })
  return [
    ...block([
      ['Name', n.meta.name],
      ['Roles', n.role === 'control-plane' ? 'control-plane' : '<none>'],
      ['Labels', labelLines(n.meta.labels)],
      ['CreationTimestamp', describeTime(n.meta.createdAt)],
      ['Taints', n.taints.length ? n.taints.map((t) => `${t.key}${t.value ? `=${t.value}` : ''}:${t.effect}`).join('\n') : '<none>'],
      ['Unschedulable', String(n.unschedulable)],
    ]),
    'Conditions:',
    ...table(['  Type', 'Status', 'Reason', 'Message'], [
      ['  MemoryPressure', 'False', 'KubeletHasSufficientMemory', 'kubelet has sufficient memory available'],
      ['  DiskPressure', 'False', 'KubeletHasNoDiskPressure', 'kubelet has no disk pressure'],
      ['  PIDPressure', 'False', 'KubeletHasSufficientPID', 'kubelet has sufficient PID available'],
      ['  Ready', 'True', 'KubeletReady', 'kubelet is posting ready status'],
    ]),
    'Addresses:',
    `  InternalIP:  ${n.ip}`,
    `  Hostname:    ${n.meta.name}`,
    'Capacity:',
    '  cpu:     8',
    '  memory:  16252928Ki',
    '  pods:    110',
    'System Info:',
    '  Kernel Version:             6.10.14-linuxkit',
    '  OS Image:                   Debian GNU/Linux 12 (bookworm)',
    '  Container Runtime Version:  containerd://2.1.4',
    `  Kubelet Version:            ${SERVER_VERSION}`,
    `PodCIDR:                      ${n.podCIDR}`,
    `Non-terminated Pods:          (${pods.length} in total)`,
    ...table(['  Namespace', 'Name', 'CPU Requests', 'Memory Requests', 'Age'], rows),
    'Allocated resources:',
    `  cpu     ${Math.round(req.cpu * 1000)}m (${Math.round((req.cpu / 8) * 100)}%)`,
    `  memory  ${Math.round(req.memory / 1024 ** 2)}Mi (${Math.round((req.memory / (15.5 * 1024 ** 3)) * 100)}%)`,
    ...eventsSection(c.state.events.filter((e) => e.object === `node/${n.meta.name}`), now),
  ]
}

function cmdDescribe(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const ns = flag(a, 'namespace') ?? c.state.currentNamespace
  let [type, ...names] = a.pos
  if (!type) return lines(err('You must specify the type of resource to describe. Use "kubectl api-resources" for a complete list of supported resources.'))
  if (type.includes('/')) [type, names] = [type.split('/')[0], [type.split('/')[1]]]
  const res = findRes(type)
  if (!res || res === 'empty') {
    return lines(res === 'empty' ? noResources(ns) : err(`error: the server doesn't have a resource type "${type}"`))
  }
  let items = res.items(c, res.namespaced ? ns : null)
  const selectorText = flag(a, 'selector')
  if (selectorText) items = items.filter((i) => parseSelector(selectorText)(res.meta(i).labels))
  const result: Line[] = []
  const targets = names.length ? names.map((n) => items.find((i) => res.meta(i).name === n) ?? n) : items
  if (!targets.length) return lines(noResources(res.namespaced ? ns : null))
  targets.forEach((t, idx) => {
    if (typeof t === 'string') {
      result.push(notFound(res, t))
      return
    }
    let body: string[]
    if (res === PODS) body = describePod(c, t, now)
    else if (res === DEPLOYMENTS) body = describeDeployment(c, t, now)
    else if (res === REPLICASETS) body = describeReplicaSet(c, t, now)
    else if (res === SERVICES) body = describeService(c, t, now)
    else if (res === NODES) body = describeNode(c, t, now)
    else if (res === NAMESPACES) body = [...block([['Name', t.meta.name], ['Labels', labelLines(t.meta.labels)], ['Annotations', '<none>'], ['Status', t.deletedAt ? 'Terminating' : 'Active']]), '', 'No resource quota.', '', 'No LimitRange resource.']
    else if (res === CONFIGMAPS) body = [...block([['Name', t.meta.name], ['Namespace', t.meta.namespace], ['Labels', labelLines(t.meta.labels)], ['Annotations', '<none>']]), '', 'Data', '====', ...Object.entries(t.data as Record<string, string>).flatMap(([k, v]) => [`${k}:`, '----', ...v.replace(/\n$/, '').split('\n'), '']), '', 'BinaryData', '====', '', 'Events:  <none>']
    else if (res === SECRETS) body = [...block([['Name', t.meta.name], ['Namespace', t.meta.namespace], ['Labels', labelLines(t.meta.labels)], ['Annotations', '<none>']]), '', `Type:  ${t.type}`, '', 'Data', '====', ...Object.entries(t.data as Record<string, string>).map(([k, v]) => `${k}:  ${safeLength(v)} bytes`)]
    else if (res === DAEMONSETS) body = [...block([['Name', t.meta.name], ['Namespace', t.meta.namespace], ['Selector', formatLabels(t.selector)], ['Node-Selector', Object.keys(t.template.spec.nodeSelector).length ? formatLabels(t.template.spec.nodeSelector) : '<none>']]), 'Pod Template:', '  Containers:', ...t.template.spec.containers.flatMap((ct: ContainerSpec) => containerBlock(ct))]
    else body = textLines(yaml(res.manifest(c, t, now))).map((l) => l.text)
    result.push(...body.map(out))
    if (idx < targets.length - 1) result.push(out(''), out(''))
  })
  return lines(result)
}

function safeLength(b64: string): number {
  try {
    return new TextEncoder().encode(b64decode(b64)).length
  } catch {
    return b64.length
  }
}

// ---------------------------------------------------------------------------
// Tạo đối tượng
// ---------------------------------------------------------------------------

function newMeta(name: string, namespace: string, now: number, labels: Labels = {}, annotations: Labels = {}): Meta {
  return { name, namespace, uid: randomUid(), labels, annotations, createdAt: now }
}

function containerNameFromImage(image: string): string {
  const base = parseImage(image).short.split('/').pop() ?? 'app'
  return base.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app'
}

function newDeployment(name: string, ns: string, replicas: number, template: PodTemplate, now: number, labels: Labels, selector: Labels): Deployment {
  return {
    meta: newMeta(name, ns, now, labels),
    replicas,
    selector,
    template,
    strategy: 'RollingUpdate',
    maxSurge: '25%',
    maxUnavailable: '25%',
    progressDeadlineSeconds: 600,
    paused: false,
    lastProgressAt: now,
    progressSig: '',
  }
}

function allocateClusterIP(c: Cluster): string {
  for (;;) {
    const ip = `10.96.${1 + Math.floor(Math.random() * 254)}.${1 + Math.floor(Math.random() * 254)}`
    if (!c.state.services.some((s) => s.clusterIP === ip)) return ip
  }
}

function allocateNodePort(c: Cluster): number {
  const used = new Set(c.state.services.flatMap((s) => s.ports.map((p) => p.nodePort)))
  for (;;) {
    const p = 30000 + Math.floor(Math.random() * 2768)
    if (!used.has(p) && !HOST_PORTS.includes(p)) return p
  }
}

function dryRunYaml(obj: Obj): Line[] {
  return textLines(yaml(obj))
}

function deploymentDryRun(name: string, image: string, replicas: number, port?: number): Obj {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { labels: { app: name }, name },
    spec: {
      replicas,
      selector: { matchLabels: { app: name } },
      strategy: {},
      template: {
        metadata: { labels: { app: name } },
        spec: { containers: [{ image, name: containerNameFromImage(image), ...(port ? { ports: [{ containerPort: port }] } : {}), resources: {} }] },
      },
    },
    status: {},
  }
}

function parseLiteral(spec: string): [string, string] | null {
  const i = spec.indexOf('=')
  return i > 0 ? [spec.slice(0, i), spec.slice(i + 1)] : null
}

function cmdCreate(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const s = c.state
  const ns = flag(a, 'namespace') ?? s.currentNamespace
  const dryRun = (flag(a, 'dry-run') ?? 'none') !== 'none'
  const files = flagAll(a, 'filename')
  if (files.length) return applyFiles(files, 'create', a, ctx, now)
  const [what, name, ...rest] = a.pos
  const nsMissing = () => !c.namespaceExists(ns)

  switch (what) {
    case 'deployment':
    case 'deploy': {
      const images = flagAll(a, 'image')
      if (!name) return lines(err('error: exactly one NAME is required, got 0'))
      if (!images.length) return lines(err('error: required flag(s) "image" not set'))
      const replicas = Number(flag(a, 'replicas') ?? 1)
      const port = flag(a, 'port') ? Number(flag(a, 'port')) : undefined
      if (dryRun) return lines(dryRunYaml(deploymentDryRun(name, images[0], replicas, port)))
      if (!isDnsSubdomain(name)) return lines(err(invalidName('Deployment', name)))
      if (nsMissing()) return lines(err(`error: failed to create deployment: namespaces "${ns}" not found`))
      if (c.findDeployment(ns, name)) return lines(err(`error: failed to create deployment: deployments.apps "${name}" already exists`))
      const labels = { app: name }
      const containers = images.map((img, i) => ({
        name: containerNameFromImage(img) + (images.length > 1 && i > 0 ? `-${i}` : ''),
        image: img,
        ports: port ? [{ containerPort: port }] : [],
        env: [],
        envFrom: [],
      }))
      s.deployments.push(
        newDeployment(name, ns, replicas, { labels, annotations: {}, spec: { containers, restartPolicy: 'Always', nodeSelector: {}, tolerations: [] } }, now, labels, labels),
      )
      return lines(out(`deployment.apps/${name} created`))
    }
    case 'namespace':
    case 'ns': {
      if (!name) return lines(err('error: exactly one NAME is required, got 0'))
      if (dryRun) return lines(dryRunYaml({ apiVersion: 'v1', kind: 'Namespace', metadata: { name }, spec: {}, status: {} }))
      if (!isDnsLabel(name)) return lines(err(invalidLabelName('Namespace', name)))
      if (s.namespaces.some((n) => n.meta.name === name)) return lines(err(`Error from server (AlreadyExists): namespaces "${name}" already exists`))
      s.namespaces.push({ meta: newMeta(name, '', now, { 'kubernetes.io/metadata.name': name }) })
      s.configmaps.push({ meta: newMeta('kube-root-ca.crt', name, now), data: { 'ca.crt': '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n' } })
      return lines(out(`namespace/${name} created`))
    }
    case 'configmap':
    case 'cm':
    case 'secret': {
      let secretType = 'Opaque'
      let objName = name
      if (what === 'secret') {
        if (!['generic', 'docker-registry'].includes(name ?? '')) {
          if (name === 'tls') return lines(note('(playground) secret tls cần file chứng chỉ thật — hãy thử trên cluster kind.'))
          return lines(err('error: Please specify a secret type: generic, tls or docker-registry'))
        }
        if (name === 'docker-registry') secretType = 'kubernetes.io/dockerconfigjson'
        objName = rest[0]
      }
      if (!objName) return lines(err('error: exactly one NAME is required, got 0'))
      const data: Record<string, string> = {}
      for (const lit of flagAll(a, 'from-literal')) {
        const kv = parseLiteral(lit)
        if (!kv) return lines(err(`error: invalid literal source ${lit}, expected key=value`))
        data[kv[0]] = kv[1]
      }
      for (const spec of flagAll(a, 'from-file')) {
        const [key, path] = spec.includes('=') ? spec.split('=') : [spec.split('/').pop()!, spec]
        if (ctx.files[path] === undefined) return lines(err(`error: error reading ${path}: no such file or directory`))
        data[key] = ctx.files[path]
      }
      for (const path of flagAll(a, 'from-env-file')) {
        if (ctx.files[path] === undefined) return lines(err(`error: error reading ${path}: no such file or directory`))
        for (const line of ctx.files[path].split('\n')) {
          const kv = parseLiteral(line.trim())
          if (kv && !line.trim().startsWith('#')) data[kv[0]] = kv[1]
        }
      }
      if (secretType === 'kubernetes.io/dockerconfigjson') {
        const server = flag(a, 'docker-server') ?? 'https://index.docker.io/v1/'
        data['.dockerconfigjson'] = JSON.stringify({ auths: { [server]: { username: flag(a, 'docker-username') ?? '', password: '***' } } })
      }
      const isSecret = what === 'secret'
      const kind = isSecret ? 'Secret' : 'ConfigMap'
      const encoded = isSecret ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, b64encode(v)])) : data
      if (dryRun) return lines(dryRunYaml({ apiVersion: 'v1', data: encoded, kind, metadata: { name: objName }, ...(isSecret ? { type: secretType } : {}) }))
      if (nsMissing()) return lines(err(`error: failed to create ${kind.toLowerCase()}: namespaces "${ns}" not found`))
      const list = isSecret ? s.secrets : s.configmaps
      if (list.some((x) => x.meta.namespace === ns && x.meta.name === objName)) {
        return lines(err(`error: failed to create ${kind.toLowerCase()}: ${kind.toLowerCase()}s "${objName}" already exists`))
      }
      if (isSecret) s.secrets.push({ meta: newMeta(objName, ns, now), type: secretType, data: encoded })
      else s.configmaps.push({ meta: newMeta(objName, ns, now), data })
      return lines(out(`${kind.toLowerCase()}/${objName} created`))
    }
    case 'service':
    case 'svc': {
      const type = ({ clusterip: 'ClusterIP', nodeport: 'NodePort', loadbalancer: 'LoadBalancer' } as Record<string, Service['type']>)[name ?? '']
      const svcName = rest[0]
      if (!type) return lines(err('error: Please specify a service type: clusterip, nodeport, loadbalancer or externalname'))
      if (!svcName) return lines(err('error: exactly one NAME is required, got 0'))
      const tcp = flagAll(a, 'tcp')
      if (!tcp.length) return lines(err('error: at least one tcp port specifier must be provided'))
      const ports = tcp.map((spec) => {
        const [p, t] = spec.split(':')
        return { name: tcp.length > 1 ? `${p}-${t ?? p}` : `${p}-${t ?? p}`, port: Number(p), targetPort: Number(t ?? p), protocol: 'TCP', nodePort: type === 'ClusterIP' ? undefined : Number(flag(a, 'node-port')) || allocateNodePort(c) }
      })
      if (dryRun) return lines(dryRunYaml({ apiVersion: 'v1', kind: 'Service', metadata: { labels: { app: svcName }, name: svcName }, spec: { ports: ports.map(({ nodePort, ...p }) => (nodePort && flag(a, 'node-port') ? { ...p, nodePort } : p)), selector: { app: svcName }, type }, status: { loadBalancer: {} } }))
      if (c.findService(ns, svcName)) return lines(err(`error: failed to create service: services "${svcName}" already exists`))
      s.services.push({ meta: newMeta(svcName, ns, now, { app: svcName }), type, clusterIP: allocateClusterIP(c), selector: { app: svcName }, ports })
      return lines(out(`service/${svcName} created`))
    }
    case undefined:
      return lines(err('error: must specify one of -f and -k'))
    default:
      return lines(note(`(playground) "kubectl create ${what}" chưa được mô phỏng. Các lệnh hỗ trợ: create deployment | namespace | configmap | secret generic | service, hoặc create -f <tệp>.`))
  }
}

function invalidName(kind: string, name: string): string {
  return `The ${kind} "${name}" is invalid: metadata.name: Invalid value: "${name}": a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character (e.g. 'example.com', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*')`
}

function invalidLabelName(kind: string, name: string): string {
  return `The ${kind} "${name}" is invalid: metadata.name: Invalid value: "${name}": a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')`
}

// ---------------------------------------------------------------------------
// kubectl run
// ---------------------------------------------------------------------------

function cmdRun(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const s = c.state
  const ns = flag(a, 'namespace') ?? s.currentNamespace
  const name = a.pos[0]
  const image = flag(a, 'image')
  if (!name) return lines(err('error: NAME is required for run'))
  if (!image) return lines(err('error: required flag(s) "image" not set'))
  if (!isDnsSubdomain(name)) return lines(err(invalidName('Pod', name)))
  const labels: Labels = {}
  const labelSpec = flag(a, 'labels') ?? flag(a, 'selector')
  if (labelSpec) {
    for (const part of labelSpec.split(',')) {
      const kv = parseLiteral(part)
      if (kv) labels[kv[0]] = kv[1]
    }
  } else labels.run = name
  const env = flagAll(a, 'env').map((e) => {
    const kv = parseLiteral(e) ?? [e, '']
    return { name: kv[0], value: kv[1] }
  })
  const port = flag(a, 'port') ? Number(flag(a, 'port')) : undefined
  const restart = (flag(a, 'restart') ?? 'Always') as 'Always' | 'OnFailure' | 'Never'
  const container: ContainerSpec = {
    name,
    image,
    ports: port ? [{ containerPort: port }] : [],
    env,
    envFrom: [],
    ...(a.dash.length ? (has(a, 'command') ? { command: a.dash } : { args: a.dash }) : {}),
  }
  const spec = { containers: [container], restartPolicy: restart, nodeSelector: {}, tolerations: [] }
  if ((flag(a, 'dry-run') ?? 'none') !== 'none') {
    return lines(dryRunYaml({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { labels, name },
      spec: { containers: [{ ...(container.args ? { args: container.args } : {}), ...(container.command ? { command: container.command } : {}), ...(env.length ? { env } : {}), image, name, ...(port ? { ports: [{ containerPort: port }] } : {}), resources: {} }], dnsPolicy: 'ClusterFirst', restartPolicy: restart },
      status: {},
    }))
  }
  if (!c.namespaceExists(ns)) return lines(err(`Error from server (NotFound): namespaces "${ns}" not found`))
  if (c.findPod(ns, name)) return lines(err(`Error from server (AlreadyExists): pods "${name}" already exists`))

  const interactive = has(a, 'stdin') || has(a, 'tty')
  const shellOnly = !a.dash.length || (a.dash.length === 1 && ['sh', 'bash', '/bin/sh', '/bin/bash', 'zsh'].includes(a.dash[0]))
  if (has(a, 'rm') || (interactive && shellOnly)) {
    if (shellOnly) {
      return lines(
        note('(playground) Shell tương tác chưa được hỗ trợ. Hãy truyền lệnh cần chạy sau dấu --, ví dụ:'),
        note(`  kubectl run ${name} --rm -it --image=${image} --restart=Never -- wget -qO- http://<service>`),
        note(`  kubectl run ${name} --rm -it --image=${image} --restart=Never -- nslookup kubernetes`),
      )
    }
    const pull = imagePullError(image)
    const result: Line[] = []
    if (pull) {
      result.push(err('error: timed out waiting for the condition'))
      return lines(result, note(`(playground) Không kéo được image "${image}" — kiểm tra lại tên/tag.`))
    }
    const temp: Pod = {
      meta: newMeta(name, ns, now, labels),
      spec,
      nodeName: 'k8s-learn-worker',
      podIP: '10.244.1.250',
      scheduledAt: now - CREATE_MS,
      runningSince: now,
      restartOffset: 0,
      accessLog: [],
    }
    if (has(a, 'tty')) result.push(note("If you don't see a command prompt, try pressing enter."))
    const r = execInPod(c, temp, container, a.dash, now)
    if (r.hitService) s.flags['curl-service'] = true
    result.push(...r.lines.map(out))
    if (r.code !== 0 && r.lines.length === 0) result.push(err(`pod ${ns}/${name} terminated (Error)`))
    result.push(out(`pod "${name}" deleted`))
    return lines(result)
  }

  const created: Line[] = []
  if (has(a, 'expose')) {
    if (!port) return lines(err('error: --port must be set when exposing a service'))
    s.services.push({ meta: newMeta(name, ns, now), type: 'ClusterIP', clusterIP: allocateClusterIP(c), selector: { ...labels }, ports: [{ port, targetPort: port, protocol: 'TCP' }] })
    created.push(out(`service/${name} created`))
  }
  s.pods.push({ meta: newMeta(name, ns, now, labels), spec, nodeName: '', podIP: '', restartOffset: 0, accessLog: [] })
  created.push(out(`pod/${name} created`))
  return lines(created)
}

// ---------------------------------------------------------------------------
// kubectl apply / create -f / delete -f
// ---------------------------------------------------------------------------

function goMap(labels: Labels): string {
  return `map[string]string{${Object.entries(labels).map(([k, v]) => `"${k}":"${v}"`).join(', ')}}`
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function yamlErrorMessage(file: string, e: unknown): string {
  const ex = e as { mark?: { line?: number }; reason?: string; message?: string }
  const line = (ex.mark?.line ?? 0) + 1
  const reason = ex.reason ?? String(ex.message ?? e).split('\n')[0]
  return `error: error parsing ${file}: error converting YAML to JSON: yaml: line ${line}: ${reason}`
}

function applyFiles(files: string[], mode: 'apply' | 'create' | 'delete', a: Args, ctx: ShellContext, now: number): ShellResult {
  const result: Line[] = []
  for (const file of files) {
    if (/^https?:\/\//.test(file)) {
      result.push(note('(playground) Không tải được tệp từ Internet. Hãy dán nội dung vào một tệp trong tab "Tệp YAML" rồi apply tệp đó.'))
      continue
    }
    const content = ctx.files[file]
    if (content === undefined) {
      result.push(err(`error: the path "${file}" does not exist`))
      continue
    }
    let docs: unknown[]
    try {
      docs = yamlLoadAll(content)
    } catch (e) {
      result.push(err(yamlErrorMessage(file, e)))
      continue
    }
    for (const doc of docs) {
      if (doc === null || doc === undefined) continue
      result.push(...applyDoc(doc, file, mode, a, ctx, now))
    }
  }
  if (mode !== 'delete' && result.some((l) => l.kind !== 'err')) ctx.cluster.state.flags.applied = true
  return lines(result)
}

const PREFIX: Record<string, string> = {
  Pod: 'pod', Deployment: 'deployment.apps', ReplicaSet: 'replicaset.apps', DaemonSet: 'daemonset.apps',
  Service: 'service', ConfigMap: 'configmap', Secret: 'secret', Namespace: 'namespace',
}
const PLURAL: Record<string, string> = {
  Pod: 'pods', Deployment: 'deployments.apps', ReplicaSet: 'replicasets.apps', DaemonSet: 'daemonsets.apps',
  Service: 'services', ConfigMap: 'configmaps', Secret: 'secrets', Namespace: 'namespaces',
}

function applyDoc(doc: unknown, file: string, mode: 'apply' | 'create' | 'delete', a: Args, ctx: ShellContext, now: number): Line[] {
  const c = ctx.cluster
  const s = c.state
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    return [err(`error: error validating "${file}": error validating data: invalid object to validate; if you choose to ignore these errors, turn validation off with --validate=false`)]
  }
  const d = doc as Obj
  const apiVersion = d.apiVersion as string | undefined
  const kind = d.kind as string | undefined
  const missing = [!apiVersion && 'apiVersion not set', !kind && 'kind not set'].filter(Boolean)
  if (missing.length) {
    return [err(`error: error validating "${file}": error validating data: [${missing.join(', ')}]; if you choose to ignore these errors, turn validation off with --validate=false`)]
  }
  const meta = asObj(d.metadata)
  const name = meta.name as string | undefined
  const flagNs = flag(a, 'namespace')
  const docNs = meta.namespace as string | undefined
  const expected = API_VERSIONS[kind!] ?? UNSUPPORTED_KINDS[kind!]
  const nsForMsg = docNs ?? flagNs ?? s.currentNamespace
  if (!expected || expected !== apiVersion) {
    return [err(`error: resource mapping not found for name: "${name ?? ''}" namespace: "${kind === 'Namespace' ? '' : nsForMsg}" from "${file}": no matches for kind "${kind}" in version "${apiVersion}"\nensure CRDs are installed first`)]
  }
  if (!API_VERSIONS[kind!]) {
    return [note(`(playground) ${kind} "${name ?? ''}" chưa được mô phỏng trong playground — bỏ qua. Hãy thử trên cluster kind thật.`)]
  }
  const version = apiVersion!.split('/').pop()
  const unknown = unknownField(d, schemaFor(kind!)!)
  if (unknown) {
    return [err(`Error from server (BadRequest): error when creating "${file}": ${kind} in version "${version}" cannot be handled as a ${kind}: strict decoding error: unknown field "${unknown}"`)]
  }
  const namespaced = kind !== 'Namespace'
  if (!name) {
    return [err(`error: error when retrieving current configuration of:\nResource: "/${version}, Resource=${PLURAL[kind!].split('.')[0]}", GroupVersionKind: "/${version}, Kind=${kind}"\nName: "", Namespace: "${namespaced ? nsForMsg : ''}"\nfrom server for: "${file}": resource name may not be empty`)]
  }
  if (docNs && flagNs && docNs !== flagNs) {
    return [err(`error: the namespace from the provided object "${docNs}" does not match the namespace "${flagNs}". You must pass '--namespace=${docNs}' to perform this operation.`)]
  }
  const ns = namespaced ? nsForMsg : ''
  const prefix = PREFIX[kind!]
  if (mode === 'delete') return deleteByKind(kind!, ns, name, ctx, now, file)
  if (namespaced && !c.namespaceExists(ns)) {
    return [err(`Error from server (NotFound): error when creating "${file}": namespaces "${ns}" not found`)]
  }
  const exists = (found: unknown) => {
    if (found && mode === 'create') return err(`Error from server (AlreadyExists): error when creating "${file}": ${PLURAL[kind!]} "${name}" already exists`)
    return null
  }

  try {
    const labels = stringMap(kind!, meta.labels, 'metadata.labels')
    const annotations = stringMap(kind!, meta.annotations, 'metadata.annotations')
    if (kind === 'Namespace') {
      if (!isDnsLabel(name)) return [err(invalidLabelName('Namespace', name))]
      const existing = s.namespaces.find((n) => n.meta.name === name)
      const dup = exists(existing)
      if (dup) return [dup]
      if (existing) {
        const changed = !sameJson(existing.meta.labels, { ...labels, 'kubernetes.io/metadata.name': name })
        existing.meta.labels = { ...labels, 'kubernetes.io/metadata.name': name }
        return [out(`${prefix}/${name} ${changed ? 'configured' : 'unchanged'}`)]
      }
      s.namespaces.push({ meta: newMeta(name, '', now, { ...labels, 'kubernetes.io/metadata.name': name }, annotations) })
      s.configmaps.push({ meta: newMeta('kube-root-ca.crt', name, now), data: { 'ca.crt': '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n' } })
      return [out(`${prefix}/${name} created`)]
    }
    if (!isDnsSubdomain(name)) return [err(invalidName(kind!, name))]

    if (kind === 'ConfigMap' || kind === 'Secret') {
      const isSecret = kind === 'Secret'
      const data: Record<string, string> = {}
      for (const [k, v] of Object.entries(asObj(d.data))) {
        if (typeof v !== 'string') throw typeError(kind, kind, 'data', v, 'string')
        if (isSecret && !isValidBase64(v)) {
          return [err(`Error from server (BadRequest): error when creating "${file}": Secret in version "v1" cannot be handled as a Secret: illegal base64 data at input byte ${Math.max(0, v.search(/[^A-Za-z0-9+/=]/))}`)]
        }
        data[k] = v
      }
      if (isSecret) for (const [k, v] of Object.entries(asObj(d.stringData))) data[k] = b64encode(String(v))
      const list = isSecret ? s.secrets : s.configmaps
      const existing = list.find((x) => x.meta.namespace === ns && x.meta.name === name)
      const dup = exists(existing)
      if (dup) return [dup]
      if (existing) {
        const changed = !sameJson(existing.data, data) || !sameJson(existing.meta.labels, labels)
        existing.data = data
        existing.meta.labels = labels
        return [out(`${prefix}/${name} ${changed ? 'configured' : 'unchanged'}`)]
      }
      if (isSecret) s.secrets.push({ meta: newMeta(name, ns, now, labels, annotations), type: String(d.type ?? 'Opaque'), data })
      else s.configmaps.push({ meta: newMeta(name, ns, now, labels, annotations), data })
      return [out(`${prefix}/${name} created`)]
    }

    if (kind === 'Pod') {
      const spec = parsePodSpec(kind, d.spec, 'spec')
      const ignoredInit = Array.isArray(asObj(d.spec).initContainers)
      const existing = c.findPod(ns, name)
      const dup = exists(existing)
      if (dup) return [dup]
      const extra = ignoredInit ? [note('(playground) initContainers được bỏ qua trong mô phỏng.')] : []
      if (existing && !existing.deletedAt) {
        const sameExceptImage = sameJson(
          { ...existing.spec, containers: existing.spec.containers.map((x) => ({ ...x, image: '' })) },
          { ...spec, containers: spec.containers.map((x) => ({ ...x, image: '' })) },
        )
        if (!sameExceptImage) {
          return [err(`The Pod "${name}" is invalid: spec: Forbidden: pod updates may not change fields other than \`spec.containers[*].image\`,\`spec.initContainers[*].image\`,\`spec.activeDeadlineSeconds\`,\`spec.tolerations\` (only additions to existing tolerations),\`spec.terminationGracePeriodSeconds\` (allow it to be set to 1 if it was previously negative)`)]
        }
        const imageChanged = !sameJson(existing.spec.containers.map((x) => x.image), spec.containers.map((x) => x.image))
        const labelsChanged = !sameJson(existing.meta.labels, labels)
        if (!imageChanged && !labelsChanged) return [out(`${prefix}/${name} unchanged`)]
        existing.meta.labels = labels
        if (imageChanged) {
          existing.spec = spec
          existing.scheduledAt = now
          existing.runningSince = undefined
          existing.restartOffset += 1
        }
        return [out(`${prefix}/${name} configured`)]
      }
      s.pods.push({ meta: newMeta(name, ns, now, labels, annotations), spec, nodeName: '', podIP: '', restartOffset: 0, accessLog: [] })
      return [out(`${prefix}/${name} created`), ...extra]
    }

    if (kind === 'Service') return applyService(d, file, mode, ns, name, ctx, now)

    // Workload có template: Deployment, ReplicaSet, DaemonSet
    const spec = asObj(d.spec)
    if (spec.replicas !== undefined && typeof spec.replicas !== 'number') {
      throw typeError(kind!, `${kind}Spec`, 'spec.replicas', spec.replicas, 'int32')
    }
    const template = parseTemplate(kind!, spec.template, 'spec.template')
    const selector = parseMatchLabels(spec.selector)
    const problems: string[] = []
    if (!Object.keys(selector).length) problems.push('spec.selector: Required value')
    if (!Object.keys(selector).length || !matchLabels(selector, template.labels)) {
      problems.push(`spec.template.metadata.labels: Invalid value: ${goMap(template.labels)}: \`selector\` does not match template \`labels\``)
    }
    if (problems.length) {
      return [err(`The ${kind} "${name}" is invalid: ${problems.length > 1 ? `\n* ${problems.join('\n* ')}` : problems[0]}`)]
    }

    if (kind === 'DaemonSet') {
      const existing = s.daemonsets.find((x) => x.meta.namespace === ns && x.meta.name === name)
      const dup = exists(existing)
      if (dup) return [dup]
      if (existing) {
        const changed = !sameJson(existing.template, template)
        existing.template = template
        if (changed) for (const p of s.pods.filter((p) => p.owner?.kind === 'DaemonSet' && p.owner.name === name && p.meta.namespace === ns)) c.markDeleted(p, now)
        return [out(`${prefix}/${name} ${changed ? 'configured' : 'unchanged'}`)]
      }
      s.daemonsets.push({ meta: newMeta(name, ns, now, labels, annotations), selector, template })
      return [out(`${prefix}/${name} created`)]
    }
    const replicas = (spec.replicas as number | undefined) ?? 1
    if (kind === 'ReplicaSet') {
      const existing = s.replicasets.find((x) => x.meta.namespace === ns && x.meta.name === name)
      const dup = exists(existing)
      if (dup) return [dup]
      if (existing) {
        const changed = existing.replicas !== replicas || !sameJson(existing.template, template)
        existing.replicas = replicas
        existing.template = template
        return [out(`${prefix}/${name} ${changed ? 'configured' : 'unchanged'}`)]
      }
      s.replicasets.push({ meta: newMeta(name, ns, now, labels, annotations), replicas, selector, template, hash: '', revision: 0, owner: '' })
      return [out(`${prefix}/${name} created`)]
    }

    // Deployment
    const strategy = asObj(spec.strategy)
    const rolling = asObj(strategy.rollingUpdate)
    const existing = c.findDeployment(ns, name)
    const dup = exists(existing)
    if (dup) return [dup]
    const strategyType = strategy.type === 'Recreate' ? 'Recreate' : 'RollingUpdate'
    const maxSurge = (rolling.maxSurge as number | string | undefined) ?? '25%'
    const maxUnavailable = (rolling.maxUnavailable as number | string | undefined) ?? '25%'
    if (existing) {
      if (!sameJson(existing.selector, selector)) {
        return [err(`The Deployment "${name}" is invalid: spec.selector: Invalid value: v1.LabelSelector{MatchLabels:${goMap(selector)}, MatchExpressions:[]v1.LabelSelectorRequirement(nil)}: field is immutable`)]
      }
      const changed =
        existing.replicas !== replicas ||
        !sameJson(existing.template, template) ||
        existing.strategy !== strategyType ||
        existing.maxSurge !== maxSurge ||
        existing.maxUnavailable !== maxUnavailable ||
        !sameJson(existing.meta.labels, labels)
      existing.replicas = replicas
      existing.template = template
      existing.strategy = strategyType
      existing.maxSurge = maxSurge
      existing.maxUnavailable = maxUnavailable
      existing.meta.labels = labels
      for (const [k, v] of Object.entries(annotations)) existing.meta.annotations[k] = v
      return [out(`${prefix}/${name} ${changed ? 'configured' : 'unchanged'}`)]
    }
    const dep = newDeployment(name, ns, replicas, template, now, labels, selector)
    dep.meta.annotations = annotations
    dep.strategy = strategyType
    dep.maxSurge = maxSurge
    dep.maxUnavailable = maxUnavailable
    if (typeof spec.progressDeadlineSeconds === 'number') dep.progressDeadlineSeconds = spec.progressDeadlineSeconds
    s.deployments.push(dep)
    return [out(`${prefix}/${name} created`)]
  } catch (e) {
    if (e instanceof ApplyError) {
      if (e.decode) return [err(`Error from server (BadRequest): error when creating "${file}": ${e.message}`)]
      return [err(`The ${kind} "${name}" is invalid: ${e.message}`)]
    }
    throw e
  }
}

// Service tách riêng vì không có template
function applyService(d: Obj, file: string, mode: 'apply' | 'create', ns: string, name: string, ctx: ShellContext, now: number): Line[] {
  const c = ctx.cluster
  const s = c.state
  const meta = asObj(d.metadata)
  const spec = asObj(d.spec)
  const labels = stringMap('Service', meta.labels, 'metadata.labels')
  const type = String(spec.type ?? 'ClusterIP')
  if (type === 'ExternalName') return [note('(playground) Service ExternalName chưa được mô phỏng.')]
  if (!['ClusterIP', 'NodePort', 'LoadBalancer'].includes(type)) {
    return [err(`The Service "${name}" is invalid: spec.type: Unsupported value: "${type}": supported values: "ClusterIP", "ExternalName", "LoadBalancer", "NodePort"`)]
  }
  const rawPorts = Array.isArray(spec.ports) ? spec.ports : []
  if (!rawPorts.length) return [err(`The Service "${name}" is invalid: spec.ports: Required value`)]
  const existing = c.findService(ns, name)
  if (existing && mode === 'create') return [err(`Error from server (AlreadyExists): error when creating "${file}": services "${name}" already exists`)]
  const usedNodePorts = new Set(s.services.filter((x) => x !== existing).flatMap((x) => x.ports.map((p) => p.nodePort)))
  const ports: Service['ports'] = []
  for (let i = 0; i < rawPorts.length; i++) {
    const p = asObj(rawPorts[i])
    if (typeof p.port !== 'number') {
      return [err(`Error from server (BadRequest): error when creating "${file}": Service in version "v1" cannot be handled as a Service: json: cannot unmarshal ${typeof p.port} into Go struct field ServicePort.spec.ports.port of type int32`)]
    }
    let nodePort = p.nodePort as number | undefined
    if (nodePort !== undefined) {
      if (type === 'ClusterIP') return [err(`The Service "${name}" is invalid: spec.ports[${i}].nodePort: Forbidden: may not be used when \`type\` is 'ClusterIP'`)]
      if (nodePort < 30000 || nodePort > 32767) return [err(`The Service "${name}" is invalid: spec.ports[${i}].nodePort: Invalid value: ${nodePort}: provided port is not in the valid range. The range of valid ports is 30000-32767`)]
      if (usedNodePorts.has(nodePort)) return [err(`The Service "${name}" is invalid: spec.ports[${i}].nodePort: Invalid value: ${nodePort}: provided port is already allocated`)]
    } else if (type !== 'ClusterIP') {
      nodePort = existing?.ports[i]?.nodePort ?? allocateNodePort(c)
    }
    ports.push({ name: p.name as string | undefined, port: p.port, targetPort: (p.targetPort as number | string | undefined) ?? p.port, nodePort, protocol: String(p.protocol ?? 'TCP') })
  }
  const selector = Object.fromEntries(Object.entries(asObj(spec.selector)).map(([k, v]) => [k, String(v)]))
  if (existing) {
    const changed = existing.type !== type || !sameJson(existing.ports, ports) || !sameJson(existing.selector, selector) || !sameJson(existing.meta.labels, labels)
    Object.assign(existing, { type, ports, selector })
    existing.meta.labels = labels
    return [out(`service/${name} ${changed ? 'configured' : 'unchanged'}`)]
  }
  s.services.push({
    meta: newMeta(name, ns, now, labels),
    type: type as Service['type'],
    clusterIP: spec.clusterIP === 'None' ? 'None' : allocateClusterIP(c),
    selector,
    ports,
  })
  return [out(`service/${name} created`)]
}

// ---------------------------------------------------------------------------
// kubectl delete
// ---------------------------------------------------------------------------

const PROTECTED_NS = ['default', 'kube-system', 'kube-public', 'kube-node-lease']

function deleteByKind(kind: string, ns: string, name: string, ctx: ShellContext, now: number, file?: string, force = false): Line[] {
  const c = ctx.cluster
  const s = c.state
  const nf = () => [err(file ? `Error from server (NotFound): error when deleting "${file}": ${PLURAL[kind]} "${name}" not found` : `Error from server (NotFound): ${PLURAL[kind]} "${name}" not found`)]
  const done = (verb = 'deleted') => [out(`${PREFIX[kind].split('.')[0]} "${name}" ${verb}`.replace(/^(deployment|replicaset|daemonset) /, '$1.apps '))]
  switch (kind) {
    case 'Pod': {
      const pod = c.findPod(ns, name)
      if (!pod) return nf()
      if (pod.owner?.kind === 'ReplicaSet') {
        const rs = s.replicasets.find((r) => r.meta.name === pod.owner!.name && r.meta.namespace === ns)
        s.flags['self-heal'] = true
        if (rs?.owner) s.flags[`self-heal:${rs.owner}`] = true
      }
      c.markDeleted(pod, now, force)
      return done(force ? 'force deleted' : 'deleted')
    }
    case 'Deployment': {
      const dep = c.findDeployment(ns, name)
      if (!dep) return nf()
      for (const rs of c.replicaSetsOf(dep)) {
        for (const p of c.podsOf(rs)) c.markDeleted(p, now, force)
        s.replicasets.splice(s.replicasets.indexOf(rs), 1)
      }
      s.deployments.splice(s.deployments.indexOf(dep), 1)
      return done()
    }
    case 'ReplicaSet': {
      const rs = s.replicasets.find((r) => r.meta.namespace === ns && r.meta.name === name)
      if (!rs) return nf()
      for (const p of c.podsOf(rs)) c.markDeleted(p, now, force)
      s.replicasets.splice(s.replicasets.indexOf(rs), 1)
      return done()
    }
    case 'DaemonSet': {
      const ds = s.daemonsets.find((r) => r.meta.namespace === ns && r.meta.name === name)
      if (!ds) return nf()
      for (const p of s.pods.filter((p) => p.owner?.kind === 'DaemonSet' && p.owner.name === name && p.meta.namespace === ns)) c.markDeleted(p, now, force)
      s.daemonsets.splice(s.daemonsets.indexOf(ds), 1)
      return done()
    }
    case 'Service': {
      const svc = c.findService(ns, name)
      if (!svc) return nf()
      if (name === 'kubernetes' && ns === 'default') {
        // API server tạo lại Service này ngay lập tức
        svc.meta.createdAt = now
        return done()
      }
      s.services.splice(s.services.indexOf(svc), 1)
      return done()
    }
    case 'ConfigMap':
    case 'Secret': {
      const list = kind === 'Secret' ? s.secrets : s.configmaps
      const item = list.find((x) => x.meta.namespace === ns && x.meta.name === name)
      if (!item) return nf()
      list.splice(list.indexOf(item as never), 1)
      return done()
    }
    case 'Namespace': {
      const n = s.namespaces.find((x) => x.meta.name === name)
      if (!n) return nf()
      if (PROTECTED_NS.includes(name)) return [err(`Error from server (Forbidden): namespaces "${name}" is forbidden: this namespace may not be deleted`)]
      if (!n.deletedAt) {
        n.deletedAt = now
        for (const p of s.pods.filter((p) => p.meta.namespace === name)) c.markDeleted(p, now)
        s.deployments = s.deployments.filter((x) => x.meta.namespace !== name)
        s.replicasets = s.replicasets.filter((x) => x.meta.namespace !== name)
        s.daemonsets = s.daemonsets.filter((x) => x.meta.namespace !== name)
        s.services = s.services.filter((x) => x.meta.namespace !== name)
      }
      return done()
    }
    case 'Node': {
      const node = c.findNode(name)
      if (!node) return [err(`Error from server (NotFound): nodes "${name}" not found`)]
      for (const p of s.pods.filter((p) => p.nodeName === name)) c.markDeleted(p, now, true)
      s.nodes.splice(s.nodes.indexOf(node), 1)
      return [out(`node "${name}" deleted`)]
    }
  }
  return [note(`(playground) Xóa ${kind} chưa được hỗ trợ.`)]
}

function cmdDelete(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const files = flagAll(a, 'filename')
  if (files.length) return applyFiles(files, 'delete', a, ctx, now)
  const ns = flag(a, 'namespace') ?? c.state.currentNamespace
  const force = has(a, 'force') && flag(a, 'grace-period') === '0'
  const { targets, error } = parseTargets(a.pos)
  if (error) return lines(error.text.startsWith('You must') ? err('error: You must provide one or more resources by argument or filename.') : error)
  const result: Line[] = []
  if (force) result.push(warn('Warning: Immediate deletion does not wait for confirmation that the running resource has been terminated. The resource may continue to run on the cluster indefinitely.'))
  const selectorText = flag(a, 'selector')
  for (const { res, names } of targets) {
    let victims: string[] = names
    if (!names.length) {
      if (!selectorText && !has(a, 'all')) return lines(err('error: resource(s) were provided, but no name was specified'))
      let items = res.items(c, res.namespaced ? ns : null)
      if (selectorText) items = items.filter((i) => parseSelector(selectorText)(res.meta(i).labels))
      if (res === PODS) items = items.filter((p: Pod) => !p.deletedAt)
      victims = items.map((i) => res.meta(i).name)
      if (!victims.length) {
        result.push(noResources(res.namespaced ? ns : null))
        continue
      }
    }
    if (![PODS, DEPLOYMENTS, REPLICASETS, DAEMONSETS, SERVICES, CONFIGMAPS, SECRETS, NAMESPACES, NODES].includes(res)) {
      result.push(note(`(playground) Xóa ${res.plural} chưa được hỗ trợ.`))
      continue
    }
    for (const name of victims) result.push(...deleteByKind(res.kind, res.namespaced ? ns : '', name, ctx, now, undefined, force))
  }
  return lines(result)
}

// ---------------------------------------------------------------------------
// scale, set, rollout, expose, label/annotate
// ---------------------------------------------------------------------------

function resolveWorkload(a: Args, ctx: ShellContext): { dep?: Deployment; rs?: ReplicaSet; pod?: Pod; error?: Line } {
  const c = ctx.cluster
  const ns = flag(a, 'namespace') ?? c.state.currentNamespace
  let [type, name] = a.pos
  if (type?.includes('/')) {
    ;[type, name] = type.split('/')
    a.pos.splice(0, 1, type, name)
  }
  if (!type) return { error: err('error: required resource not specified') }
  const res = findRes(type)
  if (!res || res === 'empty') return { error: err(`error: the server doesn't have a resource type "${type}"`) }
  if (!name) return { error: err('error: resource(s) were provided, but no name was specified') }
  if (res === DEPLOYMENTS) {
    const dep = c.findDeployment(ns, name)
    return dep ? { dep } : { error: notFound(res, name) }
  }
  if (res === REPLICASETS) {
    const rs = c.state.replicasets.find((r) => r.meta.namespace === ns && r.meta.name === name)
    return rs ? { rs } : { error: notFound(res, name) }
  }
  if (res === PODS) {
    const pod = c.findPod(ns, name)
    return pod ? { pod } : { error: notFound(res, name) }
  }
  return { error: note(`(playground) Thao tác này với ${res.plural} chưa được hỗ trợ.`) }
}

function cmdScale(a: Args, ctx: ShellContext): ShellResult {
  const replicasText = flag(a, 'replicas')
  if (replicasText === undefined) return lines(err('error: required flag(s) "replicas" not set'))
  const replicas = Number(replicasText)
  if (!Number.isInteger(replicas) || replicas < 0) return lines(err(`error: invalid argument "${replicasText}" for "--replicas" flag: strconv.ParseInt: parsing "${replicasText}": invalid syntax`))
  const { dep, rs, error } = resolveWorkload(a, ctx)
  if (error) return lines(error)
  if (dep) {
    dep.replicas = replicas
    return lines(out(`deployment.apps/${dep.meta.name} scaled`))
  }
  if (rs) {
    if (rs.owner) {
      rs.replicas = replicas
      return lines(out(`replicaset.apps/${rs.meta.name} scaled`), note('(playground) ReplicaSet này do Deployment quản lý — Deployment sẽ đưa số replicas về như cũ. Hãy scale Deployment.'))
    }
    rs.replicas = replicas
    return lines(out(`replicaset.apps/${rs.meta.name} scaled`))
  }
  return lines(err('error: cannot scale this resource'))
}

function cmdSet(a: Args, ctx: ShellContext, now: number): ShellResult {
  const sub = a.pos.shift()
  if (sub !== 'image' && sub !== 'env') {
    return lines(note('(playground) Hỗ trợ: kubectl set image deployment/<tên> <container>=<image> | kubectl set env deployment/<tên> KEY=VALUE'))
  }
  const { dep, pod, error } = resolveWorkload(a, ctx)
  if (error) return lines(error)
  const pairs = a.pos.slice(2)
  if (!pairs.length) return lines(err(sub === 'image' ? 'error: at least one image update is required' : 'error: at least one environment variable must be provided'))
  if (pod && sub === 'image') {
    for (const pair of pairs) {
      const kv = parseLiteral(pair)
      const ct = kv && pod.spec.containers.find((x) => x.name === kv[0] || kv[0] === '*')
      if (!kv || !ct) return lines(err(`error: unable to find container named "${kv?.[0] ?? pair}"`))
      ct.image = kv[1]
    }
    pod.scheduledAt = now
    pod.runningSince = undefined
    pod.restartOffset += 1
    return lines(out(`pod/${pod.meta.name} image updated`))
  }
  if (!dep) return lines(err('error: unsupported resource'))
  const template = JSON.parse(JSON.stringify(dep.template)) as PodTemplate
  for (const pair of pairs) {
    if (sub === 'env' && pair.endsWith('-')) {
      for (const ct of template.spec.containers) ct.env = ct.env.filter((e) => e.name !== pair.slice(0, -1))
      continue
    }
    const kv = parseLiteral(pair)
    if (!kv) return lines(err(`error: invalid ${sub} "${pair}"`))
    if (sub === 'image') {
      const targets = template.spec.containers.filter((x) => x.name === kv[0] || kv[0] === '*')
      if (!targets.length) return lines(err(`error: unable to find container named "${kv[0]}"`))
      targets.forEach((ct) => (ct.image = kv[1]))
    } else {
      for (const ct of template.spec.containers) {
        const existing = ct.env.find((e) => e.name === kv[0])
        if (existing) existing.value = kv[1]
        else ct.env.push({ name: kv[0], value: kv[1] })
      }
    }
  }
  if (sameJson(template, dep.template)) return lines(out(`deployment.apps/${dep.meta.name} ${sub === 'image' ? 'image' : 'env'} updated`))
  dep.template = template
  dep.lastProgressAt = now
  return lines(out(`deployment.apps/${dep.meta.name} ${sub === 'image' ? 'image' : 'env'} updated`))
}

function cmdRollout(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const sub = a.pos.shift()
  const { dep, error } = resolveWorkload(a, ctx)
  if (!sub || !['status', 'history', 'undo', 'restart', 'pause', 'resume'].includes(sub)) {
    return lines(err('error: Usage: kubectl rollout status|history|undo|restart|pause|resume deployment/<tên>'))
  }
  if (error) return lines(error)
  if (!dep) return lines(err('error: rollout chỉ hỗ trợ Deployment trong playground'))
  const id = `deployment.apps/${dep.meta.name}`
  const rss = () => c.replicaSetsOf(dep).sort((x, y) => x.revision - y.revision)

  switch (sub) {
    case 'status': {
      c.tick(now)
      const first = c.rolloutMessage(dep, now)
      const res: ShellResult = lines(first.error ? err(first.text) : out(first.text))
      if (first.done) return res
      let last = first.text
      res.stream = (emit, done) => {
        const started = Date.now()
        const timer = setInterval(() => {
          const t = Date.now()
          c.tick(t)
          const msg = c.rolloutMessage(dep, t)
          if (msg.text !== last) {
            last = msg.text
            emit([msg.error ? err(msg.text) : out(msg.text)])
          }
          if (msg.done) done()
          else if (t - started > 30_000) {
            emit([note('(playground) Rollout vẫn chưa xong sau 30 giây — nhiều khả năng đang bị kẹt. Kiểm tra: kubectl get pods và kubectl describe pod <tên-pod>. Cluster thật sẽ chờ tới progressDeadlineSeconds (mặc định 600s).')])
            done()
          }
        }, 400)
        return () => clearInterval(timer)
      }
      return res
    }
    case 'history': {
      const revision = flag(a, 'revision')
      if (revision) {
        const rs = rss().find((r) => String(r.revision) === revision)
        if (!rs) return lines(err(`error: unable to find the specified revision`))
        return lines(textLines([
          `${id} with revision #${rs.revision}`,
          'Pod Template:',
          ...block([['Labels', labelLines(rs.template.labels)]], '  '),
          '  Containers:',
          ...rs.template.spec.containers.flatMap((ct) => containerBlock(ct)),
        ].join('\n')))
      }
      const rows = rss().map((rs) => [String(rs.revision), rs.meta.annotations['kubernetes.io/change-cause'] ?? '<none>'])
      return lines(out(`${id} `), ...table(['REVISION', 'CHANGE-CAUSE'], rows).map(out), out(''))
    }
    case 'undo': {
      const list = rss()
      const current = c.newReplicaSet(dep)
      const target = flag(a, 'to-revision')
      let rs: ReplicaSet | undefined
      if (target && target !== '0') {
        rs = list.find((r) => String(r.revision) === target)
        if (!rs) return lines(err(`error: unable to find specified revision ${target} in history`))
      } else {
        rs = list.filter((r) => r !== current).at(-1)
        if (!rs) return lines(err(`error: no rollout history found for deployment "${dep.meta.name}"`))
      }
      if (rs === current) return lines(out(`${id} skipped rollback (current template already matches revision ${rs.revision})`))
      const { 'pod-template-hash': _hash, ...labels } = rs.template.labels
      dep.template = JSON.parse(JSON.stringify({ ...rs.template, labels }))
      dep.lastProgressAt = now
      c.state.flags[`rolled-back:${dep.meta.name}`] = true
      return lines(out(`${id} rolled back`))
    }
    case 'restart': {
      dep.template = { ...dep.template, annotations: { ...dep.template.annotations, 'kubectl.kubernetes.io/restartedAt': isoTime(now) } }
      dep.lastProgressAt = now
      return lines(out(`${id} restarted`))
    }
    case 'pause':
      if (dep.paused) return lines(err(`error: deployments.apps "${dep.meta.name}" is already paused`))
      dep.paused = true
      return lines(out(`${id} paused`))
    case 'resume':
      if (!dep.paused) return lines(err(`error: deployments.apps "${dep.meta.name}" is not paused`))
      dep.paused = false
      dep.lastProgressAt = now
      return lines(out(`${id} resumed`))
  }
  return lines()
}

function cmdExpose(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const ns = flag(a, 'namespace') ?? c.state.currentNamespace
  const { dep, rs, pod, error } = resolveWorkload(a, ctx)
  if (error) return lines(error)
  const selector = dep?.selector ?? rs?.selector ?? (pod ? pod.meta.labels : {})
  if (!Object.keys(selector).length) return lines(err(`error: couldn't retrieve selectors via --selector flag or introspection: the pod has no labels and cannot be exposed`))
  const sourceName = (dep ?? rs ?? pod)!.meta.name
  const name = flag(a, 'name') ?? sourceName
  const template = dep?.template ?? rs?.template
  const containerPort = (template?.spec ?? pod?.spec)?.containers[0]?.ports[0]?.containerPort
  const port = Number(flag(a, 'port') ?? containerPort)
  if (!port) return lines(err("error: couldn't find port via --port flag or introspection"))
  const target = flag(a, 'target-port')
  const typeText = flag(a, 'type') ?? 'ClusterIP'
  const type = (['ClusterIP', 'NodePort', 'LoadBalancer'].find((t) => t.toLowerCase() === typeText.toLowerCase()) ?? 'ClusterIP') as Service['type']
  if ((flag(a, 'dry-run') ?? 'none') !== 'none') {
    return lines(dryRunYaml({ apiVersion: 'v1', kind: 'Service', metadata: { labels: dep?.meta.labels ?? {}, name }, spec: { ports: [{ port, protocol: 'TCP', targetPort: target ? (Number(target) || target) : port }], selector, ...(type !== 'ClusterIP' ? { type } : {}) }, status: { loadBalancer: {} } }))
  }
  if (c.findService(ns, name)) return lines(err(`Error from server (AlreadyExists): services "${name}" already exists`))
  c.state.services.push({
    meta: newMeta(name, ns, now, { ...(dep?.meta.labels ?? pod?.meta.labels ?? {}) }),
    type,
    clusterIP: allocateClusterIP(c),
    selector: { ...selector },
    ports: [{ port, targetPort: target ? Number(target) || target : port, protocol: (flag(a, 'protocol') ?? 'TCP').toUpperCase(), nodePort: type === 'ClusterIP' ? undefined : allocateNodePort(c) }],
  })
  return lines(out(`service/${name} exposed`))
}

function cmdLabel(a: Args, ctx: ShellContext, annotate: boolean): ShellResult {
  const c = ctx.cluster
  const ns = flag(a, 'namespace') ?? c.state.currentNamespace
  let [type, name, ...changes] = a.pos
  if (type?.includes('/')) {
    changes = [name, ...changes].filter(Boolean)
    ;[type, name] = type.split('/')
  }
  if (!type || !name) return lines(err('error: one or more resources must be specified as <resource> <name> or <resource>/<name>'))
  const res = findRes(type)
  if (!res || res === 'empty') return lines(err(`error: the server doesn't have a resource type "${type}"`))
  if (!changes.length) return lines(err(`error: at least one ${annotate ? 'annotation' : 'label'} update is required`))
  const obj = res.items(c, res.namespaced ? ns : null).find((i) => res.meta(i).name === name)
  if (!obj) return lines(notFound(res, name))
  const m = res.meta(obj)
  const target = annotate ? m.annotations : m.labels
  const before = JSON.stringify(target)
  for (const ch of changes) {
    if (ch.endsWith('-')) {
      delete target[ch.slice(0, -1)]
      continue
    }
    const kv = parseLiteral(ch)
    if (!kv) return lines(err(`error: invalid ${annotate ? 'annotation' : 'label'} spec: ${ch}`))
    if (target[kv[0]] !== undefined && target[kv[0]] !== kv[1] && !has(a, 'overwrite')) {
      return lines(err(`error: '${kv[0]}' already has a value (${target[kv[0]]}), and --overwrite is false`))
    }
    if (!annotate && !/^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$|^$/.test(kv[1])) {
      return lines(err(`error: invalid label value: "${ch}": a valid label must be an empty string or consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character`))
    }
    target[kv[0]] = kv[1]
  }
  // Pod đổi label không còn khớp selector → ReplicaSet "thả" Pod (Pod mồ côi)
  if (res === PODS && !annotate) {
    const pod = obj as Pod
    if (pod.owner?.kind === 'ReplicaSet') {
      const rs = c.state.replicasets.find((r) => r.meta.name === pod.owner!.name && r.meta.namespace === ns)
      if (rs && !matchLabels(rs.selector, pod.meta.labels)) pod.owner = undefined
    }
  }
  const changed = JSON.stringify(target) !== before
  return lines(out(`${typePrefix(res)}/${name} ${changed ? '' : 'not '}${annotate ? 'annotated' : 'labeled'}`))
}

// ---------------------------------------------------------------------------
// logs, exec, port-forward
// ---------------------------------------------------------------------------

function resolvePodRef(ref: string, ns: string, c: Cluster): Pod | Line {
  if (ref.includes('/')) {
    const [type, name] = ref.split('/')
    const res = findRes(type)
    if (res === DEPLOYMENTS) {
      const dep = c.findDeployment(ns, name)
      if (!dep) return notFound(DEPLOYMENTS, name)
      const pods = c.podsOfDeployment(dep)
      return pods.find((p) => c.isPodReady(p)) ?? pods[0] ?? err(`error: no pods found for deployment ${name}`)
    }
    if (res === SERVICES) {
      const svc = c.findService(ns, name)
      if (!svc) return notFound(SERVICES, name)
      const ep = c.serviceEndpoints(svc)[0]
      return ep?.pod ?? err(`error: timed out waiting for the condition`)
    }
    if (res !== PODS) return err(`error: cannot attach to ${type}: selector for ${type} not implemented`)
    ref = name
  }
  return c.findPod(ns, ref) ?? notFound(PODS, ref)
}

function pickContainer(pod: Pod, a: Args): { container?: ContainerSpec; info?: Line; error?: Line } {
  const name = flag(a, 'container')
  if (name) {
    const ct = pod.spec.containers.find((x) => x.name === name)
    return ct ? { container: ct } : { error: err(`error: container ${name} is not valid for pod ${pod.meta.name}`) }
  }
  const ct = pod.spec.containers[0]
  return {
    container: ct,
    info: pod.spec.containers.length > 1 ? note(`Defaulted container "${ct.name}" out of: ${pod.spec.containers.map((x) => x.name).join(', ')}`) : undefined,
  }
}

function cmdLogs(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const ns = flag(a, 'namespace') ?? c.state.currentNamespace
  const selectorText = flag(a, 'selector')
  let pods: Pod[] = []
  if (selectorText) {
    pods = c.state.pods.filter((p) => p.meta.namespace === ns && !p.deletedAt && parseSelector(selectorText)(p.meta.labels))
    if (!pods.length) return lines(note('No resources found in ' + ns + ' namespace.'))
  } else {
    const ref = a.pos[0]
    if (!ref) return lines(err('error: expected POD, TYPE/NAME, or --selector'))
    const pod = resolvePodRef(ref, ns, c)
    if ('text' in pod) return lines(pod)
    pods = [pod]
  }
  const tail = flag(a, 'tail') !== undefined ? Number(flag(a, 'tail')) : -1
  const previous = has(a, 'previous')
  const result: Line[] = []
  const collect = (pod: Pod, t: number): Line[] | Line => {
    const { container, info, error } = pickContainer(pod, a)
    if (error || !container) return error!
    const st = c.podStatus(pod, t).containers.find((x) => x.name === container.name)!
    const prefix = has(a, 'prefix') || selectorText ? `[pod/${pod.meta.name}/${container.name}] ` : ''
    if (previous && !st.lastState) {
      return err(`Error from server (BadRequest): previous terminated container "${container.name}" in pod "${pod.meta.name}" not found`)
    }
    if (!previous && st.state === 'waiting' && !st.lastState) {
      return err(`Error from server (BadRequest): container "${container.name}" in pod "${pod.meta.name}" is waiting to start: ${st.reason}`)
    }
    let logLines = containerLogs(c, pod, container, st, t, previous)
    if (tail >= 0) logLines = logLines.slice(-tail || logLines.length)
    if (tail === 0) logLines = []
    return [...(info && !selectorText ? [info] : []), ...logLines.map((l) => out(prefix + l))]
  }
  for (const pod of pods) {
    const r = collect(pod, now)
    if (Array.isArray(r)) result.push(...r)
    else result.push(r)
  }
  const res = lines(result)
  if (has(a, 'follow') && pods.length) {
    const seen = new Map(pods.map((p) => [p.meta.uid, p.accessLog.length]))
    res.stream = (emit, done) => {
      const started = Date.now()
      const timer = setInterval(() => {
        const fresh: Line[] = []
        for (const p of pods) {
          const count = seen.get(p.meta.uid) ?? 0
          if (p.accessLog.length > count) {
            const prefix = selectorText ? `[pod/${p.meta.name}/${p.spec.containers[0].name}] ` : ''
            fresh.push(...p.accessLog.slice(count).map((l) => out(prefix + l.line)))
            seen.set(p.meta.uid, p.accessLog.length)
          }
        }
        if (fresh.length) emit(fresh)
        if (Date.now() - started > 120_000) done()
      }, 500)
      return () => clearInterval(timer)
    }
    res.lines.push(note('(playground) Đang theo dõi log — nhấn Ctrl+C để dừng. Gửi request tới Pod (curl/wget) để thấy log mới.'))
  }
  return res
}

function cmdExec(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const ns = flag(a, 'namespace') ?? c.state.currentNamespace
  const ref = a.pos[0]
  if (!ref) return lines(err('error: pod or type/name must be specified'))
  if (!a.dash.length) {
    return lines(err(a.pos.length > 1 ? 'error: exec [POD] [COMMAND] is not supported anymore. Use exec [POD] -- [COMMAND] instead' : 'error: you must specify at least one command for the container'))
  }
  const pod = resolvePodRef(ref, ns, c)
  if ('text' in pod) return lines(pod)
  const { container, info, error } = pickContainer(pod, a)
  if (error || !container) return lines(error!)
  const st = c.podStatus(pod, now)
  const cs = st.containers.find((x) => x.name === container.name)!
  if (st.phase === 'Succeeded' || st.phase === 'Failed') {
    return lines(err(`error: cannot exec into a container in a completed pod; current phase is ${st.phase}`))
  }
  if (cs.state !== 'running') {
    return lines(err(`error: unable to upgrade connection: container not found ("${container.name}")`))
  }
  const r = execInPod(c, pod, container, a.dash, now)
  if (r.hitService) c.state.flags['curl-service'] = true
  return lines(info ? [info] : [], r.lines.map(out), r.code !== 0 ? [err(`command terminated with exit code ${r.code}`)] : [])
}

function cmdPortForward(a: Args, ctx: ShellContext, background: boolean): ShellResult {
  const c = ctx.cluster
  const ns = flag(a, 'namespace') ?? c.state.currentNamespace
  const [ref, mapping] = a.pos
  if (!ref || !mapping) return lines(err('error: TYPE/NAME and list of ports are required for port-forward'))
  const pod = resolvePodRef(ref.includes('/') ? ref : `pod/${ref}`, ns, c)
  if ('text' in pod) return lines(pod)
  const [localText, remoteText] = mapping.includes(':') ? mapping.split(':') : [mapping, mapping]
  const local = Number(localText)
  let remote = Number(remoteText)
  if (ref.startsWith('svc/') || ref.startsWith('service/')) {
    const svc = c.findService(ns, ref.split('/')[1])!
    const sp = svc.ports.find((p) => p.port === remote)
    if (!sp) return lines(err(`error: Service ${svc.meta.name} does not have a service port ${remote}`))
    remote = c.resolveTargetPort(pod, sp.targetPort)
  }
  const st = c.podStatus(pod)
  if (st.phase !== 'Running') return lines(err(`error: unable to forward port because pod is not running. Current status=${st.phase}`))
  const label = `kubectl port-forward ${ref} ${mapping}`
  const header = [out(`Forwarding from 127.0.0.1:${local} -> ${remote}`), out(`Forwarding from [::1]:${local} -> ${remote}`)]
  if (background) {
    ctx.forwards.set(local, { pod, port: remote, label })
    return lines(out(`[${ctx.forwards.size}] ${4000 + ctx.forwards.size}`), header, note(`(playground) Đang chạy nền. Thử: curl localhost:${local}  —  dừng bằng: kill %${ctx.forwards.size}`))
  }
  const res = lines(header, note(`(playground) port-forward giữ terminal (giống thật). Mẹo: thêm " &" vào cuối lệnh để chạy nền rồi dùng curl localhost:${local}. Nhấn Ctrl+C để dừng.`))
  res.stream = (_emit, _done) => {
    ctx.forwards.set(local, { pod, port: remote, label })
    return () => ctx.forwards.delete(local)
  }
  return res
}

// ---------------------------------------------------------------------------
// Node: cordon, uncordon, drain, taint
// ---------------------------------------------------------------------------

function cmdCordon(a: Args, ctx: ShellContext, now: number, cordon: boolean): ShellResult {
  const c = ctx.cluster
  const name = a.pos[0]
  const node = name ? c.findNode(name) : undefined
  if (!name) return lines(err('error: USAGE: cordon NODE [flags]'))
  if (!node) return lines(err(`Error from server (NotFound): nodes "${name}" not found`))
  if (node.unschedulable === cordon) return lines(out(`node/${name} already ${cordon ? 'cordoned' : 'uncordoned'}`))
  node.unschedulable = cordon
  if (!cordon && c.state.flags[`drained:${name}`]) c.state.flags[`uncordoned-after-drain:${name}`] = true
  c.event({ namespace: '', type: 'Normal', reason: cordon ? 'NodeNotSchedulable' : 'NodeSchedulable', object: `node/${name}`, source: 'kubelet', message: `Node ${name} status is now: ${cordon ? 'NodeNotSchedulable' : 'NodeSchedulable'}` }, now)
  return lines(out(`node/${name} ${cordon ? 'cordoned' : 'uncordoned'}`))
}

function cmdDrain(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const name = a.pos[0]
  const node = name ? c.findNode(name) : undefined
  if (!name) return lines(err('error: USAGE: drain NODE [flags]'))
  if (!node) return lines(err(`Error from server (NotFound): nodes "${name}" not found`))
  const result: Line[] = []
  if (!node.unschedulable) {
    node.unschedulable = true
    result.push(out(`node/${name} cordoned`))
  } else result.push(out(`node/${name} already cordoned`))
  const pods = c.state.pods.filter((p) => p.nodeName === name && !p.deletedAt)
  const dsPods = pods.filter((p) => p.owner?.kind === 'DaemonSet')
  const staticPods = pods.filter((p) => p.owner?.kind === 'Node')
  const bare = pods.filter((p) => !p.owner)
  const problems: string[] = []
  if (dsPods.length && !has(a, 'ignore-daemonsets')) {
    problems.push(`cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): ${dsPods.map((p) => `${p.meta.namespace}/${p.meta.name}`).join(', ')}`)
  }
  if (bare.length && !has(a, 'force')) {
    problems.push(`cannot delete Pods that declare no controller (use --force to override): ${bare.map((p) => `${p.meta.namespace}/${p.meta.name}`).join(', ')}`)
  }
  if (problems.length) {
    result.push(err(`error: unable to drain node "${name}" due to error: [${problems.join(', ')}], continuing command...`), err('There are pending nodes to be drained:'), err(` ${name}`))
    problems.forEach((p) => result.push(err(`error: ${p}`)))
    return lines(result)
  }
  const ignored = [...dsPods, ...staticPods]
  if (ignored.length) result.push(warn(`Warning: ignoring DaemonSet-managed Pods: ${dsPods.map((p) => `${p.meta.namespace}/${p.meta.name}`).join(', ')}`))
  if (bare.length) result.push(warn(`Warning: deleting Pods that declare no controller: ${bare.map((p) => `${p.meta.namespace}/${p.meta.name}`).join(', ')}`))
  const victims = pods.filter((p) => !ignored.includes(p))
  for (const p of victims) result.push(out(`evicting pod ${p.meta.namespace}/${p.meta.name}`))
  for (const p of victims) {
    c.markDeleted(p, now)
    result.push(out(`pod/${p.meta.name} evicted`))
  }
  result.push(out(`node/${name} drained`))
  c.state.flags[`drained:${name}`] = true
  return lines(result)
}

function cmdTaint(a: Args, ctx: ShellContext): ShellResult {
  const c = ctx.cluster
  const [type, name, ...specs] = a.pos
  if (!type || !/^(nodes?|no)$/.test(type)) return lines(err('error: at least one taint update is required'))
  const node = name ? c.findNode(name) : undefined
  if (!node) return lines(err(`Error from server (NotFound): nodes "${name ?? ''}" not found`))
  if (!specs.length) return lines(err('error: at least one taint update is required'))
  for (const spec of specs) {
    const remove = spec.endsWith('-')
    const body = remove ? spec.slice(0, -1) : spec
    const m = /^([^=:]+)(?:=([^:]*))?(?::(NoSchedule|PreferNoSchedule|NoExecute))?$/.exec(body)
    if (!m) return lines(err(`error: invalid taint spec: ${spec}`))
    const [, key, value, effect] = m
    if (remove) {
      const before = node.taints.length
      node.taints = node.taints.filter((t) => !(t.key === key && (!effect || t.effect === effect)))
      if (node.taints.length === before) return lines(err(`error: taint "${body}" not found`))
      continue
    }
    if (!effect) return lines(err(`error: invalid taint spec: ${spec}, unknown taint effect`))
    const existing = node.taints.find((t) => t.key === key && t.effect === effect)
    if (existing && !has(a, 'overwrite')) return lines(err(`error: node ${name} already has ${key} taint(s) with same effect(s) and --overwrite is false`))
    node.taints = node.taints.filter((t) => !(t.key === key && t.effect === effect))
    node.taints.push({ key, value: value || undefined, effect: effect as 'NoSchedule' })
  }
  return lines(out(`node/${name} ${specs.every((s) => s.endsWith('-')) ? 'untainted' : 'tainted'}`))
}

// ---------------------------------------------------------------------------
// top, explain, version, config, auth, api-resources, wait, patch
// ---------------------------------------------------------------------------

function podUsage(p: Pod): { cpu: number; mem: number } {
  const short = parseImage(p.spec.containers[0].image).short
  const base: Record<string, [number, number]> = {
    nginx: [1, 3], httpd: [1, 6], redis: [3, 4], 'traefik/whoami': [0, 2], 'stefanprodan/podinfo': [2, 12],
    'hpa-example': [1, 9], 'coredns/coredns': [2, 15], etcd: [28, 52], 'kube-apiserver': [45, 260],
    'kube-controller-manager': [12, 48], 'kube-scheduler': [3, 20], 'kube-proxy': [1, 16], 'kindest/kindnetd': [1, 10],
  }
  const [cpu, mem] = base[short] ?? [1, 5]
  const jitter = (p.meta.uid.charCodeAt(0) % 3)
  return { cpu: cpu + (cpu > 0 ? jitter : 0), mem: mem + jitter }
}

function cmdTop(a: Args, ctx: ShellContext, now: number): ShellResult {
  const c = ctx.cluster
  const metrics = c.state.pods.some((p) => p.meta.namespace === 'kube-system' && p.meta.labels['k8s-app'] === 'metrics-server' && c.isPodReady(p, now))
  if (!metrics) {
    return lines(err('error: Metrics API not available'), note('(playground) Cần cài metrics-server trước. Thử: kubectl apply -f metrics-server.yaml rồi chờ Pod Running.'))
  }
  const what = a.pos[0] ?? ''
  if (/^(nodes?|no|pods?|po)$/.test(what)) c.state.flags.top = true
  if (/^(nodes?|no)$/.test(what)) {
    const rows = c.state.nodes.map((n) => {
      const pods = c.state.pods.filter((p) => p.nodeName === n.meta.name && !p.deletedAt)
      const cpu = 40 + pods.reduce((s, p) => s + podUsage(p).cpu, 0)
      const mem = 350 + pods.reduce((s, p) => s + podUsage(p).mem, 0)
      return [n.meta.name, `${cpu}m`, `${Math.round(cpu / 80)}%`, `${mem}Mi`, `${Math.round((mem / 15872) * 100)}%`]
    })
    return lines(table(['NAME', 'CPU(cores)', 'CPU(%)', 'MEMORY(bytes)', 'MEMORY(%)'], rows).map(out))
  }
  if (/^(pods?|po)$/.test(what)) {
    const allNs = has(a, 'all-namespaces')
    const ns = flag(a, 'namespace') ?? c.state.currentNamespace
    let pods = c.state.pods.filter((p) => (allNs || p.meta.namespace === ns) && c.isPodReady(p, now))
    if (a.pos[1]) pods = pods.filter((p) => p.meta.name === a.pos[1])
    if (!pods.length) return lines(note(`No resources found in ${ns} namespace.`))
    const sortBy = flag(a, 'sort-by')
    if (sortBy) pods.sort((x, y) => (sortBy === 'cpu' ? podUsage(y).cpu - podUsage(x).cpu : podUsage(y).mem - podUsage(x).mem))
    const rows = pods.map((p) => [...(allNs ? [p.meta.namespace] : []), p.meta.name, `${podUsage(p).cpu}m`, `${podUsage(p).mem}Mi`])
    return lines(table([...(allNs ? ['NAMESPACE'] : []), 'NAME', 'CPU(cores)', 'MEMORY(bytes)'], rows).map(out))
  }
  return lines(err('error: Usage: kubectl top node | kubectl top pod'))
}

const EXPLAIN: Record<string, string[]> = {
  pod: ['KIND:       Pod', 'VERSION:    v1', '', 'DESCRIPTION:', '    Pod is a collection of containers that can run on a host. This resource is', '    created by clients and scheduled onto hosts.', '', 'FIELDS:', '  apiVersion\t<string>', '  kind\t<string>', '  metadata\t<ObjectMeta>', '  spec\t<PodSpec>', '  status\t<PodStatus>'],
  'pod.spec': ['KIND:       Pod', 'VERSION:    v1', '', 'FIELD: spec <PodSpec>', '', 'DESCRIPTION:', '    Specification of the desired behavior of the pod.', '', 'FIELDS:', '  affinity\t<Affinity>', '  containers\t<[]Container> -required-', '  initContainers\t<[]Container>', '  nodeName\t<string>', '  nodeSelector\t<map[string]string>', '  restartPolicy\t<string>', '  securityContext\t<PodSecurityContext>', '  serviceAccountName\t<string>', '  tolerations\t<[]Toleration>', '  volumes\t<[]Volume>'],
  'pod.spec.containers': ['KIND:       Pod', 'VERSION:    v1', '', 'FIELD: containers <[]Container>', '', 'DESCRIPTION:', '    List of containers belonging to the pod. Containers cannot currently be', '    added or removed. There must be at least one container in a Pod.', '', 'FIELDS:', '  args\t<[]string>', '  command\t<[]string>', '  env\t<[]EnvVar>', '  envFrom\t<[]EnvFromSource>', '  image\t<string>', '  livenessProbe\t<Probe>', '  name\t<string> -required-', '  ports\t<[]ContainerPort>', '  readinessProbe\t<Probe>', '  resources\t<ResourceRequirements>', '  securityContext\t<SecurityContext>', '  volumeMounts\t<[]VolumeMount>'],
  deployment: ['GROUP:      apps', 'KIND:       Deployment', 'VERSION:    v1', '', 'DESCRIPTION:', '    Deployment enables declarative updates for Pods and ReplicaSets.', '', 'FIELDS:', '  apiVersion\t<string>', '  kind\t<string>', '  metadata\t<ObjectMeta>', '  spec\t<DeploymentSpec>', '  status\t<DeploymentStatus>'],
  'deployment.spec': ['GROUP:      apps', 'KIND:       Deployment', 'VERSION:    v1', '', 'FIELD: spec <DeploymentSpec>', '', 'FIELDS:', '  minReadySeconds\t<integer>', '  paused\t<boolean>', '  progressDeadlineSeconds\t<integer>', '  replicas\t<integer>', '  revisionHistoryLimit\t<integer>', '  selector\t<LabelSelector> -required-', '  strategy\t<DeploymentStrategy>', '  template\t<PodTemplateSpec> -required-'],
  'deployment.spec.strategy': ['GROUP:      apps', 'KIND:       Deployment', 'VERSION:    v1', '', 'FIELD: strategy <DeploymentStrategy>', '', 'DESCRIPTION:', '    The deployment strategy to use to replace existing pods with new ones.', '', 'FIELDS:', '  rollingUpdate\t<RollingUpdateDeployment>', '  type\t<string>', '  enum: Recreate, RollingUpdate'],
  service: ['KIND:       Service', 'VERSION:    v1', '', 'DESCRIPTION:', '    Service is a named abstraction of software service (for example, mysql)', '    consisting of local port that the proxy listens on, and the selector that', '    determines which pods will answer requests sent through the proxy.', '', 'FIELDS:', '  apiVersion\t<string>', '  kind\t<string>', '  metadata\t<ObjectMeta>', '  spec\t<ServiceSpec>', '  status\t<ServiceStatus>'],
  'service.spec': ['KIND:       Service', 'VERSION:    v1', '', 'FIELD: spec <ServiceSpec>', '', 'FIELDS:', '  clusterIP\t<string>', '  externalTrafficPolicy\t<string>', '  ports\t<[]ServicePort>', '  selector\t<map[string]string>', '  sessionAffinity\t<string>', '  type\t<string>', '  enum: ClusterIP, ExternalName, LoadBalancer, NodePort'],
  configmap: ['KIND:       ConfigMap', 'VERSION:    v1', '', 'DESCRIPTION:', '    ConfigMap holds configuration data for pods to consume.', '', 'FIELDS:', '  apiVersion\t<string>', '  binaryData\t<map[string]string>', '  data\t<map[string]string>', '  immutable\t<boolean>', '  kind\t<string>', '  metadata\t<ObjectMeta>'],
}

function cmdExplain(a: Args): ShellResult {
  const target = (a.pos[0] ?? '').toLowerCase()
  if (!target) return lines(err('error: You must specify the type of resource to explain. Use "kubectl api-resources" for a complete list of supported resources.'))
  const [type, ...fields] = target.split('.')
  const res = findRes(type)
  if (!res || res === 'empty') return lines(err(`error: the server doesn't have a resource type "${type}"`))
  const key = [res.singular, ...fields].join('.')
  const doc = EXPLAIN[key]
  if (doc) return lines(doc.map((l) => out(l.replace('\t', '  '))))
  return lines(note(`(playground) Chưa có tài liệu cho "${key}". Trên cluster thật, kubectl explain luôn có đầy đủ — thử: pod, pod.spec, pod.spec.containers, deployment.spec.strategy, service.spec.`))
}

function cmdConfig(a: Args, ctx: ShellContext): ShellResult {
  const s = ctx.cluster.state
  const sub = a.pos[0]
  switch (sub) {
    case 'current-context':
      return lines(out(CONTEXT))
    case 'get-contexts':
      return lines(table(['CURRENT', 'NAME', 'CLUSTER', 'AUTHINFO', 'NAMESPACE'], [['*', CONTEXT, CONTEXT, CONTEXT, s.currentNamespace === 'default' ? '' : s.currentNamespace]]).map(out))
    case 'use-context':
      return a.pos[1] === CONTEXT ? lines(out(`Switched to context "${CONTEXT}".`)) : lines(err(`error: no context exists with the name: "${a.pos[1] ?? ''}"`))
    case 'set-context': {
      const ns = flag(a, 'namespace')
      if (ns) s.currentNamespace = ns
      return lines(out(`Context "${CONTEXT}" modified.`))
    }
    case 'view':
      return lines(textLines([
        'apiVersion: v1',
        'clusters:',
        '- cluster:',
        '    certificate-authority-data: DATA+OMITTED',
        '    server: https://127.0.0.1:41235',
        `  name: ${CONTEXT}`,
        'contexts:',
        '- context:',
        `    cluster: ${CONTEXT}`,
        ...(s.currentNamespace !== 'default' ? [`    namespace: ${s.currentNamespace}`] : []),
        `    user: ${CONTEXT}`,
        `  name: ${CONTEXT}`,
        `current-context: ${CONTEXT}`,
        'kind: Config',
        'users:',
        `- name: ${CONTEXT}`,
        '  user:',
        '    client-certificate-data: DATA+OMITTED',
        '    client-key-data: DATA+OMITTED',
      ].join('\n')))
  }
  return lines(err('error: Usage: kubectl config current-context | get-contexts | use-context | set-context --current --namespace=<ns> | view'))
}

function cmdAuth(a: Args): ShellResult {
  const sub = a.pos[0]
  if (sub === 'whoami') {
    return lines(table(['ATTRIBUTE', 'VALUE'], [['Username', 'kubernetes-admin'], ['Groups', '[kubeadm:cluster-admins system:authenticated]']]).map(out))
  }
  if (sub === 'can-i') {
    if (flag(a, 'as')) return lines(out('no'), note('(playground) Playground chưa mô phỏng RBAC cho danh tính khác — hãy thử trên cluster kind (bài RBAC).'))
    if (has(a, 'list')) return lines(table(['Resources', 'Non-Resource URLs', 'Resource Names', 'Verbs'], [['*.*', '[]', '[]', '[*]'], ['', '[*]', '[]', '[*]']]).map(out))
    return lines(out('yes'))
  }
  return lines(err('error: Usage: kubectl auth can-i VERB RESOURCE | kubectl auth whoami'))
}

const API_RESOURCES = [
  ['bindings', '', 'v1', 'true', 'Binding'],
  ['configmaps', 'cm', 'v1', 'true', 'ConfigMap'],
  ['endpoints', 'ep', 'v1', 'true', 'Endpoints'],
  ['events', 'ev', 'v1', 'true', 'Event'],
  ['namespaces', 'ns', 'v1', 'false', 'Namespace'],
  ['nodes', 'no', 'v1', 'false', 'Node'],
  ['persistentvolumeclaims', 'pvc', 'v1', 'true', 'PersistentVolumeClaim'],
  ['persistentvolumes', 'pv', 'v1', 'false', 'PersistentVolume'],
  ['pods', 'po', 'v1', 'true', 'Pod'],
  ['secrets', '', 'v1', 'true', 'Secret'],
  ['serviceaccounts', 'sa', 'v1', 'true', 'ServiceAccount'],
  ['services', 'svc', 'v1', 'true', 'Service'],
  ['daemonsets', 'ds', 'apps/v1', 'true', 'DaemonSet'],
  ['deployments', 'deploy', 'apps/v1', 'true', 'Deployment'],
  ['replicasets', 'rs', 'apps/v1', 'true', 'ReplicaSet'],
  ['statefulsets', 'sts', 'apps/v1', 'true', 'StatefulSet'],
  ['horizontalpodautoscalers', 'hpa', 'autoscaling/v2', 'true', 'HorizontalPodAutoscaler'],
  ['cronjobs', 'cj', 'batch/v1', 'true', 'CronJob'],
  ['jobs', '', 'batch/v1', 'true', 'Job'],
  ['endpointslices', '', 'discovery.k8s.io/v1', 'true', 'EndpointSlice'],
  ['ingresses', 'ing', 'networking.k8s.io/v1', 'true', 'Ingress'],
  ['networkpolicies', 'netpol', 'networking.k8s.io/v1', 'true', 'NetworkPolicy'],
  ['poddisruptionbudgets', 'pdb', 'policy/v1', 'true', 'PodDisruptionBudget'],
  ['clusterrolebindings', '', 'rbac.authorization.k8s.io/v1', 'false', 'ClusterRoleBinding'],
  ['clusterroles', '', 'rbac.authorization.k8s.io/v1', 'false', 'ClusterRole'],
  ['rolebindings', '', 'rbac.authorization.k8s.io/v1', 'true', 'RoleBinding'],
  ['roles', '', 'rbac.authorization.k8s.io/v1', 'true', 'Role'],
  ['storageclasses', 'sc', 'storage.k8s.io/v1', 'false', 'StorageClass'],
]

function cmdApiResources(a: Args): ShellResult {
  const namespaced = flag(a, 'namespaced')
  const rows = API_RESOURCES.filter((r) => namespaced === undefined || r[3] === namespaced)
  if (flag(a, 'output') === 'name') return lines(rows.map((r) => out(r[2].includes('/') ? `${r[0]}.${r[2].split('/')[0]}` : r[0])))
  return lines(table(['NAME', 'SHORTNAMES', 'APIVERSION', 'NAMESPACED', 'KIND'], rows).map(out))
}

function cmdWait(a: Args, ctx: ShellContext): ShellResult {
  const c = ctx.cluster
  const ns = flag(a, 'namespace') ?? c.state.currentNamespace
  const cond = (flag(a, 'for') ?? '').replace(/^condition=/i, '').toLowerCase()
  const ref = a.pos[0] ?? ''
  const [type, name] = ref.split('/')
  const res = findRes(type ?? '')
  type Check = { problem: Line } | { done: boolean; text: string }
  const check = (): Check => {
    if (res === DEPLOYMENTS) {
      const dep = c.findDeployment(ns, name)
      if (!dep) return { problem: notFound(DEPLOYMENTS, name) }
      const st = c.deploymentStatus(dep)
      const ok = cond === 'progressing' ? true : st.available >= dep.replicas
      return { done: ok, text: `deployment.apps/${name} condition met` }
    }
    if (res === PODS) {
      const pod = c.findPod(ns, name)
      if (!pod) return { problem: notFound(PODS, name) }
      return { done: c.isPodReady(pod), text: `pod/${name} condition met` }
    }
    return { problem: note('(playground) kubectl wait chỉ hỗ trợ deployment/<tên> và pod/<tên>.') }
  }
  const first = check()
  if ('problem' in first) return lines(first.problem)
  if (first.done) return lines(out(first.text))
  const res2: ShellResult = lines()
  res2.stream = (emit, done) => {
    const started = Date.now()
    const timer = setInterval(() => {
      c.tick()
      const x = check()
      if ('problem' in x) {
        emit([x.problem])
        done()
      } else if (x.done) {
        emit([out(x.text)])
        done()
      } else if (Date.now() - started > 30_000) {
        emit([err(`error: timed out waiting for the condition on ${ref}`)])
        done()
      }
    }, 500)
    return () => clearInterval(timer)
  }
  return res2
}

function cmdPatch(a: Args, ctx: ShellContext): ShellResult {
  const c = ctx.cluster
  const patchText = flag(a, 'patch')
  if (!patchText) return lines(err('error: must specify -p to patch'))
  let patch: Obj
  try {
    patch = JSON.parse(patchText)
  } catch {
    return lines(err(`error: unable to parse "${patchText}": yaml: invalid JSON`))
  }
  const [type, name] = a.pos[0]?.includes('/') ? a.pos[0].split('/') : a.pos
  const res = findRes(type ?? '')
  const spec = asObj(patch.spec)
  if (res === NODES) {
    const node = c.findNode(name)
    if (!node) return lines(notFound(NODES, name))
    if (typeof spec.unschedulable === 'boolean') node.unschedulable = spec.unschedulable
    return lines(out(`node/${name} patched`))
  }
  if (res === DEPLOYMENTS) {
    const dep = c.findDeployment(flag(a, 'namespace') ?? c.state.currentNamespace, name)
    if (!dep) return lines(notFound(DEPLOYMENTS, name))
    if (typeof spec.replicas === 'number') {
      dep.replicas = spec.replicas
      return lines(out(`deployment.apps/${name} patched`))
    }
    return lines(note('(playground) patch chỉ hỗ trợ spec.replicas cho Deployment. Hãy sửa file YAML rồi kubectl apply -f.'))
  }
  return lines(note('(playground) patch chưa hỗ trợ loại tài nguyên này.'))
}

// ---------------------------------------------------------------------------
// Bộ điều phối kubectl
// ---------------------------------------------------------------------------

const VERBS = [
  'get', 'describe', 'create', 'run', 'apply', 'delete', 'scale', 'set', 'rollout', 'expose', 'label', 'annotate',
  'logs', 'exec', 'port-forward', 'cordon', 'uncordon', 'drain', 'taint', 'top', 'explain', 'version', 'cluster-info',
  'config', 'auth', 'api-resources', 'api-versions', 'wait', 'patch', 'edit', 'replace', 'autoscale', 'debug', 'cp',
  'attach', 'diff', 'kustomize', 'events', 'certificate', 'completion', 'plugin',
]

function kubectl(tokens: string[], ctx: ShellContext, now: number, background: boolean): ShellResult {
  const verb = tokens[0]
  if (!verb || verb === '--help' || verb === '-h' || verb === 'help') {
    return lines(textLines([
      'kubectl controls the Kubernetes cluster manager.',
      '',
      'Basic Commands: create, expose, run, set, explain, get, edit, delete',
      'Deploy Commands: rollout, scale, autoscale',
      'Cluster Management Commands: top, cordon, uncordon, drain, taint',
      'Troubleshooting and Debugging Commands: describe, logs, attach, exec, port-forward, debug, events',
      'Advanced Commands: diff, apply, patch, replace, wait, kustomize',
      'Settings Commands: label, annotate, completion',
      'Other Commands: api-resources, api-versions, config, version',
      '',
      'Usage:',
      '  kubectl [flags] [options]',
    ].join('\n')))
  }
  if (!VERBS.includes(verb)) {
    const suggestions = VERBS.filter((v) => levenshtein(v, verb) <= 2)
    return lines(textLines(
      `error: unknown command "${verb}" for "kubectl"${suggestions.length ? `\n\nDid you mean this?\n${suggestions.map((s) => `\t${s}`).join('\n')}` : ''}`,
      'err',
    ))
  }
  const a = parseArgs(tokens.slice(1), verb)
  switch (verb) {
    case 'get':
      return cmdGet(a, ctx, now)
    case 'events':
      return cmdGet({ ...a, pos: ['events'] }, ctx, now)
    case 'describe':
      return cmdDescribe(a, ctx, now)
    case 'create':
      return cmdCreate(a, ctx, now)
    case 'run':
      return cmdRun(a, ctx, now)
    case 'apply': {
      const files = flagAll(a, 'filename')
      if (flag(a, 'kustomize') !== undefined || a.flags.has('k')) return lines(note('(playground) Kustomize (-k) chưa được mô phỏng — hãy thử trên cluster kind.'))
      if (!files.length) return lines(err('error: must specify one of -f and -k'))
      return applyFiles(files, 'apply', a, ctx, now)
    }
    case 'delete':
      return cmdDelete(a, ctx, now)
    case 'scale':
      return cmdScale(a, ctx)
    case 'set':
      return cmdSet(a, ctx, now)
    case 'rollout':
      return cmdRollout(a, ctx, now)
    case 'expose':
      return cmdExpose(a, ctx, now)
    case 'label':
      return cmdLabel(a, ctx, false)
    case 'annotate':
      return cmdLabel(a, ctx, true)
    case 'logs':
      return cmdLogs(a, ctx, now)
    case 'exec':
      return cmdExec(a, ctx, now)
    case 'port-forward':
      return cmdPortForward(a, ctx, background)
    case 'cordon':
      return cmdCordon(a, ctx, now, true)
    case 'uncordon':
      return cmdCordon(a, ctx, now, false)
    case 'drain':
      return cmdDrain(a, ctx, now)
    case 'taint':
      return cmdTaint(a, ctx)
    case 'top':
      return cmdTop(a, ctx, now)
    case 'explain':
      return cmdExplain(a)
    case 'version':
      return lines(
        out(`Client Version: ${CLIENT_VERSION}`),
        out(`Kustomize Version: ${KUSTOMIZE_VERSION}`),
        ...(has(a, 'client') ? [] : [out(`Server Version: ${SERVER_VERSION}`)]),
      )
    case 'cluster-info':
      return lines(
        out('Kubernetes control plane is running at https://127.0.0.1:41235'),
        out('CoreDNS is running at https://127.0.0.1:41235/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy'),
        out(''),
        out("To further debug and diagnose cluster problems, use 'kubectl cluster-info dump'."),
      )
    case 'config':
      return cmdConfig(a, ctx)
    case 'auth':
      return cmdAuth(a)
    case 'api-resources':
      return cmdApiResources(a)
    case 'api-versions':
      return lines(['admissionregistration.k8s.io/v1', 'apps/v1', 'authentication.k8s.io/v1', 'autoscaling/v2', 'batch/v1', 'discovery.k8s.io/v1', 'networking.k8s.io/v1', 'policy/v1', 'rbac.authorization.k8s.io/v1', 'storage.k8s.io/v1', 'v1'].map(out))
    case 'wait':
      return cmdWait(a, ctx)
    case 'patch':
      return cmdPatch(a, ctx)
    case 'edit':
    case 'replace':
      return lines(note(`(playground) "kubectl ${verb}" mở trình soạn thảo trên máy thật. Ở đây hãy sửa tệp trong tab "Tệp YAML" (hoặc gõ: vi <tệp>) rồi chạy kubectl apply -f <tệp>.`))
    case 'diff':
      return lines(note('(playground) kubectl diff chưa được mô phỏng. Trên cluster thật nó in ra khác biệt giữa tệp và trạng thái đang chạy.'))
    case 'kustomize':
      return lines(note('(playground) Kustomize chưa được mô phỏng — hãy thử trên cluster kind (bài Kustomize).'))
    default:
      return lines(note(`(playground) "kubectl ${verb}" chưa được mô phỏng trong playground. Hãy thử trên cluster kind thật.`))
  }
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export const HELP = [
  'Playground mô phỏng cluster kind 3 node (Kubernetes ' + SERVER_VERSION + ') ngay trên trình duyệt.',
  '',
  'Lệnh kubectl được hỗ trợ (gõ k thay cho kubectl cũng được):',
  '  get, describe, create, run, apply -f, delete, scale, set image|env, rollout status|history|undo|restart,',
  '  expose, label, annotate, logs, exec, port-forward, cordon, uncordon, drain, taint, top, explain,',
  '  config, auth, api-resources, version, cluster-info, wait, patch',
  '',
  'Lệnh shell: ls, cat <tệp>, vi <tệp>, touch, rm, curl, wget, echo, history, jobs, kill %n, clear, reset',
  'Hỗ trợ ống | grep, | head, | tail, | wc -l, | base64 -d và chuyển hướng > tệp',
  '',
  'Phím tắt: ↑/↓ lịch sử lệnh · Tab tự hoàn thành · Ctrl+C dừng lệnh đang chạy · Ctrl+L xóa màn hình',
  'Bắt đầu với: kubectl get nodes   hoặc làm theo các nhiệm vụ ở khung bên cạnh.',
]

function splitTopLevel(line: string, sep: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null
      current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === sep) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)
  return parts
}

function applyPipe(stage: string, input: ShellResult): ShellResult {
  const [cmd, ...args] = tokenize(stage)
  const data = input.lines.filter((l) => l.kind !== 'err' && l.kind !== 'info')
  const errors = input.lines.filter((l) => l.kind === 'err')
  let result: Line[]
  switch (cmd) {
    case 'grep': {
      const invert = args.includes('-v')
      const insensitive = args.includes('-i')
      const pattern = args.filter((x) => !x.startsWith('-')).join(' ')
      let re: RegExp
      try {
        re = new RegExp(pattern, insensitive ? 'i' : '')
      } catch {
        re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), insensitive ? 'i' : '')
      }
      result = data.filter((l) => re.test(l.text) !== invert)
      break
    }
    case 'head':
    case 'tail': {
      const nFlag = args.find((x) => /^-\d+$/.test(x))
      const nIdx = args.indexOf('-n')
      const n = nFlag ? Number(nFlag.slice(1)) : nIdx >= 0 ? Number(args[nIdx + 1]) : 10
      result = cmd === 'head' ? data.slice(0, n) : data.slice(-n)
      break
    }
    case 'wc':
      result = [out(String(args.includes('-l') ? data.length : data.reduce((s, l) => s + l.text.split(/\s+/).filter(Boolean).length, 0)))]
      break
    case 'sort':
      result = [...data].sort((x, y) => x.text.localeCompare(y.text))
      break
    case 'base64': {
      const text = data.map((l) => l.text).join('\n')
      try {
        result = args.includes('-d') || args.includes('--decode') ? textLines(b64decode(text.trim())) : [out(b64encode(text))]
      } catch {
        result = [err('base64: invalid input')]
      }
      break
    }
    case 'less':
    case 'more':
    case 'cat':
      result = data
      break
    default:
      result = [err(`bash: ${cmd}: command not found`)]
  }
  return { ...input, lines: [...errors, ...result] }
}

function hostHttp(tool: 'curl' | 'wget', args: string[], ctx: ShellContext, now: number): ShellResult {
  const url = args.filter((a) => !a.startsWith('-'))[0]
  if (!url) return lines(err(tool === 'curl' ? "curl: try 'curl --help' for more information" : 'wget: missing URL'))
  const r = httpRequest(ctx.cluster, url, { forwards: ctx.forwards }, now)
  if (!r.ok) {
    const res = lines(err(curlError(tool, r)))
    if (r.error === 'resolve') res.lines.push(note('(playground) Lệnh này chạy trên "máy của bạn" — tên Service chỉ phân giải được bên trong cluster. Hãy dùng kubectl exec, kubectl run --rm, hoặc NodePort (localhost:30080) / port-forward.'))
    return res
  }
  return lines(textLines(r.body ?? ''))
}

export function runCommand(line: string, ctx: ShellContext): ShellResult {
  const now = Date.now()
  const c = ctx.cluster
  c.tick(now)
  const trimmed = line.trim()
  if (!trimmed) return lines()
  c.state.history.push(trimmed)
  if (c.state.history.length > 300) c.state.history.splice(0, c.state.history.length - 300)

  let command = trimmed
  let redirect: { file: string; append: boolean } | undefined
  const red = /\s(>>?)\s*([\w.\-/]+)\s*$/.exec(command)
  if (red && splitTopLevel(command.slice(0, red.index), '"').length % 2 === 1) {
    redirect = { file: red[2], append: red[1] === '>>' }
    command = command.slice(0, red.index)
  }
  let background = false
  if (/\s&$/.test(command)) {
    background = true
    command = command.replace(/\s&$/, '')
  }
  const [first, ...pipes] = splitTopLevel(command, '|')
  let result = dispatch(first.trim(), ctx, now, background)
  for (const stage of pipes) result = applyPipe(stage.trim(), result)
  if (redirect && !result.stream) {
    const text = result.lines.filter((l) => l.kind !== 'err' && l.kind !== 'info').map((l) => l.text).join('\n')
    ctx.files[redirect.file] = redirect.append && ctx.files[redirect.file] ? `${ctx.files[redirect.file]}\n${text}` : `${text}\n`
    result = { ...result, lines: result.lines.filter((l) => l.kind === 'err'), filesChanged: true }
  }
  c.tick(Date.now())
  return result
}

function dispatch(cmdLine: string, ctx: ShellContext, now: number, background: boolean): ShellResult {
  const tokens = tokenize(cmdLine)
  const [prog, ...args] = tokens
  switch (prog) {
    case 'kubectl':
    case 'k':
      return kubectl(args, ctx, now, background)
    case 'help':
      return lines(HELP.map(out))
    case 'clear':
      return { lines: [], clear: true }
    case 'reset':
      return { lines: [], reset: true }
    case 'ls':
      return lines(Object.keys(ctx.files).sort().map(out))
    case 'cat': {
      if (!args.length) return lines(err('cat: missing file operand'))
      return lines(args.flatMap((f) => (ctx.files[f] === undefined ? [err(`cat: ${f}: No such file or directory`)] : textLines(ctx.files[f].replace(/\n$/, '')))))
    }
    case 'touch':
      for (const f of args) if (ctx.files[f] === undefined) ctx.files[f] = ''
      return { lines: [], filesChanged: true }
    case 'rm':
      for (const f of args.filter((x) => !x.startsWith('-'))) delete ctx.files[f]
      return { lines: [], filesChanged: true }
    case 'vi':
    case 'vim':
    case 'nano':
    case 'code':
    case 'notepad': {
      const file = args[0]
      if (!file) return lines(err(`${prog}: cần tên tệp`))
      if (ctx.files[file] === undefined) ctx.files[file] = ''
      return { lines: [note(`(playground) Đã mở "${file}" trong tab Tệp YAML.`)], openFile: file, filesChanged: true }
    }
    case 'echo':
      return lines(out(args.join(' ')))
    case 'pwd':
      return lines(out('/home/hocvien'))
    case 'whoami':
      return lines(out('hocvien'))
    case 'date':
      return lines(out(new Date(now).toString()))
    case 'history':
      return lines(ctx.cluster.state.history.slice(-50).map((h, i, arr) => out(`${String(ctx.cluster.state.history.length - arr.length + i + 1).padStart(5)}  ${h}`)))
    case 'curl':
    case 'wget':
      return hostHttp(prog, args, ctx, now)
    case 'jobs':
      return lines([...ctx.forwards.values()].map((f, i) => out(`[${i + 1}]  Running                 ${f.label} &`)))
    case 'kill': {
      const n = Number((args[0] ?? '').replace('%', ''))
      const entry = [...ctx.forwards.entries()][n - 1]
      if (!entry) return lines(err(`bash: kill: ${args[0] ?? ''}: no such job`))
      ctx.forwards.delete(entry[0])
      return lines(out(`[${n}]+  Terminated              ${entry[1].label}`))
    }
    case 'docker':
    case 'kind':
    case 'minikube':
    case 'k3d':
      return lines(note(`(playground) "${prog}" không có trong trình duyệt. Playground đã giả lập sẵn một cluster kind tên k8s-learn — chỉ cần dùng kubectl.`))
    case 'helm':
    case 'kustomize':
    case 'k9s':
    case 'stern':
      return lines(note(`(playground) "${prog}" chưa được mô phỏng. Hãy thử trên cluster kind thật theo bài học tương ứng.`))
    case 'sudo':
    case 'ssh':
    case 'apt':
    case 'apt-get':
      return lines(note('(playground) Playground chỉ mô phỏng kubectl và vài lệnh shell cơ bản.'))
    default:
      if (/^(kubeclt|kubect|kubctl|kubecl|kuebctl|kubeclt)$/.test(prog)) {
        return lines(err(`bash: ${prog}: command not found`), note('(playground) Có phải bạn muốn gõ "kubectl"?'))
      }
      return lines(err(`bash: ${prog}: command not found`))
  }
}

// ---------------------------------------------------------------------------
// Tự hoàn thành (Tab)
// ---------------------------------------------------------------------------

const RESOURCE_WORDS = ['pods', 'deployments', 'replicasets', 'services', 'nodes', 'namespaces', 'configmaps', 'secrets', 'daemonsets', 'events', 'endpoints', 'all']

export function complete(input: string, ctx: ShellContext): { value: string; options: string[] } {
  const tokens = input.split(/\s+/)
  const current = tokens[tokens.length - 1]
  const before = tokens.slice(0, -1)
  let candidates: string[] = []
  const c = ctx.cluster
  const ns = c.state.currentNamespace
  if (before.length === 0) candidates = ['kubectl', 'clear', 'help', 'ls', 'cat', 'curl', 'history', 'reset', 'vi']
  else if (['kubectl', 'k'].includes(before[0])) {
    const words = before.slice(1).filter((w) => !w.startsWith('-'))
    const prev = before[before.length - 1]
    if (prev === '-f' || prev === '--filename') candidates = Object.keys(ctx.files)
    else if (prev === '-n' || prev === '--namespace') candidates = c.state.namespaces.map((n) => n.meta.name)
    else if (words.length === 0) candidates = VERBS
    else if (words.length === 1 && ['get', 'describe', 'delete', 'label', 'annotate', 'explain', 'edit'].includes(words[0])) candidates = RESOURCE_WORDS
    else if (words.length === 1 && ['scale', 'expose', 'rollout'].includes(words[0])) candidates = words[0] === 'rollout' ? ['status', 'history', 'undo', 'restart', 'pause', 'resume'] : ['deployment']
    else if (words.length === 1 && ['logs', 'exec'].includes(words[0])) candidates = c.state.pods.filter((p) => p.meta.namespace === ns && !p.deletedAt).map((p) => p.meta.name)
    else if (words.length === 1 && ['cordon', 'uncordon', 'drain'].includes(words[0])) candidates = c.state.nodes.map((n) => n.meta.name)
    else if (words.length === 1 && words[0] === 'create') candidates = ['deployment', 'namespace', 'configmap', 'secret', 'service', '-f']
    else if (words.length === 1 && words[0] === 'set') candidates = ['image', 'env']
    else if (words.length >= 2) {
      const typeWord = words[words.length - 1].includes('/') ? '' : words[words.length - 1]
      const res = findRes(typeWord) ?? findRes(words[1])
      if (res && res !== 'empty') {
        candidates = res.items(c, res.namespaced ? ns : null).map((i) => res.meta(i).name)
        if (current.includes('/')) candidates = candidates.map((n) => `${current.split('/')[0]}/${n}`)
      } else if (words[0] === 'rollout' || words[0] === 'set') {
        candidates = c.state.deployments.filter((d) => d.meta.namespace === ns).map((d) => `deployment/${d.meta.name}`)
      }
    }
  } else if (['cat', 'vi', 'vim', 'nano', 'rm'].includes(before[0])) candidates = Object.keys(ctx.files)

  const matches = [...new Set(candidates)].filter((x) => x.startsWith(current))
  if (!matches.length) return { value: input, options: [] }
  if (matches.length === 1) return { value: [...before, matches[0]].join(' ') + ' ', options: [] }
  let prefix = matches[0]
  for (const m of matches) while (!m.startsWith(prefix)) prefix = prefix.slice(0, -1)
  return { value: [...before, prefix].join(' '), options: matches }
}
