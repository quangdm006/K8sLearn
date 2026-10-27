// Log của container, lệnh chạy bên trong container và mô phỏng request HTTP qua Service.
import type { Cluster, ContainerState } from './cluster'
import { HOST_PORTS, imageInfo, nginxVersion } from './cluster'
import type { ContainerSpec, Pod, Service } from './types'
import { parseImage, tokenize } from './util'

const pad2 = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function nginxTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}

function accessTime(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} +0000`
}

function isoMillis(ms: number): string {
  return new Date(ms).toISOString()
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

function startupLogs(pod: Pod, c: ContainerSpec, startedAt: number, env: Record<string, string>): string[] {
  const short = parseImage(c.image).short
  const t = nginxTime(startedAt)
  if (short === 'nginx' || short === 'nginxinc/nginx-unprivileged') {
    return [
      '/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration',
      '/docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/',
      '/docker-entrypoint.sh: Launching /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh',
      '10-listen-on-ipv6-by-default.sh: info: Getting the checksum of /etc/nginx/conf.d/default.conf',
      '10-listen-on-ipv6-by-default.sh: info: Enabled listen on IPv6 in /etc/nginx/conf.d/default.conf',
      '/docker-entrypoint.sh: Sourcing /docker-entrypoint.d/15-local-resolvers.envsh',
      '/docker-entrypoint.sh: Launching /docker-entrypoint.d/20-envsubst-on-templates.sh',
      '/docker-entrypoint.sh: Launching /docker-entrypoint.d/30-tune-worker-processes.sh',
      '/docker-entrypoint.sh: Configuration complete; ready for start up',
      `${t} [notice] 1#1: using the "epoll" event method`,
      `${t} [notice] 1#1: nginx/${nginxVersion(c.image)}`,
      `${t} [notice] 1#1: built by gcc 14.2.0 (Debian 14.2.0-19)`,
      `${t} [notice] 1#1: OS: Linux 6.10.14-linuxkit`,
      `${t} [notice] 1#1: getrlimit(RLIMIT_NOFILE): 1048576:1048576`,
      `${t} [notice] 1#1: start worker processes`,
      `${t} [notice] 1#1: start worker process 29`,
    ]
  }
  if (short === 'httpd') {
    return [
      `AH00558: httpd: Could not reliably determine the server's fully qualified domain name, using ${pod.podIP}. Set the 'ServerName' directive globally to suppress this message`,
      `[${new Date(startedAt).toUTCString()}] [mpm_event:notice] [pid 1:tid 1] AH00489: Apache/2.4.65 (Unix) configured -- resuming normal operations`,
      `[${new Date(startedAt).toUTCString()}] [core:notice] [pid 1:tid 1] AH00094: Command line: 'httpd -D FOREGROUND'`,
    ]
  }
  if (short === 'redis') {
    const d = new Date(startedAt)
    const rt = `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.215`
    return [
      `1:C ${rt} * oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo`,
      `1:C ${rt} * Redis version=8.10.2, bits=64, commit=00000000, modified=1, pid=1, just started`,
      `1:M ${rt} * monotonic clock: POSIX clock_gettime`,
      `1:M ${rt} * Running mode=standalone, port=6379.`,
      `1:M ${rt} * Server initialized`,
      `1:M ${rt} * Ready to accept connections tcp`,
    ]
  }
  if (short === 'traefik/whoami') return [`${nginxTime(startedAt)} Starting up on port 80`]
  if (short === 'stefanprodan/podinfo') {
    const ts = isoMillis(startedAt)
    return [
      `{"level":"info","ts":"${ts}","caller":"podinfo/main.go:153","msg":"Starting podinfo","version":"6.15.0","revision":"","port":"9898"}`,
      `{"level":"info","ts":"${ts}","caller":"http/server.go:245","msg":"Starting HTTP Server.","addr":":9898"}`,
    ]
  }
  if (short === 'postgres') {
    return [
      'The files belonging to this database system will be owned by user "postgres".',
      'Success. You can now start the database server using:',
      `${isoMillis(startedAt).replace('T', ' ').slice(0, 23)} UTC [1] LOG:  starting PostgreSQL 18.6 on x86_64-pc-linux-gnu`,
      `${isoMillis(startedAt).replace('T', ' ').slice(0, 23)} UTC [1] LOG:  database system is ready to accept connections`,
    ]
  }
  if (short === 'hpa-example') return [`AH00094: Command line: 'apache2 -D FOREGROUND'`]
  void env
  return []
}

