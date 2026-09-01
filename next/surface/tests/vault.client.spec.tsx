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

/** 一张照片。写入那一刻定格的人可读摘要——正文渲染只读 `text`（立此存照律）。 */
const photo = (text: string, id?: string): { text: string; at: string; anchor?: { kind: string; id: string } } => ({
  text,
  at: new Date(1_700_000_000_000).toISOString(),
  ...(id === undefined ? {} : { anchor: { kind: 'commitment', id } }),
})

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
  settleDays: 14,
  foldThreshold: 2,
  testing: [
    {
      expectationId: 'exp-1',
      text: '评审能过，不返工',
      checkpointText: '明早评审后',
      verdict: photo('竞品对比表', 'c-1'),
      bornAt: 1_700_000_000_000,
      due: false,
      asked: false,
      premise: 'live',
      zone: 'live',
      verbs: ['withdraw'],
    },
  ],
  awaiting: [
    {
      expectationId: 'exp-2',
      text: '8/15 前签回宏图续约',
      checkpointText: '2020-08-15',
      checkpointTs: 1_597_449_600_000,
      verdict: photo('续约推进', 'c-2'),
      bornAt: 1_600_000_000_000,
      due: true,
      asked: true,
      premise: 'live',
      zone: 'live',
      verbs: ['note-fact', 'withdraw'],
    },
  ],
  settled: [
    {
      calibrationId: 'cal-1',
      attribution: 'q3',
      attributionLabel: '错了 · 因判断',
      thenText: '预期「评审能过」',
      fact: photo('评审过了但被追问定价策略'),
      verdict: photo('竞品对比表', 'c-1'),
      family: 'delivery-acceptance',
      at: 1_700_000_100_000,
      verbs: ['reattribute'],
    },
  ],
  sunk: [],
  withdrawn: [
    {
      expectationId: 'exp-3',
      text: '8 月内签下益丰',
      checkpointText: '8 月底',
      verdict: photo('益丰推进', 'c-3'),
      bornAt: 1_600_000_000_000,
      due: false,
      asked: false,
      withdrawnReason: '客户转观望',
      premise: 'live',
      zone: 'live',
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
  distribution: {
    q1: 0, q2: 0, q3: 1, q4: 0,
    cases: { q1: [], q2: [], q3: ['cal-1'], q4: [] },
    labels: { q1: '对了 · 因判断', q2: '对了 · 因运气', q3: '错了 · 因判断', q4: '错了 · 因世界' },
    verbs: ['open-cell'],
  },
  gears: [
    {
      family: 'delivery-acceptance',
      label: '交付验收',
      what: '交付被主张之前的一次自检',
      gear: 'default',
      evidence: [photo('近 90 天这一族的判例：2 条')],
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
  quota: {
    quota: 2,
    usedToday: 1,
    range: { min: 0, max: 3 },
    verbs: ['set-quota'],
  },
}

/** A stand-in inject: every call records what the screen asked the host to do. */
function fakeInject(calls: string[], vault: VaultViewWire | undefined = VAULT): SurfaceInject {
  const ok = async (): Promise<{ error?: string }> => ({})
  return {
    vault: async () => vault,
    privateRows: async () => ({ rows: [] }),
    vaultEvidence: async (kind, id) => {
      calls.push(`evidence:${kind ?? ''}:${id ?? ''}`)
      return {
        title: '证据面 · 「评审能过，不返工」',
        rows: [
          { text: '竞品对比表', at: '2023-11-14T22:13:20.000Z', anchor: { kind: 'commitment', id: 'c-1' }, premise: 'live', mark: '当时裁决' },
        ],
        note: '摘要为主、锚为辅：正文来自写入时刻的快照，锚只是「回去看看」的一跳。',
      }
    },
    vaultSearch: async (query) => {
      calls.push(`search:${query}`)
      return query === '评审' ? [{ zone: 'testing', id: 'exp-1', text: '评审能过，不返工' }] : []
    },
    vaultExport: async () => {
      calls.push('export')
      return { casebook: '# 判例册\n\n## 错了 · 因判断\n', readme: '# 这是什么\n' }
    },
    setQuota: async (quota) => { calls.push(`quota:${String(quota)}`); return {} },
    vaultContract: async () => {
      calls.push('contract')
      return {
        hard: [
          { label: '仅你可见', guarantee: 'policy · viewer 单态', how: '这个账本的读取面上没有「别人」这个参数' },
          { label: '金库 ≠ 记忆', guarantee: 'import 禁令（双向）', how: '蒸馏器无 pgraph，pledger 无 memory' },
        ],
        soft: [
          {
            label: '全局日配额', value: '2 / 天（上限 3）', where: '金库 · 配额行',
            cost: '调低：不再被问起也就不再有对表的机会；调高：合起来仍然是骚扰。',
          },
        ],
        signedBy: '你自己',
        agentMayPropose: false,
        note: '模型工具的动作枚举里没有这些参数，连提议的通道都不存在。',
      }
    },
    objectPreview: async (kind, id) => {
      calls.push(`preview:${kind}:${id}`)
      return id === 'c-1'
        ? { alive: true, title: '竞品对比表', lines: ['状态：settled'], sessionId: 'ses-1' }
        : { alive: false }
    },
    pledgerAct: async () => ({ receipt: '已记在你的账上。', outcome: 'applied' }),
    pledge: async () => ({}),
    declineInvite: ok,
    withdrawExpectation: async (id, reason) => { calls.push(`withdraw:${id}:${reason ?? ''}`); return {} },
    noteFact: async (input) => { calls.push(`note:${input.expectationId ?? ''}:${input.text}`); return {} },
    reattribute: async (id, attribution) => { calls.push(`attr:${id}:${attribution}`); return {} },
    shiftGear: async (family, gear) => { calls.push(`gear:${family}:${gear}`); return {} },
    toggleMirror: async (family, key, on, entry) => {
      calls.push(`mirror:${family}:${key}:${String(on)}${entry === undefined ? '' : `:${entry}`}`)
      return {}
    },
    reopenInvites: async (family) => { calls.push(`reopen:${family}`); return {} },
    destroyVault: async (confirm) => { calls.push(`destroy:${confirm}`); return {} },
  } as unknown as SurfaceInject
}

/** Every button on screen, by its label. */
function labels(root: HTMLElement): string[] {
  return [...root.querySelectorAll('button')].map(node => node.textContent ?? '')
}

describe('金库：每一行既可见又可动', () => {
  it('六区各自长出自己的动词，已撤回区一个都没有', async () => {
    const { root, text } = render(<YzjVault inject={fakeInject([])} back={() => {}} />)
    await act(async () => { await Promise.resolve() })

    expect(text).toContain('我的判断（金库）')
    // 硬合同 chips：一份人看不见的合同不是合同。
    expect(root.textContent).toContain('仅你可见')
    expect(root.textContent).toContain('不入组织图')

    const buttons = labels(root)
    // 检验中 → 撤回；待对表 → 补登事实 + 撤回；已对表 → 改归因。
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

  it('已撤回那一行：没有一个动作动词，但「证据」在 —— 读不是动作', async () => {
    const { root } = render(<YzjVault inject={fakeInject([])} back={() => {}} />)
    await act(async () => { await Promise.resolve() })

    /*
      **这一条盯的是那个分别本身。**

      `verbs: []` 保护的是「诚实退出不悔棋」——改不动那一行。而「我当时为什么押
      这个、后来为什么撤」恰恰是已撤回那一行最值得看的一问；把读也一起禁掉，就成了
      用一条保护诚实的规矩去惩罚诚实的人。

      所以断言写成两半：**动作一个都不许有**（将来谁加一颗「重新立」当场变红），
      **读必须在**。
    */
    // 取**最内层**那一个：外层容器当然也「包含」这行字，可它还包含整屏的按钮。
    const row = [...root.querySelectorAll('div')]
      .filter(node => node.textContent?.includes('8 月内签下益丰') === true
        && node.querySelector('button') !== null)
      .sort((left, right) => (
        left.querySelectorAll('button').length - right.querySelectorAll('button').length
      ))[0]
    expect(row).toBeDefined()
    const labels = [...(row as HTMLElement).querySelectorAll('button')].map(one => one.textContent)
    expect(labels).toEqual(['证据'])
    for (const forbidden of ['撤回', '补登事实', '照旧对表', '重新立']) {
      expect(labels).not.toContain(forbidden)
    }
  })

  it('屏幕上没有一处 [object Object] —— 类型换了，读它的那一行也要跟着换', async () => {
    /*
      换挡依据在 v2.0 从 `string[]` 变成了照片（`AnchoredText[]`），而这一行还在
      `.join()`——于是三行换挡依据全成了「[object Object]」，在屏幕上错了整整两轮。

      **既有用例一条都不会红**：`toContain` 查的是「这个词出现过」，对**多出来的
      东西**一律无感；而没有一处用例读过这一行的内容。所以这一条查的是**字面**：
      整屏不许出现那五个字。
    */
    const { root } = render(<YzjVault inject={fakeInject([])} back={() => {}} />)
    await act(async () => { await Promise.resolve() })
    expect(root.textContent).not.toContain('[object Object]')
    // 而且要真的把那句依据读出来——否则这条断言可以靠「什么都不渲染」通过。
    expect(root.textContent).toContain('近 90 天这一族的判例：2 条')
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

  it('金库这一列不再自带右栏 —— 一屏一个右栏，账本随会话整体切换', async () => {
    /*
      **曾经这里长过一个 aside**，而宿主的对象面槽位照旧渲染着组织侧那一栏：同一屏上
      两个右栏，两本账并排。v2.2 的账本律说的正是这件事不该发生——右栏没有自己的
      身份，它是**当前会话的物的投影**，切会话即整体重算。
    */
    const { root } = render(<YzjVault inject={fakeInject([])} back={() => {}} />)
    await act(async () => { await Promise.resolve() })
    expect(root.querySelector('aside')).toBeNull()
    expect(root.textContent).not.toContain('证据面')
    // 证据入口仍在这一列上：它把选中态写进 store，右栏那边读它。
    expect([...root.querySelectorAll('button')].map(one => one.textContent)).toContain('证据')
  })


  it('硬合同 chips 是入口不是终点：点开是一份与场所合同同语法的合同', async () => {
    const calls: string[] = []
    const { root } = render(<YzjVault inject={fakeInject(calls)} back={() => {}} />)
    await act(async () => { await Promise.resolve() })

    const chip = [...root.querySelectorAll('button')].find(node => node.textContent === '仅你可见')
    expect(chip).toBeDefined()
    await act(async () => { (chip as HTMLButtonElement).click(); await Promise.resolve() })
    expect(calls).toContain('contract')

    /*
      硬区列的是**为什么改不了**，不是「请勿修改」。

      一条 guard 拦得住而面板说不清的规矩，和一条没人执行的规矩一样不可信。
    */
    expect(root.textContent).toContain('policy · viewer 单态')
    // 软区 = 换挡台参数，只读陈列 + 指路。
    expect(root.textContent).toContain('全局日配额')
    expect(root.textContent).toContain('金库 · 配额行')
    // 这份合同和场所合同唯一的语法差别，也是它的全部特殊性。
    expect(root.textContent).toContain('agent 在这份合同上没有提议权')
    expect(root.textContent).toContain('另一半签署人')

    /*
      **「改在哪儿」是一扇门，不是一句说明**（信号即门）。

      这份合同自己写着「说不出在哪儿改的可调，和不可调没有分别」——那么一句
      点不开的「金库 · 配额行」，离那句话也就只差一步。
    */
    const door = [...root.querySelectorAll('button')].find(node => node.textContent?.startsWith('去改'))
    expect(door).toBeDefined()
    await act(async () => { (door as HTMLButtonElement).click() })
    // 面板关掉，人就站在金库里，那一行就在眼前。
    expect(root.textContent).not.toContain('agent 在这份合同上没有提议权')
  })

  it('空账如实解释自己为什么空 ——「还没有」和「不可能有」是两句话', async () => {
    const empty: VaultViewWire = {
      ...VAULT,
      testing: [], awaiting: [], settled: [], sunk: [], withdrawn: [], patterns: [],
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
    zone: 'live',
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

  it('答完的回执带着合环行 —— 说明文字占位同罪，这里数的是按钮', async () => {
    /*
      这一条是补上来的：注册表上写着 `receipt:就地合环行` 是「开镜/换挡」的第二个
      入口，可两个客户端都整片滤掉了 answered 行——**入口只存在于注册表上**。

      入口不垄断律要能被看见才算数，所以这里数按钮，不数字段。
    */
    const answered: PrivateRowWire = {
      kind: 'calibration',
      id: 'cal-1',
      at: 2,
      seq: 2,
      state: {
        calibrationId: 'cal-1',
        thenText: '预期「评审能过」',
        fact: { text: '被追问定价', at: '2023-11-14T22:13:20.000Z' },
        evidence: [],
        status: 'answered',
      },
      resolved: true,
      zone: 'live',
      actions: [],
      loopback: {
        family: 'delivery-acceptance',
        familyLabel: '交付验收',
        patternKey: 'delivery-acceptance:q3',
        mirrorOn: false,
        gear: 'default',
        note: '判断刚出炉，合环就在这一行上——金库是汇总处，不是唯一入口。',
      },
    }
    const calls: string[] = []
    const { root, text } = render(
      <PrivateCard
        row={answered}
        busy={false}
        act={async () => {}}
        loopback={async (family, patternKey, on, gear) => {
          calls.push(`${family}:${patternKey ?? '-'}:${String(on)}:${gear ?? '-'}`)
        }}
      />,
    )
    expect(text).toContain('金库是汇总处')
    const mirror = [...root.querySelectorAll('button')]
      .find(node => node.textContent?.includes('给这类卡开后视镜'))
    expect(mirror).toBeDefined()
    await act(async () => { (mirror as HTMLButtonElement).click() })
    expect(calls).toEqual(['delivery-acceptance:delivery-acceptance:q3:true:-'])

    // 调档是同一行上的第二个动词——换挡的入口也不该只有金库一个。
    const gear = [...root.querySelectorAll('button')].find(node => node.textContent?.startsWith('⚖ 调档'))
    await act(async () => { (gear as HTMLButtonElement).click() })
    expect(calls.at(-1)).toBe('delivery-acceptance:-:false:weight')
  })

  it('没有 loopback 的卡不长那一行 —— 私语流之外没有合环动词', () => {
    const { text } = render(<PrivateCard row={invite} busy={false} act={async () => {}} />)
    expect(text).not.toContain('给这类卡开后视镜')
    expect(text).not.toContain('调档')
  })

  it('回执卡上有「证据」，邀约卡上没有 —— 那一刻还没有事实可对', async () => {
    const answered: PrivateRowWire = {
      kind: 'calibration',
      id: 'cal-9',
      at: 3,
      seq: 3,
      state: {
        calibrationId: 'cal-9',
        thenText: '预期「评审能过」',
        fact: { text: '被追问定价', at: '2023-11-14T22:13:20.000Z' },
        evidence: [],
        status: 'open',
      },
      resolved: false,
      zone: 'live',
      actions: [{ id: 'q3', label: '错了因判断', needsInput: false, available: true }],
    }
    const asked: string[] = []
    const { root } = render(
      <PrivateCard
        row={answered}
        busy={false}
        act={async () => {}}
        showEvidence={(id) => { asked.push(id) }}
      />,
    )
    const evidence = [...root.querySelectorAll('button')].find(node => node.textContent === '证据')
    expect(evidence).toBeDefined()
    await act(async () => { (evidence as HTMLButtonElement).click() })
    // **对表不出屏在这里最要紧**：四格真正被按下的地方，就是这张卡。
    expect(asked).toEqual(['cal-9'])

    /*
      邀约卡上没有这一颗：它问的是「要不要立个预期」，那一刻还没有事实可对。
      自聊里也没有——那儿没有右栏，一颗按了什么都不会发生的「证据」比没有更糟。
    */
    const onInvite = render(
      <PrivateCard row={invite} busy={false} act={async () => {}} showEvidence={() => {}} />,
    )
    expect([...onInvite.root.querySelectorAll('button')].map(one => one.textContent))
      .not.toContain('证据')
    const noColumn = render(<PrivateCard row={answered} busy={false} act={async () => {}} />)
    expect([...noColumn.root.querySelectorAll('button')].map(one => one.textContent))
      .not.toContain('证据')
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
