// @vitest-environment jsdom
/**
 * 一套卡的语法 (界面重设计 P3 · §5.2 · 律七 · 律八 · 律九).
 *
 * 这里锁的每一条都对应一种**安静地错**：
 *
 * - **号对不上**：桌面上按 1 是「确认」，手机上回 1 却是别的——两处各编各的号，迟早有一天
 *   对不上，而那一天按错的是一次写入。号只能从一张表来。
 * - **撤回窗漏了**：回答在窗里被撤回，图上却已经留下了一笔——那就不是撤回，是反悔。
 * - **出处说错**：在云之家答掉的卡，桌面写「你确认了」，人会以为自己在这里按过。
 * - **规矩自己长出来**：提议必须有据（连续同意、没拒过、不是强写、没有现成的规矩），
 *   签发必须是人——这里只验「提」，不提「签」。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YzjGraph } from '@yzj-next/graph'
import { YzjCards } from '@yzj-next/cards'
import {
  approvalCard, approvalFamily, leaseCard, leaseFamily, taskCard, taskFamily,
} from '@yzj-next/objects'
import type { TopicDescriptor } from '@yzj-next/channel'
import { autoHandled, cardsFor, rulesFor, RULE_STREAK } from '../src/rpc.ts'
import { CardRow } from '../src/client/CardRow.tsx'
import {
  dropAnsweredElsewhere, pressOnCard, resetAnswers, stage, stagedNow, undo, undoLatest, UNDO_MS,
  type Answer,
} from '../src/client/answers.ts'
import { answeringNow } from '../src/client/store.ts'
import { audienceRiskOf, registrationLine } from '../src/client/Composer.tsx'
import type { StreamCard } from '../src/client/rpc.ts'

const TOPIC: TopicDescriptor = {
  topicKey: 'yzj-topic-a', sessionId: 'session-a', placeKey: 'yzj-group-g1', groupId: 'g1',
  groupName: '产品讨论群', topicRootId: 'root-a', label: '竞品对比表', generation: 1,
  conversationKind: 'group',
}

let ctx: Context
let graph: YzjGraph
let cards: YzjCards

beforeEach(async () => {
  ctx = new Context()
  graph = new YzjGraph(ctx, { root: await mkdtemp(join(tmpdir(), 'yzj-next-p3-')) })
  for (const family of [approvalFamily, taskFamily, leaseFamily]) graph.defineFamily(family)
  await graph.selectAccount('acct-1')
  cards = new YzjCards(ctx)
  cards.register(approvalCard)
  cards.register(taskCard)
  cards.register(leaseCard)
  cards.setDesktopActor({ kind: 'operator', openId: 'op-1' }, '我')
  ctx.provide('yzjTopics', {
    topicOf: () => TOPIC,
    tree: () => [],
    messagesFor: async () => Promise.resolve([]),
    aliases: () => ['@next'],
    peers: () => [{ openId: 'p-li', name: '李婷' }],
  } as never)
})

afterEach(() => {
  resetAnswers()
  vi.useRealTimers()
})

let seq = 0
async function ask(
  status?: 'approved' | 'rejected',
  extra: { toolName?: string; level?: 'standard' | 'strong'; placeKey?: string } = {},
): Promise<string> {
  seq += 1
  const id = `ap-${String(seq)}`
  await graph.append({
    type: 'approval/opened',
    data: {
      approvalId: id, toolName: extra.toolName ?? 'yzj_sheet_record_create', reason: '云之家操作确认：写入表格记录',
      level: extra.level ?? 'standard', args: { table: '评审表', rows: 12 }, argsDigest: 'd', decider: 'op-1',
      deadline: Date.now() + 60_000, topicKey: TOPIC.topicKey, placeKey: extra.placeKey ?? TOPIC.placeKey,
      audience: [TOPIC.placeKey],
    },
    actor: { kind: 'agent' },
  })
  if (status !== undefined) {
    await graph.append({
      type: 'approval/decided',
      data: { approvalId: id, status, decidedBy: 'op-1' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
  }
  return id
}

const streamCard = (id: string): StreamCard => (
  cardsFor(ctx, TOPIC).find(card => card.id === id) as unknown as StreamCard
)

describe('号：桌面按 1 = 云之家里回 1', () => {
  it('确认卡：1 确认写入、2 先不写；号和字都由服务端编', async () => {
    const id = await ask()
    const card = streamCard(id)
    const numbered = card.actions.filter(action => action.n !== undefined).map(action => [action.n, action.label])
    expect(numbered).toEqual([[1, '确认写入'], [2, '先不写']])
  })

  it('作废不占号——按错一个数字就作废一件事，不是键盘该有的代价', async () => {
    await graph.append({
      type: 'task/opened',
      data: { taskId: 'tk-1', what: '拉三家竞品', topicKey: TOPIC.topicKey, sourceAnchor: 'yzj:m', operator: 'op-1' },
      actor: { kind: 'agent' },
    })
    await graph.append({ type: 'task/terminal', data: { taskId: 'tk-1', summary: '拉好了', artifacts: [] }, actor: { kind: 'agent' } })
    const card = streamCard('tk-1')
    expect(card.actions.filter(action => action.n !== undefined).map(action => action.id)).toEqual(['accept', 'reject'])
    expect(card.actions.find(action => action.id === 'void')?.secondary).toBe(true)
  })

  it('云之家里回「2 价格没定」= 第二个动词，后面是原因', async () => {
    const id = await ask()
    expect(cards.resolveKeyword({ kind: 'approval', id }, '2 价格没定')).toEqual({ actionId: 'reject', input: '价格没定' })
    expect(cards.resolveKeyword({ kind: 'approval', id }, '1')).toEqual({ actionId: 'approve' })
    const text = cards.renderText({ kind: 'approval', id })
    // 云之家里的号和桌面按钮同一个字：同一扇门不在两处叫两个名字。
    expect(text?.numbered).toEqual(['确认写入', '先不写'])
    // 卡上写什么，回什么就算什么。
    expect(cards.resolveKeyword({ kind: 'approval', id }, '确认写入')).toEqual({ actionId: 'approve' })
    expect(cards.resolveKeyword({ kind: 'approval', id }, '先不写 价格没定')).toEqual({ actionId: 'reject', input: '价格没定' })
  })
})

/*
  登记回执 (§5.3)：此前是一整张承诺卡，「张锐负责」说了两遍，却没说「明天」解析成了哪天。
*/
describe('登记回执', () => {
  it('一行：谁负责 · 什么事 · 原话 → 解析出的那天，旁边一个「改」', async () => {
    const now = new Date(2026, 9, 21, 10, 0).getTime()
    const card: StreamCard = {
      kind: 'commitment', id: 'c-1', at: now, seq: 1, resolved: false, actions: [],
      state: { what: '价格页数据', due: '明天下班前', status: 'open', executor: { kind: 'human', name: '张锐', openId: 'u-zr' } },
      dueAt: new Date(2026, 9, 22, 18, 0).getTime(),
    }
    const host = document.createElement('div')
    await act(async () => { createRoot(host).render(<CardRow card={card} now={now} answer={() => undefined} />) })
    expect(host.textContent).toContain('记下了：张锐负责 · 价格页数据 · 原话「明天下班前」 → 明天 18:00')
    expect(host.textContent?.match(/负责/gu)).toHaveLength(1)
    expect([...host.querySelectorAll('button')].map(button => button.textContent)).toEqual(['改'])
  })
})

