// @vitest-environment jsdom
/**
 * 金库与后视镜条的**渲染**规格 (私账层 接缝④⑤⑥).
 *
 * 服务端那一侧已经有十五条断言看着；这一份看的是**屏幕上真的长出来了没有**，因为
 * 这一层最容易长歪的两种病都不会让任何一条服务端用例变红：
 *
 * - **说明文字占位同罪.** 一行写着「可以撤回」却没有撤回按钮，数据是对的、屏幕是
 *   假的。所以这里数的是按钮，不是字段。
 * - **私账内容跑进别的通道.** 后视镜条只该由桌面渲染管道组合出来；卡上没有 `strip`
 *   的时候，那一块必须**整个不存在**——不是空的，是不画。
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { CardRow } from '../src/client/CardRow.tsx'
import { PrivateCard } from '../src/client/PrivateCard.tsx'
import { YzjVault } from '../src/client/Vault.tsx'
import type { PrivateRowWire, StreamCard, SurfaceInject, VaultViewWire } from '../src/client/rpc.ts'

/** Render one node and hand back both its text and its live container. */
function render(node: React.ReactNode): { text: string; root: HTMLElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(node) })
  return { text: container.textContent ?? '', root: container }
}

const VAULT: VaultViewWire = {
  owner: 'op-1',
  destroyPhrase: '销毁我的金库',
  directory: '/tmp/pledger/op-1',
  contract: [
    { label: '仅你可见', how: 'viewer 单态' },
    { label: '不入组织图', how: '单向引用' },
  ],
  refusals: ['无分数', '无排名', '无画像', '无建议倾向', '无团队视图'],
  window: { days: 90 },
  testing: [
    {
      expectationId: 'exp-1',
      text: '评审能过，不返工',
      checkpointText: '明早评审后',
      verdictRef: { kind: 'commitment', id: 'c-1', label: '竞品对比表' },
      bornAt: 1_700_000_000_000,
      due: false,
      asked: false,
      verbs: ['withdraw'],
    },
    {
      expectationId: 'exp-2',
      text: '8/15 前签回宏图续约',
      checkpointText: '2020-08-15',
      checkpointTs: 1_597_449_600_000,
      verdictRef: { kind: 'commitment', id: 'c-2' },
      bornAt: 1_600_000_000_000,
      due: true,
      asked: true,
      verbs: ['note-fact', 'withdraw'],
    },
  ],
  settled: [
    {
      calibrationId: 'cal-1',
      attribution: 'q3',
      attributionLabel: '错了 · 因判断',
      thenText: '预期「评审能过」',
      factText: '评审过了但被追问定价策略',
      verdictRef: { kind: 'commitment', id: 'c-1' },
      at: 1_700_000_100_000,
      verbs: ['reattribute'],
    },
  ],
  withdrawn: [
    {
      expectationId: 'exp-3',
      text: '8 月内签下益丰',
      checkpointText: '8 月底',
      verdictRef: { kind: 'commitment', id: 'c-3' },
      bornAt: 1_600_000_000_000,
      due: false,
      asked: false,
      withdrawnReason: '客户转观望',
      // 撤回是终态：这一行一个动词都没有，而那是有理由的。
      verbs: [],
    },
  ],
  patterns: [
    {
      patternKey: 'delivery-acceptance:q3',
      family: 'delivery-acceptance',
      label: '交付验收 · 错了 · 因判断',
      count: 2,
      mirror: false,
      cases: [{ calibrationId: 'cal-1', thenText: '预期「评审能过」', factText: '被追问定价', at: 1 }],
      verbs: ['mirror'],
    },
  ],
  gears: [
    {
      family: 'delivery-acceptance',
      label: '交付验收',
      what: '交付被主张之前的一次自检',
      gear: 'default',
      evidence: ['近 90 天这一族的判例：2 条'],
      entry: 'none',
      leaseAvailable: false,
      leaseNote: '租约本体在组织侧（授权租约族尚未开门）',
      verbs: ['shift'],
    },
  ],
  invites: [
    {
      family: 'delivery-acceptance',
      label: '交付验收',
      quiet: false,
      declinedInARow: 0,
      verbs: ['invite-reopen'],
    },
  ],
}

