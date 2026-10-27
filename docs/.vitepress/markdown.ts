import type { MarkdownRenderer } from 'vitepress'

/** ```mermaid ... ``` → component <Mermaid> (sơ đồ được vẽ phía trình duyệt). */
export function mermaidFence(md: MarkdownRenderer) {
  const fence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (token.info.trim() === 'mermaid') {
      return `<Mermaid code="${encodeURIComponent(token.content)}" />`
    }
    return fence(tokens, idx, options, env, self)
  }
}

/** Danh sách công việc kiểu GitHub: "- [ ] việc cần làm" / "- [x] việc đã xong". */
export function taskLists(md: MarkdownRenderer) {
  md.core.ruler.after('inline', 'task-lists', (state) => {
    const tokens = state.tokens
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i]
      const listItem = tokens[i - 2]
      if (
        inline.type !== 'inline' ||
        tokens[i - 1].type !== 'paragraph_open' ||
        listItem.type !== 'list_item_open'
      ) {
        continue
      }
      const first = inline.children?.[0]
      const match = first?.type === 'text' ? /^\[([ xX])\]\s+/.exec(first.content) : null
      if (!first || !match) continue

      first.content = first.content.slice(match[0].length)
      const open = new state.Token('html_inline', '', 0)
      const checked = match[1] === ' ' ? '' : ' checked'
      open.content = `<label class="task-label"><input type="checkbox" class="task-checkbox"${checked}> `
      const close = new state.Token('html_inline', '', 0)
      close.content = '</label>'
      inline.children!.unshift(open)
      inline.children!.push(close)
      listItem.attrJoin('class', 'task-list-item')

      for (let j = i - 3; j >= 0; j--) {
        if (tokens[j].type === 'bullet_list_open' && tokens[j].level === listItem.level - 1) {
          tokens[j].attrJoin('class', 'contains-task-list')
          break
        }
      }
    }
  })
}
