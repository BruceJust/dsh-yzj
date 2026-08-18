import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accountKeyFor, topicRouteFor } from '../src/protocol.ts'
import { GatewayState } from '../src/state.ts'
import type { YzjIdentity } from '../src/types.ts'

const IDENTITY: YzjIdentity = { orgId: 'org-1', openId: 'agent-self', name: 'Agent' }

async function loadState(file: string, identity: YzjIdentity = IDENTITY): Promise<GatewayState> {
  const state = new GatewayState(file)
  await state.load()
  state.selectAccount(identity)
  return state
}

describe('GatewayState', () => {
  it('persists conversation cursors and processed-message dedupe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-state-'))
    const file = join(directory, 'nested', 'state.json')
    const first = await loadState(file)
    first.setCursor('group-1', 'msg-3')
    first.markProcessed('msg-2', 100)
    await first.save(100)

    const second = await loadState(file)
    expect(second.cursor('group-1')).toBe('msg-3')
    expect(second.seen('msg-2')).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 2 })
  })

  it('persists revocations and reads v2 files written without the revoked field', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-state-'))
    const file = join(directory, 'state.json')
    // A pre-revocation v2 file has no `revoked` key in its account partition.
    await writeFile(file, JSON.stringify({
      version: 2,
      accounts: {
        [accountKeyFor(IDENTITY)]: {
          identity: IDENTITY, cursors: {}, processed: [], pending: [],
          messageTopics: {}, managedTitles: {},
        },
      },
    }))

    const first = await loadState(file)
    expect(first.isRevoked('task-1')).toBe(false)
    first.revoke('task-1')
    first.revoke('task-1')
    expect(first.isRevoked('task-1')).toBe(true)
    await first.save()

    const second = await loadState(file)
    expect(second.isRevoked('task-1')).toBe(true)
    expect(second.isRevoked('task-2')).toBe(false)
    const stored = JSON.parse(await readFile(file, 'utf8')) as {
      accounts: Record<string, { revoked: string[] }>
    }
    expect(stored.accounts[accountKeyFor(IDENTITY)]?.revoked).toEqual(['task-1'])
  })

  it('is never revoked before an account is selected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-state-'))
    const state = new GatewayState(join(directory, 'missing.json'))
    await state.load()
    expect(state.isRevoked('task-1')).toBe(false)
  })

  it('retains admitted tasks until terminal delivery completes them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-state-'))
    const file = join(directory, 'state.json')
    const message = {
      content: '@agent 处理任务', fromOpenId: 'user-1', msgId: 'msg-pending',
      msgType: 'text', sendTime: '2099-01-01 00:00:00.000', param: {},
    }
    const group = {
      groupId: 'group-1', groupName: '研发群', groupType: 2, lastMsgId: message.msgId,
      lastMsgSendTime: message.sendTime, lastMsg: message,
    }
    const trigger = {
      group,
      message,
      context: [message],
      prompt: '[用户任务]\n处理任务',
      route: topicRouteFor(IDENTITY, group, message, [message]),
    }
    const first = await loadState(file)
    expect(first.admit(trigger)).toBe(true)
    await first.save()

    const recovered = await loadState(file)
    expect(recovered.pendingTasks()).toHaveLength(1)
    expect(recovered.seen(message.msgId)).toBe(true)
    recovered.complete(message.msgId)
    await recovered.save()

    const completed = await loadState(file)
    expect(completed.pendingTasks()).toEqual([])
    expect(completed.seen(message.msgId)).toBe(true)
  })

  it('never evicts a pending task id from processed-message dedupe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-state-'))
    const file = join(directory, 'state.json')
    const state = await loadState(file)
    const message = {
      content: '@agent 长任务', fromOpenId: 'user-1', msgId: 'pending-old',
      msgType: 'text', sendTime: '2099-01-01 00:00:00.000', param: {},
    }
    const group = {
      groupId: 'group-1', groupName: '研发群', groupType: 2,
      lastMsgId: message.msgId, lastMsgSendTime: message.sendTime, lastMsg: message,
    }
    state.admit({
      group, message, context: [message], prompt: '长任务',
      route: topicRouteFor(IDENTITY, group, message, [message]),
    }, 1)
    for (let index = 0; index < 2_000; index += 1) {
      state.markProcessed(`recent-${String(index)}`, 100)
    }
    await state.save(100)

    const stored = JSON.parse(await readFile(file, 'utf8')) as {
      accounts: Record<string, { processed: { msgId: string }[] }>
    }
    const processed = stored.accounts[accountKeyFor(IDENTITY)]?.processed ?? []
    expect(processed).toHaveLength(2_000)
    expect(processed.some(entry => entry.msgId === 'pending-old')).toBe(true)
  })

  it('migrates v1 into the selected account and preserves a backup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-state-'))
    const file = join(directory, 'state.json')
    await writeFile(file, JSON.stringify({
      version: 1,
      cursors: { 'group-1': 'msg-3' },
      processed: [{ msgId: 'msg-2', time: 100 }],
      pending: [],
    }))

    const state = await loadState(file)
    await state.save(100)

    expect(state.cursor('group-1')).toBe('msg-3')
    expect(state.seen('msg-2')).toBe(true)
    expect(JSON.parse(await readFile(`${file}.v1.bak`, 'utf8'))).toMatchObject({ version: 1 })
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 2 })
  })

  it('rejects account changes and unknown state versions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yzj-agent-state-'))
    const state = await loadState(join(directory, 'missing.json'))
    expect(state.cursor('group-1')).toBeUndefined()
    expect(state.seen('msg-1')).toBe(false)
    expect(() => state.selectAccount({ orgId: 'org-2', openId: 'other', name: 'Other' }))
      .toThrow('login account changed')

    const unsupported = join(directory, 'unsupported.json')
    await writeFile(unsupported, JSON.stringify({ version: 99 }))
    await expect(new GatewayState(unsupported).load()).rejects.toThrow('Unsupported Yunzhijia Agent state version')

    const wrongKey = join(directory, 'wrong-key.json')
    await writeFile(wrongKey, JSON.stringify({
      version: 2,
      accounts: {
        'yzj-account-wrong': {
          identity: IDENTITY, cursors: {}, processed: [], pending: [],
          messageTopics: {}, managedTitles: {},
        },
      },
    }))
    await expect(new GatewayState(wrongKey).load()).rejects.toThrow('partition key')

    const legacyPending = join(directory, 'legacy-pending.json')
    const message = {
      content: '@agent 危险重放', fromOpenId: 'user-1', msgId: 'legacy-task',
      msgType: 'text', sendTime: '2099-01-01 00:00:00.000', param: {},
    }
    const group = {
      groupId: 'group-1', groupName: '研发群', groupType: 2,
      lastMsgId: message.msgId, lastMsgSendTime: message.sendTime, lastMsg: message,
    }
    const missingRoute = join(directory, 'missing-route.json')
    await writeFile(missingRoute, JSON.stringify({
      version: 2,
      accounts: {
        [accountKeyFor(IDENTITY)]: {
          identity: IDENTITY, cursors: {}, processed: [],
          pending: [{ group, message, context: [message], prompt: '执行' }],
          messageTopics: {}, managedTitles: {},
        },
      },
    }))
    await expect(new GatewayState(missingRoute).load()).rejects.toThrow('no valid route')

    const route = topicRouteFor(IDENTITY, group, message, [message])
    const unjournaled = join(directory, 'unjournaled-pending.json')
    const account = {
      identity: IDENTITY, cursors: {}, processed: [],
      pending: [{ group, message, context: [message], prompt: '执行', route }],
      messageTopics: {}, managedTitles: {},
    }
    await writeFile(unjournaled, JSON.stringify({
      version: 2, accounts: { [accountKeyFor(IDENTITY)]: account },
    }))
    await expect(new GatewayState(unjournaled).load()).rejects.toThrow('exactly once in processed')

    const duplicate = join(directory, 'duplicate-pending.json')
    await writeFile(duplicate, JSON.stringify({
      version: 2,
      accounts: {
        [accountKeyFor(IDENTITY)]: {
          ...account,
          processed: [{ msgId: message.msgId, time: Date.now() }],
          pending: [account.pending[0], account.pending[0]],
        },
      },
    }))
    await expect(new GatewayState(duplicate).load()).rejects.toThrow('duplicate message id')

    await writeFile(legacyPending, JSON.stringify({
      version: 1, cursors: {}, processed: [],
      pending: [{ group, message, context: [message], prompt: '执行' }],
    }))
    const legacy = new GatewayState(legacyPending)
    await legacy.load()
    expect(() => legacy.selectAccount(IDENTITY)).toThrow('refusing unsafe replay')
  })
})