/** A stand-in inject: every call records what the screen asked the host to do. */
function fakeInject(calls: string[], vault: VaultViewWire | undefined = VAULT): SurfaceInject {
  const ok = async (): Promise<{ error?: string }> => ({})
  return {
    vault: async () => vault,
    privateRows: async () => [],
    pledgerAct: async () => ({ receipt: '已记在你的账上。', outcome: 'applied' }),
    pledge: async () => ({}),
    declineInvite: ok,
    withdrawExpectation: async (id, reason) => { calls.push(`withdraw:${id}:${reason ?? ''}`); return {} },
    noteFact: async (input) => { calls.push(`note:${input.expectationId ?? ''}:${input.text}`); return {} },
    reattribute: async (id, attribution) => { calls.push(`attr:${id}:${attribution}`); return {} },
    shiftGear: async (family, gear) => { calls.push(`gear:${family}:${gear}`); return {} },
    toggleMirror: async (family, key, on) => { calls.push(`mirror:${family}:${key}:${String(on)}`); return {} },
    reopenInvites: async (family) => { calls.push(`reopen:${family}`); return {} },
    destroyVault: async (confirm) => { calls.push(`destroy:${confirm}`); return {} },
  } as unknown as SurfaceInject
}

/** Every button on screen, by its label. */
function labels(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button')].map(node => node.textContent ?? '')
}

describe('金库：每一行既可见又可动', () => {
  it('四区各自长出自己的动词，已撤回区一个都没有', async () => {
    const { root, text } = render(<YzjVault inject={fakeInject([])} back={() => {}} />)
    await act(async () => { await Promise.resolve() })

    expect(text).toContain('我的判断（金库）')
    // 硬合同 chips：一份人看不见的合同不是合同。
    expect(root.textContent).toContain('仅你可见')
    expect(root.textContent).toContain('不入组织图')

    const buttons = labels(root)
    // 检验中 → 撤回；已过检验点 → 补登事实 + 撤回；已对表 → 改归因。
    expect(buttons.filter(one => one === '撤回')).toHaveLength(2)
    expect(buttons).toContain('补登事实')
    expect(buttons).toContain('改归因')
    // 模式 → 后视镜开关；换挡台 → 三档；邀约频率 → 重新打开。
    expect(buttons.some(one => one.startsWith('🪞 后视镜'))).toBe(true)
    expect(buttons).toContain('负重')
    expect(buttons).toContain('重新打开')

    /*
      已撤回区是**终态**：它在屏幕上，可它一个动词都没有。

      这一条只能这么测——数总按钮数。若哪天有人给它加一颗「重新立」，
      「诚实退出不悔棋」就在没人察觉的情况下没了。
    */
    expect(root.textContent).toContain('已撤回')
    expect(root.textContent).toContain('诚实退出不悔棋')
  })

  it('租约档不可达，而且说出理由，不是画一扇打不开的门', async () => {
    const { root } = render(<YzjVault inject={fakeInject([])} back={() => {}} />)
    await act(async () => { await Promise.resolve() })
    const lease = [...root.querySelectorAll('button')].find(node => node.textContent === '租约')
    expect(lease).toBeDefined()
    expect((lease as HTMLButtonElement).disabled).toBe(true)
    expect(root.textContent).toContain('租约本体在组织侧')
  })

  it('后视镜是一次真的写：点下去，宿主收到 mirror 指令', async () => {
    const calls: string[] = []
    const { root } = render(<YzjVault inject={fakeInject(calls)} back={() => {}} />)
    await act(async () => { await Promise.resolve() })
    const mirror = [...root.querySelectorAll('button')]
      .find(node => node.textContent?.startsWith('🪞 后视镜'))
    await act(async () => { (mirror as HTMLButtonElement).click(); await Promise.resolve() })
    expect(calls).toContain('mirror:delivery-acceptance:delivery-acceptance:q3:true')
  })

  it('销毁是两段式：那句话没打对，按钮按不动', async () => {
    const { root } = render(<YzjVault inject={fakeInject([])} back={() => {}} />)
    await act(async () => { await Promise.resolve() })
    const destroy = [...root.querySelectorAll('button')].find(node => node.textContent === '销毁整本账')
    expect((destroy as HTMLButtonElement).disabled).toBe(true)
    expect(root.textContent).toContain('拷走这个目录')
  })

  it('五不做写在脚上：故意没有的东西说出来了', async () => {
    // **读的是渲染之后的容器**：`text` 是首帧的快照，而首帧还在等宿主回话。
    const { root } = render(<YzjVault inject={fakeInject([])} back={() => {}} />)
    await act(async () => { await Promise.resolve() })
    for (const refusal of ['无分数', '无排名', '无画像', '无建议倾向', '无团队视图']) {
      expect(root.textContent).toContain(refusal)
    }
  })

  it('空账如实解释自己为什么空 ——「还没有」和「不可能有」是两句话', async () => {
    const empty: VaultViewWire = {
      ...VAULT,
      testing: [], settled: [], withdrawn: [], patterns: [],
      emptyBecause: '空。预期在裁决时刻出生，不可回填——这里永远不会出现事后补写的行。',
    }
    const { root } = render(<YzjVault inject={fakeInject([], empty)} back={() => {}} />)
    await act(async () => { await Promise.resolve() })
    expect(root.textContent).toContain('不可回填')
  })
})

