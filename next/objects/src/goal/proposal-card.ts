/**
 * 提案裁决卡 — the only door an agent-authored goal or decomposition can walk
 * through, and it only opens from the human side.
 *
 * **确认即签发.** The design's own words: 提案裁决的逐条确认即签发，代发是其机械
 * 后果，不再弹第二张确认卡. So this card's `apply` does the whole thing — records
 * the decision, mints the commitment, and stamps it with where the registration
 * utterance must be spoken. One sovereign moment, one press. A second "are you
 * sure" here would not add safety; it would add the approval fatigue that makes
 * people stop reading the first card.
 *
 * **挂起 is a real answer.** 「不是现在」 and 「不」 are different facts about an
 * item, and collapsing them loses the one thing a weekly review needs. Held
 * items keep the card answerable; 「收起」 is the exit that stops a
 * half-decided proposal from living forever.
 *
 * **It is built against a context, not exported as a constant.** Signing has to
 * be able to ask the graph two questions no card state can answer: does this
 * commitment already exist, and does something already live at this goal's URI.
 * A pure `apply` could only guess, and both guesses go wrong in the same
 * direction — re-posting a registration into a real group, and overwriting a
 * goal that has children hanging off it.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CardDefinition } from '@yzj-next/cards'
import type { GraphAppendInput } from '@yzj-next/graph'
import { commitmentIdFor, commitmentIdemKeyFor } from '../commitment/family.ts'
import {
  goalCommitmentIdFor, itemsFrom, proposalSettled,
  type ProposalDecision, type ProposalItem, type ProposalState,
} from './family.ts'

const MARK: Record<ProposalDecision, string> = {
  confirmed: '✓ 已确认',
  rejected: '✗ 已驳回',
  held: '⏸ 已挂起',
}

function itemLine(item: ProposalItem, index: number, state: ProposalState): string {
  const decision = (state.decisions ?? {})[String(index)]
  const who = item.executorName ?? item.executorOpenId ?? '未定'
  // The EFFECTIVE destination, not just the one written on the item. Showing
  // only `item.placeKey` left the card blank about where confirming would post
  // — so the operator signed 「会以你的名义发到执行者所在的会话」 without being
  // told which conversation that was.
  const where = item.placeName ?? placeFor(item, state)
  return [
    `${String(index + 1)}. ${item.what}`,
    `　 ${who}${item.due === undefined ? '' : ` · ${item.due}`}`,
    state.kind === 'goal'
      ? ''
      : where === undefined ? ' · ⚠ 没有可投递的会话，确认后需你亲自去说' : ` · 登记发到「${where}」`,
    decision === undefined ? '' : `　${MARK[decision]}`,
  ].join('')
}

/**
 * The registration utterance's landing place for one item.
 *
 * Falls back to the place the proposal itself was made in — but ONLY that.
 * There is deliberately no search for "a group this person is in": picking
 * between speaking publicly and speaking privately is a social decision, and
 * §1.6 puts it with the person, not with a lookup (v4.9 场所人选不推导).
 */
function placeFor(item: ProposalItem, state: ProposalState): string | undefined {
  return item.placeKey ?? state.placeKey
}

/**
 * The goal body's URI, preferring the one pasted with the confirmation.
 *
 * 真身外挂: a goal proposal arrives with the link it was TOLD, and this field is
 * where a different one can override it. Accepting only something that parses as
 * an http(s) URL keeps 「确认 1」 from being mistaken for a link.
 *
 * **「agent 建不了云之家文档」这句前提是错的**，它曾经写在这里，并且长出了一整段让人
 * 当集成层的动线（去云之家新建、复制链接、回来粘上）。`yzj_doc_create` 一直都在，这个
 * 部署里也真的建过——和「通讯录不能按名字搜」是同一次误判的两个化身。看板那一侧已经改成
 * 「人选知识库、系统建文档」；**这条卡片路还没有**：agent 提案时该顺手问一句「要我建
 * 一个吗」，建完把链接带在提案上。明标未做，不假装它不存在。
 */
function goalRefFrom(state: ProposalState, input: string | undefined): string | undefined {
  const typed = (input ?? '').trim()
  // Nothing typed means "use the link you were told", which is the whole point
  // of carrying one on the proposal.
  if (typed === '') return state.goalRef
  /*
    Accept what people actually paste.

    Copying a link out of the Yunzhijia address-bar chip yields
    `www.yunzhijia.com/doc/…` with no scheme, and requiring one silently fell
    back to the OLD ref — minting a goal against a document the operator was in
    the middle of replacing, with a success receipt. So a scheme is added rather
    than demanded.
  */
  const normalized = /^https?:\/\//u.test(typed) ? typed : `https://${typed}`
  if (/^https?:\/\/[^\s/]+\.[^\s/]+/u.test(normalized)) return normalized
  /*
    They typed something, and it is not a link.

    Falling back to `state.goalRef` here is the dangerous branch: whatever they
    meant, they did not mean "use the old one". Returning nothing makes the
    confirmation mint nothing and leaves the card open — and the desktop refuses
    to enable the button in this state at all.
  */
  return undefined
}

