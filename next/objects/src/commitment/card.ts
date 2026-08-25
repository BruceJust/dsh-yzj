/**
 * The commitment card.
 *
 * A commitment owed by a PERSON is the case that matters here: the agent is an
 * observer, so the only way the graph learns anything after registration is
 * through this card's verbs and through receipts. Give it no answer path and
 * the commitment board fills with zombies — which is exactly why `void` is a
 * first-class action next to `done`.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CardDefinition } from '@yzj-next/cards'
import { asRecord, asString, type GraphViewer } from '@yzj-next/graph'
import { goalTitleVisible } from '../goal/audience.ts'
import { goalCommitmentIdFor } from '../goal/family.ts'
import { isSettled, ownsCommitment, type CommitmentState } from './family.ts'

/**
 * 谁能验收这份交付 —— **验收权跟着委派者走**（S3）。
 *
 * 验收自己委派的活是主权本义，所以它问的就是「这条归谁管」——和修理动词族、三个 CTA
 * 是**同一个谓词**（v4.22 裁决②：渲染过滤与执行校验共用单一事实源）。这里曾经自己抄
 * 了一份一模一样的实现；两份一样的判断迟早在某一次「要不要放宽老数据」上分道扬镳。
 *
 * **「∪ 操作者」不在这里，也不该在这里。** 自审时我按 §5.2 的字面把「跑这台桌面的
 * 那个人」也放了进来，理由是委派者一落到实处、老数据那条放行分支就不再兜着他。场景
 * 用例当场把它按了回去（`scenarios.spec` S3「别人签发的活，我验收不了」）：那样一来，
 * 一条同事委派、恰好由操作者执行的活，会在「主张即验收」那一步**自己把自己验收掉**，
 * 而委派者一次都没看过。§5.2 那句话里的「操作者」是这条委派的操作者，不是这台桌面的
 * 主人——用例说得比注释准。
 */
const mayAccept = ownsCommitment

/**
 * 主张交付的这个人，同时也是要验收的那个人吗。
 *
 * 是的话，**主张即验收**——再请他按一次「验收」，是同一个主权时刻收两次费（和提案
 * 裁决确认后不再弹第二张确认卡同一条道理）。「我欠我自己的活做完了」需要两次点击，
 * 是审批疲劳的教科书样本。
 */
export function claimIsAcceptance(openId: string | undefined, state: CommitmentState): boolean {
  return mayAccept(openId, state) && state.executor.kind === 'human'
    && state.executor.openId === openId
}

function executorLabel(state: CommitmentState): string {
  return state.executor.kind === 'agent'
    ? 'agent'
    : state.executor.name ?? state.executor.openId
}

function statusLabel(status: CommitmentState['status']): string {
  switch (status) {
    case 'closed': return '已完成'
    case 'voided': return '已作废'
    case 'merged': return '已合并'
    default: return '进行中'
  }
}

/**
 * 承诺卡 —— 工厂，因为它要按**投到哪儿**裁剪 (v4.22 裁决① 三态投影).
 *
 * 此前它是一个常量，`renderText` 只看得见 state；而卡上那一行「承 …」引用的是**另一个
 * 对象**（目标），而那个对象未必和这张卡有同一个听众集合。于是它把 goalRef 的**原始
 * URI** 原样印进每一间收到这张卡的屋子——对一个看不见这个目标的群，那一行等于告诉
 * 他们「这儿有个你看不到的东西」，而 URI 本身常常就带着名字。
 *
 * 拿到 ctx 才问得出「这间屋子看得见这个目标的标题吗」，所以它成了工厂。
 */
