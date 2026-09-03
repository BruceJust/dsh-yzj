/**
 * The Yunzhijia CLI client: identity, group discovery, message reads, and the
 * outbound path.
 *
 * Every send goes through {@link YzjChannelClient.send}, which pre-registers
 * the outbound message before spawning the CLI. That ordering is the whole
 * echo protocol: a crash after the send but before the record still leaves a
 * fingerprint behind, and a crash before the send leaves a fingerprint that
 * simply never matches anything.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@yzj-next/bridge'
import { signOutbound } from '@yzj-next/objects'
import {
  asArray, asRecord, asString, conversationKindForGroup, outboundFingerprint,
  parseGroup, parseMessage, resolveTopicRootId,
  type TopicLookup, type YzjGroup, type YzjIdentity, type YzjMessage,
} from './protocol.ts'
import type { ChannelState } from './state.ts'

/** `yzj-cli im message list --limit` refuses anything larger. */
export const YZJ_MESSAGE_PAGE_MAX = 20

export class YzjChannelClient {
  private pinned: Pick<YzjIdentity, 'orgId' | 'openId'> | undefined
  /** 署名要落的名字。身份解析之前发出的东西签「未署名」——不签是唯一不允许的。 */
  private operatorName = ''

  constructor(
    private readonly ctx: Context,
    private readonly state: ChannelState,
    private readonly timeoutMs: number,
  ) {}

