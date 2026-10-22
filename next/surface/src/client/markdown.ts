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

      文档内的锚点（目录里的「#1-总览」）除外：它指的就是下面那个标题，念出来只是
      在每一行目录后面多挂一串乱码。
    */
    .replace(/\[([^\]]+)\]\(#[^)]*\)/gu, '$1')
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
  // A table ends at the first line that is not a row — a blank line, a fence,
  // a heading. Left open, the browser hoists whatever follows into the table.
  let inTable = false
  const closeTable = (): void => {
    if (inTable) {
      out.push('</tbody></table>')
      inTable = false
    }
  }
  const closeParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }
  /*
    连着的几行引用是一段引用，不是几段：一行一个 blockquote，左边那道线就断成
    一截一截。每行留着换行——文档头上「类型：… / 基线：… / 范围：…」这种写法，
    作者要的就是一行一条。
  */
  let quote: string[] = []
  const closeQuote = (): void => {
    if (quote.length > 0) {
      out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`)
      quote = []
    }
  }

  for (const line of lines) {
    if (/^\s*```/u.test(line)) {
      if (inFence) {
        out.push(`<pre><code>${fence.join('\n')}</code></pre>`)
        fence = []
        inFence = false
      } else {
        closeTable()
        closeParagraph()
        closeList()
        closeQuote()
        inFence = true
      }
      continue
    }
    if (inFence) {
      fence.push(line)
      continue
    }
    if (line.trim() === '') {
      closeTable()
      closeParagraph()
      closeList()
      closeQuote()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (heading !== null) {
      closeTable()
      closeParagraph()
      closeList()
      const level = (heading[1] ?? '#').length
      out.push(`<h${String(level)}>${inline(heading[2] ?? '')}</h${String(level)}>`)
      continue
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      closeTable()
      closeParagraph()
      closeList()
      out.push('<hr>')
      continue
    }
    const quoted = /^\s*&gt;\s?(.*)$/u.exec(line)
    if (quoted !== null) {
      closeTable()
      closeParagraph()
      closeList()
      // 引用里的空行（「>」单独一行）是段落的分隔，不是一行空字。
      if ((quoted[1] ?? '').trim() === '') closeQuote()
      else quote.push(quoted[1] ?? '')
      continue
    }
    closeQuote()
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
      inTable = true
      listKind = undefined
      continue
    }
    if (inTable) {
      if (line.includes('|')) {
        out.push(`<tr>${cells(line).map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`)
        continue
      }
      closeTable()
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
  closeQuote()
  closeTable()
  closeParagraph()
  closeList()
  return out.join('\n')
}

/** The frame's own palette, one per host mode. It cannot read our tokens: no origin, no stylesheet. */
const FRAME_INK = {
  light: { scheme: 'light', ink: '#23262B', soft: '#5A6270', faint: '#6B7280', well: '#F7F8FA', chip: '#F2F4F7', rule: '#E3E6EB', quote: '#C9DBFA', link: '#1E4FBD' },
  dark: { scheme: 'dark', ink: '#E6E8EB', soft: '#A9AFB8', faint: '#8A909B', well: '#1A1B1E', chip: '#24262A', rule: '#33363B', quote: '#3A5280', link: '#8DB1FF' },
} as const

/**
 * Wrap a fragment into a standalone document for the preview frame.
 *
 * Styles are inlined because the frame has no origin and therefore cannot load
 * a stylesheet from us — and an unstyled dump of markup reads worse than the
 * plain text it replaced. Markdown is ours to typeset, so it follows the host's
 * light/dark; the frame stays transparent and the column behind it shows through.
 */
export function previewDocument(body: string, dark = false): string {
  const ink = dark ? FRAME_INK.dark : FRAME_INK.light
  return `<!doctype html><meta charset="utf-8"><style>
  :root { color-scheme: ${ink.scheme}; }
  /* system-ui 打头：Chromium 不认 -apple-system，排在前面就落到苹方，苹方的连字符是一道长横，「kwork-server」读成「kwork–server」。 */
  body { margin: 0; padding: 4px 2px; font: 13px/1.75 system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif; color: ${ink.ink}; background: transparent; }
  h1,h2,h3,h4,h5,h6 { margin: 1.1em 0 .5em; line-height: 1.35; }
  h1 { font-size: 1.5em; } h2 { font-size: 1.28em; } h3 { font-size: 1.12em; }
  p, li { margin: .45em 0; }
  a { color: ${ink.link}; }
  code { background: ${ink.chip}; border-radius: 4px; padding: 1px 5px;
         font-family: ui-monospace, Menlo, monospace; font-size: .92em; }
  pre { background: ${ink.well}; border-radius: 8px; padding: 10px 12px; overflow: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: .6em 0; padding: .2em .9em; border-left: 3px solid ${ink.quote}; color: ${ink.soft}; }
  table { border-collapse: collapse; margin: .7em 0; font-size: .95em; }
  th, td { border: 1px solid ${ink.rule}; padding: 5px 9px; text-align: left; }
  th { background: ${ink.well}; }
  hr { border: 0; border-top: 1px solid ${ink.rule}; margin: 1.1em 0; }
  img { max-width: 100%; }
  .u { color: ${ink.faint}; word-break: break-all; }
</style>${body}`
}
