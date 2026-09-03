/**
 * An answerable object, rendered where it happened.
 *
 * A card is a projection of a graph object, not a widget with state (卡片三定律
 * ①). So this component holds nothing but the text somebody is typing into it:
 * it renders what the host says the object is right now, and every button goes
 * back through the action bus — the same bus the Yunzhijia keyword reply uses.
 * That is what makes "answer on either surface, effect once" true rather than
 * aspirational, including the loud receipt when this surface loses the race.
 *
 * Each kind gets its own shape because each decision HAS its own shape. A
 * confirmation is a form you read before signing — the tool, the arguments, the
 * deadline after which it self-rejects. An acceptance is a bar you clear. A
 * commitment is somebody's name against a date. Rendering all three as the same
 * grey box was the fastest way to make every decision feel equally unimportant.
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AnchoredTextWire, FamilyHeadWire, StreamCard, StripWire, SurfaceInject } from './rpc.ts'
import { GearBox } from './Judg.tsx'
import css from './card.module.css'

const KIND_LABEL: Record<string, string> = {
  approval: '确认',
  task: '任务',
  waiting: '等待',
  conflict: '冲突',
  commitment: '承诺',
}

const STATUS: Record<string, string> = {
  pending: '待确认',
  approved: '已放行',
  rejected: '已拒绝',
  expired: '超时自动拒绝',
  interrupted: '因重启中断',
  superseded: '已重新发起',
  terminal: '待验收',
  accepted: '已验收',
  voided: '已作废',
  rework: '返工中',
  open: '进行中',
  escalated: '已升级',
  closed: '已关闭',
  merged: '已合并',
  // 移交不是死法：事还在，只是换了一条边（决策 #59）。缺了这一行会露出裸状态串。
  transferred: '已移交',
  flagged: '待裁定',
  resolved: '已裁定',
}

/** The arguments a reader must not have to guess at. Long values are clipped. */
const ARG_LIMIT = 200

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * 一个参数值，摊平成一行.
 *
 * `limit` 是**负重档的落点**：默认档把长参数截到 200 字（卡是入口不是全文），
 * 负重档把它整个摆开——「摆开证据」不是多画一句说明，是真的把你要看的东西放出来。
 * 一个写着「证据已摆开」却仍然截断的卡，正是「说明文字占位同罪」要禁的那种。
 */