  private async run(command: readonly string[], label: string): Promise<unknown> {
    const result = await this.ctx.yzjBridge.run(command, { timeoutMs: this.timeoutMs })
    if (!result.ok) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${String(result.exitCode)}`
      throw new Error(`yzj channel ${label} failed: ${detail}`)
    }
    return result.json
  }

  async identity(): Promise<YzjIdentity> {
    const json = await this.run(['contact', 'user', 'get'], 'identity')
    const first = asRecord(asArray(json)[0] ?? json)
    const openId = asString(first.openId)
    const orgId = asString(first.orgId)
    if (openId === '' || orgId === '') throw new Error('yzj channel identity returned no openId/orgId')
    return { orgId, openId, name: asString(first.name) || openId }
  }

  /** Pin the identity this run is bound to; a change is fatal, not adaptive. */
  pinIdentity(identity: Pick<YzjIdentity, 'orgId' | 'openId'> & { name?: string }): void {
    const pinned = this.pinned
    if (pinned !== undefined && (pinned.orgId !== identity.orgId || pinned.openId !== identity.openId)) {
      throw new Error('Yunzhijia login account changed while the channel was running')
    }
    this.pinned = { orgId: identity.orgId, openId: identity.openId }
    if (identity.name !== undefined && identity.name !== '') this.operatorName = identity.name
  }

  /**
   * The conversation list, newest-first by the server's own ordering.
   *
   * A page that fails does NOT lose the pages before it. Two things make that
   * matter rather than being defensive habit: the API rate-limits back-to-back
   * page calls (`code=503, 稍后重试`), and this account has two conversation
   * records the server itself cannot serialize (`code=1110201`) — any page
   * window spanning them fails, permanently. Throwing on the first bad page
   * meant one poisoned record could cost the whole poll, every poll.
   */
  async recentGroups(pageCount: number): Promise<YzjGroup[]> {
    const groups: YzjGroup[] = []
    for (let page = 1; page <= pageCount; page += 1) {
      let json
      try {
        json = asRecord(await this.run(
          ['im', 'group', 'recent', '--limit', '20', '--page', String(page)],
          `recent groups page ${String(page)}`,
        ))
      } catch (error) {
        // The first page failing is a real outage — the caller's health
        // tracking should see it. A later page is an INDEPENDENT window, so a
        // bad one is skipped rather than ending the walk: `break` here meant a
        // single poisoned record at rank 25 permanently cost pages 3..n, and
        // an on-duty conversation ranked below it would simply stop being
        // polled. Skipping is also never silent — a truncated conversation
        // list that says nothing is indistinguishable from a short one.
        if (page === 1) throw error
        console.error(`[yzj-next-channel] conversation list page ${String(page)} unavailable`, error)
        continue
      }
      groups.push(...asArray(json.list).map(parseGroup).filter(group => group !== undefined))
      if (json.more !== true) break
    }
    return groups
  }

  /**
   * Newest `limit` messages, or everything after `afterMsgId` when given.
   *
   * The limit is clamped HERE rather than at each call site. `yzj-cli` rejects
   * anything above 20 outright — a caller that asks for 40 gets no messages at
   * all, not fewer — and that is a property of the CLI contract this class
   * exists to own. Leaving it to callers is how the place view shipped reading
   * nothing: every one of them has to remember a number none of them can see.
   */
  async messages(groupId: string, limit: number, afterMsgId?: string): Promise<YzjMessage[]> {
    limit = Math.max(1, Math.min(limit, YZJ_MESSAGE_PAGE_MAX))
    if (afterMsgId === undefined) {
      const json = asRecord(await this.run(
        ['im', 'message', 'list', '--group-id', groupId, '--type', 'newest', '--limit', String(limit)],
        `messages for ${groupId}`,
      ))
      return asArray(json.list).map(parseMessage).filter(message => message !== undefined)
    }
    const messages: YzjMessage[] = []
    let anchor = afterMsgId
    for (let page = 0; page < 10; page += 1) {
      const json = asRecord(await this.run(
        ['im', 'message', 'list', '--group-id', groupId, '--type', 'new', '--msg-id', anchor, '--limit', String(limit)],
        `messages for ${groupId}`,
      ))
      const batch = asArray(json.list).map(parseMessage).filter(message => message !== undefined)
      messages.push(...batch)
      const next = batch.at(-1)?.msgId
      if (json.more !== true || next === undefined || next === anchor) break
      anchor = next
    }
    return messages
  }

  async olderPage(groupId: string, anchor: string): Promise<{ messages: YzjMessage[]; more: boolean }> {
    const json = asRecord(await this.run(
      ['im', 'message', 'list', '--group-id', groupId, '--type', 'old', '--msg-id', anchor, '--limit', '20'],
      `topic history for ${groupId}`,
    ))
    return {
      messages: asArray(json.list).map(parseMessage).filter(message => message !== undefined),
      more: json.more === true,
    }
  }

  /**
   * Resolve display names for a batch of openIds. One call, repeatable flag —
   * the directory is the only place a real name exists, and rendering openIds
   * to a human is the same as rendering nothing.
   */
  /**
   * Pull an attachment's REAL bytes to a local path.
   *
   * There is no public URL for them. `https://static.yunzhijia.com/image/<g>/<id>`
   * looks like one and answers 200 — but it serves a generic 96–108px ICON,
   * byte-identical for two different pictures (measured). Everything built on
   * that URL was showing placeholders: every inline image, and every file
   * "download" link, which handed people a 96×96 png wearing the file's name.
   *
   * The CLI is the only route that returns the attachment itself.
   */
  async downloadFile(fileId: string, outPath: string): Promise<void> {
    await this.run(
      ['file', 'download', '--id', fileId, '--output', outPath, '--overwrite'],
      `file download ${fileId}`,
    )
  }

  async usersByOpenId(openIds: readonly string[]): Promise<{ openId: string; name: string }[]> {
    if (openIds.length === 0) return []
    const command = ['contact', 'user', 'get']
    for (const openId of openIds) command.push('--open-id', openId)
    const json = await this.run(command, 'contact user get')
    const rows = Array.isArray(json) ? json : []
    const out: { openId: string; name: string }[] = []
    for (const row of rows) {
      const record = asRecord(row)
      const openId = asString(record.openId)
      if (openId === '') continue
      out.push({ openId, name: asString(record.name) || openId })
    }
    return out
  }

  /**
   * Page backwards from the newest message until the freshness cutoff is
   * crossed or the page budget runs out. `truncated` with a `nextAnchor` means
   * the scan is INCOMPLETE — the caller must not advance its cursor yet.
   */
  async messagesSince(
    groupId: string,
    cutoff: number,
    pageCount: number,
    anchor?: string,
  ): Promise<{ messages: YzjMessage[]; truncated: boolean; nextAnchor?: string }> {
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
      scanned = [...older.messages.filter(message => !seen.has(message.msgId)), ...scanned]
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

  /**
   * The conversation context for one trigger: the running DM tail, or the
   * messages of the trigger's own topic, walking back until the root is in
   * hand. This is how a cold start after a switch recovers its context.
   */
  async contextFor(
    group: YzjGroup,
    trigger: YzjMessage,
    limit: number,
    topicRootId: string,
    lookup?: TopicLookup,
  ): Promise<YzjMessage[]> {
    let scanned = await this.messages(group.groupId, Math.min(20, limit))
    if (!scanned.some(message => message.msgId === trigger.msgId)) {
      const around = await this.olderPage(group.groupId, trigger.msgId)
      scanned = [...around.messages.filter(message => message.msgId !== trigger.msgId), trigger]
    }
    if (conversationKindForGroup(group) === 'direct') {
      const index = scanned.findIndex(message => message.msgId === trigger.msgId)
      const throughTrigger = index < 0 ? [...scanned, trigger] : scanned.slice(0, index + 1)
      return throughTrigger.slice(-limit)
    }

    let rootId = topicRootId
    for (let page = 0; page < 10; page += 1) {
      rootId = resolveTopicRootId(group, trigger, scanned, lookup)
      if (scanned.some(message => message.msgId === rootId)) break
      const earliest = scanned[0]?.msgId
      if (earliest === undefined) break
      const older = await this.olderPage(group.groupId, earliest)
      if (older.messages.length === 0) break
      const seen = new Set(scanned.map(message => message.msgId))
      scanned = [...older.messages.filter(message => !seen.has(message.msgId)), ...scanned]
      if (!older.more) {
        rootId = resolveTopicRootId(group, trigger, scanned, lookup)
        break
      }
    }

    const index = scanned.findIndex(message => message.msgId === trigger.msgId)
    const throughTrigger = index < 0 ? [...scanned, trigger] : scanned.slice(0, index + 1)
    const topic = throughTrigger.filter(message => (
      resolveTopicRootId(group, message, throughTrigger, lookup) === rootId
    ))
    if (topic.length <= limit) return topic
    const root = topic.find(message => message.msgId === rootId)
    if (root === undefined || limit < 2) return topic.slice(-limit)
    return [root, ...topic.filter(message => message.msgId !== rootId).slice(-(limit - 1))]
  }

  /**
   * Send one message. Pre-registers before spawning; returns the message id
   * and the conversation the CLI actually delivered into (a DM send only
   * learns its group id from the response).
   */
  /**
   * @param origin - who is speaking. Both are "ours" for echo suppression;
   *   only the agent's own words count as the agent having been addressed
   *   when somebody replies to them (受话判定, v4.7).
   */
  async send(
    target: { groupId?: string; toOpenId?: string },
    content: string,
    replyMsgId?: string,
    origin: 'agent' | 'desk' = 'agent',
  ): Promise<{ msgId?: string; groupId?: string }> {
    const groupId = target.groupId ?? `dm:${target.toOpenId ?? ''}`
    /*
      **署名协议** (决策 #63 §8 B5②)：agent 的一切出站恒带「—— 云小助（Bruce）」。
      桌面那一路（`desk`）是人自己在说话，不签——签了，别的实例会把人的话当成实例出站
      而不接（同侪回声），而人的话恰恰是要被接的。

      指纹按**签完的正文**算：回来的就是这一段。
    */
    content = origin === 'agent' ? signOutbound(content, this.operatorName) : content
    const nonce = randomUUID()
    const fingerprint = outboundFingerprint(groupId, content)
    this.state.registerOutbound(nonce, groupId, fingerprint, origin)
    await this.state.save()

    const command = ['im', 'message', 'send', '--msg-type', 'text', '--content', content]
    if (target.groupId !== undefined) command.push('--group-id', target.groupId)
    if (target.toOpenId !== undefined) command.push('--to-open-id', target.toOpenId)
    if (replyMsgId !== undefined) command.push('--reply-msg-id', replyMsgId)

    const json = asRecord(await this.run(command, `send to ${groupId}`))
    const msgId = asString(json.msgId ?? json.id)
    const sentGroupId = asString(json.groupId)
    if (msgId !== '') {
      this.state.confirmOutbound(nonce, msgId)
      // Re-register the fingerprint under the conversation the message really
      // landed in, so the poll that reads it back recognises it as ours.
      if (sentGroupId !== '' && sentGroupId !== groupId) {
        this.state.registerOutbound(`${nonce}:resolved`, sentGroupId, outboundFingerprint(sentGroupId, content))
        this.state.confirmOutbound(`${nonce}:resolved`, msgId)
      }
      await this.state.save()
    }
    return {
      ...(msgId === '' ? {} : { msgId }),
      ...(sentGroupId === '' ? (target.groupId === undefined ? {} : { groupId: target.groupId }) : { groupId: sentGroupId }),
    }
  }
}