/**
 * The events one confirmed item appends.
 *
 * A goal proposal mints the goal itself (id derived from its body URI, so a
 * second confirmation of the same goal folds onto one object); a breakdown item
 * mints a child carrying the goal's URI as its parent. Both carry
 * `notifyPlaceKey` — the delivery listener turns it into an actual utterance,
 * and reports out loud when it cannot.
 */
function mint(
  state: ProposalState,
  item: ProposalItem,
  index: number,
  goalRef: string | undefined,
): { readonly commitmentId: string; readonly events: readonly GraphAppendInput[] } {
  const anchor = `${state.sourceAnchor}#proposal:${state.proposalId}:${String(index)}`
  const isGoal = state.kind === 'goal'
  const commitmentId = isGoal && goalRef !== undefined
    ? goalCommitmentIdFor(goalRef)
    : commitmentIdFor(anchor, item.what)
  const executor = item.executorOpenId === undefined
    ? { kind: 'agent' as const, topicKey: state.topicKey ?? 'desktop' }
    : {
      kind: 'human' as const,
      openId: item.executorOpenId,
      ...(item.executorName === undefined ? {} : { name: item.executorName }),
    }
  const place = placeFor(item, state)
  return {
    commitmentId,
    events: [{
      type: 'commitment/opened',
      data: {
        commitmentId,
        what: item.what,
        executor,
        sourceAnchor: anchor,
        /*
          委派者 = **接下这份提案的那个人**。

          提案由 agent 落库，所以内核盖不上委派者（它盖的是 actor，而 actor 是 agent）。
          而「谁把这几条活派出去了」有一个确定的答案：按下「就这么办」的那个人，也就是
          这张卡的 `decider`。没有它，方向轴与主权谓词在这条路径上同样是空的。
        */
        ...(state.decider === undefined || state.decider === '' ? {} : { delegatedBy: state.decider }),
        idemKey: isGoal && goalRef !== undefined
          ? `goal:${goalRef}`
          : commitmentIdemKeyFor(anchor, item.what),
        ...(state.topicKey === undefined ? {} : { topicKey: state.topicKey }),
        ...(item.due === undefined ? {} : { due: item.due }),
        /*
          听众集合由登记话语确立 (v4.9) — so when there is one to send, this
          waits for it.

          Copying the PROPOSAL's audience here would say "the people who saw
          the proposal know about this commitment", which is a different claim
          and, when delivery fails, a false one: the row would sit on the board
          looking properly announced to a room that was never told. The
          delivery listener writes the audience it actually reached.
        */
        ...(state.audience === undefined || (!isGoal && place !== undefined)
          ? {}
          : { audience: [...state.audience] }),
        ...(isGoal
          // 立目标 = 登记一条 executor=owner、人工验收、真身在云之家的承诺。
          ? {
            ...(goalRef === undefined ? {} : { goalRef }),
            ...(state.criteria === undefined ? {} : { criteria: state.criteria }),
            attachedVia: 'explicit' as const,
          }
          : {
            // 出生时刻 · 从目标语境委派：继承不是推断。
            ...(goalRef === undefined
              ? {}
              : { parentGoalRef: goalRef, attachedVia: 'object-context' as const }),
          }),
        // 落库即代发：没有静默登记。A goal declared by its own owner needs no
        // announcement — the owner is the one pressing.
        ...(isGoal || place === undefined ? {} : { notifyPlaceKey: place }),
        /*
          A commitment somebody else owes with NOWHERE to announce it is the
          ghost this module exists to forbid — and it was being minted
          silently, because the board only shouts about `failed`. There is no
          conversation to speak into, so it is born already marked: the row
          says 「未通知 · 请亲发」 and the owner knows they still owe the
          sentence. 宁可刺眼，不可静默。
        */
        ...(isGoal || place !== undefined ? {} : { notified: 'failed' as const }),
      },
      actor: { kind: 'agent' as const },
    }],
  }
}

/**
 * 谁能签发：递给谁，就是谁 (v4.9 人签发).
 *
 * `openId !== undefined` was not a check — it admitted everybody in the room.
 * A proposal posted into a group could then be signed by any member, and the
 * registration utterance that follows goes out **under the operator's account**
 * into a conversation that member may not even be in. The approval family got
 * this right from the start (`isDecider`); this is the same rule.
 *
 * A proposal with no recorded decider (older ones) falls back to the previous
 * behaviour rather than becoming unanswerable — a card nobody can answer is its
 * own failure mode.
 */
