/**
 * A small Markdown → HTML converter, for previewing what somebody attached.
 *
 * **It is not a sanitizer, and it does not need to be.** Everything it produces
 * is displayed inside `<iframe sandbox="">`, which denies scripts, same-origin
 * access, forms and navigation — so the security property is structural rather
 * than a bet that this file caught every trick. That matters because the input
 * is a file a colleague uploaded into a group: a converter that had to be
 * airtight would be the wrong shape of defence.
 *
 * What it still does carefully is ESCAPE FIRST and transform second. Escaping
 * after transformation would mangle the tags this produces, and escaping never
 * would let raw markup through into the frame — harmless there, but it would
 * silently render a `.md` file as HTML, which is a lie about what the file is.
 *
 * Scope is what people actually put in a `.md`: headings, emphasis, code,
 * fences, lists, quotes, rules, links, tables. Anything unrecognised survives
 * as its own text, which is the right failure for a preview.
 */

/** HTML-escape. The first thing that happens to every byte of input. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

/** Inline marks, applied to already-escaped text. */
function inline(text: string): string {
  return text
    // Code first: what is inside a span of code is not emphasis.
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/gu, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/gu, '<del>$1</del>')
    /*
      Links keep their text but NOT their destination.

      The frame cannot navigate anywhere (`sandbox=""` denies it), so a live
      href would be a control that silently does nothing — worse than showing
      where it points. The target is rendered as visible text instead.
    */
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/gu, '$1 <span class="u">$2</span>')
}

/** One table row's cells, already escaped. */
function cells(line: string): string[] {
  return line.replace(/^\||\|$/gu, '').split('|').map(cell => cell.trim())
}

/** Convert Markdown to a fragment of HTML meant for a sandboxed frame. */
export function markdownToHtml(source: string): string {
  const lines = escapeHtml(source.replace(/\r\n?/gu, '\n')).split('\n')
  const out: string[] = []
  let listKind: 'ul' | 'ol' | undefined
  let inFence = false
  let fence: string[] = []
  let paragraph: string[] = []

  const closeList = (): void => {
    if (listKind !== undefined) {
      out.push(`</${listKind}>`)
      listKind = undefined
    }
  }
  const closeParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }

  for (const line of lines) {
    if (/^\s*```/u.test(line)) {
      if (inFence) {
        out.push(`<pre><code>${fence.join('\n')}</code></pre>`)
        fence = []
        inFence = false
      } else {
        closeParagraph()
        closeList()
        inFence = true
      }
      continue
    }
    if (inFence) {
      fence.push(line)
      continue
    }
    if (line.trim() === '') {
      closeParagraph()
      closeList()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (heading !== null) {
      closeParagraph()
      closeList()
      const level = (heading[1] ?? '#').length
      out.push(`<h${String(level)}>${inline(heading[2] ?? '')}</h${String(level)}>`)
      continue
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      closeParagraph()
      closeList()
      out.push('<hr>')
      continue
    }
    const quote = /^\s*&gt;\s?(.*)$/u.exec(line)
    if (quote !== null) {
      closeParagraph()
      closeList()
      out.push(`<blockquote>${inline(quote[1] ?? '')}</blockquote>`)
      continue
    }
    // A table is recognised by its separator row, so the header is buffered
    // until the line after it proves what it was.
    // A table at the very top of a file is still a table; the only thing the
    // separator needs is a buffered header line above it.
    if (/^\s*\|?[\s:-]*-[\s:|-]*\|/u.test(line) && paragraph.length === 1) {
      const header = cells(paragraph[0] ?? '')
      paragraph = []
      out.push(`<table><thead><tr>${
        header.map(cell => `<th>${inline(cell)}</th>`).join('')
      }</tr></thead><tbody>`)
      listKind = undefined
      continue
    }
    if (out.at(-1)?.endsWith('<tbody>') === true || out.at(-1)?.startsWith('<tr>') === true) {
      if (line.includes('|')) {
        out.push(`<tr>${cells(line).map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`)
        continue
      }
      out.push('</tbody></table>')
    }
    const bullet = /^\s*[-*+]\s+(.*)$/u.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/u.exec(line)
    if (bullet !== null || numbered !== null) {
      closeParagraph()
      const kind = bullet !== null ? 'ul' : 'ol'
      if (listKind !== kind) {
        closeList()
        out.push(`<${kind}>`)
        listKind = kind
      }
      out.push(`<li>${inline((bullet ?? numbered)?.[1] ?? '')}</li>`)
      continue
    }
    closeList()
    paragraph.push(line.trim())
  }
  if (inFence && fence.length > 0) out.push(`<pre><code>${fence.join('\n')}</code></pre>`)
  closeParagraph()
  closeList()
  if (out.at(-1)?.startsWith('<tr>') === true) out.push('</tbody></table>')
  return out.join('\n')
}

/**
 * Wrap a fragment into a standalone document for the preview frame.
 *
 * Styles are inlined because the frame has no origin and therefore cannot load
 * a stylesheet from us — and an unstyled dump of markup reads worse than the
 * plain text it replaced.
 */
export function previewDocument(body: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; padding: 4px 2px; font: 13px/1.75 -apple-system, "PingFang SC", system-ui, sans-serif; color: #23262B; }
  h1,h2,h3,h4,h5,h6 { margin: 1.1em 0 .5em; line-height: 1.35; }
  h1 { font-size: 1.5em; } h2 { font-size: 1.28em; } h3 { font-size: 1.12em; }
  p, li { margin: .45em 0; }
  code { background: #F2F4F7; border-radius: 4px; padding: 1px 5px;
         font-family: ui-monospace, Menlo, monospace; font-size: .92em; }
  pre { background: #F7F8FA; border-radius: 8px; padding: 10px 12px; overflow: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: .6em 0; padding: .2em .9em; border-left: 3px solid #C9DBFA; color: #5A6270; }
  table { border-collapse: collapse; margin: .7em 0; font-size: .95em; }
  th, td { border: 1px solid #E3E6EB; padding: 5px 9px; text-align: left; }
  th { background: #F7F8FA; }
  hr { border: 0; border-top: 1px solid #E3E6EB; margin: 1.1em 0; }
  img { max-width: 100%; }
  .u { color: #6B7280; word-break: break-all; }
</style>${body}`
}
