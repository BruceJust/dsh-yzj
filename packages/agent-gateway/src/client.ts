import type { Context } from '@deepseek-ai/cordis'
import {
  asArray, asRecord, asString, conversationKindForGroup, parseGroup, parseMessage,
  resolveTopicRootId,
} from './protocol.ts'
import type { YzjGroup, YzjIdentity, YzjMessage } from './types.ts'

export interface YzjDiscoveryBatch {
  readonly messages: YzjMessage[]
  readonly truncated: boolean
  readonly nextAnchor?: string
}

export class YzjGatewayClient {
  private pinnedIdentity: Pick<YzjIdentity, 'orgId' | 'openId'> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly timeoutMs: number,
  ) {}

  private async run(command: readonly string[], label: string): Promise<unknown> {
    const result = await this.ctx.yzjBridge.run(command, { timeoutMs: this.timeoutMs })
    if (!result.ok) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${String(result.exitCode)}`
      throw new Error(`yzj agent gateway ${label} failed: ${detail}`)
    }
    return result.json
  }

  async identity(): Promise<YzjIdentity> {
    const json = await this.run(['contact', 'user', 'get'], 'identity')
    const first = asRecord(asArray(json)[0])
    const openId = asString(first.openId)
    const orgId = asString(first.orgId)
    if (openId === '') throw new Error('yzj agent gateway identity returned no openId')
    if (orgId === '') throw new Error('yzj agent gateway identity returned no orgId')
    return { orgId, openId, name: asString(first.name) || openId }
  }

  pinIdentity(identity: Pick<YzjIdentity, 'orgId' | 'openId'>): void {
    const pinned = this.pinnedIdentity
    if (pinned !== undefined && (pinned.orgId !== identity.orgId || pinned.openId !== identity.openId)) {
      throw new Error('Yunzhijia login account changed while Agent gateway is running')
    }
    this.pinnedIdentity = { orgId: identity.orgId, openId: identity.openId }
  }

  async assertPinnedIdentity(): Promise<void> {
    const pinned = this.pinnedIdentity
    if (pinned === undefined) throw new Error('Yunzhijia Agent client has no pinned identity')
    const observed = await this.identity()
    if (observed.orgId !== pinned.orgId || observed.openId !== pinned.openId) {
      throw new Error('Yunzhijia login account changed after this Agent task was admitted')
    }
  }

  async recentGroups(pageCount: number): Promise<YzjGroup[]> {
    const groups: YzjGroup[] = []
    for (let page = 1; page <= pageCount; page += 1) {
      const json = asRecord(await this.run([
        'im', 'group', 'recent', '--limit', '20', '--page', String(page),
      ], `recent groups page ${String(page)}`))
      groups.push(...asArray(json.list).map(parseGroup).filter(group => group !== undefined))
      if (json.more !== true) break
    }
    return groups
  }

  async messages(groupId: string, limit: number, afterMsgId?: string): Promise<YzjMessage[]> {
    if (afterMsgId === undefined) {
      const json = asRecord(await this.run([
        'im', 'message', 'list', '--group-id', groupId,
        '--type', 'newest', '--limit', String(limit),
      ], `messages for ${groupId}`))
      return asArray(json.list).map(parseMessage).filter(message => message !== undefined)
    }
    const messages: YzjMessage[] = []
    let anchor = afterMsgId
    for (let page = 0; page < 10; page += 1) {
      const json = asRecord(await this.run([
        'im', 'message', 'list', '--group-id', groupId,
        '--type', 'new', '--msg-id', anchor, '--limit', String(limit),
      ], `messages for ${groupId}`))
      const batch = asArray(json.list).map(parseMessage).filter(message => message !== undefined)
      messages.push(...batch)
      const next = batch.at(-1)?.msgId
      if (json.more !== true || next === undefined || next === anchor) break
      anchor = next
    }
    return messages
  }

  private async olderPage(groupId: string, anchor: string): Promise<{ messages: YzjMessage[]; more: boolean }> {
    const json = asRecord(await this.run([
      'im', 'message', 'list', '--group-id', groupId,
      '--type', 'old', '--msg-id', anchor, '--limit', '20',
    ], `topic history for ${groupId}`))
    return {
      messages: asArray(json.list).map(parseMessage).filter(message => message !== undefined),
      more: json.more === true,
    }
  }

  async messagesSince(
    groupId: string,
    cutoff: number,
    pageCount: number,
    anchor?: string,
  ): Promise<YzjDiscoveryBatch> {
    let scanned: YzjMessage[]
    let more: boolean
    if (anchor === undefined) {
      scanned = await this.messages(groupId, 20)
      more = scanned.length > 0
    } else {
      const first = await this.olderPage(groupId, anchor)
      scanned = first.messages
      more = first.more
    }
    for (let page = 1; page < pageCount && more; page += 1) {
      const earliest = scanned[0]
      if (earliest === undefined) {
        more = false
        break
      }
      const earliestAt = Date.parse(earliest.sendTime.replace(' ', 'T'))
      if (Number.isFinite(earliestAt) && earliestAt < cutoff) {
        more = false
        break
      }
      const older = await this.olderPage(groupId, earliest.msgId)
      if (older.messages.length === 0) {
        more = false
        break
      }
      const seen = new Set(scanned.map(message => message.msgId))
      scanned = [
        ...older.messages.filter(message => !seen.has(message.msgId)),
        ...scanned,
      ]
      more = older.more
    }
    const earliest = scanned[0]
    const earliestAt = earliest === undefined
      ? Number.NaN
      : Date.parse(earliest.sendTime.replace(' ', 'T'))
    const truncated = more && earliest !== undefined
      && (!Number.isFinite(earliestAt) || earliestAt >= cutoff)
    return {
      messages: scanned.filter((message) => {
        const sentAt = Date.parse(message.sendTime.replace(' ', 'T'))
        return Number.isFinite(sentAt) && sentAt >= cutoff
      }),
      truncated,
      ...(truncated ? { nextAnchor: earliest?.msgId } : {}),
    }
  }

  async contextFor(
    group: YzjGroup,
    trigger: YzjMessage,
    limit: number,
    topicRootId: string = resolveTopicRootId(group, trigger),
    lookup?: (groupId: string, messageId: string) => string | undefined,
  ): Promise<YzjMessage[]> {
    let scanned = await this.messages(group.groupId, Math.min(20, limit))
    if (!scanned.some(message => message.msgId === trigger.msgId)) {
      const aroundTrigger = await this.olderPage(group.groupId, trigger.msgId)
      scanned = [
        ...aroundTrigger.messages.filter(message => message.msgId !== trigger.msgId),
        trigger,
      ]
    }
    if (conversationKindForGroup(group) === 'direct') {
      const triggerIndex = scanned.findIndex(message => message.msgId === trigger.msgId)
      const throughTrigger = triggerIndex < 0 ? [...scanned, trigger] : scanned.slice(0, triggerIndex + 1)
      return throughTrigger.slice(-limit)
    }

    let resolvedRootId = topicRootId
    for (let page = 0; page < 10; page += 1) {
      resolvedRootId = resolveTopicRootId(group, trigger, scanned, lookup)
      if (scanned.some(message => message.msgId === resolvedRootId)) break
      const earliest = scanned[0]?.msgId
      if (earliest === undefined) break
      const olderPage = await this.olderPage(group.groupId, earliest)
      const older = olderPage.messages
      if (older.length === 0) break
      const seen = new Set(scanned.map(message => message.msgId))
      scanned = [...older.filter(message => !seen.has(message.msgId)), ...scanned]
      if (!olderPage.more) {
        resolvedRootId = resolveTopicRootId(group, trigger, scanned, lookup)
        break
      }
    }

    const triggerIndex = scanned.findIndex(message => message.msgId === trigger.msgId)
    const throughTrigger = triggerIndex < 0 ? [...scanned, trigger] : scanned.slice(0, triggerIndex + 1)
    const topic = throughTrigger.filter(message => (
      resolveTopicRootId(group, message, throughTrigger, lookup) === resolvedRootId
    ))
    if (topic.length <= limit) return topic
    const root = topic.find(message => message.msgId === resolvedRootId)
    if (root === undefined || limit < 2) return topic.slice(-limit)
    return [root, ...topic.filter(message => message.msgId !== resolvedRootId).slice(-(limit - 1))]
  }

  async reply(
    groupId: string,
    replyMsgId: string,
    content: string,
    assertAuthorized?: () => void,
  ): Promise<string | undefined> {
    await this.assertPinnedIdentity()
    assertAuthorized?.()
    const json = asRecord(await this.run([
      'im', 'message', 'send',
      '--group-id', groupId,
      '--msg-type', 'text',
      '--content', content,
      '--reply-msg-id', replyMsgId,
    ], `reply to ${groupId}`))
    return asString(json.msgId ?? json.id) || undefined
  }
}
