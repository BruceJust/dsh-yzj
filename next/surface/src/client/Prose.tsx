/**
 * 云小助说的话，按它写的样子排出来 (界面重设计 律一).
 *
 * 它的回答是用 Markdown 写的：加粗、列表、表格、代码。原样摊在屏上，人读到的是
 * `**`、`|---|` 这些给排版用的记号——界面在逼人替它解析。这里把那几种常用的写法
 * 排成样子，其余原样留着。
 *
 * **只产出 React 元素，从不拼 HTML。** 文字由 React 转义；链接只认 http(s)，别的
 * 协议原样当字显示。所以这里不是消毒器，也不需要是：没有一个字节会被当成标签。
 *
 * 只用在云小助的话上。人说的话是原话，按原样显示——群里的人打了个星号，就是一个
 * 星号。
 */

import { Fragment, type ReactNode } from 'react'
import css from './prose.module.css'

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[]; start: number }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'hr' }

const FENCE = /^\s*```/u
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/u
const BULLET = /^\s*[-*+]\s+(.*)$/u
const NUMBERED = /^\s*(\d{1,3})[.)、]\s+(.*)$/u
const QUOTE = /^\s*>\s?(.*)$/u
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/u

const cells = (line: string): string[] => line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map(cell => cell.trim())

/** 一段文字切成块。认不出的行归进段落，原样保留。 */
export function blocksOf(text: string): Block[] {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const out: Block[] = []
  let index = 0
  const paragraph = (line: string): void => {
    const last = out.at(-1)
    if (last?.kind === 'p') last.lines.push(line)
    else out.push({ kind: 'p', lines: [line] })
  }
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (FENCE.test(line)) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) { body.push(lines[index] ?? ''); index += 1 }
      index += 1
      out.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    if (line.trim() === '') { out.push({ kind: 'p', lines: [] }); index += 1; continue }
    if (line.includes('|') && TABLE_DIVIDER.test(lines[index + 1] ?? '')) {
      const head = cells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim() !== '') {
        rows.push(cells(lines[index] ?? ''))
        index += 1
      }
      out.push({ kind: 'table', head, rows })
      continue
    }
    if (RULE.test(line)) { out.push({ kind: 'hr' }); index += 1; continue }
    const heading = HEADING.exec(line)
    if (heading !== null) { out.push({ kind: 'h', text: heading[1] ?? '' }); index += 1; continue }
    const quote = QUOTE.exec(line)
    if (quote !== null) {
      const last = out.at(-1)
      if (last?.kind === 'quote') last.lines.push(quote[1] ?? '')
      else out.push({ kind: 'quote', lines: [quote[1] ?? ''] })
      index += 1
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet === null ? NUMBERED.exec(line) : null
    if (bullet !== null || numbered !== null) {
      const kind = bullet === null ? 'ol' : 'ul'
      const item = bullet === null ? numbered?.[2] ?? '' : bullet[1] ?? ''
      const last = out.at(-1)
      if (last?.kind === kind) last.items.push(item)
      else out.push({ kind, items: [item], start: Number(numbered?.[1] ?? 1) })
      index += 1
      continue
    }
    paragraph(line)
    index += 1
  }
  // 空行只用来断段，不占位置。
  return out.filter(block => block.kind !== 'p' || block.lines.length > 0)
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(https?:\/\/[^\s<>()（）「」，。；]+)|((?<![*\w])\*[^*\s][^*\n]*\*(?![*\w]))/gu

/** 行内：代码、加粗、删除线、链接、斜体。代码里的东西不再当记号。 */
export function inlineOf(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let count = 0
  for (const match of text.matchAll(INLINE)) {
    const at = match.index
    if (at > last) out.push(text.slice(last, at))
    const [whole, code, strong, del, link, bare, em] = match
    const id = `${key}:${String(count++)}`
    if (code !== undefined) out.push(<code className={css.code} key={id}>{code.slice(1, -1)}</code>)
    else if (strong !== undefined) out.push(<strong key={id}>{inlineOf(strong.slice(2, -2), id)}</strong>)
    else if (del !== undefined) out.push(<del key={id}>{del.slice(2, -2)}</del>)
    else if (link !== undefined) {
      const split = link.indexOf('](')
      out.push(<a className={css.link} key={id} href={link.slice(split + 2, -1)} target="_blank" rel="noreferrer noopener">{link.slice(1, split)}</a>)
    } else if (bare !== undefined) {
      out.push(<a className={css.link} key={id} href={bare} target="_blank" rel="noreferrer noopener">{bare}</a>)
    } else if (em !== undefined) out.push(<em key={id}>{em.slice(1, -1)}</em>)
    else out.push(whole)
    last = at + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Prose(props: { text: string; className?: string }): ReactNode {
  const blocks = blocksOf(props.text)
  return (
    <div className={`${css.prose} ${props.className ?? ''}`}>
      {blocks.map((block, index) => {
        const key = String(index)
        switch (block.kind) {
          case 'p':
            return (
              <p key={key}>
                {block.lines.map((line, at) => (
                  <Fragment key={`${key}:${String(at)}`}>{at > 0 && <br />}{inlineOf(line, `${key}:${String(at)}`)}</Fragment>
                ))}
              </p>
            )
          case 'h':
            return <p className={css.heading} key={key}>{inlineOf(block.text, key)}</p>
          case 'code':
            return <pre className={css.pre} key={key}><code>{block.text}</code></pre>
          case 'quote':
            return (
              <blockquote className={css.quote} key={key}>
                {block.lines.map((line, at) => (
                  <Fragment key={`${key}:${String(at)}`}>{at > 0 && <br />}{inlineOf(line, `${key}:${String(at)}`)}</Fragment>
                ))}
              </blockquote>
            )
          case 'ul':
            return <ul className={css.list} key={key}>{block.items.map((item, at) => <li key={`${key}:${String(at)}`}>{inlineOf(item, `${key}:${String(at)}`)}</li>)}</ul>
          case 'ol':
            return <ol className={css.list} start={block.start} key={key}>{block.items.map((item, at) => <li key={`${key}:${String(at)}`}>{inlineOf(item, `${key}:${String(at)}`)}</li>)}</ol>
          case 'table':
            return (
              <div className={css.tableWrap} key={key}>
                <table className={css.table}>
                  <thead><tr>{block.head.map((cell, at) => <th key={`${key}:h${String(at)}`}>{inlineOf(cell, `${key}:h${String(at)}`)}</th>)}</tr></thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={`${key}:r${String(r)}`}>
                        {block.head.map((_, c) => <td key={`${key}:${String(r)}:${String(c)}`}>{inlineOf(row[c] ?? '', `${key}:${String(r)}:${String(c)}`)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'hr':
            return <hr className={css.hr} key={key} />
        }
      })}
    </div>
  )
}