function isDecider(openId: string | undefined, state: ProposalState): boolean {
  if (openId === undefined) return false
  return state.decider === undefined || state.decider === openId
}

function decideAction(
  id: ProposalDecision,
  label: string,
  keywords: readonly string[],
  style: 'primary' | 'danger' | 'neutral',
  /** 这一下是哪一种人签发的裁决终态。不给 = 它不是一个终态（如「按下不表」）。 */
  verdict?: string,
): CardDefinition<ProposalState>['actions'][number] {
  return {
    id,
    label,
    style,
    keywords: [...keywords],
    ...(verdict === undefined ? {} : { verdict }),
    needsInput: true,
    allowedActors: (actor, state) => isDecider(actor.openId, state),
    available: state => !proposalSettled(state),
  }
}

/**
 * Build the card against a context.
 *
 * `apply` needs two graph reads that no card state can stand in for, and both
 * of them guard against writing something unrecoverable.
 */
export function createProposalCard(ctx: Context): CardDefinition<ProposalState> {
  return {
  type: 'proposal',
  updateStrategy: 'append-echo',

  actions: [
    /*
      Keywords are matched by PREFIX on the text channel (that is how 「确认 1,3」
      carries its selection), so a loose synonym is a loaded gun: 「同意归同意，
      但先别登记」 begins with 同意 and would sign. Only imperative verbs that do
      not open ordinary sentences survive here. 「确认一下真要做吗?」 can still
      misfire — that exposure is the text channel's, shared with 完成/验收, and
      it is now bounded to the one person the proposal was handed to.
    */
    /*
      确认一条提案 = **委派签发**（拆解落库）：这一下之后，那件事真的挂到了人头上。
      驳回与挂起不是终态——事情还在这张卡上，没有可对表的「后来」。
    */
    decideAction('confirmed', '确认', ['确认'], 'primary', 'delegation'),
    decideAction('rejected', '驳回', ['驳回'], 'danger'),
    decideAction('held', '挂起', ['挂起'], 'neutral'),
    {
      id: 'settle',
      label: '收起',
      style: 'neutral',
      keywords: ['收起'],
      allowedActors: (actor, state) => isDecider(actor.openId, state),
      available: state => !proposalSettled(state),
    },
  ],

  isResolved: state => proposalSettled(state),

  /**
   * 同一张卡，两种模式——**因为人要做的动作真的不同**。
   *
   * 立目标那张只有一条，人做的是**④签发**：一次主权时刻，按下去方向就定了。
   * 拆解那张是**②逐条裁决**：N 条各自定生死，还没裁的条数就是它此刻等你的量。
   * 把两者说成同一种，是把「签一次字」和「过一遍清单」混为一谈。
   */
  demand: (state) => {
    if (proposalSettled(state)) return undefined
    if (state.kind === 'goal') {
      return { layer: 'blocking', mode: 'issuance', label: state.title }
    }
    const decisions = state.decisions ?? {}
    const left = state.items.filter((_item, index) => decisions[String(index)] === undefined).length
    return {
      layer: 'blocking',
      mode: 'per-item-verdict',
      label: `${state.title} · ${String(left)} 条未裁`,
    }
  },

  renderText: state => ({
    body: [
      state.kind === 'goal'
        ? `【提案·立目标】${state.title}`
        : `【提案·拆解】${state.title}`,
      ...(state.goalName === undefined && state.goalRef === undefined
        ? []
        : [`目标：${state.goalName ?? state.goalRef ?? ''}`]),
      ...(state.criteria === undefined ? [] : [`怎么算完成：${state.criteria}`]),
      ...state.items.map((item, index) => itemLine(item, index, state)),
      // 人签发铁律，说在卡上而不是只说在设计文档里。
      state.kind === 'goal'
        ? state.goalRef === undefined
          /*
            没有真身链接时说什么 (v3.10 4h③).

            此前这句是「先在云之家建目标文档，把链接一起发过来」——把一件 agent 明明
            做得到的事推给了人。`yzj_doc_create` 与 `yzj_doc_block_insert` 一直在
            工具面里，"agent 建不了文档"是一次能力误判。所以现在给的是**两条路**，
            而不是一条作业：让它建，或者你自己贴。人签发这一步一个字没变。
          */
          ? '这是提案，不是目标——真身还不存在。回一句「建一份」让我把文档建好'
            + '（成功标准会写进正文），或者自己建完把链接跟「确认」一起发过来。'
          : '这是提案，不是目标。确认才算你签发。'
        : '逐条裁决。确认即签发——确认后会以你的名义把登记消息发到执行者所在的会话。',
      `[card#proposal:${state.proposalId}]`,
    ].join('\n'),
    replyHints: proposalSettled(state)
      ? []
      : state.kind === 'goal'
        // 「建一份」刻意**不在**这里：replyHints 列的是卡上的动词，会被关键词解析成
        // 一个动作。而「建一份」是说给 agent 听的一句话（它会去建文档再重新提案），
        // 把它混进动词表，就成了一个点下去没有对应动作的承诺。
        /*
          **有真身的提案，「确认」就是「确认」。**

          这里一直写着 `确认 <真身链接>`——那是真身要靠人粘进来的年代留下的话。现在提案
          递上来时真身已经建好了（`goal_propose` 没有真身根本不递），再把链接摆进主动词
          里，等于告诉人「你还得去找一个链接」，而这正是这次要消灭的那一步。

          没有真身的老提案照旧提示带链接——它们确实还缺那一样东西。
        */
        ? (state.goalRef === undefined ? ['确认 <真身链接>', '驳回', '收起'] : ['确认', '驳回', '收起'])
        : ['确认 <编号>', '驳回 <编号>', '挂起 <编号>', '收起'],
  }),

  onResolved: (state) => {
    const decisions = state.decisions ?? {}
    const confirmed = state.items.filter(
      (_item, index) => decisions[String(index)] === 'confirmed',
    ).length
    return {
      echoText: `【提案·已裁决】${state.title}——确认 ${String(confirmed)} 条，其余未采纳。`,
    }
  },

  apply: (state, action, actor, input) => {
    if (action.id === 'settle') {
      return {
        events: [{
          type: 'proposal/settled',
          data: { proposalId: state.proposalId, cause: '操作者收起' },
          actor,
        }],
      }
    }
    const decision = action.id as ProposalDecision
    /*
      The input means two different things depending on the kind, so it is
      interpreted once, here, and never twice.

      On a BREAKDOWN it is a selection of item numbers and the goal is whatever
      the proposal was opened against — running it through the link parser would
      read「1,3」as a malformed URL and quietly detach every child from its goal.
      On a GOAL proposal it is the body's link.
    */
    const goalRef = state.kind === 'goal' ? goalRefFrom(state, input) : state.goalRef
    const { indices } = state.kind === 'goal' ? { indices: [0] } : itemsFrom(input, state)
    const events: GraphAppendInput[] = []
    for (const index of indices) {
      const item = state.items[index]
      if (item === undefined) continue
      /*
        A goal with no body is a wish, and a goal row pointing at nothing is
        the copy we do not have. Refusing to mint leaves the card OPEN and
        answerable, which is the honest outcome: the operator makes the
        document and confirms again with the link.
      */
      if (decision === 'confirmed' && state.kind === 'goal' && goalRef === undefined) continue
      if (decision !== 'confirmed') {
        events.push({
          type: 'proposal/item-decided',
          data: { proposalId: state.proposalId, index, decision },
          actor,
        })
        continue
      }
      /*
        确认两次不是确认两遍.

        Overlapping selections are how people actually answer — 「确认 1」 then
        「确认 1,2」. The item's commitment id is derived from the proposal and
        the index, so a second confirmation re-appends `commitment/opened` on
        the SAME object: the registration goes out into the group a second
        time, and because that event carries `status: 'open'`, a commitment
        somebody had already reported done comes back to life with its own
        receipt still attached.
      */
      if ((state.decisions ?? {})[String(index)] === 'confirmed') continue
      const minted = mint(state, item, index, goalRef)
      /*
        一个真身，一个目标 —— and confirming must never overwrite one.

        The goal's id is derived from its URI, so pasting a link that already
        carries a goal folds onto that object: its name, owner, criteria and
        anchor are rewritten, and a settled one reopens — while its children
        still point at the same URI, so the board silently re-parents an entire
        subtree. The board's own declare path has refused this from the start;
        the card had no equivalent because a pure `apply` could not look.
      */
      if (state.kind === 'goal'
        && ctx.yzjGraph.rawObject('commitment', minted.commitmentId) !== undefined) continue
      // Commitment first, decision second: the decision names the commitment
      // it minted, and a decision pointing at an object that does not exist yet
      // is a record a crash could make permanent.
      events.push(...minted.events, {
        type: 'proposal/item-decided',
        data: {
          proposalId: state.proposalId,
          index,
          decision,
          commitmentId: minted.commitmentId,
        },
        actor,
      })
    }
    return { events }
  },
  }
}
