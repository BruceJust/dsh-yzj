/**
 * 立约邀约卡 —— 环的第一环, and the only door a bet may be spoken through.
 *
 * Three properties this card exists to hold, in the order they matter:
 *
 * 1. **出处限组织侧事实** (#61 收紧⑤ / PTD-9). The generator's INPUT FACE is
 *    this file's {@link inviteFor} signature: a verdict anchor and its
 *    organization-side evidence. It has no pledger handle at all, so「镜子等
 *    人来照，不追着人照」is discharged by the fact that the generator cannot
 *    see the mirror — not by a rule it is asked to respect.
 * 2. **立约时窗** (v1.1 / PTD-13). 幂等锚只防重复，不防事后补立。The window is
 *    the second lock: a bet is only reachable while ITS invite is still open,
 *    and the invite is bound to the verdict it was born from. 「预期只在裁决
 *    时刻出生」 becomes「邀约还开着的时刻就还开着」, which is a state a machine
 *    can check.
 * 3. **产婆术**. The textarea starts EMPTY. 「帮我写」得到维度，不得到句子 —
 *    {@link PLEDGE_DIMENSIONS} is the whole of what the agent may offer, and
 *    the bet's words are the person's own (原话直存律, enforced on the tool
 *    face by having no `text` parameter at all).
 *
 * 一次性：不追问、不老化、不催——未答邀约静躺私语流。
 */

import type { CardAction, CardTransition } from '@yzj-next/cards'
import type { GraphActor } from '@yzj-next/graph'
import type { PledgerCardDefinition } from './bus.ts'
import { expectationIdFor, expectationIdemKeyFor, inviteIdFor, inviteIdemKeyFor } from './families.ts'
import type { OrgAnchor } from './types.ts'

/** Materialized invite state. */
export interface InviteState {
  readonly inviteId: string
  readonly family: string
  readonly status: 'open' | 'declined' | 'pledged'
  readonly verdictRef: OrgAnchor
  readonly evidenceRefs: readonly OrgAnchor[]
  readonly sourceLine: string
  /** 检验点的话语层，来自组织侧出处。人的赌注是人的话，检验点是图上的事实。 */
  readonly checkpointText: string
  readonly expectationId?: string
}

/**
 * 「帮我写」给得出的全部 —— **维度，不是句子** (产婆术条款).
 *
 * 这三问是从裁决本身长出来的，与任何人的判例无关：它们对第一天使用的人和第一百天
 * 使用的人一模一样。给出句子会当场制造对齐表演——难度长在真实决断里，不长在仪式里。
 */
export const PLEDGE_DIMENSIONS: readonly string[] = [
  '过不过？',
  '返几轮？',
  '影响下一步吗？',
]

/**
 * One invite's opening event, built from ORGANIZATION-SIDE FACTS ONLY.
 *
 * The signature is the guarantee (断言⑥): there is no pledger service, no
 * store handle, no pattern list in it. A future reviewer asking「邀约会不会
 * 读金库」reads this line and is done.
 */
export function inviteFor(input: {
  readonly verdict: OrgAnchor
  readonly family: string
  readonly evidence: readonly OrgAnchor[]
  /** 出处那一句话，说的是**组织侧的事实**：这份交付要用在哪儿。 */
  readonly sourceLine: string
  /** 检验点的话语，同样来自组织侧（那场会、那个期限）。 */
  readonly checkpointText: string
}): { inviteId: string; type: string; data: Record<string, unknown> } {
  const inviteId = inviteIdFor(input.verdict)
  return {
    inviteId,
    type: 'invite/opened',
    data: {
      inviteId,
      family: input.family,
      verdictRef: input.verdict,
      evidenceRefs: [...input.evidence],
      sourceLine: input.sourceLine,
      checkpointText: input.checkpointText,
      idemKey: inviteIdemKeyFor(input.verdict),
    },
  }
}

/**
 * 检验点两层 (与主册 due 同构): 话语真身 + 解析投影，可空可纠。
 *
 * 解析不出来就**没有** `ts`。把「明早评审后」硬解析成一个人没说过的时刻，是拿我们
 * 的解析冒充他的赌注；而没有 `ts` 的预期不会因此消失——它只是不参与时间轮，等人
 * 自己回来对表。
 */
export function parseCheckpoint(text: string): { text: string; ts?: number } {
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? { text, ts: parsed } : { text }
}

const isOperator = (actor: GraphActor): boolean => actor.kind === 'operator'