/** Thay biến $VAR / ${VAR} và $(date) như shell thật. */
function substitute(text: string, env: Record<string, string>, time: number): string {
  return text
    .replace(/\$\(date\)/g, new Date(time).toUTCString())
    .replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a: string | undefined, b: string | undefined) => env[(a ?? b)!] ?? '')
}

export function containerLogs(
  cluster: Cluster,
  pod: Pod,
  c: ContainerSpec,
  state: ContainerState,
  now: number,
  previous: boolean,
): string[] {
  const { env } = cluster.resolveEnv(pod, c)
  const fullEnv = { HOSTNAME: pod.meta.name, ...env }
  const o = state.outcome
  if (o.kind === 'exit') {
    const startedAt = previous ? state.lastState?.startedAt ?? now : state.startedAt ?? now
    return o.logs.map((l) => substitute(l, fullEnv, startedAt))
  }
  if (o.kind !== 'run') return []
  const startedAt = state.startedAt ?? now
  const cmd = [...(c.command ?? []), ...(c.args ?? [])].join(' ')
  const loop = /while\s+(true|:);\s*do\s+(.+?);\s*sleep\s+(\d+);\s*done/.exec(cmd)
  if (loop) {
    const body = loop[2]
    const every = Math.max(1, Number(loop[3])) * 1000
    const count = Math.min(200, Math.floor((now - startedAt) / every) + 1)
    const lines: string[] = []
    for (let i = 0; i < count; i++) {
      const at = startedAt + i * every
      for (const part of body.split(/;|&&/)) {
        const echo = /echo\s+("([^"]*)"|'([^']*)'|(.+))/.exec(part.trim())
        if (echo) lines.push(substitute((echo[2] ?? echo[3] ?? echo[4] ?? '').trim(), fullEnv, at))
      }
    }
    return lines
  }
  if (c.command?.length && /\becho\b/.test(cmd)) {
    const echo = /echo\s+("([^"]*)"|'([^']*)'|([^;&|]+))/.exec(cmd)
    return echo ? [substitute((echo[2] ?? echo[3] ?? echo[4] ?? '').trim(), fullEnv, startedAt)] : []
  }
  return [
    ...startupLogs(pod, c, startedAt, fullEnv),
    ...pod.accessLog.filter((l) => l.time >= startedAt).map((l) => l.line),
  ]
}

// ---------------------------------------------------------------------------
// HTTP và DNS trong cluster
// ---------------------------------------------------------------------------

export interface HttpResult {
  ok: boolean
  status?: number
  body?: string
  error?: string
  servedBy?: Pod
}

const NGINX_HTML = (version: string) => `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, nginx is successfully installed and working.
Further configuration is required for the web server to be online.</p>
<p><em>Thank you for using nginx. (nginx/${version})</em></p>
</body>
</html>`

export function resolveName(
  cluster: Cluster,
  host: string,
  fromNs: string,
): { service?: Service; pod?: Pod; ip: string } | null {
  const s = cluster.state
  const h = host.replace(/\.$/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const svc = s.services.find((x) => x.clusterIP === h)
    if (svc) return { service: svc, ip: h }
    const pod = s.pods.find((p) => p.podIP === h && !p.deletedAt)
    return pod ? { pod, ip: h } : { ip: h }
  }
  const parts = h.split('.')
  let name = parts[0]
  let ns = fromNs
  if (parts.length >= 2) ns = parts[1]
  const suffix = parts.slice(2).join('.')
  if (parts.length > 2 && !['svc', 'svc.cluster.local'].includes(suffix)) {
    // Có thể là tên Pod của StatefulSet: pod.svc.ns.svc.cluster.local
    if (parts.length >= 3) {
      const svc = s.services.find((x) => x.meta.name === parts[1] && x.meta.namespace === parts[2])
      const pod = svc && s.pods.find((p) => p.meta.name === parts[0] && p.meta.namespace === parts[2] && !p.deletedAt)
      if (svc && pod && svc.clusterIP === 'None') return { pod, ip: pod.podIP }
    }
    return null
  }
  if (parts.length === 1) name = parts[0]
  const svc = s.services.find((x) => x.meta.name === name && x.meta.namespace === ns)
  if (!svc) return null
  return { service: svc, ip: svc.clusterIP }
}