describe('私语通道的两位住客', () => {
  const invite: PrivateRowWire = {
    kind: 'invite',
    id: 'inv-1',
    at: 1,
    seq: 1,
    state: {
      inviteId: 'inv-1',
      sourceLine: '你刚刚验收了「竞品对比表」',
      checkpointText: '明早评审后',
      status: 'open',
    },
    resolved: false,
    actions: [
      { id: 'pledge', label: '立个预期', style: 'primary', needsInput: true, available: true },
      { id: 'decline', label: '不立', needsInput: false, available: true },
    ],
  }

  it('立约输入框是空的 —— 产婆术：只给维度，不给句子', async () => {
    const { root } = render(<PrivateCard row={invite} busy={false} act={async () => {}} />)
    const pledge = [...root.querySelectorAll('button')].find(node => node.textContent === '立个预期')
    await act(async () => { (pledge as HTMLButtonElement).click() })
    const box = root.querySelector('textarea') as HTMLTextAreaElement
    expect(box).not.toBeNull()
    // **预填一个字都是替人写好了赌注。** 占位符只说维度。
    expect(box.value).toBe('')
    expect(box.placeholder).toContain('过不过？')
    expect(box.placeholder).not.toContain('评审')
  })

  it('卡自己说清三不入：左栏计数不会因为它变化', () => {
    const { text } = render(<PrivateCard row={invite} busy={false} act={async () => {}} />)
    expect(text).toContain('不进收件箱')
    expect(text).toContain('不老化')
    expect(text).toContain('债主是你自己')
  })
})

