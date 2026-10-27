// JSONPath rút gọn đủ dùng cho các ví dụ trong khóa học:
//   {.items[*].metadata.name}   {.spec.containers[0].image}   {"\t"}   {"\n"}
//   {range .items[*]}{.metadata.name}{"\n"}{end}   {.items[?(@.type=="InternalIP")].address}

type Node =
  | { type: 'text'; value: string }
  | { type: 'path'; path: string }
  | { type: 'range'; path: string; body: Node[] }

export class JsonPathError extends Error {}

function parseTemplate(template: string): Node[] {
  const root: Node[] = []
  const stack: Node[][] = [root]
  let i = 0
  while (i < template.length) {
    const open = template.indexOf('{', i)
    if (open < 0) {
      stack[stack.length - 1].push({ type: 'text', value: template.slice(i) })
      break
    }
    if (open > i) stack[stack.length - 1].push({ type: 'text', value: template.slice(i, open) })
    let close = open + 1
    let quote = false
    while (close < template.length && (quote || template[close] !== '}')) {
      if (template[close] === '"') quote = !quote
      close++
    }
    if (close >= template.length) throw new JsonPathError('unclosed action')
    const expr = template.slice(open + 1, close).trim()
    i = close + 1
    if (expr.startsWith('range ')) {
      const node: Node = { type: 'range', path: expr.slice(6).trim(), body: [] }
      stack[stack.length - 1].push(node)
      stack.push(node.body)
    } else if (expr === 'end') {
      if (stack.length === 1) throw new JsonPathError('not in range, nothing to end')
      stack.pop()
    } else if (expr.startsWith('"')) {
      const literal = expr.slice(1, -1).replace(/\\t/g, '\t').replace(/\\n/g, '\n')
      stack[stack.length - 1].push({ type: 'text', value: literal })
    } else {
      stack[stack.length - 1].push({ type: 'path', path: expr })
    }
  }
  return root
}

type Segment =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'all' }
  | { kind: 'filter'; field: string[]; value: string }

function parsePath(path: string): Segment[] {
  const segs: Segment[] = []
  let p = path.replace(/^\$/, '')
  while (p.length) {
    if (p.startsWith('.')) {
      const m = /^\.([^.[\]]+)/.exec(p)
      if (!m) {
        p = p.slice(1)
        continue
      }
      segs.push({ kind: 'key', key: m[1] })
      p = p.slice(m[0].length)
    } else if (p.startsWith('[*]')) {
      segs.push({ kind: 'all' })
      p = p.slice(3)
    } else if (p.startsWith('[?(')) {
      const end = p.indexOf(')]')
      const cond = p.slice(3, end)
      const m = /^@\.([\w.]+)\s*==\s*["']([^"']*)["']$/.exec(cond)
      if (!m) throw new JsonPathError(`unsupported filter: ${cond}`)
      segs.push({ kind: 'filter', field: m[1].split('.'), value: m[2] })
      p = p.slice(end + 2)
    } else if (p.startsWith('[')) {
      const m = /^\[(-?\d+)\]/.exec(p)
      const key = /^\['([^']+)'\]/.exec(p)
      if (m) {
        segs.push({ kind: 'index', index: Number(m[1]) })
        p = p.slice(m[0].length)
      } else if (key) {
        segs.push({ kind: 'key', key: key[1] })
        p = p.slice(key[0].length)
      } else throw new JsonPathError(`unrecognized character in action: ${p}`)
    } else {
      const m = /^([^.[\]]+)/.exec(p)
      if (!m) throw new JsonPathError(`unrecognized identifier ${p}`)
      segs.push({ kind: 'key', key: m[1] })
      p = p.slice(m[0].length)
    }
  }
  return segs
}

export function evalPath(path: string, data: unknown): unknown[] {
  let current: unknown[] = [data]
  for (const seg of parsePath(path)) {
    const next: unknown[] = []
    for (const v of current) {
      if (v === null || v === undefined) continue
      if (seg.kind === 'key' && typeof v === 'object' && !Array.isArray(v)) {
        const child = (v as Record<string, unknown>)[seg.key]
        if (child !== undefined) next.push(child)
      } else if (seg.kind === 'index' && Array.isArray(v)) {
        const item = v[seg.index < 0 ? v.length + seg.index : seg.index]
        if (item !== undefined) next.push(item)
      } else if (seg.kind === 'all') {
        if (Array.isArray(v)) next.push(...v)
        else if (typeof v === 'object') next.push(...Object.values(v as object))
      } else if (seg.kind === 'filter' && Array.isArray(v)) {
        for (const item of v) {
          let field: unknown = item
          for (const f of seg.field) field = (field as Record<string, unknown> | undefined)?.[f]
          if (String(field) === seg.value) next.push(item)
        }
      }
    }
    current = next
  }
  return current
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function render(nodes: Node[], data: unknown): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text') out += node.value
    else if (node.type === 'path') out += evalPath(node.path, data).map(stringify).join(' ')
    else for (const item of evalPath(node.path, data)) out += render(node.body, item)
  }
  return out
}

export function jsonPath(template: string, data: unknown): string {
  return render(parseTemplate(template), data)
}