function serveHttp(cluster: Cluster, target: Pod, port: number, path: string, method: string, body: string, from: string, now: number): HttpResult {
  if (!cluster.listeningPorts(target, now).includes(port)) {
    return { ok: false, error: 'refused' }
  }
  const c = target.spec.containers.find((x) => imageInfo(x.image).port === port) ?? target.spec.containers[0]
  const short = parseImage(c.image).short
  const record = (status: number, bytes: number) => {
    target.accessLog.push({
      time: now,
      line: `${from} - - [${accessTime(now)}] "${method} ${path} HTTP/1.1" ${status} ${bytes} "-" "curl/8.23.0" "-"`,
    })
    if (target.accessLog.length > 200) target.accessLog.splice(0, target.accessLog.length - 200)
  }
  if (short === 'nginx' || short === 'nginxinc/nginx-unprivileged') {
    if (path === '/' || path === '/index.html') {
      const html = NGINX_HTML(nginxVersion(c.image))
      record(200, 615)
      return { ok: true, status: 200, body: html, servedBy: target }
    }
    record(404, 153)
    return {
      ok: true,
      status: 404,
      body: `<html>\n<head><title>404 Not Found</title></head>\n<body>\n<center><h1>404 Not Found</h1></center>\n<hr><center>nginx/${nginxVersion(c.image)}</center>\n</body>\n</html>`,
      servedBy: target,
    }
  }
  if (short === 'httpd') {
    record(200, 45)
    return { ok: true, status: 200, body: '<html><body><h1>It works!</h1></body></html>', servedBy: target }
  }
  if (short === 'traefik/whoami') {
    return {
      ok: true,
      status: 200,
      servedBy: target,
      body: [
        `Hostname: ${target.meta.name}`,
        'IP: 127.0.0.1',
        'IP: ::1',
        `IP: ${target.podIP}`,
        `RemoteAddr: ${from}:${40000 + Math.floor(Math.random() * 20000)}`,
        `${method} ${path} HTTP/1.1`,
        'User-Agent: curl/8.23.0',
        'Accept: */*',
      ].join('\n'),
    }
  }
  if (short === 'stefanprodan/podinfo') {
    if (path.startsWith('/healthz') || path.startsWith('/readyz')) {
      return { ok: true, status: 200, body: '{\n  "status": "OK"\n}', servedBy: target }
    }
    if (path.startsWith('/echo') || path.startsWith('/api/echo')) {
      return { ok: true, status: 202, body: body || '', servedBy: target }
    }
    const env = cluster.resolveEnv(target, c).env
    return {
      ok: true,
      status: 200,
      servedBy: target,
      body: JSON.stringify(
        {
          hostname: target.meta.name,
          version: '6.15.0',
          revision: '',
          color: env.PODINFO_UI_COLOR ?? '#34577c',
          logo: 'https://raw.githubusercontent.com/stefanprodan/podinfo/gh-pages/cuddle_clap.gif',
          message: env.PODINFO_UI_MESSAGE ?? `greetings from podinfo v6.15.0`,
          goos: 'linux',
          goarch: 'amd64',
          runtime: 'go1.27.0',
          num_goroutine: '8',
          num_cpu: '8',
        },
        null,
        2,
      ),
    }
  }
  if (short === 'hpa-example') return { ok: true, status: 200, body: 'OK!', servedBy: target }
  if (['redis', 'postgres', 'mysql', 'mariadb', 'mongo', 'memcached', 'rabbitmq'].includes(short)) {
    return { ok: false, error: 'empty' }
  }
  return { ok: true, status: 200, body: `Hello from ${target.meta.name}`, servedBy: target }
}