function flatten(value: unknown, limit = ARG_LIMIT): string {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  const flat = rendered.replace(/\s+/gu, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

/** 负重档下不截断：证据摆开的意思就是你能看见全部。 */
const SPREAD_LIMIT = 4_000

/** `HH:mm`, for a deadline the reader has to be able to act before. */
function clock(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  const when = new Date(value)
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${pad(when.getHours())}:${pad(when.getMinutes())}`
}

export interface CardRowProps {
  card: StreamCard
  busy: boolean
  act(kind: string, id: string, actionId: string, input?: string, dwellMs?: number): void
  /** 私条上的动词走它。不给 = 这张卡长在没有私账的地方，私条整块不画。 */
  inject?: SurfaceInject
  /** 引用指名押：把句柄放进私语道 composer（「押 [card#…]：」），由人把话说完。 */
  pledgeOn?(handle: string): void
}

interface Action {
  id: string
  label: string
  style?: string
  needsInput: boolean
  available: boolean
}

/**
 * 卡 + 私账在它旁边的那三样 (私账层 接缝④⑤).
 *
 * **卡组件本体零改动**是这条接缝的形状：后视镜条与两读卡由渲染管道**组合**在卡的
 * 后面，而不是长进卡的定义里。这不只是整洁——文本投影走的是另一条路（`renderText`），
 * 那条路上根本没有这些字段，于是「私账内容离开桌面通道即事故」成了一件结构上做不到
 * 的事，而不是一条要靠人记得的纪律。
 */
export function CardRow(props: CardRowProps): ReactNode {
  return (
    <>
      <CardBody {...props} />
      <PledgerTail {...props} />
    </>
  )
}

function CardBody(props: CardRowProps): ReactNode {
  const { card, busy, act } = props
  const [input, setInput] = useState('')
  /**
   * 负重档的**无一键通过**：主动作要按两下 (档位生效面).
   *
   * 这不是防误触。「你先拆，我再补」的意思是**把手从自动驾驶上拿回来**——而一颗
   * 按一下就过的绿色按钮，正是三主权时刻退化成三剧场时刻的那个手势。第二下不是
   * 摩擦，它就是那次裁决本身。
   */
  const [arming, setArming] = useState<string | undefined>(undefined)
  const state = record(card.state)
  const status = text(state.status)
  const actions = card.actions.filter(action => action.available)
  /*
    「先看」条在场 = 你定的规矩生效：不预选、无一键通过（决策 #64 §4.4 换挡生效面）。
    停留从这张卡挂上屏那一刻起算——本人行为事实，随裁决广播只进私账。
  */
  const weight = (card.strips ?? []).some(strip => strip.kind === 'spread')
  const mountedAt = useRef(Date.now())

  const run = (action: Action): void => {
    act(card.kind, card.id, action.id, action.needsInput && input !== '' ? input : undefined, Date.now() - mountedAt.current)
    setInput('')
    setArming(undefined)
  }

  const buttons = (needsInputPlaceholder: string): ReactNode => (
    actions.length === 0 ? null : (
      <>
        {actions.map((action) => {
          // 不预选：负重档下没有哪一颗按钮被画成「就按这个」。
          const emphasis = weight
            ? ''
            : `${action.style === 'primary' ? css.primary : ''} ${action.style === 'danger' ? css.danger : ''}`
          const armed = arming === action.id
          const twoStep = weight && action.style === 'primary'
          return (
            <button
              type="button"
              key={action.id}
              className={`${css.button} ${emphasis} ${armed ? css.primary : ''}`}
              disabled={busy}
              title={twoStep && !armed ? '负重档：这一下只是拿起来，再按一下才算数' : undefined}
              onClick={() => {
                if (twoStep && !armed) { setArming(action.id); return }
                run(action)
              }}
            >
              {armed ? `再按一次：${action.label}` : action.label}
            </button>
          )
        })}
        {actions.some(action => action.needsInput) && (
          <input
            className={css.input}
            value={input}
            placeholder={needsInputPlaceholder}
            disabled={busy}
            onChange={(event) => { setInput(event.target.value) }}
          />
        )}
      </>
    )
  )

  // 验收条 — horizontal, green, a threshold rather than a form.
  if (card.kind === 'task') {
    const settled = status === 'accepted' || status === 'voided'
    const round = typeof state.round === 'number' ? state.round : 0
    return (
      <div className={`${css.accept} ${settled ? css.acceptDone : ''} ${status === 'interrupted' ? css.acceptBroken : ''}`}>
        <span className={css.acceptLabel}>
          {settled
            ? status === 'voided' ? '🗑 已作废' : '✅ 已验收'
            : status === 'interrupted' ? '⚡ 中断 · 可继续' : '待验收'}
        </span>
        <span className={css.acceptWhat}>{text(state.what)}</span>
        {!settled && <span className={css.acceptActions}>{buttons('打回/作废的原因')}</span>}
        {/*
          中断的落点必须说出来：「继续」之所以值得按，正是因为结果会回到它
          出生的那个地方,而不是留在这一列里。
        */}
        {status === 'interrupted' && (
          <span className={css.acceptNote}>
            载体断了，这件事没结束。按「继续」它接着做——<b>结果仍然发回原来那个会话</b>。
          </span>
        )}
        <span className={css.acceptNote}>
          {round > 0 && `已返工 ${String(round)} 轮${text(state.reason) === '' ? '' : `：${text(state.reason)}`} · `}
          {settled
            ? text(state.reason) === '' ? '终态已定。' : `原因：${text(state.reason)}`
            : '也可在云之家回复「验收」「打回 <原因>」「作废 <原因>」。'}
        </span>
      </div>
    )
  }

  // 确认卡 — the form you read before signing.
  if (card.kind === 'approval') {
    const strong = text(state.level) === 'strong'
    const args = Object.entries(record(state.args))
    const deadline = clock(state.deadline)
    const done = status === 'approved'
    const dead = status !== 'pending' && !done
    return (
      <div className={`${css.card} ${css.approval} ${done ? css.approvalDone : ''} ${dead ? css.approvalDead : ''}`}>
        <div className={css.head}>
          <span className={`${css.domain} ${done ? css.domainGreen : dead ? css.domainGrey : css.domainAmber}`}>
            云之家 · {STATUS[status] ?? status}
          </span>
          <span className={css.title}>{text(state.reason) || '需要确认'}</span>
          {/*
            徽标说的是**这道门为什么在这儿**，不是一句关于后果的断言。

            强风险这一族有两种理由：做了收不回（删文档、作废），或者改变触达面（建群、
            把一条惯例记成「不限场所」）。后者是撤销得掉的，而卡上顶着「不可撤销」，
            这张卡自己就成了那句谎——和场所合同面板那一格同一处病。
          */}
          {strong && <span className={css.risk}>强风险 · 每次都问</span>}
        </div>
        <div className={css.fields}>
          <span className={css.fieldKey}>工具</span>
          <span className={`${css.fieldValue} ${css.fieldMono}`}>{text(state.toolName)}</span>
          {args.map(([key, value]) => (
            <Fragment key={key}>
              <span className={css.fieldKey}>{key}</span>
              <span className={css.fieldValue}>
                {flatten(value, weight ? SPREAD_LIMIT : ARG_LIMIT)}
              </span>
            </Fragment>
          ))}
          {deadline !== undefined && status === 'pending' && (
            <>
              <span className={css.fieldKey}>期限</span>
              <span className={css.fieldValue}>{deadline} 前未答复即自动拒绝</span>
            </>
          )}
        </div>
        {status === 'pending'
          ? <div className={css.actions}>{buttons('拒绝理由（可选）')}</div>
          : (
            <div className={`${css.foot} ${done ? css.footDone : ''}`}>
              {done ? '已放行，操作已执行。' : `${STATUS[status] ?? status}${text(state.reason) === '' ? '' : ''}`}
            </div>
          )}
      </div>
    )
  }

  // 承诺卡 — somebody's name against a date.
  if (card.kind === 'commitment') {
    const executor = record(state.executor)
    const human = text(executor.kind) === 'human'
    const due = text(state.due)
    const settled = status === 'closed' || status === 'voided'
    return (
      <div className={`${css.card} ${css.commitment}`}>
        <div className={css.head}>
          <span className={`${css.exTag} ${human ? css.exHuman : css.exAgent}`}>
            {human ? (text(executor.name) || text(executor.openId) || '某人') : 'agent'}
          </span>
          <span className={css.title}>{text(state.what)}</span>
          <span className={`${css.domain} ${settled ? css.domainGrey : css.domainViolet}`}>
            {STATUS[status] ?? status}
          </span>
        </div>
        <div className={css.fields}>
          {due !== '' && (
            <>
              <span className={css.fieldKey}>期限</span>
              <span className={css.fieldValue}>{due}</span>
            </>
          )}
          {text(state.lastReceipt) !== '' && (
            <>
              <span className={css.fieldKey}>最新回执</span>
              <span className={css.fieldValue}>{text(state.lastReceipt)}</span>
            </>
          )}
          {text(state.parentGoalRef) !== '' && (
            <>
              <span className={css.fieldKey}>挂在目标</span>
              <span className={css.fieldValue}>
                {text(state.parentGoalRef)}
                {text(state.attachedVia) === 'inferred' && ' · 推断待核，可回复「改挂 <目标>」'}
              </span>
            </>
          )}
          {/*
            负重档：**把已经在图上的证据摆出来** —— 交付主张的原话与返工轮次。

            默认档下它们不占位（卡是入口不是全文），而负重档的整个意思就是「你先看，
            我再补」。摆的是同一份数据，不是新造的一段话：证据只能来自图。
          */}
          {weight && text(record(state.delivery).claim) !== '' && (
            <>
              <span className={css.fieldKey}>交付主张</span>
              <span className={css.fieldValue}>
                {flatten(record(state.delivery).claim, SPREAD_LIMIT)}
              </span>
            </>
          )}
          {weight && typeof state.round === 'number' && state.round > 0 && (
            <>
              <span className={css.fieldKey}>已返工</span>
              <span className={css.fieldValue}>
                {String(state.round)} 轮{text(state.reason) === '' ? '' : `：${text(state.reason)}`}
              </span>
            </>
          )}
        </div>
        {actions.length > 0
          ? <div className={css.actions}>{buttons('作废理由')}</div>
          : <div className={css.foot}>也可在云之家回复这张卡作答。</div>}
      </div>
    )
  }

  /*
    提案裁决卡 — 逐条，且确认即签发 (v4.9).

    Per-item buttons rather than "type the numbers you mean": deciding item by
    item is the whole ritual, and making somebody transcribe indices into a box
    turns three decisions into one typo. The text channel keeps the numbered
    form for people answering from Yunzhijia — same action ids, same state
    machine, one arbiter.

    There is deliberately NO second confirmation. 一次主权时刻一次确认: the press
    IS the signature, and the registration utterance that follows is its
    mechanical consequence, not another thing to approve.
  */
  if (card.kind === 'proposal') {
    const items = Array.isArray(state.items) ? state.items : []
    const decisions = record(state.decisions)
    const isGoal = text(state.kind) === 'goal'
    // 同一张卡四种模式：提案（立目标 / 拆解）、裁决卡（发现）、交付推断（提议）。
    const isFinding = text(state.kind) === 'finding'
    const isDelivery = text(state.kind) === 'delivery'
    const settled = card.resolved
    /*
      按下去必须真的发生一件事 (v4.10 人签发).

      A goal proposal mints nothing unless a body link is available, and the
      bus answers 「已记录。」 for a transition that produced no events — so an
      enabled button here produced a success receipt, no goal, and no clue.
      The one press the whole design calls 签发 must never be a no-op, so the
      condition that decides whether anything happens also decides whether the
      button is live.

      Scheme-less is accepted (`www.yunzhijia.com/doc/…` is what the address-bar
      chip yields); anything that is not a link at all is not, because the node
      side treats "typed but not a link" as "do not use the old one".
    */
    const typed = input.trim()
    const looksLikeLink = /^(https?:\/\/)?[^\s/]+\.[^\s/]+/u.test(typed)
    const canSign = !isGoal
      || (typed === '' ? text(state.goalRef) !== '' : looksLikeLink)
    const decide = (id: string, index: number): void => {
      if (id === 'confirmed' && !canSign) return
      // 转办 <编号> <姓名>：名字从下面那一栏来，空着就不发——没有去向的转办不是转办。
      if (id === 'transferred') {
        if (input.trim() === '') return
        act(card.kind, card.id, id, `${String(index + 1)} ${input.trim()}`)
        setInput('')
        return
      }
      act(card.kind, card.id, id, isGoal ? (input === '' ? undefined : input) : String(index + 1))
      setInput('')
    }
    return (
      <div className={`${css.card} ${css.proposal}`}>
        <div className={css.head}>
          <span className={`${css.domain} ${settled ? css.domainGrey : css.domainAmber}`}>
            {isFinding ? '裁决卡 · 发现' : isDelivery ? '交付推断' : `提案 · ${isGoal ? '立目标' : '拆解'}`}
            {settled ? ' · 已裁决' : isDelivery ? ' · 待确认' : ' · 待裁决'}
          </span>
          <span className={css.title}>{text(state.title)}</span>
        </div>
        {isGoal && text(state.criteria) !== '' && (
          <div className={css.fields}>
            <span className={css.fieldKey}>怎么算完成</span>
            <span className={css.fieldValue}>{text(state.criteria)}</span>
          </div>
        )}
        <div className={css.items}>
          {items.map((raw, index) => {
            const item = record(raw)
            const decided = text(decisions[String(index)])
            return (
              <div className={css.item} key={`${card.id}:${String(index)}`}>
                <span className={css.itemNo}>{index + 1}</span>
                <span className={css.itemWhat}>{text(item.what)}</span>
                {(isFinding || isDelivery)
                  ? (text(item.evidence) === '' ? null : <span className={css.itemWhere}>依据：{text(item.evidence)}</span>)
                  : (
                    <span className={css.itemWho}>
                      {text(item.executorName) || text(item.executorOpenId) || '未定'}
                      {text(item.due) === '' ? '' : ` · ${text(item.due)}`}
                    </span>
                  )}
                {/*
                  场所是委派话语的一等参数——它得写在卡上，不能只活在实现里。

                  And it has to be the EFFECTIVE destination: an item with no
                  place of its own still lands in the conversation the proposal
                  was made in, so showing only `item.placeName` left this blank
                  while confirming would post into a real group. Blank where
                  something will happen is the worst of the three states.
                */}
                {!isGoal && !isFinding && !isDelivery && (() => {
                  // A place KEY is a hex handle, not a name. When the item has
                  // no place of its own it lands here, and「这个会话所在的群」
                  // is the true, readable answer — printing the key would be
                  // technically correct and useless to somebody signing.
                  const where = text(item.placeName) !== ''
                    ? text(item.placeName)
                    : text(item.placeKey) !== ''
                      ? text(item.placeKey)
                      : text(state.placeKey) !== '' ? '这个会话所在的群' : ''
                  return where === ''
                    ? (
                      <span className={css.itemNowhere}>
                        ⚠ 没有可投递的会话，确认后需你亲自去说
                      </span>
                    )
                    : <span className={css.itemWhere}>登记发到「{where}」</span>
                })()}
                {decided !== '' && (
                  <span className={`${css.itemMark} ${
                    decided === 'confirmed' ? css.markOk : decided === 'rejected' ? css.markNo : css.markHold
                  }`}
                  >
                    {decided === 'confirmed' ? '已确认' : decided === 'rejected' ? (isDelivery ? '不是交付' : '已驳回') : decided === 'transferred' ? '已转办' : '已挂起'}
                  </span>
                )}
                {/*
                  挂起 = 「不是现在」，所以它必须还能变成「是」或「不」。
                  Hiding the controls once an item was held made 挂起 a one-way
                  door: on a desktop-only proposal there is no text projection
                  to reply 「确认 2」 into, so the only exit left was 收起 —
                  which discards it. That turns the third answer into a slower
                  rejection, which is exactly the distinction it exists to keep.
                */}
                {(decided === '' || decided === 'held') && !settled
                  && (
                      <span className={css.itemActs}>
                        <button
                          type="button"
                          className={`${css.button} ${css.primary}`}
                          disabled={busy || !canSign}
                          title={canSign
                            ? undefined
                            : '先把云之家目标文档的链接贴进下面那一栏——目标的真身不在这里，没有它就没有可签发的东西'}
                          onClick={() => { decide('confirmed', index) }}
                        >
                          确认
                        </button>
                        <button
                          type="button"
                          className={css.button}
                          disabled={busy}
                          onClick={() => { decide('rejected', index) }}
                        >
                          {isDelivery ? '不是交付' : '驳回'}
                        </button>
                        {isFinding && (
                          <button
                            type="button"
                            className={css.button}
                            disabled={busy || input.trim() === ''}
                            title={input.trim() === '' ? '先在下面那一栏写上转办给谁' : `给「${input.trim()}」立一条承诺，证据一起带过去`}
                            onClick={() => { decide('transferred', index) }}
                          >
                            转办
                          </button>
                        )}
                        {!isGoal && !isDelivery && decided !== 'held' && (
                          <button
                            type="button"
                            className={css.button}
                            disabled={busy}
                            onClick={() => { decide('held', index) }}
                          >
                            挂起
                          </button>
                        )}
                      </span>
                    )}
              </div>
            )
          })}
        </div>
        {isFinding && !settled && (
          <div className={css.actions}>
            <input
              className={css.input}
              value={input}
              placeholder="转办给谁（姓名）——按某一条的「转办」时用"
              disabled={busy}
              onChange={(event) => { setInput(event.target.value) }}
            />
          </div>
        )}
        {isGoal && !settled && (
          <div className={css.actions}>
            <input
              className={css.input}
              value={input}
              placeholder={text(state.goalRef) === ''
                ? '云之家目标文档的链接（必填——真身不在这里）'
                : `真身：${text(state.goalRef)}（要换的话贴新链接）`}
              disabled={busy}
              onChange={(event) => { setInput(event.target.value) }}
            />
            {!canSign && (
              <span className={css.signHint}>
                {typed === ''
                  ? '贴上链接才能确认——没有真身的目标行，正是这套设计拒绝画出来的东西。'
                  : '这看起来不像一个链接。写错了就直接改，它不会退回用旧的那个。'}
              </span>
            )}
          </div>
        )}
        <div className={css.foot}>
          {settled
            ? (isDelivery ? '已答。' : '已裁决。没被确认的条目不会变成任何人的活。')
            : isGoal
              ? '确认才算你签发——agent 只能提案。'
              : isFinding
                ? '确认 = 这条发现成立（改动仍要过写确认）；转办 = 给那个人立一条承诺，证据一起带过去。确认之前不动数据。'
                : isDelivery
                  ? '确认 = 以你的名义把「已交付」回到登记场所，那条承诺进入待验收；不是交付 = 这个文件与它无关，不再问。'
                  : '确认一条即签发一条：那条承诺会以你的名义发到执行者所在的会话，不会静默落库。'}
          {!settled && actions.some(action => action.id === 'settle') && (
            <button
              type="button"
              className={css.linkBtn}
              disabled={busy}
              onClick={() => { act(card.kind, card.id, 'settle') }}
            >
              收起
            </button>
          )}
        </div>
      </div>
    )
  }

  /*
    差距简报 — 验收权 ≠ 验收材料 (v4.10).

    Every line carries the object it was read off. That column is the whole
    difference between this and an OKR check-in: one cites the graph, the other
    asks somebody how they feel it is going.
  */
  if (card.kind === 'assessment') {
    const lines = Array.isArray(state.lines) ? state.lines : []
    const done = status !== 'open'
    return (
      <div className={`${css.card} ${css.assessment}`}>
        <div className={css.head}>
          <span className={`${css.domain} ${done ? css.domainGrey : css.domainViolet}`}>
            差距简报{status === 'accepted' ? ' · 已验收' : status === 'continued' ? ' · 继续' : ''}
          </span>
          <span className={css.title}>{text(state.goalName) || text(state.goalRef)}</span>
        </div>
        <div className={css.reportBody}>{text(state.summary)}</div>
        <div className={css.items}>
          {lines.map((raw, index) => {
            const line = record(raw)
            const verdict = text(line.verdict)
            return (
              <div className={css.item} key={`${card.id}:${String(index)}`}>
                <span className={`${css.itemMark} ${
                  verdict === 'met' ? css.markOk : verdict === 'partial' ? css.markHold : css.markNo
                }`}
                >
                  {verdict === 'met' ? '已达成' : verdict === 'partial' ? '部分' : '缺失'}
                </span>
                <span className={css.itemWhat}>{text(line.criterion)}</span>
                <span className={css.itemWho}>{text(line.evidence)}</span>
              </div>
            )
          })}
        </div>
        {actions.length > 0
          ? <div className={css.actions}>{buttons('（不需要说明）')}</div>
          : null}
        <div className={css.foot}>
          {done
            ? status === 'accepted' ? '你验收了这个目标。' : '看过了，目标继续。'
            : '这是材料，不是判决——验收是你的动作。缺口要变委派，去承诺板的这个目标上按「变委派」。'}
        </div>
      </div>
    )
  }

  // 冲突 / 等待 — the two that pause work rather than produce it.
  const conflict = card.kind === 'conflict'
  return (
    <div className={`${css.card} ${conflict ? css.conflict : css.waiting}`}>
      <div className={css.head}>
        <span className={`${css.domain} ${conflict ? css.domainAmber : css.domainGrey}`}>
          {KIND_LABEL[card.kind] ?? card.kind} · {STATUS[status] ?? status}
        </span>
        <span className={css.title}>
          {text(state.what) || text(state.note) || text(state.summary) || KIND_LABEL[card.kind]}
        </span>
      </div>
      <div className={css.fields}>
        {text(state.newInstruction) !== '' && (
          <>
            <span className={css.fieldKey}>新指令</span>
            <span className={css.fieldValue}>{text(state.newInstruction)}</span>
          </>
        )}
        {text(state.priorInstruction) !== '' && (
          <>
            <span className={css.fieldKey}>原指令</span>
            <span className={css.fieldValue}>{text(state.priorInstruction)}</span>
          </>
        )}
        {text(state.waitingFor) !== '' && (
          <>
            <span className={css.fieldKey}>在等</span>
            <span className={css.fieldValue}>{text(state.waitingFor)}</span>
          </>
        )}
      </div>
      {actions.length > 0
        ? <div className={css.actions}>{buttons('说明（可选）')}</div>
        : <div className={css.foot}>也可在云之家回复这张卡作答。</div>}
    </div>
  )
}

/**
 * 私条 —— 长在裁决卡下的四种条，**全部仅操作者可见，全部只在桌面**（接缝⑤）。
 *
 * 押条 / 回执条（当时 × 后来两栏照片 + 归因四格 + 「这不是那件事的结果」+ 「以后这类事…」）
 * / 「先看」摆开条（要求 × 交付）/ 「上次」判例条（同族判例 ≤2）。不在场时整块不画。
 */
function PledgerTail(props: CardRowProps): ReactNode {
  const { card, inject, pledgeOn } = props
  const strips = card.strips ?? []
  const [note, setNote] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [gearAt, setGearAt] = useState<string | undefined>(undefined)
  const [gearHead, setGearHead] = useState<FamilyHeadWire | undefined>(undefined)
  const [editing, setEditing] = useState<{ key: string; text: string } | undefined>(undefined)
  const seen = useRef(new Set<string>())
  const receipts = strips.filter((strip): strip is Extract<StripWire, { kind: 'receipt' }> => strip.kind === 'receipt')
  useEffect(() => {
    const fresh = receipts.filter(strip => !strip.row.seen && !seen.current.has(strip.row.calibrationId)).map(strip => strip.row.calibrationId)
    if (fresh.length === 0 || inject === undefined) return
    for (const id of fresh) seen.current.add(id)
    void inject.markSeen(fresh)
  }, [receipts, inject])
  if ((strips.length === 0 && card.pledgeHandle === undefined) || inject === undefined) return null

  const run = (action: () => Promise<{ error?: string; note?: string }>): void => {
    setBusy(true)
    void action().then((result) => { setNote(result.error ?? result.note); setEditing(undefined) }).finally(() => { setBusy(false) })
  }
  const tiny = (label: string, title: string, onClick: () => void): ReactNode => (
    <button type="button" className={css.button} disabled={busy} title={title} onClick={onClick}>{label}</button>
  )
  const photo = (one: AnchoredTextWire, index: number): ReactNode => (
    <div key={`${one.at}:${String(index)}`} className={css.mirrorCase}>{one.text}</div>
  )
  const openGear = (family: string, key: string): void => {
    if (gearAt === key) { setGearAt(undefined); return }
    void inject.judg().then((view) => {
      setGearHead(view?.groups.find(group => group.head.family === family)?.head)
      setGearAt(key)
    })
  }

  return (
    <div className={css.pledgerTail}>
      {note !== undefined && <div className={css.gearNote}>{note}</div>}
      {card.pledgeHandle !== undefined && pledgeOn !== undefined && (
        <div className={css.mirror}>
          <span className={css.mirrorMark}>🔒</span>
          <span className={css.twoReadLine}>{tiny('押一句 ›', '对这次裁决押一句可证伪的话——有结果时回到这张卡下面；只有你能看到', () => { pledgeOn(card.pledgeHandle ?? '') })}</span>
        </div>
      )}
      {strips.map((strip, index) => {
        if (strip.kind === 'pledge') {
          const row = strip.row
          return (
            <div key={`pledge:${row.expectationId}`} className={css.mirror}>
              <span className={css.mirrorMark}>🔒</span>
              <span className={css.mirrorBody}>
                <span className={css.mirrorNote}>只有你能看到 · 押</span>
                「<b>{row.text}</b>」{row.status === 'settled' ? ' · 已见分晓' : row.premise === 'changed' ? ' · ⚠ 前提已变' : ` · ${row.checkpointText}见分晓`}
                {row.status !== 'settled' && row.status !== 'withdrawn' && (
                  <span className={css.twoReadLine}>
                    {tiny('撤回', '撤回留痕不删史；撤回之后这条裁决不能再押', () => { setEditing({ key: `withdraw:${row.expectationId}`, text: '' }) })}
                  </span>
                )}
                {editing?.key === `withdraw:${row.expectationId}` && (
                  <span className={css.twoReadLine}>
                    <input className={css.input} placeholder="为什么撤回？（留空也行）" value={editing.text} onChange={(event) => { setEditing({ key: editing.key, text: event.target.value }) }} />
                    {tiny('记下', '', () => { run(() => inject.withdrawExpectation(row.expectationId, editing.text.trim())) })}
                  </span>
                )}
              </span>
            </div>
          )
        }
        if (strip.kind === 'receipt') {
          const row = strip.row
          const cellNote = (id: 'q1' | 'q2' | 'q3' | 'q4'): string => (
            id === 'q1' ? '你当时看到的，就是后来发生的'
              : id === 'q2' ? '结果是好的，但不是因为你当时看到的那些'
                : id === 'q3' ? (row.then[1] === undefined ? '当时卡上有的，你没看' : `「${row.then[1].text}」当时就在卡上`)
                  : '后来的事，当时看不到')
          return (
            <div key={`receipt:${row.calibrationId}`} className={css.twoRead} data-testid="strip-receipt">
              <span className={css.twoReadHead}>🔒 只有你能看到 · 回执 · <b>{row.type === 'pledged' ? '押过的' : row.type === 'reversed' ? '同意了，被现实推翻' : '没同意，被现实印证'}</b></span>
              <span className={css.twoReadBody}>
                <span className={css.twoReadLine}><b>你当时</b> · {row.verdict.text}</span>
                {row.then.map(photo)}
                <span className={css.twoReadLine}><b>后来</b>{row.later.length === 0 ? ' · 还没有结果——到「我的判断」里补一句' : ''}</span>
                {row.later.map(photo)}
                {row.dismissed
                  ? <span className={css.twoReadLine}>这不是那件事的结果——没记入。{(['q1', 'q2', 'q3', 'q4'] as const).map(id => tiny(ATTRIBUTION_LABEL[id], '记回来', () => { run(() => inject.attribute(row.calibrationId, id)) }))}</span>
                  : row.attributionLabel !== undefined
                    ? (
                      <span className={css.twoReadLine}>
                        <b>{row.attributionLabel}</b> · 已记 · 想改随时改
                        {(['q1', 'q2', 'q3', 'q4'] as const).filter(id => id !== row.attribution).map(id => tiny(ATTRIBUTION_LABEL[id], cellNote(id), () => { run(() => inject.attribute(row.calibrationId, id)) }))}
                        {tiny('以后这类事… ›', '先看本族的 2×2，再决定改不改规矩', () => { openGear(row.family, row.calibrationId) })}
                      </span>
                    )
                    : (
                      <span className={css.twoReadLine}>
                        <b>这次算什么？</b>（你来定）
                        {(['q1', 'q2', 'q3', 'q4'] as const).map(id => tiny(ATTRIBUTION_LABEL[id], cellNote(id), () => { run(() => inject.attribute(row.calibrationId, id)) }))}
                        {tiny('这不是那件事的结果', '判例不入账；想记回来再按一格即可', () => { run(() => inject.dismissReceipt(row.calibrationId)) })}
                      </span>
                    )}
                {gearAt === row.calibrationId && gearHead !== undefined && (
                  <GearBox head={gearHead} inject={inject} busy={busy} done={(text) => { setGearAt(undefined); setNote(text) }} />
                )}
              </span>
            </div>
          )
        }
        if (strip.kind === 'spread') {
          return (
            <div key={`spread:${String(index)}`} className={css.twoRead} data-testid="strip-spread">
              <span className={css.twoReadHead}>🔒 你定的规矩 · 先看 · 要求 × 交付</span>
              <span className={css.twoReadBody}>
                <span className={css.twoReadLine}><b>要求</b></span>
                {strip.requirements.map(photo)}
                <span className={css.twoReadLine}><b>交付</b></span>
                {strip.delivery.map(photo)}
                <span className={css.mirrorNote}>不预选、无一键通过——主动作要按两下。</span>
              </span>
            </div>
          )
        }
        return (
          <div key={`mirror:${String(index)}`} className={css.mirror} data-testid="strip-mirror">
            <span className={css.mirrorMark}>🔒</span>
            <span className={css.mirrorBody}>
              <span className={css.mirrorNote}>你定的规矩 · 上次 · 你在{strip.family}上的结果：</span>
              {strip.cases.map(one => (
                <span key={one.calibrationId} className={css.mirrorCase}>
                  {when(one.verdict.at)} · {one.attributionLabel ?? ''}：{one.verdict.text} → {one.later[0]?.text ?? ''}
                </span>
              ))}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const ATTRIBUTION_LABEL = { q1: '对了 · 因判断', q2: '对了 · 因运气', q3: '错了 · 因判断', q4: '错了 · 因世界' } as const

const when = (at: string): string => {
  const parsed = Date.parse(at)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : at
}