describe('出处：在哪、由谁答的', () => {
  it('在云之家里答的，吸收行写「你在云之家里回了」', async () => {
    const id = await ask('approved')
    await graph.append({
      type: 'answer/recorded',
      data: { cardRef: { kind: 'approval', id }, actionId: 'approve', actor: 'op-1', via: 'yzj-text', outcome: 'applied' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    const card = streamCard(id)
    expect(card.answered).toMatchObject({ via: 'yzj-text', actionId: 'approve', label: '确认', mine: true })
    const host = document.createElement('div')
    await act(async () => { createRoot(host).render(<CardRow card={card} now={Date.now()} answer={() => undefined} />) })
    expect(host.textContent).toContain('你在云之家里回了「确认」')
  })

  it('别人答的写别人的名字；输掉的那一笔不算出处', async () => {
    const id = await ask('approved')
    await graph.append({
      type: 'answer/recorded',
      data: { cardRef: { kind: 'approval', id }, actionId: 'approve', actor: 'p-li', via: 'desktop', outcome: 'applied' },
      actor: { kind: 'operator', openId: 'p-li' },
    })
    await graph.append({
      type: 'answer/recorded',
      data: { cardRef: { kind: 'approval', id }, actionId: 'reject', actor: 'op-1', via: 'desktop', outcome: 'duplicate' },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    expect(streamCard(id).answered).toMatchObject({ mine: false, who: '李婷', actionId: 'approve' })
  })
})

describe('律九：规矩只在有据时提', () => {
  it(`同类同群连续同意 ${String(RULE_STREAK)} 次才提；一次拒绝就从头攒`, async () => {
    for (let i = 0; i < RULE_STREAK - 1; i += 1) await ask('approved')
    expect(streamCard(await ask()).ruleHint).toBeUndefined()
    await ask('approved')
    // 现在是 4 + 1 = 5 次同意（中间那张还没答，不算也不断）。
    const hint = streamCard(await ask()).ruleHint
    expect(hint).toMatchObject({ toolClass: 'sheet', placeKey: TOPIC.placeKey, placeName: '产品讨论群', streak: RULE_STREAK })
    await ask('rejected')
    expect(streamCard(await ask()).ruleHint).toBeUndefined()
  })

  it('强写永远不提；别的群的同意不算这里的', async () => {
    for (let i = 0; i < RULE_STREAK; i += 1) await ask('approved', { level: 'strong', toolName: 'yzj_sheet_table_delete' })
    for (let i = 0; i < RULE_STREAK; i += 1) await ask('approved', { placeKey: 'yzj-group-other' })
    expect(streamCard(await ask(undefined, { level: 'strong', toolName: 'yzj_sheet_table_delete' })).ruleHint).toBeUndefined()
    expect(streamCard(await ask()).ruleHint).toBeUndefined()
  })

  it('已经有一条等你签的规矩，就不再提第二次', async () => {
    for (let i = 0; i < RULE_STREAK; i += 1) await ask('approved')
    await graph.append({
      type: 'lease/proposed',
      data: {
        leaseId: 'lse-1', scope: { toolClass: 'sheet', placeKey: TOPIC.placeKey }, period: { from: 1, to: Date.now() + 1e9 },
        periodText: '30 天', family: 'write-confirm', decider: 'op-1', reason: 'x', idemKey: 'lease:lse-1',
      },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    expect(streamCard(await ask()).ruleHint).toBeUndefined()
  })
})

describe('规则面板：你签的规矩', () => {
  /** 一条租约走到某个状态：proposed，或由 `by` 签成 active。 */
  async function lease(id: string, placeKey: string | undefined, by?: string): Promise<void> {
    const scope = { toolClass: 'sheet', ...(placeKey === undefined ? {} : { placeKey }) }
    await graph.append({
      type: 'lease/proposed',
      data: {
        leaseId: id, scope, period: { from: 1, to: Date.now() + 3 * 86_400_000 },
        periodText: '30 天', family: 'write-confirm', decider: 'op-1', reason: '往表格里写不用每次问', idemKey: `lease:${id}`,
      },
      actor: { kind: 'operator', openId: 'op-1' },
    })
    if (by === undefined) return
    await graph.append({
      type: 'lease/granted',
      data: { leaseId: id, grantedBy: by, scope, periodText: '30 天', family: 'write-confirm' },
      actor: { kind: 'operator', openId: by },
    })
  }

  it('只列在这个群算数的；等你签的在前，其余按省了几次排；签的人说名字', async () => {
    // 放行账的族由工具包装；这里只要它的形状，所以用一张不校验的表。
    graph.defineFamily({
      kind: 'action',
      events: {
        'action/released': { schema: { parse: (data: unknown) => data } as never },
        'action/settled': { schema: { parse: (data: unknown) => data } as never },
      },
      objectIdOf: () => undefined,
      reduce: previous => previous ?? null,
    } as never)
    ctx.provide('yzjLeases', {} as never)
    await lease('l-here', TOPIC.placeKey, 'op-1')
    await lease('l-any', undefined, 'p-li')
    await lease('l-else', 'yzj-group-other', 'op-1')
    await lease('l-draft', TOPIC.placeKey)
    // 「替你省了几次」只数真办成了的：c3 没办成，它没替你省掉什么。
    for (const [callId, outcome] of [['c1', 'ok'], ['c2', 'ok'], ['c3', 'failed']] as const) {
      await graph.append({
        type: 'action/released',
        data: {
          sessionId: 's', callId, toolName: 'yzj_sheet_record_create', level: 'standard', argsDigest: 'd',
          authority: { kind: 'lease', leaseId: 'l-here', grantedBy: 'op-1' },
        },
        actor: { kind: 'agent' },
      })
      await graph.append({ type: 'action/settled', data: { sessionId: 's', callId, outcome, durationMs: 1 }, actor: { kind: 'agent' } })
    }
    const rows = rulesFor(ctx, TOPIC.placeKey)
    expect(rows.map(row => [row.leaseId, row.status, row.scoped, row.signedBy, row.saved])).toEqual([
      ['l-draft', 'proposed', true, undefined, 0],
      ['l-here', 'active', true, '你', 2],
      ['l-any', 'active', false, '李婷', 0],
    ])
  })

  it('没装租约族的部署：这一行空着，不去查一个不存在的族', () => {
    expect(rulesFor(ctx, TOPIC.placeKey)).toEqual([])
  })

  it('今天自己办了的：凭规矩或凭群里那句话、而且真办成了的写；人批的、没办成的不算', async () => {
    graph.defineFamily({
      kind: 'action',
      events: {
        'action/released': { schema: { parse: (data: unknown) => data } as never },
        'action/settled': { schema: { parse: (data: unknown) => data } as never },
      },
      objectIdOf: () => undefined,
      reduce: previous => previous ?? null,
    } as never)
    await lease('l-here', TOPIC.placeKey, 'op-1')
    const release = async (callId: string, authority: Record<string, string>, outcome: string): Promise<void> => {
      await graph.append({
        type: 'action/released',
        data: { sessionId: 's', callId, toolName: 'yzj_sheet_record_create', level: 'standard', argsDigest: 'd', authority, topicKey: TOPIC.topicKey },
        actor: { kind: 'agent' },
      })
      await graph.append({ type: 'action/settled', data: { sessionId: 's', callId, outcome, durationMs: 1 }, actor: { kind: 'agent' } })
    }
    await release('a1', { kind: 'lease', leaseId: 'l-here', grantedBy: 'op-1' }, 'ok')
    await release('a2', { kind: 'message', messageId: 'm-1', senderOpenId: 'p-li' }, 'ok')
    await release('a3', { kind: 'approval', approvalId: 'ap-1', decidedBy: 'op-1' }, 'ok')
    await release('a4', { kind: 'lease', leaseId: 'l-here', grantedBy: 'op-1' }, 'failed')
    // 你自己在群里叫它做的不算「没问你就办了」——那是你问过了。
    await release('a5', { kind: 'message', messageId: 'm-2', senderOpenId: 'op-1' }, 'ok')
    // 产出按调用对上：a1 写出了「竞品对比表」，同一分钟里 a2 写的是另一份——不再被说成同一份。
    for (const [callId, title] of [['a1', '竞品对比表'], ['a2', '周报汇总']] as const) {
      await graph.append({
        type: 'lineage/produced',
        data: {
          topicKey: TOPIC.topicKey, action: '新增表格记录', toolName: 'yzj_sheet_record_create', sessionId: 's', callId,
          artifact: { uri: `yzj://sheet/${callId}xxxxxx`, placeKey: 'yzj-sheet', kind: 'sheet', title },
        },
        actor: { kind: 'agent' },
      })
    }
    const rows = autoHandled(ctx, 0)
    expect(rows.map(row => row.what)).toEqual(['写表格「周报汇总」', '写表格「竞品对比表」'])
    expect(rows.map(row => row.by.kind)).toEqual(['message', 'lease'])
    expect(rows[0]?.by).toEqual({ kind: 'message', who: '李婷' })
    expect(rows[1]?.by).toMatchObject({ kind: 'lease', leaseId: 'l-here', active: true })
    expect((rows[1]?.by as { rule: string }).rule).toContain('往表格里新加东西不用每次问')
    expect(autoHandled(ctx, Date.now() + 60_000)).toEqual([])
  })
})

describe('撤回窗 (律七)', () => {
  const answer: Answer = { kind: 'approval', id: 'ap-x', steps: [{ actionId: 'approve' }], said: '你确认了' }

  it('5 秒后才落账；窗里撤回，什么都没发出去', async () => {
    vi.useFakeTimers()
    const commit = vi.fn(async () => Promise.resolve())
    stage(answer, commit)
    expect(answeringNow()).toEqual([{ kind: 'approval', id: 'ap-x' }])
    expect(undo(answer)).toBe(true)
    await vi.advanceTimersByTimeAsync(UNDO_MS + 100)
    expect(commit).not.toHaveBeenCalled()
    expect(answeringNow()).toEqual([])

    stage(answer, commit)
    await vi.advanceTimersByTimeAsync(UNDO_MS + 100)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(stagedNow()).toEqual([])
  })

  it('同一张卡在窗里再按一次不算第二次回答；Z 撤的是最近那一件', () => {
    const commit = vi.fn(async () => Promise.resolve())
    stage(answer, commit)
    stage({ ...answer, said: '又按了一次' }, commit)
    stage({ ...answer, id: 'ap-y' }, commit)
    expect(stagedNow().map(one => one.id)).toEqual(['ap-x', 'ap-y'])
    expect(undoLatest()?.id).toBe('ap-y')
    expect(stagedNow().map(one => one.id)).toEqual(['ap-x'])
  })

  it('别处先答了：本机这一份静静丢掉，不提交', async () => {
    vi.useFakeTimers()
    const commit = vi.fn(async () => Promise.resolve())
    stage(answer, commit)
    dropAnsweredElsewhere([{ kind: 'approval', id: 'ap-x' }])
    await vi.advanceTimersByTimeAsync(UNDO_MS + 100)
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('卡上的键 (律八)', () => {
  async function mount(card: StreamCard, onAnswer: (one: Answer) => void): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => { createRoot(host).render(<CardRow card={card} now={Date.now()} answer={onAnswer} />) })
    return host
  }

  it('数字键答当前这张；卡上写着「云之家里回 1 / 2 也行」', async () => {
    const id = await ask()
    const answers: Answer[] = []
    const host = await mount(streamCard(id), (one) => { answers.push(one) })
    expect(host.textContent).toContain('要你确认')
    expect(host.textContent).toContain('云之家里回 1 / 2 也行')
    // 按钮说清按下去的是什么：写表格是「确认写入 / 先不写」，不是光秃秃的「确认 / 取消」。
    const labels = [...host.querySelectorAll('button')].map(button => button.textContent ?? '')
    expect(labels).toContain('1确认写入')
    expect(labels).toContain('2先不写')
    await act(async () => { pressOnCard(`approval:${id}`, '1') })
    expect(answers[0]).toMatchObject({ kind: 'approval', id, said: '你确认了', steps: [{ actionId: 'approve' }] })
  })

  it('「下一件」只长在答过的卡下：窗里就出现，撤回后跟着消失', async () => {
    const id = await ask()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const render = async (): Promise<void> => {
      await act(async () => {
        root.render(<CardRow card={streamCard(id)} now={Date.now()} answer={() => undefined} next={{ need: undefined }} />)
      })
    }
    await render()
    expect(host.textContent).not.toContain('要你的都处理完了')
    await act(async () => {
      stage({ kind: 'approval', id, steps: [{ actionId: 'approve' }], said: '你确认了' }, async () => Promise.resolve())
    })
    await render()
    expect(host.textContent).toContain('秒后生效')
    expect(host.textContent).toContain('要你的都处理完了')
    await act(async () => { undo({ kind: 'approval', id }) })
    await render()
    expect(host.textContent).toContain('要你确认')
    expect(host.textContent).not.toContain('要你的都处理完了')
  })

  it('打回要就地写原因，写了才发得出去', async () => {
    await graph.append({
      type: 'task/opened',
      data: { taskId: 'tk-2', what: 'Q3 复盘材料', topicKey: TOPIC.topicKey, sourceAnchor: 'yzj:m', operator: 'op-1' },
      actor: { kind: 'agent' },
    })
    await graph.append({ type: 'task/terminal', data: { taskId: 'tk-2', summary: '初稿', artifacts: [] }, actor: { kind: 'agent' } })
    const answers: Answer[] = []
    const host = await mount(streamCard('tk-2'), (one) => { answers.push(one) })
    await act(async () => { pressOnCard('task:tk-2', '2') })
    const submit = host.querySelector('form button[type="submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    const input = host.querySelector('form input') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '缺第三节')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { submit.click() })
    expect(answers[0]?.steps[0]).toMatchObject({ actionId: 'reject', input: '缺第三节' })
  })

  it('交付是文件、一眼没看就通过：卡里多一行，给两个出口', async () => {
    await graph.append({
      type: 'task/opened',
      data: { taskId: 'tk-3', what: '出一版对比表', topicKey: TOPIC.topicKey, sourceAnchor: 'yzj:m', operator: 'op-1' },
      actor: { kind: 'agent' },
    })
    await graph.append({
      type: 'task/terminal',
      data: { taskId: 'tk-3', summary: '在附件里', artifacts: [{ uri: 'yzj://file/f-1', placeKey: TOPIC.placeKey, title: '对比表.xlsx' }] },
      actor: { kind: 'agent' },
    })
    const answers: Answer[] = []
    const host = await mount(streamCard('tk-3'), (one) => { answers.push(one) })
    await act(async () => { pressOnCard('task:tk-3', '1') })
    expect(answers).toHaveLength(0)
    expect(host.textContent).toContain('你还没打开交付的文件')
    const skip = [...host.querySelectorAll('button')].find(button => button.textContent === '不看，直接通过')
    await act(async () => { skip?.click() })
    expect(answers[0]?.steps[0]?.actionId).toBe('accept')
  })

  it('规矩提议那一行只是一扇门：点了交给调用方去起草，卡自己什么都不签', async () => {
    for (let i = 0; i < RULE_STREAK; i += 1) await ask('approved')
    const card = streamCard(await ask())
    const proposed: unknown[] = []
    const host = document.createElement('div')
    await act(async () => {
      createRoot(host).render(<CardRow card={card} now={Date.now()} answer={() => undefined} proposeRule={(hint) => { proposed.push(hint) }} />)
    })
    expect(host.textContent).toContain(`这类写入你已经连续确认 ${String(RULE_STREAK)} 次`)
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === '以后同类不用问')?.click() })
    expect(proposed).toEqual([card.ruleHint])
  })
})

describe('输入框：发出前说清会记成什么、谁听不见 (律四)', () => {
  it('登记预览用的是落库的同一个解析——认得出就说会记下什么，认不出就说不会', () => {
    expect(registrationLine('登记承诺：价格页数据，张锐负责，周五前', { name: '张锐' }))
      .toEqual({ line: '发出后会记下：张锐负责 · 价格页数据 · 原话「周五前」', ok: true })
    expect(registrationLine('张锐你看下', { name: '张锐' }).ok).toBe(false)
  })

  it('私下点了某人做某事才提醒；群里说、闲聊、没点名都不提醒', () => {
    expect(audienceRiskOf('张锐周五前把价格页补上', 'private', ['张锐', '李婷'])).toBe('张锐')
    expect(audienceRiskOf('张锐周五前把价格页补上', 'place', ['张锐'])).toBeUndefined()
    expect(audienceRiskOf('张锐这个想法不错', 'private', ['张锐'])).toBeUndefined()
    expect(audienceRiskOf('明天把价格页补上', 'private', ['张锐'])).toBeUndefined()
  })
})