export const inviteCard: PledgerCardDefinition<InviteState> = {
  type: 'invite',

  actions: [
    {
      id: 'pledge',
      label: '立个预期',
      style: 'primary',
      // 关键词路径同样只收**人自己的那句话**：「立约 <你的赌注>」。
      keywords: ['立约', '立个预期', '立预期'],
      needsInput: true,
      allowedActors: isOperator,
      /**
       * **立约时窗的那把锁** (PTD-13 第二把).
       *
       * 邀约不再开着，这个动作就不在了——不是被拒绝，是不可用。事后对着一条历史裁决
       * 补立，走不到这里；走到编排层的那条路上会拿到一句**说得清是哪一种**的拒绝
       * （越窗，不是重复）——断言⑭ 要的正是这个区分。
       */
      available: state => state.status === 'open',
    },
    {
      id: 'decline',
      label: '不立',
      keywords: ['不立', '按下不表', '先不'],
      allowedActors: isOperator,
      available: state => state.status === 'open',
    },
  ],

  isResolved: state => state.status !== 'open',

  renderText: state => ({
    body: [
      '【立约 · 一次性邀约，不追问】立个预期？',
      state.sourceLine === '' ? '' : `出处：${state.sourceLine}`,
      `检验点：${state.checkpointText}`,
      '',
      '立了，结果回来就能对表。不立也不影响任何组织侧流程——回执照样会来（裁决本身即隐式预期）。',
      `想不出怎么说？只给维度不给句子：${PLEDGE_DIMENSIONS.join(' ')}`,
      '',
      '回复「立约 <你的赌注>」立一个，回复「不立」按下不表。',
      `[pledge#invite:${state.inviteId}]`,
    ].filter(line => line !== '').join('\n'),
    replyHints: ['立约 ', '不立'],
  }),

  onResolved: state => ({
    echoText: state.status === 'pledged'
      ? `【立约 · 已立】仅你可见，不入组织图。检验点：${state.checkpointText}`
      : '【立约 · 按下不表】这一单不再问。连续几次不立，这类时刻我会整体降频（重新打开在金库）。',
  }),

  apply: (state, action: CardAction<InviteState>, actor, input): CardTransition => {
    if (action.id === 'decline') {
      return {
        events: [{
          type: 'invite/declined',
          data: { inviteId: state.inviteId, family: state.family },
          actor,
        }],
      }
    }
    /*
      **原话直存律** (v1.1 / PTD-12).

      `input` 是人刚刚打出来的那句话，一个字节不动地成为 `expectation.text`。这条路
      上没有任何模型参与：编排层把话语原文锚定注入，模型工具的 schema 上根本没有
      `text` 这个参数（断言⑬）。产婆术在最关键的那一句表达上，不依赖模型的自律。
    */
    const text = input?.trim() ?? ''
    if (text === '') {
      throw new Error('预期得有内容——一句可证伪的赌注，由你说。')
    }
    const expectationId = expectationIdFor(state.verdictRef)
    return {
      events: [
        {
          type: 'expectation/opened',
          data: {
            expectationId,
            text,
            checkpoint: parseCheckpoint(state.checkpointText),
            verdictRef: { ...state.verdictRef },
            evidenceRefs: state.evidenceRefs.map(anchor => ({ ...anchor })),
            inviteId: state.inviteId,
            family: state.family,
            idemKey: expectationIdemKeyFor(state.verdictRef),
          },
          actor,
        },
        {
          type: 'invite/pledged',
          data: { inviteId: state.inviteId, expectationId },
          actor,
        },
      ],
    }
  },
}

/**
 * 疲劳治理 —— 同族连续 3 次不立，这一族就停问 (§4).
 *
 * **人用脚投票就是应答.** 计数是纯派生：数这个族的 `invite/declined`，遇到一次
 * `invite/reopened` 或一次真的立约就清零。所以「降频」没有第二个要维护的对象，
 * 也没有一个会和事实对不上的开关。
 */
export const FATIGUE_LIMIT = 3

export function isFamilyQuiet(
  events: readonly { readonly type: string; readonly data: unknown }[],
  family: string,
): boolean {
  let consecutive = 0
  for (const event of events) {
    const data = event.data as { family?: unknown } | null
    if (typeof data !== 'object' || data === null || data.family !== family) continue
    if (event.type === 'invite/declined') consecutive += 1
    // 重开与真的立约都清零：前者是人明说「再问我」，后者是人用行动说的同一句话。
    if (event.type === 'invite/reopened' || event.type === 'expectation/opened') consecutive = 0
  }
  return consecutive >= FATIGUE_LIMIT
}
