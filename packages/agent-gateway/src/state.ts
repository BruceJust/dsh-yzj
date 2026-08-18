import { constants, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { accountKeyFor, asRecord, asString } from './protocol.ts'
import {
  decodeGatewayState, freshAccountState, freshGatewayState,
  type LegacyGatewayAccountData,
} from './state-codec.ts'
import type { GatewayAccountStateData, GatewayStateData, YzjIdentity, YzjTrigger } from './types.ts'

const MAX_PROCESSED = 2_000
const MAX_TOPIC_INDEX = 20_000
const RETAIN_MS = 7 * 24 * 60 * 60 * 1_000
const topicIndexKey = (groupId: string, msgId: string): string => `${groupId}\0${msgId}`

export class GatewayState {
  private data: GatewayStateData = freshGatewayState()
  private legacy: LegacyGatewayAccountData | undefined
  private activeKey: string | undefined
  private readonly seenIds = new Set<string>()
  private saving: Promise<void> = Promise.resolve()
  private migrationPending = false

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const decoded = decodeGatewayState(JSON.parse(await readFile(this.filePath, 'utf8')))
      this.data = decoded.data
      this.legacy = decoded.legacy
    } catch (error) {
      if (asString(asRecord(error).code) !== 'ENOENT') throw error
      this.data = freshGatewayState()
      this.legacy = undefined
    }
  }

  selectAccount(identity: YzjIdentity): string {
    if (this.legacy !== undefined && this.legacy.pending.length > 0) {
      throw new Error('Legacy Yunzhijia Agent state contains account-less pending tasks; refusing unsafe replay')
    }
    const key = accountKeyFor(identity)
    if (this.activeKey !== undefined && this.activeKey !== key) {
      throw new Error('Yunzhijia login account changed while Agent gateway is running')
    }
    let account = this.data.accounts[key]
    if (account === undefined) {
      account = {
        ...freshAccountState(identity),
        ...(this.legacy === undefined ? {} : this.legacy),
      }
      this.data.accounts[key] = account
      this.migrationPending = this.legacy !== undefined
      this.legacy = undefined
    } else {
      account.identity = identity
    }
    this.activeKey = key
    this.rebuildSeen()
    return key
  }

  cursor(groupId: string): string | undefined { return this.active().cursors[groupId] }
  setCursor(groupId: string, msgId: string): void { this.active().cursors[groupId] = msgId }
  seen(msgId: string): boolean { this.active(); return this.seenIds.has(msgId) }
  pendingTasks(): readonly YzjTrigger[] { return [...this.active().pending] }

  admit(trigger: YzjTrigger, time: number = Date.now()): boolean {
    if (trigger.route === undefined) throw new Error('Yunzhijia Agent task admission requires a v2 topic route')
    const account = this.active()
    if (this.seen(trigger.message.msgId)) return false
    this.markProcessed(trigger.message.msgId, time)
    account.pending.push(trigger)
    return true
  }

  complete(msgId: string): void {
    const account = this.active()
    account.pending = account.pending.filter(trigger => trigger.message.msgId !== msgId)
  }

  forget(msgId: string): void {
    const account = this.active()
    this.complete(msgId)
    account.processed = account.processed.filter(entry => entry.msgId !== msgId)
    this.seenIds.delete(msgId)
  }

  markProcessed(msgId: string, time: number = Date.now()): void {
    const account = this.active()
    if (this.seenIds.has(msgId)) return
    this.seenIds.add(msgId)
    account.processed.push({ msgId, time })
  }

  topicForMessage(groupId: string, msgId: string): string | undefined {
    return this.active().messageTopics[topicIndexKey(groupId, msgId)]
  }

  recordMessageTopic(groupId: string, msgId: string, topicRootId: string): void {
    if (msgId !== '') this.active().messageTopics[topicIndexKey(groupId, msgId)] = topicRootId
  }

  revoke(messageId: string): void {
    const account = this.active()
    if (!account.revoked.includes(messageId)) account.revoked.push(messageId)
  }

  /** False before an account is selected: an unknown task is never revoked. */
  isRevoked(messageId: string): boolean {
    if (this.activeKey === undefined) return false
    return this.active().revoked.includes(messageId)
  }

  managedTitle(sessionId: string): string | undefined {
    return this.active().managedTitles[sessionId]
  }

  setManagedTitle(sessionId: string, title: string): void {
    this.active().managedTitles[sessionId] = title
  }

  save(now: number = Date.now()): Promise<void> {
    const next = this.saving.catch(() => undefined).then(() => this.persist(now))
    this.saving = next
    return next
  }

  private active(): GatewayAccountStateData {
    if (this.activeKey === undefined) throw new Error('Yunzhijia Agent state has no selected account')
    const account = this.data.accounts[this.activeKey]
    if (account === undefined) throw new Error('Selected Yunzhijia Agent account state is missing')
    return account
  }

  private async persist(now: number): Promise<void> {
    for (const account of Object.values(this.data.accounts)) {
      const pendingIds = new Set(account.pending.map(trigger => trigger.message.msgId))
      const retained = account.processed
        .filter(entry => entry.time >= now - RETAIN_MS || pendingIds.has(entry.msgId))
      const pendingRows = retained.filter(entry => pendingIds.has(entry.msgId))
      const capacity = Math.max(0, MAX_PROCESSED - pendingRows.length)
      const recent = retained.filter(entry => !pendingIds.has(entry.msgId))
      const keptRecent = capacity === 0 ? [] : recent.slice(-capacity)
      const keptRecentIds = new Set(keptRecent.map(entry => entry.msgId))
      account.processed = retained.filter(entry => (
        pendingIds.has(entry.msgId) || keptRecentIds.has(entry.msgId)
      ))
      const topicEntries = Object.entries(account.messageTopics)
      if (topicEntries.length > MAX_TOPIC_INDEX) {
        account.messageTopics = Object.fromEntries(topicEntries.slice(-MAX_TOPIC_INDEX))
      }
      if (account.revoked.length > MAX_PROCESSED) {
        account.revoked = account.revoked.slice(-MAX_PROCESSED)
      }
    }
    this.rebuildSeen()
    await mkdir(dirname(this.filePath), { recursive: true })
    if (this.migrationPending) await this.backupLegacy()
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
    this.migrationPending = false
  }

  private async backupLegacy(): Promise<void> {
    try {
      await copyFile(this.filePath, `${this.filePath}.v1.bak`, constants.COPYFILE_EXCL)
    } catch (error) {
      const code = asString(asRecord(error).code)
      if (code !== 'ENOENT' && code !== 'EEXIST') throw error
    }
  }

  private rebuildSeen(): void {
    this.seenIds.clear()
    if (this.activeKey === undefined) return
    for (const entry of this.active().processed) this.seenIds.add(entry.msgId)
  }
}