export function createCommitmentCard(ctx: Context): CardDefinition<CommitmentState> {
  /**
   * 那一行「承 …」，按三态投影渲染。
   *
   * - 标题可见 → 印**名字**（读不出名字就退回链接：标题可见∧正文不可读那一态）；
   * - 标题不可见 → **整行不印**。不是印个链接——零暗示才和「连计数不泄漏」自洽。
   */
  const goalLine = (state: CommitmentState, placeKey?: string): string[] => {
    // Detaching writes an EMPTY string rather than deleting the key (the fold
    // is a merge), so `undefined` is not the only absent value.
    const ref = state.parentGoalRef
    if (ref === undefined || ref === '') return []
    const viewer: GraphViewer = placeKey === undefined
      ? { kind: 'operator', openId: '' }
      : { kind: 'place', placeKey }
    if (!goalTitleVisible(ctx, ref, viewer)) return []
    /*
      名字读的是**未过滤的图**，因为上一行已经授权过了。

      拿 `object(viewer, …)` 再问一遍，问的是另一个问题：那条**目标登记**本身的听众集合
      （多半是空的——目标常常是在板上私下签发的）。于是「这个群看得见这个目标的标题」
      和「这个群读得到那条登记」打架，结果是明明该显示名字的地方印出一串 URI。
      标题可见域**就是**这一问的答案，不该再被它自己的原料否决一次。
    */
    const name = asString(
      asRecord(ctx.yzjGraph.rawObject('commitment', goalCommitmentIdFor(ref))?.state)?.what,
    )
    const guess = state.attachedVia === 'inferred' ? '（推断，可回复「改挂 <目标>」纠正）' : ''
    return [`承 ${name ?? ref}${guess}`]
  }

  /** ack 上那一行：这条边会不会被写进目标文档，以及怎么改。 */
  const projectionLine = (state: CommitmentState, placeKey?: string): string[] => {
    const ref = state.parentGoalRef
    if (ref === undefined || ref === '' || state.status !== 'open') return []
    // 看不见这个目标的人，不该被告知一件关于它的事——三态投影对这一行同样适用。
    const viewer: GraphViewer = placeKey === undefined
      ? { kind: 'operator', openId: '' }
      : { kind: 'place', placeKey }
    if (!goalTitleVisible(ctx, ref, viewer)) return []
    const projected = typeof state.projected === 'boolean'
      ? state.projected
      : (state.audience ?? []).some(place => place.startsWith('yzj-group-'))
    return [projected
      ? '这条会写进目标文档（全组可读）——回复「不公示」可以改'
      : '这条**不会**写进目标文档（私下登记）——回复「公示」写进去']
  }

  return {
  type: 'commitment',
  updateStrategy: 'append-echo',

  actions: [
    {
      id: 'done',
      label: '完成',
      style: 'primary',
      keywords: ['完成', '做完了', '已完成', 'done'],
      // Whoever is in the audience may report it done — the executor usually
      // is not the operator, and making the operator relay that is exactly the
      // pumping the design forbids.
      allowedActors: actor => actor.openId !== undefined,
      // 已经主张过交付的，这颗按钮就退场——该按的是「验收」或「打回」。
      available: state => state.status === 'open' && state.delivery === undefined,
    },
    {
      /*
        验收 —— 双动词之一 (v4.21 第一档⑥「验收断链接通」)。

        只在交付被主张之后出现：没有交付可验的时候摆一颗「验收」，是请人去验收一份
        不存在的产出（此前修过的僵尸问题）。
      */
      id: 'accept',
      label: '验收',
      style: 'primary',
      keywords: ['验收', '收下了', '可以', 'accept'],
      allowedActors: (actor, state) => mayAccept(actor.openId, state),
      available: state => state.status === 'open' && state.delivery !== undefined,
    },
    {
      /*
        打回 —— 拒收 → 返工 → 再验收，**在同一条上循环**，轮次可见。

        它不是作废：承诺没死，死的是这一版交付主张。作废是「这件事不做了」，打回是
        「这件事还没做好」——两者混成一个按钮，等于让一次质量判断顺手杀掉一条承诺。
      */
      id: 'reject',
      label: '打回',
      style: 'danger',
      keywords: ['打回', '拒收', '不行', '返工'],
      needsInput: true,
      allowedActors: (actor, state) => mayAccept(actor.openId, state),
      available: state => state.status === 'open' && state.delivery !== undefined,
    },
    {
      /*
        **反转投影** —— 边级选择的入口，就在这张 ack 上 (v4.22 裁决③).

        默认从登记场所的公私派生（公域→投影、私下→不投影明细），**当场生效**；这颗
        动词是它的「可纠」那一半。**不加第二张确认卡**——一次主权时刻一次确认，而这
        本来就不是一次主权时刻：默认已经生效了，这里只是改主意。

        主权归 owner：把不把自己委派的这件事说给全组听，是他的隐私主权。
      */
      /*
        主权归 owner，**操作者那一半不适用**：验收权借得到，隐私主权借不到。把不把
        同事私下登记的这件事说给全组听，不是「跑这台桌面的人」能替他决定的。
      */
      id: 'publish',
      label: '写进目标文档',
      style: 'neutral',
      keywords: ['公示', '写进目标'],
      allowedActors: (actor, state) => mayAccept(actor.openId, state),
      available: state => (
        state.status === 'open'
        && state.parentGoalRef !== undefined && state.parentGoalRef !== ''
        && state.projected !== true
      ),
    },
    {
      id: 'unpublish',
      label: '不写进目标文档',
      style: 'neutral',
      keywords: ['不公示', '别写进目标'],
      allowedActors: (actor, state) => mayAccept(actor.openId, state),
      /*
        只在**还没投影出去**的时候可选。

        投影出去之后关掉它并不会让文档里那一行消失，却会让它的状态余生停止更新——
        组里看到的会是一条永远停在「已登记」的活。那不是隐私，那是策展。
      */
      available: state => (
        state.status === 'open'
        && state.parentGoalRef !== undefined && state.parentGoalRef !== ''
        && state.projected !== false
      ),
    },
    {
      id: 'void',
      label: '作废',
      style: 'danger',
      keywords: ['作废', '不做了', '取消这条'],
      needsInput: true,
      allowedActors: actor => actor.openId !== undefined,
      available: state => state.status === 'open',
    },
  ],

  isResolved: state => isSettled(state.status),

  /**
   * 第三层：**信号 + 就近动词**，不进决断面 (v4.15 三层定律)。
   *
   * 一条没做完的承诺不是一个「等你答」的问题——它是一件还没发生的事。逾期、
   * 没信号、真身被改过都是**信号**，动词（完成／作废／催／顺延）就近长在承诺板
   * 那一行上。
   *
   * 把它塞进决断条，条会立刻长成一份待办清单：每一条没做完的活都要人去按一下
   * 「我知道了」。那正是「宁默认勿阻塞」拦的东西，也是零维护死掉的样子。
   */
  demand: (state) => {
    if (state.status !== 'open') return undefined
    /*
      交付被主张了 —— 这一刻它**才**是一个「等你答」的东西 (v4.21 第一档⑥)。

      此前一条人执行的承诺在任何状态下都只是信号，于是「他交了、等我认」这个真正需要
      人的时刻，在决断面上根本不存在。这就是断头路：登记有呼吸，交付无验收落座。

      返工轮次**不写进徽标**（和验收卡同一条纪律）：徽标是一格固定词汇，塞进「待验收 ·
      第 2 版」就把一个变长的事实挤进了一个不变长的槽。轮次的位置在卡正文上。
    */
    if (state.delivery !== undefined) {
      return {
        layer: 'blocking',
        mode: 'two-verb-acceptance',
        label: state.delivery.claim === '' ? state.what : state.delivery.claim,
      }
    }
    return { layer: 'signal', mode: 'open-question', label: `进行中：${state.what}` }
  },

  renderText: (state, view) => ({
    body: [
      `【承诺·${statusLabel(state.status)}】${state.what}`,
      `执行者：${executorLabel(state)}${state.due === undefined ? '' : ` · 期限 ${state.due}`}`,
      // Detaching writes an EMPTY string rather than deleting the key (the
      // fold is a merge), so `undefined` is not the only absent value — and
      // this is the projection that gets posted into a real group.
      ...goalLine(state, view?.placeKey),
      /*
        **亮出那个默认，并给出反转入口** (v4.22 裁决③).

        「投影即公开这次委派」这件事必须**明示在 ack 上**——一条私下登记的活被写进
        一份全组打开就能读的文档，而当事人以为那句话只有两个人听见，是这条裁决要防的
        全部内容。所以这一行不是提示，是**告知**：它已经生效了，你可以改。

        只在挂着目标、而且还在跟的时候说：终态之后再说这句话没有意义。
      */
      ...projectionLine(state, view?.placeKey),
      ...(state.lastReceipt === undefined ? [] : [`最近回执：${state.lastReceipt}`]),
      // 交付主张 + 返工轮次上卡（轮次不进徽标，位置在这儿）。
      ...(state.delivery === undefined
        ? []
        : [
          `交付：${state.delivery.claim}${state.delivery.anchor === undefined ? '' : ` — ${state.delivery.anchor}`}`,
          ...((state.delivery.round ?? 0) > 0 ? [`已返工 ${String(state.delivery.round)} 轮`] : []),
        ]),
      `[card#commitment:${state.commitmentId}]`,
    ].join('\n'),
    replyHints: state.status !== 'open'
      ? []
      : state.delivery !== undefined
        ? ['验收', '打回 <原因>', '作废 <原因>']
        : ['完成', '作废 <原因>'],
  }),

  onResolved: state => ({
    echoText: `【承诺·${statusLabel(state.status)}】${state.what}${state.cause === undefined ? '' : `（${state.cause}）`}`,
  }),

  apply: (state, action, actor, input) => {
    if (action.id === 'void') {
      return {
        events: [{
          type: 'commitment/voided',
          data: {
            commitmentId: state.commitmentId,
            cause: input === undefined || input.trim() === '' ? '未说明' : input.trim(),
          },
          actor,
        }],
      }
    }
    if (action.id === 'publish' || action.id === 'unpublish') {
      return {
        events: [{
          type: 'commitment/updated',
          data: { commitmentId: state.commitmentId, projected: action.id === 'publish' },
          actor,
        }],
      }
    }
    if (action.id === 'accept') {
      return {
        events: [{
          type: 'commitment/closed',
          data: { commitmentId: state.commitmentId, cause: 'accepted' },
          actor,
        }],
      }
    }
    if (action.id === 'reject') {
      return {
        events: [{
          type: 'commitment/rework',
          data: {
            commitmentId: state.commitmentId,
            reason: input === undefined || input.trim() === '' ? '未说明' : input.trim(),
            // 轮次从承诺上数，不从那份即将被删掉的交付主张里数。
            round: (state.round ?? 0) + 1,
          },
          actor,
        }],
      }
    }
    /*
      「完成」= **主张交付**，不是终态 (v4.21 第一档⑥)。

      「他说做完了」和「我认了这份交付」是两个人的两次判断，此前被压成同一件事：
      执行者按一下，系统直接判终态，而委派的人从来没有被问过。

      **除非主张的人就是要验收的那个人**——那时再请他按一次「验收」，是同一个主权
      时刻收两次费。「我欠我自己的活做完了」要点两下，是审批疲劳的教科书样本。
    */
    if (claimIsAcceptance(actor.openId, state)) {
      return {
        events: [{
          type: 'commitment/closed',
          data: { commitmentId: state.commitmentId, cause: 'done' },
          actor,
        }],
      }
    }
    return {
      events: [{
        type: 'commitment/delivered',
        data: {
          commitmentId: state.commitmentId,
          delivery: {
            claim: input === undefined || input.trim() === '' ? '（说了完成，没有细节）' : input.trim(),
            at: Date.now(),
            // 重交时把承诺上的轮次抄进这一版交付，卡上才写得出「已返工 N 轮」。
            ...(state.round === undefined ? {} : { round: state.round }),
          },
        },
        actor,
      }],
    }
  },
  }
}
