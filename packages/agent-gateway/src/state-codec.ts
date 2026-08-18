import {
  accountKeyFor, asRecord, asString, parseGroup, parseMessage, topicRouteFor,
} from './protocol.ts'
import type {
  GatewayAccountStateData, GatewayStateData, YzjIdentity, YzjMessage, YzjTopicRoute, YzjTrigger,
} from './types.ts'

export interface LegacyGatewayAccountData {
  cursors: Record<string, string>
  processed: { msgId: string; time: number }[]
  pending: YzjTrigger[]
}

export interface DecodedGatewayState {
  data: GatewayStateData
  legacy?: LegacyGatewayAccountData
}

function corrupt(detail: string): never {
  throw new Error(`Invalid Yunzhijia Agent state: ${detail}`)
}

function requireRecord(value: unknown, detail: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return corrupt(detail)
  return value as Record<string, unknown>
}

function requireArray(value: unknown, detail: string): unknown[] {
  if (!Array.isArray(value)) return corrupt(detail)
  return value
}

export function freshGatewayState(): GatewayStateData {
  return { version: 2, accounts: {} }
}

export function freshAccountState(identity: YzjIdentity): GatewayAccountStateData {
  return {
    identity,
    cursors: {},
    processed: [],
    pending: [],
    messageTopics: {},
    managedTitles: {},
    revoked: [],
  }
}

function parseIdentity(value: unknown): YzjIdentity | undefined {
  const raw = asRecord(value)
  const orgId = asString(raw.orgId)
  const openId = asString(raw.openId)
  const name = asString(raw.name)
  if (orgId === '' || openId === '') return undefined
  return { orgId, openId, name: name || openId }
}

function parseRoute(
  value: unknown,
  group: NonNullable<ReturnType<typeof parseGroup>>,
  message: YzjMessage,
  context: readonly YzjMessage[],
): YzjTopicRoute | undefined {
  const raw = asRecord(value)
  const accountKey = asString(raw.accountKey)
  const accountOrgId = asString(raw.accountOrgId)
  const accountOpenId = asString(raw.accountOpenId)
  const conversationKind = raw.conversationKind === 'direct'
    ? 'direct'
    : raw.conversationKind === 'group' ? 'group' : undefined
  const channelKey = asString(raw.channelKey)
  const topicRootId = asString(raw.topicRootId)
  const topicKey = asString(raw.topicKey)
  const sessionId = asString(raw.sessionId)
  const title = asString(raw.title)
  if ([accountKey, accountOrgId, accountOpenId, channelKey, topicRootId, topicKey, sessionId, title].includes('')
    || conversationKind === undefined) return undefined
  const enriched = topicRouteFor(
    { orgId: accountOrgId, openId: accountOpenId }, group, message, context, topicRootId,
  )
  return {
    accountKey, accountOrgId, accountOpenId, conversationKind,
    groupId: enriched.groupId,
    groupName: enriched.groupName,
    channelKey, topicRootId, topicKey,
    topicLabel: enriched.topicLabel,
    sessionId, title,
  }
}

function parseTrigger(value: unknown): YzjTrigger | undefined {
  const raw = asRecord(value)
  const group = parseGroup(raw.group)
  const message = parseMessage(raw.message)
  const prompt = asString(raw.prompt)
  if (group === undefined || message === undefined || prompt === '' || !Array.isArray(raw.context)) {
    return undefined
  }
  const context: YzjMessage[] = []
  for (const entry of raw.context) {
    const parsed = parseMessage(entry)
    if (parsed === undefined) return undefined
    context.push(parsed)
  }
  const route = parseRoute(raw.route, group, message, context)
  return { group, message, context, prompt, ...(route === undefined ? {} : { route }) }
}

function parseStringRecord(value: unknown, detail: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(requireRecord(value, detail))) {
    if (key === '' || typeof entry !== 'string' || entry === '') return corrupt(detail)
    result[key] = entry
  }
  return result
}