export function httpRequest(
  cluster: Cluster,
  url: string,
  opts: { fromPod?: Pod; method?: string; body?: string; forwards?: Map<number, { pod: Pod; port: number }> },
  now: number,
): HttpResult & { host: string; port: number } {
  const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url)
  if (!m) return { ok: false, error: 'badurl', host: url, port: 0 }
  const host = m[2]
  const port = m[3] ? Number(m[3]) : m[1] === 'https' ? 443 : 80
  const path = m[4] ?? '/'
  const method = opts.method ?? 'GET'
  const from = opts.fromPod?.podIP ?? '10.244.0.1'
  const base = { host, port }

  if (host === 'localhost' || host === '127.0.0.1') {
    if (opts.fromPod) return { ...base, ...serveHttp(cluster, opts.fromPod, port, path, method, opts.body ?? '', '127.0.0.1', now) }
    const fwd = opts.forwards?.get(port)
    if (fwd) return { ...base, ...serveHttp(cluster, fwd.pod, fwd.port, path, method, opts.body ?? '', '127.0.0.1', now) }
    if (HOST_PORTS.includes(port)) {
      const svc = cluster.state.services.find((s) => s.ports.some((p) => p.nodePort === port))
      if (svc) {
        const sp = svc.ports.find((p) => p.nodePort === port)!
        return { ...base, ...viaService(cluster, svc, sp.port, path, method, opts.body ?? '', '172.18.0.1', now) }
      }
    }
    return { ...base, ok: false, error: 'refused' }
  }

  if (!opts.fromPod) return { ...base, ok: false, error: 'resolve' }
  const resolved = resolveName(cluster, host, opts.fromPod.meta.namespace)
  if (!resolved) {
    if (/\.(com|net|org|vn|io|dev)$/.test(host)) return { ...base, ok: false, error: 'internet' }
    return { ...base, ok: false, error: 'resolve' }
  }
  if (resolved.service) {
    return { ...base, ...viaService(cluster, resolved.service, port, path, method, opts.body ?? '', from, now) }
  }
  if (resolved.pod) return { ...base, ...serveHttp(cluster, resolved.pod, port, path, method, opts.body ?? '', from, now) }
  return { ...base, ok: false, error: 'timeout' }
}

function viaService(cluster: Cluster, svc: Service, port: number, path: string, method: string, body: string, from: string, now: number): HttpResult {
  if (svc.clusterIP === 'None') {
    const eps = cluster.serviceEndpoints(svc, now)
    if (!eps.length) return { ok: false, error: 'resolve' }
    const ep = eps[Math.floor(Math.random() * eps.length)]
    return serveHttp(cluster, ep.pod, port, path, method, body, from, now)
  }
  const sp = svc.ports.find((p) => p.port === port)
  if (!sp) return { ok: false, error: 'timeout' }
  const eps = cluster.state.pods.filter(
    (p) =>
      p.meta.namespace === svc.meta.namespace &&
      Object.keys(svc.selector).length > 0 &&
      Object.entries(svc.selector).every(([k, v]) => p.meta.labels[k] === v) &&
      cluster.isPodReady(p, now),
  )
  if (!eps.length) return { ok: false, error: 'refused' }
  const target = eps[Math.floor(Math.random() * eps.length)]
  return serveHttp(cluster, target, cluster.resolveTargetPort(target, sp.targetPort), path, method, body, from, now)
}

export function curlError(tool: 'curl' | 'wget', r: HttpResult & { host: string; port: number }): string {
  if (tool === 'wget') {
    switch (r.error) {
      case 'resolve':
        return `wget: bad address '${r.host}'`
      case 'refused':
        return `wget: can't connect to remote host: Connection refused`
      case 'empty':
        return 'wget: error getting response'
      case 'internet':
        return '(playground) Không mô phỏng truy cập Internet. Trên cluster thật, Pod gọi được ra ngoài nếu không bị NetworkPolicy chặn.'
      default:
        return 'wget: download timed out'
    }
  }
  switch (r.error) {
    case 'resolve':
      return `curl: (6) Could not resolve host: ${r.host}`
    case 'refused':
      return `curl: (7) Failed to connect to ${r.host} port ${r.port} after 2 ms: Couldn't connect to server`
    case 'empty':
      return 'curl: (52) Empty reply from server'
    case 'internet':
      return '(playground) Không mô phỏng truy cập Internet. Trên cluster thật, Pod gọi được ra ngoài nếu không bị NetworkPolicy chặn.'
    case 'badurl':
      return 'curl: (3) URL rejected: Malformed input to a URL function'
    default:
      return `curl: (28) Failed to connect to ${r.host} port ${r.port} after 3002 ms: Timeout was reached`
  }
}

