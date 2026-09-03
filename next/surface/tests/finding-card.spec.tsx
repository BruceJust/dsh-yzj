// @vitest-environment jsdom
/** 桌面上的裁决卡（发现）与交付推断提议卡：同一张提案卡的第三、四种脸——依据上卡、动词按模式亮。 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { CardRow } from '../src/client/CardRow.tsx'
import type { StreamCard } from '../src/client/rpc.ts'

async function rendered(node: React.ReactNode): Promise<{ text: string; host: HTMLElement }> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(node); await new Promise(resolve => setTimeout(resolve, 40)) })
  return { text: host.textContent ?? '', host }
}

const actions = (ids: readonly string[]): StreamCard['actions'] => ids.map(id => ({ id, label: id, needsInput: true, available: true }))

function card(kind: string, items: Record<string, unknown>[], extra: Record<string, unknown> = {}): StreamCard {
  return {
    kind: 'proposal', id: 'prp-1', resolved: false, at: 1, seq: 1,
    state: { proposalId: 'prp-1', kind, title: kind === 'finding' ? '7 月对账 · 2 处差异' : '这像是「给财务出费用明细」的交付——挂为交付回执？', items, decisions: {}, ...extra },
    actions: actions(['confirmed', 'rejected', 'held', 'transferred', 'settle']),
  }
}

describe('裁决卡 · 发现', () => {
  it('头上写「裁决卡 · 发现」，条目下面是依据；有转办栏与转办键，转办空名不发', async () => {
    const acted: unknown[] = []
    const { text, host } = await rendered(
      <CardRow card={card('finding', [{ what: '第 12 行不符', evidence: '对账单 L12' }, { what: '发票号缺失', evidence: '对账单 L88' }])} busy={false} act={(...args) => { acted.push(args) }} />,
    )
    expect(text).toContain('裁决卡 · 发现')
    expect(text).toContain('依据：对账单 L12')
    expect(text).not.toContain('登记发到')
    expect(text).toContain('确认 = 这条发现成立')
    const transfer = [...host.querySelectorAll('button')].find(button => button.textContent === '转办')
    expect(transfer?.disabled).toBe(true)
    const input = host.querySelector('input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '李四')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const armed = [...host.querySelectorAll('button')].find(button => button.textContent === '转办')
    expect(armed?.disabled).toBe(false)
    await act(async () => { armed?.click() })
    expect(acted).toEqual([['proposal', 'prp-1', 'transferred', '1 李四']])
  })
})

describe('交付推断提议卡', () => {
  it('头上写「交付推断 · 待确认」，第二个动词叫「不是交付」，没有挂起', async () => {
    const acted: unknown[] = []
    const { text, host } = await rendered(
      <CardRow card={card('delivery', [{ what: '给财务出费用明细', evidence: '费用明细.xlsx', commitmentId: 'cmt-1' }], { artifact: { msgId: 'm', fileId: 'f', name: '费用明细.xlsx', placeKey: 'p' } })} busy={false} act={(...args) => { acted.push(args) }} />,
    )
    expect(text).toContain('交付推断 · 待确认')
    expect(text).toContain('依据：费用明细.xlsx')
    const labels = [...host.querySelectorAll('button')].map(button => button.textContent)
    expect(labels).toContain('不是交付')
    expect(labels).not.toContain('挂起')
    expect(labels).not.toContain('转办')
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === '不是交付')?.click() })
    expect(acted).toEqual([['proposal', 'prp-1', 'rejected', '1']])
  })
})