// Absent in v2 files written before revocations moved into gateway state.
function parseRevoked(value: unknown): string[] {
  if (value === undefined) return []
  return requireArray(value, 'revoked must be an array').map((entry) => {
    if (typeof entry !== 'string' || entry === '') return corrupt('revoked entries must be non-empty strings')
    return entry
  })
}

function parseProcessed(value: unknown): { msgId: string; time: number }[] {
  return requireArray(value, 'processed must be an array').map((entry) => {
    const row = requireRecord(entry, 'processed row must be an object')
    const msgId = asString(row.msgId)
    const time = row.time
    if (msgId === '' || typeof time !== 'number' || !Number.isFinite(time)) {
      return corrupt('processed row has invalid msgId or time')
    }
    return { msgId, time }
  })
}

function parsePending(value: unknown, requireRoute: boolean): YzjTrigger[] {
  return requireArray(value, 'pending must be an array').map((entry) => {
    const parsed = parseTrigger(entry)
    if (parsed === undefined) return corrupt('pending task is malformed')
    if (requireRoute && parsed.route === undefined) return corrupt('v2 pending task has no valid route')
    return parsed
  })
}

function parseAccount(value: unknown): GatewayAccountStateData {
  const raw = requireRecord(value, 'account partition must be an object')
  const identity = parseIdentity(raw.identity)
  if (identity === undefined) return corrupt('account partition has invalid identity')
  const processed = parseProcessed(raw.processed)
  const pending = parsePending(raw.pending, true)
  const processedCounts = new Map<string, number>()
  for (const row of processed) {
    processedCounts.set(row.msgId, (processedCounts.get(row.msgId) ?? 0) + 1)
  }
  const pendingIds = new Set<string>()
  const expectedKey = accountKeyFor(identity)
  for (const trigger of pending) {
    if (pendingIds.has(trigger.message.msgId)) {
      return corrupt('v2 pending contains a duplicate message id')
    }
    pendingIds.add(trigger.message.msgId)
    if (processedCounts.get(trigger.message.msgId) !== 1) {
      return corrupt('v2 pending message id must appear exactly once in processed')
    }
    const route = trigger.route
    const expected = route === undefined ? undefined : topicRouteFor(
      identity, trigger.group, trigger.message, trigger.context, route.topicRootId,
    )
    if (route === undefined || expected === undefined || route.accountKey !== expectedKey
      || route.accountOrgId !== identity.orgId || route.accountOpenId !== identity.openId
      || route.conversationKind !== expected.conversationKind
      || route.channelKey !== expected.channelKey || route.topicKey !== expected.topicKey
      || route.sessionId !== expected.sessionId) {
      return corrupt('pending route does not match its account partition')
    }
  }
  return {
    identity,
    cursors: parseStringRecord(raw.cursors, 'cursors must contain non-empty strings'),
    processed,
    pending,
    messageTopics: parseStringRecord(raw.messageTopics, 'messageTopics must contain non-empty strings'),
    managedTitles: parseStringRecord(raw.managedTitles, 'managedTitles must contain non-empty strings'),
    revoked: parseRevoked(raw.revoked),
  }
}

export function decodeGatewayState(value: unknown): DecodedGatewayState {
  const raw = requireRecord(value, 'root must be an object')
  if (raw.version === 1) {
    return {
      data: freshGatewayState(),
      legacy: {
        cursors: parseStringRecord(raw.cursors, 'legacy cursors must contain non-empty strings'),
        processed: parseProcessed(raw.processed),
        pending: parsePending(raw.pending, false),
      },
    }
  }
  if (raw.version !== 2) throw new Error(`Unsupported Yunzhijia Agent state version: ${String(raw.version)}`)
  const accounts: Record<string, GatewayAccountStateData> = {}
  for (const [key, value] of Object.entries(requireRecord(raw.accounts, 'accounts must be an object'))) {
    const account = parseAccount(value)
    if (key === '' || key !== accountKeyFor(account.identity)) {
      return corrupt('account partition key does not match its identity')
    }
    accounts[key] = account
  }
  return { data: { version: 2, accounts } }
}
