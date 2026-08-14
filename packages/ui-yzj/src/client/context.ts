/**
 * Reference-context resolution: given a dragged or @-picked Yunzhijia ref,
 * fetch a compact, model-facing context block (title + key facts + content
 * excerpt) over the /yzj RPC face. The result rides the reference codec's
 * serialize() so the agent receives substance — not just a title link.
 * Pure async helper; no hooks, no runtime services beyond the inject face.
 */
import type { YzjPanelInject } from './rpc.ts'
import type { YzjDragRef } from './panel.tsx'

/** In-memory ref → context cache, keyed by a stable ref string. */
const contextCache = new Map<string, string>()

export function yzjRefKey(ref: Pick<YzjDragRef, 'kind' | 'id'>): string {
  return `${ref.kind}:${ref.id}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Compact clock for event ms timestamps. */
function clock(ms: unknown): string {
  if (typeof ms !== 'number') return ''
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Extract plain text from a doc block subtree (heading/paragraph/code/text). */
function blockText(node: unknown): string {
  const record = asRecord(node)
  const parts: string[] = []
  const content = record.content
  if (Array.isArray(content)) {
    for (const item of content) {
      const text = asString(asRecord(item).content)
      if (text !== '') parts.push(text)
    }
  }
  for (const child of asArray(record.children)) {
    const childText = blockText(child)
    if (childText !== '') parts.push(childText)
  }
  return parts.join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Fetch one reference's context block; caches per ref key. */
export async function fetchRefContext(
  inject: YzjPanelInject,
  ref: YzjDragRef,
): Promise<string> {
  const key = yzjRefKey(ref)
  const cached = contextCache.get(key)
  if (cached !== undefined) return cached

  const lines: string[] = []
  const kindLabel: Record<string, string> = {
    workspace: '知识库', doc: '文档', group: '会话', event: '日程', contact: '联系人', message: '消息',
  }
  lines.push(`【云之家·${kindLabel[ref.kind] ?? ref.kind}】${ref.title}`)

  try {
    switch (ref.kind) {
      case 'workspace': {
        const result = await inject.fetchWorkspace(ref.id)
        if (result.ok) {
          const ws = asRecord(result.value)
          lines.push(`类型：${asString(ws.bizType) === '' ? '知识库' : asString(ws.bizType)} · 文档 ${typeof ws.docCount === 'number' ? ws.docCount : '?'} 篇 · 成员 ${typeof ws.memberCount === 'number' ? ws.memberCount : '?'} 人`)
          if (asString(ws.description) !== '') lines.push(`简介：${asString(ws.description)}`)
        }
        break
      }
      case 'doc': {
        const [infoResult, blocksResult] = await Promise.all([
          inject.fetchDoc(ref.id),
          inject.fetchDocBlocks(ref.id),
        ])
        if (infoResult.ok) {
          const node = asRecord(infoResult.value)
          const suffix = asString(node.fileSuffix)
          lines.push(`类型：${suffix === 'dbt' ? '多维表格' : '在线文档'} · 更新 ${asString(node.updateTime).slice(0, 10)} · 创建人 ${asString(node.creatorName) === '' ? '未知' : asString(node.creatorName)}`)
          const link = asString(node.openWebUrl)
          if (link !== '') lines.push(`链接：${link}`)
        }
        if (blocksResult.ok) {
          const blocks = asArray(blocksResult.value)
          const excerpt = blocks.slice(0, 10).map(blockText).filter(text => text !== '').join(' ')
          if (excerpt !== '') lines.push(`内容摘要：${excerpt.length > 500 ? `${excerpt.slice(0, 500)}…` : excerpt}`)
        }
        break
      }
      case 'group': {
        lines.push(`会话ID：${ref.id}`)
        const result = await inject.fetchMessages(ref.id, 8)
        if (result.ok) {
          const messages = asArray(asRecord(result.value).list)
          const preview = [...messages].reverse().slice(0, 6).map((item) => {
            const message = asRecord(item)
            const time = asString(message.sendTime).slice(5, 16)
            const body = asString(message.content)
            return `[${time}] ${body === '' ? '(文件/图片消息)' : body.replace(/\s+/g, ' ').slice(0, 60)}`
          })
          if (preview.length > 0) lines.push(`最近消息：\n${preview.join('\n')}`)
        }
        break
      }
      case 'event': {
        const result = await inject.fetchEvent(ref.id)
        if (result.ok) {
          const event = asRecord(result.value)
          const span = [clock(event.startDate), clock(event.endDate)].filter(part => part !== '').join(' → ')
          lines.push(`时间：${span === '' ? '未知' : span}`)
          if (asString(event.personName) !== '') lines.push(`组织者：${asString(event.personName)}`)
          if (asString(event.content) !== '') lines.push(`描述：${asString(event.content).slice(0, 200)}`)
        }
        break
      }
      case 'contact': {
        const result = await inject.fetchContact(ref.id)
        if (result.ok) {
          const users = asArray(result.value)
          const user = asRecord(users[0] ?? result.value)
          const parts = [asString(user.department), asString(user.jobTitle), asString(user.jobNo) === '' ? '' : `工号 ${asString(user.jobNo)}`]
          lines.push(parts.filter(part => part !== '').join(' · '))
        }
        break
      }
      case 'message': {
        // Hard requirement (design v1.6 §5.2): the drag payload must carry
        // the owning groupId so the codec can re-fetch the original body.
        const groupId = asString(ref.group)
        if (groupId !== '') {
          lines.push(`所属会话：${groupId}`)
          const result = await inject.fetchMessages(groupId, 20, { type: 'new', msgId: ref.id })
          if (result.ok) {
            const list = asArray(asRecord(result.value).list)
            const hit = list.find(item => asString(asRecord(item).msgId) === ref.id)
            if (hit !== undefined) {
              const message = asRecord(hit)
              const body = asString(message.content)
              const from = asString(message.fromOpenId)
              lines.push(`发送人：${from === '' ? '(未知)' : from}`)
              lines.push(`原文：${body === '' ? `(${asString(message.msgType) === '' ? '消息' : asString(message.msgType)})` : body}`)
            } else {
              // Anchor not in the returned window: keep the snapshot, marked.
              lines.push(`内容（快照，原文可能已变）：${ref.title}`)
            }
          } else {
            lines.push(`内容（快照，原文可能已变）：${ref.title}`)
          }
        } else {
          lines.push(`内容（快照，原文可能已变）：${ref.title}`)
        }
        if (asString(ref.sub) !== '') lines.push(`时间：${asString(ref.sub)}`)
        break
      }
    }
  } catch {
    // Context is best-effort; a failure keeps the header line only.
  }

  const block = lines.join('\n')
  contextCache.set(key, block)
  return block
}

/** Drop one cached context (used when a session resets). */
export function clearRefContextCache(): void {
  contextCache.clear()
}