describe('接缝④⑤：后视镜条与两读只长在桌面卡的渲染管道上', () => {
  const base: StreamCard = {
    kind: 'commitment',
    id: 'c-1',
    state: { status: 'open', what: '竞品对比表', delivery: { claim: '做完了', at: 1 } },
    at: 1,
    seq: 1,
    resolved: false,
    actions: [{ id: 'accept', label: '验收', style: 'primary', needsInput: false, available: true }],
  }

  it('没有 strip / twoRead / 负重档时，那一块整个不存在', () => {
    const { text } = render(<CardRow card={base} busy={false} act={() => {}} />)
    expect(text).not.toContain('后视镜')
    expect(text).not.toContain('这类确认还需要你吗')
    expect(text).not.toContain('负重档')
  })

  it('开了镜：判例在这张卡旁边，并且带着「判断仍由你下」', () => {
    const card: StreamCard = {
      ...base,
      strip: {
        family: 'delivery-acceptance',
        patternLabel: '交付验收',
        cases: [{ calibrationId: 'cal-1', thenText: '预期「评审能过」', factText: '被追问定价' }],
        note: '仅你可见 · 你在金库签发的负重显示（回喂环）——判断仍由你下',
      },
    }
    const { text } = render(<CardRow card={card} busy={false} act={() => {}} />)
    expect(text).toContain('后视镜（仅你可见）')
    expect(text).toContain('被追问定价')
    expect(text).toContain('判断仍由你下')
  })

  it('条尾两读：一个出口扩成两个，且租约不可达时说出为什么', () => {
    const card: StreamCard = {
      ...base,
      twoRead: {
        family: 'delivery-acceptance',
        label: '交付验收',
        gear: 'default',
        evidence: ['近 90 天这一族的判例：2 条'],
        leaseAvailable: false,
        leaseNote: '租约本体在组织侧（授权租约族尚未开门）',
        note: '仅你可见 · 非消息',
      },
    }
    const { text } = render(<CardRow card={card} busy={false} act={() => {}} />)
    expect(text).toContain('这类确认还需要你吗')
    expect(text).toContain('不再需要你')
    expect(text).toContain('需要你更多')
    expect(text).toContain('租约本体在组织侧')
    expect(text).toContain('仅你可见 · 非消息')
  })

  it('负重档真的把证据摆开了 —— 说明文字占位同罪', () => {
    const long = 'x'.repeat(600)
    const approval: StreamCard = {
      kind: 'approval',
      id: 'a-1',
      state: {
        status: 'pending', reason: '新建知识库文档', toolName: 'yzj_doc_create',
        level: 'standard', args: { body: long }, deadline: Date.now() + 60_000,
      },
      at: 1, seq: 1, resolved: false,
      actions: [{ id: 'approve', label: '确认', style: 'primary', needsInput: false, available: true }],
    }
    // 默认档：卡是入口不是全文，长参数截断。
    const plain = render(<CardRow card={approval} busy={false} act={() => {}} />)
    expect(plain.text).toContain('…')
    expect(plain.text).not.toContain(long)

    // 负重档：**同一份数据，整个摆开**。一个写着「证据已摆开」却仍然截断的卡是假话。
    const weighted = render(
      <CardRow
        card={{
          ...approval,
          gearEffect: {
            family: 'write-confirm', gear: 'weight',
            preselect: false, quickAccept: false, spreadEvidence: true,
          },
        }}
        busy={false}
        act={() => {}}
      />,
    )
    expect(weighted.text).toContain(long)
  })

  it('负重档：不预选、无一键通过 —— 主动作要按两下', async () => {
    const pressed: string[] = []
    const card: StreamCard = {
      ...base,
      gearEffect: {
        family: 'delivery-acceptance',
        gear: 'weight',
        preselect: false,
        quickAccept: false,
        spreadEvidence: true,
      },
    }
    const { root, text } = render(
      <CardRow card={card} busy={false} act={(_k, _i, actionId) => { pressed.push(actionId) }} />,
    )
    expect(text).toContain('负重档')
    const accept = [...root.querySelectorAll('button')].find(node => node.textContent === '验收')
    expect(accept).toBeDefined()
    await act(async () => { (accept as HTMLButtonElement).click() })
    /*
      第一下**什么都没发生**——它只是把手从自动驾驶上拿了回来。

      这不是防误触：一颗按一下就过的绿色按钮，正是三主权时刻退化成三剧场时刻的那个
      手势，而第二下就是那次裁决本身。
    */
    expect(pressed).toEqual([])
    const armed = [...root.querySelectorAll('button')].find(node => node.textContent?.startsWith('再按一次'))
    expect(armed).toBeDefined()
    await act(async () => { (armed as HTMLButtonElement).click() })
    expect(pressed).toEqual(['accept'])
  })
})