// ---------------------------------------------------------------------------
// Lệnh chạy bên trong container (kubectl exec / kubectl run --rm)
// ---------------------------------------------------------------------------

export interface ExecOutput {
  lines: string[]
  code: number
  /** Gọi thành công một Service (phục vụ chấm nhiệm vụ) */
  hitService?: boolean
}

export function execInPod(
  cluster: Cluster,
  pod: Pod,
  c: ContainerSpec,
  argv: string[],
  now: number,
): ExecOutput {
  const [cmd, ...args] = argv
  const short = parseImage(c.image).short
  const busybox = ['busybox', 'alpine'].includes(short)
  const env = { ...cluster.resolveEnv(pod, c).env }
  const ns = pod.meta.namespace

  if (['sh', 'bash', '/bin/sh', '/bin/bash', 'zsh', 'ash'].includes(cmd)) {
    if (args[0] === '-c' && args[1] !== undefined) {
      const out: string[] = []
      let code = 0
      let hit = false
      for (const part of args[1].split(/\s*(?:;|&&)\s*/).filter(Boolean)) {
        const r = execInPod(cluster, pod, c, tokenize(substitute(part, { HOSTNAME: pod.meta.name, ...env }, now)), now)
        out.push(...r.lines)
        code = r.code
        hit = hit || !!r.hitService
      }
      return { lines: out, code, hitService: hit }
    }
    return {
      lines: [
        '(playground) Shell tương tác chưa được hỗ trợ. Hãy chạy từng lệnh trực tiếp, ví dụ:',
        `  kubectl exec ${pod.meta.name} -- env`,
        `  kubectl exec ${pod.meta.name} -- curl -s http://<tên-service>`,
      ],
      code: 0,
    }
  }

  switch (cmd) {
    case 'env':
    case 'printenv': {
      const services = cluster.state.services.filter((s) => s.meta.namespace === ns && s.meta.createdAt <= pod.meta.createdAt && s.clusterIP !== 'None')
      const lines = [
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        `HOSTNAME=${pod.meta.name}`,
        ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
        'KUBERNETES_SERVICE_HOST=10.96.0.1',
        'KUBERNETES_SERVICE_PORT=443',
        'KUBERNETES_SERVICE_PORT_HTTPS=443',
        'KUBERNETES_PORT=tcp://10.96.0.1:443',
        ...services
          .filter((s) => s.meta.name !== 'kubernetes')
          .flatMap((s) => {
            const n = s.meta.name.toUpperCase().replace(/-/g, '_')
            return [`${n}_SERVICE_HOST=${s.clusterIP}`, `${n}_SERVICE_PORT=${s.ports[0]?.port ?? ''}`]
          }),
        'HOME=/root',
      ]
      if (args[0]) return { lines: lines.filter((l) => l.startsWith(`${args[0]}=`)).map((l) => l.split('=').slice(1).join('=')), code: 0 }
      return { lines, code: 0 }
    }
    case 'hostname':
      return { lines: [pod.meta.name], code: 0 }
    case 'whoami':
      return { lines: [short.includes('unprivileged') ? 'nginx' : short === 'stefanprodan/podinfo' ? 'app' : 'root'], code: 0 }
    case 'id':
      return { lines: ['uid=0(root) gid=0(root) groups=0(root)'], code: 0 }
    case 'pwd':
      return { lines: [short === 'stefanprodan/podinfo' ? '/home/app' : '/'], code: 0 }
    case 'date':
      return { lines: [new Date(now).toUTCString()], code: 0 }
    case 'uname':
      return { lines: [args.includes('-a') ? `Linux ${pod.meta.name} 6.10.14-linuxkit #1 SMP x86_64 GNU/Linux` : 'Linux'], code: 0 }
    case 'echo':
      return { lines: [args.join(' ')], code: 0 }
    case 'sleep':
      return { lines: [], code: 0 }
    case 'ps': {
      const main = [...(c.command ?? []), ...(c.args ?? [])].join(' ') || defaultCommand(short)
      return { lines: ['PID   USER     TIME  COMMAND', `    1 root      0:00 ${main}`, `   42 root      0:00 ps ${args.join(' ')}`.trimEnd()], code: 0 }
    }
    case 'ls': {
      const path = args.filter((a) => !a.startsWith('-'))[0] ?? '/'
      const listing: Record<string, string[]> = {
        '/': ['bin', 'dev', 'etc', 'home', 'lib', 'proc', 'root', 'run', 'sys', 'tmp', 'usr', 'var'],
        '/usr/share/nginx/html': ['50x.html', 'index.html'],
        '/etc/nginx/conf.d': ['default.conf'],
        '/var/run/secrets/kubernetes.io/serviceaccount': ['ca.crt', 'namespace', 'token'],
        '/data': [],
      }
      const files = listing[path.replace(/\/$/, '') || '/']
      if (!files) return { lines: [`ls: ${path}: No such file or directory`], code: 1 }
      return { lines: files.length ? [files.join('  ')] : [], code: 0 }
    }
    case 'cat': {
      const file = args[0] ?? ''
      const files: Record<string, string[]> = {
        '/etc/hostname': [pod.meta.name],
        '/etc/resolv.conf': [
          `search ${ns}.svc.cluster.local svc.cluster.local cluster.local`,
          'nameserver 10.96.0.10',
          'options ndots:5',
        ],
        '/etc/hosts': [
          '# Kubernetes-managed hosts file.',
          '127.0.0.1\tlocalhost',
          '::1\tlocalhost ip6-localhost ip6-loopback',
          `${pod.podIP}\t${pod.meta.name}`,
        ],
        '/var/run/secrets/kubernetes.io/serviceaccount/namespace': [ns],
        '/var/run/secrets/kubernetes.io/serviceaccount/token': ['eyJhbGciOiJSUzI1NiIsImtpZCI6Ik1yS…(token JWT ngắn hạn)…'],
        '/usr/share/nginx/html/index.html': NGINX_HTML(nginxVersion(c.image)).split('\n'),
        '/etc/os-release': ['PRETTY_NAME="Debian GNU/Linux 13 (trixie)"', 'NAME="Debian GNU/Linux"', 'VERSION_ID="13"'],
      }
      if (files[file]) return { lines: files[file], code: 0 }
      return { lines: [busybox ? `cat: can't open '${file}': No such file or directory` : `cat: ${file}: No such file or directory`], code: 1 }
    }
    case 'nslookup':
    case 'host':
    case 'dig': {
      const name = args.filter((a) => !a.startsWith('-') && !a.startsWith('+'))[0]
      if (!name) return { lines: ['Usage: nslookup [HOST] [SERVER]'], code: 1 }
      const r = resolveName(cluster, name, ns)
      const fqdn = r?.service ? `${r.service.meta.name}.${r.service.meta.namespace}.svc.cluster.local` : name
      const header = ['Server:\t\t10.96.0.10', 'Address:\t10.96.0.10:53', '']
      if (!r) return { lines: [...header, `** server can't find ${name}.${ns}.svc.cluster.local: NXDOMAIN`, ''], code: 1 }
      if (r.service?.clusterIP === 'None') {
        const ips = cluster.serviceEndpoints(r.service, now).map((e) => e.pod.podIP)
        return { lines: [...header, ...ips.flatMap((ip) => [`Name:\t${fqdn}`, `Address: ${ip}`]), ''], code: 0 }
      }
      return { lines: [...header, `Name:\t${fqdn}`, `Address: ${r.ip}`, ''], code: 0 }
    }
    case 'curl':
    case 'wget': {
      const tool = cmd as 'curl' | 'wget'
      let method = 'GET'
      let body = ''
      let url = ''
      let silent = false
      let head = false
      for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (a === '-X' || a === '--request') method = args[++i] ?? 'GET'
        else if (a === '-d' || a === '--data') {
          body = args[++i] ?? ''
          if (method === 'GET') method = 'POST'
        } else if (a === '-s' || a === '-q' || a === '-qO-' || a === '-sS') silent = true
        else if (a === '-I' || a === '--head') head = true
        else if (['-O', '-T', '-m', '--max-time', '-H', '-o', '-w', '--connect-timeout'].includes(a)) i++
        else if (a.startsWith('-')) continue
        else url = a
      }
      if (!url) return { lines: [tool === 'curl' ? "curl: try 'curl --help' for more information" : 'BusyBox wget: missing URL'], code: 2 }
      const r = httpRequest(cluster, url, { fromPod: pod, method, body }, now)
      if (!r.ok) return { lines: [curlError(tool, r)], code: tool === 'curl' ? 7 : 1 }
      const viaService = !!resolveName(cluster, r.host, ns)?.service
      const lines: string[] = []
      if (tool === 'wget' && !silent) lines.push(`Connecting to ${r.host} (${r.servedBy?.podIP ?? r.host})`)
      if (head) lines.push(`HTTP/1.1 ${r.status} ${r.status === 200 ? 'OK' : ''}`.trim())
      else lines.push(...(r.body ?? '').split('\n'))
      return { lines, code: 0, hitService: viaService && r.status !== undefined && r.status < 400 }
    }
    case 'nc': {
      const positional: string[] = []
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-w' || args[i] === '-W') i++
        else if (!args[i].startsWith('-')) positional.push(args[i])
      }
      const [host, portText] = positional
      const port = Number(portText)
      if (!host || !port) return { lines: ['usage: nc [-zv] [-w timeout] host port'], code: 1 }
      const r = resolveName(cluster, host, ns)
      let listening = false
      if (r?.service) {
        const sp = r.service.ports.find((p) => p.port === port)
        const ep = sp ? cluster.serviceEndpoints(r.service, now)[0] : undefined
        listening = !!ep && cluster.listeningPorts(ep.pod, now).includes(cluster.resolveTargetPort(ep.pod, sp!.targetPort))
      } else if (r?.pod) {
        listening = cluster.listeningPorts(r.pod, now).includes(port)
      }
      if (listening) return { lines: [`Connection to ${host} (${r!.ip}) ${port} port [tcp/*] succeeded!`], code: 0 }
      return { lines: [`nc: connect to ${host} (${r?.ip ?? host}) port ${port} (tcp) failed: Connection refused`], code: 1 }
    }
    case 'ping': {
      const host = args.filter((a) => !a.startsWith('-'))[0] ?? ''
      const r = resolveName(cluster, host, ns)
      if (r?.service && r.service.clusterIP !== 'None') {
        return {
          lines: [
            `PING ${host} (${r.ip}): 56 data bytes`,
            '',
            `--- ${host} ping statistics ---`,
            '3 packets transmitted, 0 packets received, 100% packet loss',
            '(playground) ClusterIP là IP ảo chỉ chuyển tiếp cổng của Service — ping không có phản hồi là bình thường.',
          ],
          code: 1,
        }
      }
      if (r?.pod) {
        return { lines: [`PING ${host} (${r.ip}): 56 data bytes`, `64 bytes from ${r.ip}: seq=0 ttl=63 time=0.112 ms`], code: 0 }
      }
      return { lines: [`ping: bad address '${host}'`], code: 1 }
    }
    case 'nginx':
      if (args.includes('-v') || args.includes('-V')) return { lines: [`nginx version: nginx/${nginxVersion(c.image)}`], code: 0 }
      if (args.includes('-t')) return { lines: ['nginx: the configuration file /etc/nginx/nginx.conf syntax is ok', 'nginx: configuration file /etc/nginx/nginx.conf test is successful'], code: 0 }
      if (args.includes('-s')) return { lines: [`${nginxTime(now)} [notice] 64#64: signal process started`], code: 0 }
      break
    case 'redis-cli':
      if (args.includes('ping') || args.includes('PING')) return { lines: ['PONG'], code: 0 }
      return { lines: ['(playground) redis-cli tương tác chưa được hỗ trợ — thử: redis-cli ping'], code: 0 }
  }
  return { lines: [`sh: ${cmd}: not found`], code: 127 }
}

function defaultCommand(short: string): string {
  const map: Record<string, string> = {
    nginx: 'nginx: master process nginx -g daemon off;',
    httpd: 'httpd -DFOREGROUND',
    redis: 'redis-server *:6379',
    'traefik/whoami': '/whoami',
    'stefanprodan/podinfo': './podinfo',
  }
  return map[short] ?? 'sh'
}
