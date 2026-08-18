import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { YzjGatewayClient } from '../src/client.ts'
import type { YzjGroup, YzjMessage } from '../src/types.ts'

function message(msgId: string, content: string, param: YzjMessage['param'] = {}): YzjMessage {
  return {
    msgId, content, param, fromOpenId: 'user-1', msgType: 'text',
    sendTime: `2099-01-01 00:00:0${msgId.length}.000`,
  }
}

function group(groupType: number, last: YzjMessage): YzjGroup {
  return {
    groupId: 'group-1', groupName: groupType === 1 ? '张三' : '研发群', groupType,
    lastMsgId: last.msgId, lastMsgSendTime: last.sendTime, lastMsg: last,
  }
}

function clientFor(handler: (args: readonly string[]) => unknown): YzjGatewayClient {
  return new YzjGatewayClient({
    yzjBridge: {
      run: async (args: readonly string[]) => ({
        ok: true, stdout: '', stderr: '', exitCode: 0, json: handler(args),
      }),
    },
  } as unknown as Context, 5_000)
}

describe('YzjGatewayClient topic context', () => {
  it('pages backward to the root and excludes unrelated group messages', async () => {
    const root = message('root', '话题根')
    const reply = message('reply', '第一次回复', { replyMsgId: 'root', replyRootMsgId: 'root' })
    const unrelated = message('other', '另一个话题')
    const trigger = message('trigger', '@agent 总结', { replyMsgId: 'reply', replyRootMsgId: 'root' })
    const client = clientFor((args) => {
      const type = args[args.indexOf('--type') + 1]
      if (type === 'newest') return { list: [reply, unrelated, trigger], more: true }
      if (type === 'old') return { list: [root], more: false }
      throw new Error(`unexpected message type ${String(type)}`)
    })

    const context = await client.contextFor(group(2, trigger), trigger, 20, 'root')

    expect(context.map(item => item.msgId)).toEqual(['root', 'reply', 'trigger'])
  })

  it('resolves nested parent chains when replyRootMsgId is absent', async () => {
    const root = message('root', '话题根')
    const parent = message('parent', '父回复', { replyMsgId: 'root' })
    const trigger = message('trigger', '@agent 继续', { replyMsgId: 'parent' })
    const client = clientFor(() => ({ list: [root, parent, trigger], more: false }))

    const context = await client.contextFor(group(2, trigger), trigger, 20, 'root')

    expect(context.map(item => item.msgId)).toEqual(['root', 'parent', 'trigger'])
  })

  it('continues paging when a found parent points to an older root', async () => {
    const root = message('root', '跨页根消息')
    const parent = message('parent', '跨页父回复', { replyMsgId: 'root' })
    const trigger = message('trigger', '@agent 跨页继续', { replyMsgId: 'parent' })
    let oldCalls = 0
    const client = clientFor((args) => {
      const type = args[args.indexOf('--type') + 1]
      if (type === 'newest') return { list: [trigger], more: true }
      oldCalls += 1
      return oldCalls === 1
        ? { list: [parent], more: true }
        : { list: [root], more: false }
    })

    const context = await client.contextFor(group(2, trigger), trigger, 20, 'parent')

    expect(oldCalls).toBe(2)
    expect(context.map(item => item.msgId)).toEqual(['root', 'parent', 'trigger'])
  })

  it('uses durable reply mappings when the parent is outside history', async () => {
    const trigger = message('trigger', '@agent 继续', { replyMsgId: 'agent-final' })
    const client = clientFor((args) => {
      const type = args[args.indexOf('--type') + 1]
      return type === 'newest'
        ? { list: [trigger], more: true }
        : { list: [], more: false }
    })

    const context = await client.contextFor(
      group(2, trigger), trigger, 20, 'root',
      (_groupId, messageId) => messageId === 'agent-final' ? 'root' : undefined,
    )

    expect(context.map(item => item.msgId)).toEqual(['trigger'])
  })

  it('keeps a bounded direct-chat window only through the trigger', async () => {
    const before = message('before', '前文')
    const trigger = message('trigger', '@agent 回答')
    const later = message('later', '之后发送')
    const client = clientFor((args) => {
      const type = args[args.indexOf('--type') + 1]
      return type === 'newest'
        ? { list: [later], more: true }
        : { list: [before], more: false }
    })

    const context = await client.contextFor(group(1, later), trigger, 20, 'direct')

    expect(context.map(item => item.msgId)).toEqual(['before', 'trigger'])
  })

  it('pages backward for fresh command discovery independently of context size', async () => {
    const trigger = message('trigger', '@agent 较早命令')
    const later = message('later', '后续普通消息')
    let oldCalls = 0
    const client = clientFor((args) => {
      const type = args[args.indexOf('--type') + 1]
      if (type === 'newest') return { list: [later], more: true }
      oldCalls += 1
      return { list: [trigger], more: false }
    })

    const batch = await client.messagesSince(
      'group-1', Date.parse('2098-12-31T00:00:00.000'), 3,
    )

    expect(oldCalls).toBe(1)
    expect(batch.truncated).toBe(false)
    expect(batch.messages.map(item => item.msgId)).toEqual(['trigger', 'later'])
  })

  it('returns a continuation anchor when discovery exhausts its page budget', async () => {
    const later = message('later', '后续普通消息')
    const trigger = message('trigger', '@agent 较早命令')
    const client = clientFor((args) => {
      const type = args[args.indexOf('--type') + 1]
      return type === 'newest'
        ? { list: [later], more: true }
        : { list: [trigger], more: false }
    })
    const cutoff = Date.parse('2098-12-31T00:00:00.000')

    const first = await client.messagesSince('group-1', cutoff, 1)
    const second = await client.messagesSince('group-1', cutoff, 1, first.nextAnchor)

    expect(first).toMatchObject({ truncated: true, nextAnchor: 'later' })
    expect(second.truncated).toBe(false)
    expect(second.messages.map(item => item.msgId)).toEqual(['trigger'])
  })

  it('blocks replies after the pinned Yunzhijia account changes', async () => {
    let openId = 'agent-self'
    let sends = 0
    const ctx = {
      yzjBridge: {
        run: async (args: readonly string[]) => {
          if (args[0] === 'contact') {
            return {
              ok: true, exitCode: 0, stdout: '', stderr: '',
              json: [{ orgId: 'org-1', openId, name: 'Agent' }],
            }
          }
          sends += 1
          return { ok: true, exitCode: 0, stdout: '', stderr: '', json: { msgId: 'sent' } }
        },
      },
    } as unknown as Context
    const client = new YzjGatewayClient(ctx, 5_000)
    client.pinIdentity({ orgId: 'org-1', openId: 'agent-self' })
    openId = 'other-account'

    await expect(client.reply('group-1', 'message-1', 'reply')).rejects.toThrow('login account changed')
    expect(sends).toBe(0)
  })

  it('checks the task lease immediately before sending a reply', async () => {
    let sends = 0
    const ctx = {
      yzjBridge: {
        run: async (args: readonly string[]) => {
          if (args[0] === 'contact') {
            return {
              ok: true, exitCode: 0, stdout: '', stderr: '',
              json: [{ orgId: 'org-1', openId: 'agent-self', name: 'Agent' }],
            }
          }
          sends += 1
          return { ok: true, exitCode: 0, stdout: '', stderr: '', json: { msgId: 'sent' } }
        },
      },
    } as unknown as Context
    const client = new YzjGatewayClient(ctx, 5_000)
    client.pinIdentity({ orgId: 'org-1', openId: 'agent-self' })

    await expect(client.reply('group-1', 'message-1', 'reply', () => {
      throw new Error('lease revoked')
    })).rejects.toThrow('lease revoked')
    expect(sends).toBe(0)
  })
})
