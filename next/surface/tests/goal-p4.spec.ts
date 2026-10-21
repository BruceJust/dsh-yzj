/**
 * 目标页 (界面重设计 P4 · §5.5).
 *
 * 两件安静地错的事：
 *
 * - **提示一多就没人看**：目标结束了底下还在跑、标准改过、云之家很久没对账、底下停摆——
 *   同时成立时，只说最重的那一句。
 * - **事实行替人下结论**：一行事实只放读得出来的数；只有逾期上色。
 */

import { describe, expect, it } from 'vitest'
import type { BoardRowWire, GoalPageWire } from '../src/client/rpc.ts'
import { goalFacts, goalHintOf } from '../src/client/GoalPage.tsx'
import { currentSpotlight, focusOf, setFrame, setSpotlight } from '../src/client/store.ts'

function row(input: Partial<BoardRowWire>): BoardRowWire {
  return {
    id: 'r', what: '一件事', executorKind: 'human', who: '张锐', overdue: false, status: 'open',
    remindable: true, direction: 'owed-to-me', signal: 'evidence', lastSignalAt: 0, inferredGoal: false,
    ...input,
  } as BoardRowWire
}

function page(input: {
  goal?: Partial<GoalPageWire['goal']>
  retired?: boolean
  pulse?: GoalPageWire['pulse']
  staleDays?: number
}): GoalPageWire {
  return {
    goal: {
      goalRef: 'https://yzj.example.com/doc/q3',
      row: row({ id: 'g', what: 'Q3 对账', who: '王五', due: { text: '季度末' } as never, isGoal: 'https://yzj.example.com/doc/q3' }),
      children: [],
      counts: { open: 0, overdue: 0, settled: 0 },
      artifacts: [],
      ...input.goal,
    },
    decisions: [],
    pulse: input.pulse ?? 'running',
    ...(input.staleDays === undefined ? {} : { staleDays: input.staleDays }),
    retired: input.retired ?? false,
    mySlice: [],
  }
}

describe('最多一条提示，按轻重', () => {
  it('says nothing when nothing is off', () => {
    expect(goalHintOf(page({}))).toBeUndefined()
  })

  it('a finished goal with work still running outranks everything else', () => {
    const hint = goalHintOf(page({
      retired: true,
      pulse: 'stalled',
      goal: {
        row: row({ id: 'g', what: 'Q3', status: 'voided' }),
        children: [row({ id: 'a' }), row({ id: 'b', status: 'closed' })],
        criteriaDrifted: true,
        truthSilentDays: 30,
      },
    }))
    expect(hint).toEqual({ kind: 'retired', open: 1, how: '作废' })
  })

  it('a finished goal with nothing left open is not a hint — the eyebrow says it', () => {
    expect(goalHintOf(page({ retired: true, goal: { children: [row({ status: 'closed' })] } }))).toBeUndefined()
  })

  it('drifted criteria outrank a silent document and a stall', () => {
    const hint = goalHintOf(page({ pulse: 'stalled', goal: { criteriaDrifted: true, truthSilentDays: 9 } }))
    expect(hint?.kind).toBe('drifted')
    expect((hint as { text: string }).text).toContain('旧版')
  })

  it('quotes what the agent saw when it noticed the change, not a guess', () => {
    const now = Date.UTC(2026, 9, 21)
    const hint = goalHintOf(page({ goal: { criteriaDrifted: true, truthChanged: { at: now - 2 * 86_400_000, detail: '第三条标准从 T+5 改成了 T+3' } } }), now)
    expect((hint as { text: string }).text).toContain('第三条标准从 T+5 改成了 T+3')
    expect((hint as { text: string }).text).toContain('2 天前')
  })

  it('a silent document under a week is a rhythm, not a hint', () => {
    expect(goalHintOf(page({ goal: { truthSilentDays: 6 } }))).toBeUndefined()
    expect(goalHintOf(page({ goal: { truthSilentDays: 7 } }))).toEqual({ kind: 'silent', days: 7 })
  })

  it('a stall is the last thing worth saying', () => {
    expect(goalHintOf(page({ pulse: 'stalled', staleDays: 4 }))).toEqual({ kind: 'stalled', days: 4 })
  })
})

describe('一行事实', () => {
  it('reads due · open · late · settled · last movement, and only lateness is coloured', () => {
    const facts = goalFacts(page({ staleDays: 2, goal: { counts: { open: 3, overdue: 1, settled: 2 } } }))
    expect(facts.map(fact => fact.text)).toEqual(['截止 季度末', '3 在跟', '1 逾期', '2 已结束', '最近动静 2 天前'])
    expect(facts.filter(fact => fact.late === true).map(fact => fact.text)).toEqual(['1 逾期'])
  })

  it('drops the counts that are zero; a goal with nothing under it says so instead of「0 在跟」', () => {
    expect(goalFacts(page({ goal: { row: undefined, counts: { open: 0, overdue: 0, settled: 0 } } })).map(fact => fact.text))
      .toEqual(['还没挂活'])
    expect(goalFacts(page({ goal: { row: undefined, counts: { open: 0, overdue: 0, settled: 3 } } })).map(fact => fact.text))
      .toEqual(['0 在跟', '3 已结束'])
  })

  it('an overdue goal turns its own due date red — unless it is already finished', () => {
    const late = row({ id: 'g', due: { text: '上周五' } as never, overdue: true })
    expect(goalFacts(page({ goal: { row: late } }))[0]).toEqual({ text: '截止 上周五', late: true })
    expect(goalFacts(page({ retired: true, goal: { row: late } }))[0]).toEqual({ text: '截止 上周五' })
  })
})

describe('右栏只问一处：focusOf (律六)', () => {
  const pick = { kind: 'commitment' as const, id: 'c-1', title: '一件事' }

  it('话题、群：产出 · 记忆 · 资料', () => {
    expect(focusOf({ kind: 'session' }, false, undefined)).toEqual({ kind: 'things' })
    expect(focusOf({ kind: 'place', placeKey: 'p', groupName: 'g' }, false, undefined)).toEqual({ kind: 'things' })
  })

  it('承诺、目标两屏没选中什么：收起，不摆上一屏留下的东西', () => {
    expect(focusOf({ kind: 'board' }, false, undefined)).toEqual({ kind: 'none' })
    expect(focusOf({ kind: 'goal', goalRef: 'g', goalName: 'G' }, false, undefined)).toEqual({ kind: 'none' })
  })

  it('选中一行：来龙去脉；并排看排在它前面——那是刚按下的那一下', () => {
    expect(focusOf({ kind: 'board' }, false, pick)).toEqual(pick)
    expect(focusOf({ kind: 'board' }, true, pick)).toEqual({ kind: 'preview' })
  })

  it('我定过的：私账那一棵树，别的一概不认', () => {
    expect(focusOf({ kind: 'judg' }, true, pick)).toEqual({ kind: 'judg' })
  })

  it('换一屏，上一屏选中的那一条一起退场', () => {
    setSpotlight(pick)
    setFrame({ kind: 'board' })
    expect(currentSpotlight()).toBeUndefined()
  })
})
