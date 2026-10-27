import type { Labels } from './types'

// Bảng chữ cái Kubernetes dùng cho tên sinh tự động (tránh nguyên âm và ký tự dễ nhầm).
const SAFE_ALPHABET = 'bcdfghjklmnpqrstvwxz2456789'

export function randomSuffix(length = 5): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += SAFE_ALPHABET[Math.floor(Math.random() * SAFE_ALPHABET.length)]
  }
  return out
}

export function randomUid(): string {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`
}

/** JSON với khóa được sắp xếp, để băm ổn định. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Băm kiểu pod-template-hash: FNV-1a 32 bit → chuỗi số → ánh xạ sang bảng chữ an toàn. */
export function templateHash(value: unknown): string {
  const text = stableStringify(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return String(hash)
    .split('')
    .map((c) => SAFE_ALPHABET[c.charCodeAt(0) % SAFE_ALPHABET.length])
    .join('')
}

/** Định dạng thời gian giống `kubectl get` (k8s.io/apimachinery/pkg/util/duration.HumanDuration). */
export function humanDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < -1) return '<invalid>'
  if (seconds < 0) return '0s'
  if (seconds < 120) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 10) {
    const s = seconds % 60
    return s === 0 ? `${minutes}m` : `${minutes}m${s}s`
  }
  if (minutes < 180) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 8) {
    const m = minutes % 60
    return m === 0 ? `${hours}h` : `${hours}h${m}m`
  }
  if (hours < 48) return `${hours}h`
  if (hours < 24 * 8) {
    const h = hours % 24
    return h === 0 ? `${Math.floor(hours / 24)}d` : `${Math.floor(hours / 24)}d${h}h`
  }
  if (hours < 24 * 365 * 2) return `${Math.floor(hours / 24)}d`
  const days = Math.floor(hours / 24)
  const years = Math.floor(days / 365)
  if (hours < 24 * 365 * 8) {
    const dy = days % 365
    return dy === 0 ? `${years}y` : `${years}y${dy}d`
  }
  return `${years}y`
}

/** Bảng căn cột giống tabwriter của kubectl (khoảng đệm 3 ký tự). */
export function table(headers: string[], rows: string[][]): string[] {
  const all = [headers, ...rows]
  const widths = headers.map((_, col) =>
    Math.max(6, ...all.map((r) => (r[col] ?? '').length + 3)),
  )
  return all.map((r) =>
    r
      .map((cell, col) => (col === r.length - 1 ? cell : (cell ?? '').padEnd(widths[col])))
      .join('')
      .trimEnd(),
  )
}

export function isoTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Định dạng thời gian trong `kubectl describe`, ví dụ: Mon, 26 Oct 2026 16:40:12 +0700 */
export function describeTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${DAYS[d.getDay()]}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ` +
    `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  )
}

export function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels)
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(',') : '<none>'
}

export function matchLabels(selector: Labels, labels: Labels): boolean {
  return Object.entries(selector).every(([k, v]) => labels[k] === v)
}

export type LabelPredicate = (labels: Labels) => boolean

/** Phân tích label selector của kubectl: a=b, a==b, a!=b, a in (x,y), a notin (x), a, !a */
export function parseSelector(expr: string): LabelPredicate {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of expr) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)

  const predicates = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part): LabelPredicate => {
      const setMatch = /^([\w./-]+)\s+(in|notin)\s+\(([^)]*)\)$/.exec(part)
      if (setMatch) {
        const [, key, op, list] = setMatch
        const values = list.split(',').map((s) => s.trim())
        return op === 'in'
          ? (l) => key in l && values.includes(l[key])
          : (l) => !(key in l) || !values.includes(l[key])
      }
      const notExists = /^!([\w./-]+)$/.exec(part)
      if (notExists) {
        const key = notExists[1]
        return (l) => !(key in l)
      }
      const notEqual = /^([\w./-]+)\s*!=\s*([\w./-]*)$/.exec(part)
      if (notEqual) {
        const [, key, value] = notEqual
        return (l) => l[key] !== value
      }
      const equal = /^([\w./-]+)\s*==?\s*([\w./-]*)$/.exec(part)
      if (equal) {
        const [, key, value] = equal
        return (l) => l[key] === value
      }
      const exists = /^([\w./-]+)$/.exec(part)
      if (exists) {
        const key = exists[1]
        return (l) => key in l
      }
      throw new Error(`unable to parse requirement: found '${part}', expected: identifier`)
    })
  return (labels) => predicates.every((p) => p(labels))
}

export interface ImageRef {
  registry: string
  /** Đường dẫn repository, với Docker Hub chính thức có tiền tố library/ */
  repo: string
  tag: string
  digest: string
  /** Tên đầy đủ như containerd hiển thị */
  full: string
  /** Tên ngắn để nhận diện: nginx, traefik/whoami, stefanprodan/podinfo... */
  short: string
}

export function parseImage(image: string): ImageRef {
  let rest = image.trim()
  let digest = ''
  const at = rest.indexOf('@')
  if (at >= 0) {
    digest = rest.slice(at + 1)
    rest = rest.slice(0, at)
  }
  let tag = ''
  const lastSlash = rest.lastIndexOf('/')
  const lastColon = rest.lastIndexOf(':')
  if (lastColon > lastSlash) {
    tag = rest.slice(lastColon + 1)
    rest = rest.slice(0, lastColon)
  }
  const parts = rest.split('/')
  let registry = 'docker.io'
  if (parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost')) {
    registry = parts.shift()!
  }
  let repo = parts.join('/')
  if (registry === 'docker.io' && !repo.includes('/')) repo = `library/${repo}`
  if (!tag && !digest) tag = 'latest'
  const short = repo.replace(/^library\//, '')
  return {
    registry,
    repo,
    tag,
    digest,
    short,
    full: `${registry}/${repo}${digest ? `@${digest}` : `:${tag}`}`,
  }
}

export function b64encode(text: string): string {
  let binary = ''
  new TextEncoder().encode(text).forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

export function b64decode(data: string): string {
  const binary = atob(data)
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

export function isValidBase64(data: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(data) && data.length % 4 === 0
}

/** Tên hợp lệ kiểu RFC 1123 (dùng cho hầu hết tài nguyên). */
export function isDnsSubdomain(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 253 &&
    /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(name)
  )
}

/** Tên hợp lệ kiểu RFC 1123 label (container, namespace, service). */
export function isDnsLabel(name: string): boolean {
  return name.length > 0 && name.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return dp[a.length][b.length]
}

/** Tách dòng lệnh thành token, hỗ trợ nháy đơn/kép. */
export function tokenize(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let hasToken = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) current += line[++i]
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasToken = true
    } else if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
    } else {
      current += ch
      hasToken = true
    }
  }
  if (hasToken) tokens.push(current)
  return tokens
}
