// @vitest-environment jsdom
/**
 * 桌面上的裁决卡（发现）与交付推断提议卡：同一张提案卡的第三、四种脸——依据上卡、动词按模式亮。
 *
 * 逐条裁决是「选满了才定下」(界面重设计 §5.2)：每一条先选，「定下这 N 处」一窗提交——
 * 此前每按一下就落一笔，三条要定的事，第一条按下去它就已经发出去了。
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { CardRow } from '../src/client/CardRow.tsx'
import { pressOnCard, resetAnswers, type Answer } from '../src/client/answers.ts'
import type { StreamCard } from '../src/client/rpc.ts'

async function rendered(node: React.ReactNode): Promise<{ text: () => string; host: HTMLElement }> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(node); await new Promise(resolve => setTimeout(resolve, 20)) })
  return { text: () => host.textContent ?? '', host }
}

const actions = (ids: readonly string[]): StreamCard['actions'] => ids.map(id => ({
  id, label: id, needsInput: true, available: true, ...(id === 'settle' ? { secondary: true } : {}),
}))

function card(kind: string, items: Record<string, unknown>[], extra: Record<string, unknown> = {}): StreamCard {
  return {
    kind: 'proposal', id: 'prp-1', resolved: false, at: 1, seq: 1,
    state: { proposalId: 'prp-1', kind, title: kind === 'finding' ? '7 月对账 · 2 处差异' : '这像是「给财务出费用明细」的交付——挂为交付回执？', items, decisions: {}, ...extra },
    actions: actions(['confirmed', 'rejected', 'held', 'transferred', 'settle']),
  }
}

const buttons = (host: HTMLElement): HTMLButtonElement[] => [...host.querySelectorAll('button')]
/** 胶囊上当前那一条带着号（「3转办」），按字尾认。 */
const pill = (host: HTMLElement, label: string, nth = 0): HTMLButtonElement | undefined => (
  buttons(host).filter(button => (button.textContent ?? '').endsWith(label))[nth]
)

afterEach(() => { resetAnswers() })

describe('裁决卡 · 发现', () => {
  it('条目下面是依据；转办要写名字才定得下；定下时一窗提交每一条', async () => {
    const answers: Answer[] = []
    const { text, host } = await rendered(
      <CardRow card={card('finding', [{ what: '第 12 行不符', evidence: '对账单 L12' }, { what: '发票号缺失', evidence: '对账单 L88' }])} now={10} answer={(one) => { answers.push(one) }} />,
    )
    expect(text()).toContain('依据：对账单 L12')
    expect(text()).not.toContain('登记发到')
    await act(async () => { pill(host, '转办', 0)?.click() })
    await act(async () => { pill(host, '驳回', 1)?.click() })
    const submit = (): HTMLButtonElement | undefined => buttons(host).find(button => (button.textContent ?? '').startsWith('定下这'))
    expect(submit()?.disabled).toBe(true)
    const input = host.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '李四')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(submit()?.disabled).toBe(false)
    await act(async () => { submit()?.click() })
    expect(answers).toHaveLength(1)
    expect(answers[0]?.steps).toEqual([
      { actionId: 'transferred', input: '1 李四' },
      { actionId: 'rejected', input: '2' },
    ])
  })
})

describe('交付推断提议卡', () => {
  it('第二个动词叫「不是交付」，没有挂起、没有转办', async () => {
    const answers: Answer[] = []
    const { host } = await rendered(
      <CardRow card={card('delivery', [{ what: '给财务出费用明细', evidence: '费用明细.xlsx', commitmentId: 'cmt-1' }], { artifact: { msgId: 'm', fileId: 'f', name: '费用明细.xlsx', placeKey: 'p' } })} now={10} answer={(one) => { answers.push(one) }} />,
    )
    const labels = buttons(host).map(button => button.textContent ?? '')
    expect(labels.some(label => label.endsWith('不是交付'))).toBe(true)
    expect(labels.some(label => label.endsWith('挂起'))).toBe(false)
    expect(labels.some(label => label.endsWith('转办'))).toBe(false)
    await act(async () => { pill(host, '不是交付')?.click() })
    await act(async () => { buttons(host).find(button => (button.textContent ?? '').startsWith('定下这 1 处'))?.click() })
    expect(answers[0]?.steps).toEqual([{ actionId: 'rejected', input: '1' }])
  })
})

describe('逐条定的卡 · 键盘', () => {
  it('数字答当前这一条并跳到下一条没答的；J/K 在条之间走，选过的能回去改；到头交还给中栏', async () => {
    const answers: Answer[] = []
    await rendered(
      <CardRow card={card('finding', [{ what: 'A' }, { what: 'B' }, { what: 'C' }])} now={10} answer={(one) => { answers.push(one) }} />,
    )
    const press = async (key: string): Promise<boolean> => {
      let taken = false
      await act(async () => { taken = pressOnCard('proposal:prp-1', key) })
      return taken
    }
    expect(await press('k')).toBe(false) // 光标在第一条：往上走交还给中栏，去上一张卡
    expect(await press('1')).toBe(true) // A ← 1，光标跳到 B
    expect(await press('j')).toBe(true) // 跳过 B，到 C
    expect(await press('2')).toBe(true) // C ← 2，光标回到唯一没答的 B
    expect(await press('k')).toBe(true) // 回到 A
    expect(await press('2')).toBe(true) // A 改成 2，光标跳到 B
    expect(await press('1')).toBe(true) // B ← 1
    expect(await press('Enter')).toBe(true)
    // 第 N 条记作 input N：A 改过一次落在 2（驳回），B 是 1（确认），C 是 2。
    expect(answers[0]?.steps).toEqual([
      { actionId: 'rejected', input: '1' },
      { actionId: 'confirmed', input: '2' },
      { actionId: 'rejected', input: '3' },
    ])
  })
})
