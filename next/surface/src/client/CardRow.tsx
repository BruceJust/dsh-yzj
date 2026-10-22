/**
 * 一张卡 —— 一个等人答的图对象，长在它发问的地方 (界面重设计 §5.2).
 *
 * 卡是对象的投影，不是一个有状态的部件（卡片三定律①）：这里只存人正在敲的那几个字，
 * 每一个按钮都回到动作总线——云之家里回关键词走的也是那条总线。「两处都能答、只生效
 * 一次」因此是结构，不是愿望。
 *
 * **一套语法，六种模式**。此前每一族各画各的：确认是一张表单，验收是一条横杠，承诺是
 * 一个名字配一个日期——它们各有道理，可放在一起，人每次都得重新认一遍「这张卡要我干
 * 什么」。现在每张卡都是同一副骨架：
 *
 *     ● 要你确认 · 云小助停在这一步等你 · 5 分钟
 *     写入 12 条记录到「竞品对比 · 评审表」
 *     写操作，照规矩写之前先问你一次。
 *     ┌ 参数的一行摘要 … ┐                         看参数
 *     ✦ 这类写入你已经连续确认 5 次，没拒过一次。  以后同类不用问 ›
 *     [1 确认] [2 取消]                             云之家里回 1 / 2 也行
 *
 * 差别只在中间那一块（参数、交付物、逐条、差距）。号是服务端编的，和云之家里「回 1 / 2」
 * 是同一张表（`numberedActions`）。
 *
 * **每一次回答都先进撤回窗**（律七）：卡立刻收成一行虚线框，5 秒后才真的落账。
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { AnchoredTextWire, FamilyHeadWire, NeedWire, StreamCard, StripWire, SurfaceInject } from './rpc.ts'
import { GearBox } from './Judg.tsx'
import { AgentFace, Icon } from './icons.tsx'
import { AGENT, approvalVerbs, dueDayText, span, waitLine, whenOf, whereOf } from './words.ts'
import { registerCardKeys, stagedNow, subscribeStaged, undo, UNDO_MS, type Answer } from './answers.ts'
import { artifactRefOf } from './artifacts.ts'
import { openPreview, revealAside, type PreviewTarget } from './preview.ts'
import { jumpToNeed, setSpotlight } from './store.ts'
import { NeedMark } from './NeedMark.tsx'
import css from './card.module.css'

type Action = StreamCard['actions'][number]

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 一个参数值摊平成一行。负重档下不截：「证据摆开」的意思就是你能看见全部。 */
function flatten(value: unknown, limit: number): string {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  const flat = rendered.replace(/\s+/gu, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function clock(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  const when = new Date(value)
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
}

/**
 * 答完之后那一行怎么说 —— 用人做了什么来说，不用按钮的名字。
 *
 * 「你先不签了」「你按新指令了」是按钮名硬拼出来的句子；人回想自己做过什么的时候，
 * 说的是「你让它按新指令做」。
 */
const SAID: Record<string, string> = {
  'approval:approve': '确认了',
  'approval:reject': '取消了',
  'approval:retry': '让它重试',
  'task:accept': '通过了验收',
  'task:reject': '打回了',
  'task:resume': '让它继续',
  'task:void': '作废了',
  'commitment:done': '标了完成',
  'commitment:accept': '通过了验收',
  'commitment:reject': '打回了',
  'commitment:publish': '写进了目标文档',
  'commitment:unpublish': '没写进目标文档',
  'commitment:void': '作废了',
  'lease:grant': '签了这条规矩',
  'lease:decline': '先没签',
  'lease:revoke': '收回了这条规矩',
  'conflict:continue': '让它照原来的做',
  'conflict:cancel': '让它按新指令做',
  'waiting:resolve': '标了已解决',
  'assessment:accept': '验收了这个目标',
  'assessment:continue': '让目标继续',
  'proposal:confirmed': '定了',
}

/** 没有人答、自己走到终点的卡，各自怎么收尾。 */
const SETTLED: Record<string, string> = {
  expired: '没等到回答，到点自动取消了',
  superseded: '已经重新发起了',
  rejected: '取消了',
  approved: '确认了',
  accepted: '验收通过了',
  voided: '作废了',
  closed: '办完了',
  merged: '合并到另一条里了',
  transferred: '移交给别人了',
  revoked: '规矩已收回',
  declined: '没签',
  resolved: '已解决',
  continued: '目标继续',
}

/** 卡的标题：这件事是什么。每一族的「是什么」住在不同的字段里。 */
export function titleOf(card: StreamCard): string {
  const state = record(card.state)
  if (card.kind === 'approval') return text(state.reason).replace(/^云之家操作确认[：:]\s*/u, '') || '一次写操作'
  if (card.kind === 'lease') return text(state.reason)
  if (card.kind === 'proposal') return text(state.title)
  if (card.kind === 'assessment') return text(state.goalName) || '这个目标还差什么'
  return text(state.what) || text(state.summary) || text(state.note) || card.demand?.label || ''
}

/** 谁在等你。等你的是一个人时说人；是云小助时说它停在哪儿。规矩卡没人在等。 */
function waitingOf(card: StreamCard, now: number): string | undefined {
  const state = record(card.state)
  if (card.kind === 'lease') return undefined
  if (card.kind === 'commitment') {
    const executor = record(state.executor)
    const who = text(executor.kind) === 'human' ? (text(executor.name) || '对方') : AGENT
    return waitLine(who, card.at, now)
  }
  if (card.kind === 'approval') {
    const waited = now - card.at
    return waited < 60_000 ? `${AGENT}停在这一步等你` : `${AGENT}停在这一步等你 · ${span(waited)}`
  }
  return waitLine(AGENT, card.at, now)
}

/** 交付物里**能打开来看**的那几个——验收「先并排看」看的就是它们。 */
function filesOf(card: StreamCard): { readonly targets: PreviewTarget[]; readonly links: { title: string; href: string }[] } {
  const state = record(card.state)
  const targets: PreviewTarget[] = []
  const links: { title: string; href: string }[] = []
  if (card.kind !== 'task' || !Array.isArray(state.artifacts)) return { targets, links }
  for (const raw of state.artifacts) {
    const one = record(raw)
    const ref = artifactRefOf({ uri: text(one.uri), title: text(one.title) })
    if (ref.fileId !== undefined) targets.push({ ...ref, fileId: ref.fileId })
    else if (ref.href !== undefined) links.push({ title: ref.title, href: ref.href })
  }
  return { targets, links }
}

/** 按钮上的字：说清按下去的是什么（「确认写入」「通过验收」），不只一个「确认」。 */
function labelOf(card: StreamCard, action: Action): string {
  if (card.kind === 'approval' && (action.id === 'approve' || action.id === 'reject')) {
    const verbs = approvalVerbs(text(record(card.state).toolName))
    return action.id === 'approve' ? verbs.yes : verbs.no
  }
  if (card.kind === 'task' && action.id === 'accept') {
    // 打回之后再收：收的不是一份新交付，是「不用再改了」。
    return text(record(card.state).status) === 'terminal' ? '通过验收' : '就这样收了'
  }
  if (card.kind === 'commitment' && action.id === 'accept') return '通过验收'
  if (card.kind === 'task' && action.id === 'resume' && typeof record(card.state).round === 'number') return '接着改'
  return action.label
}

/**
 * 话说成了裁决的样子，门在卡上 (返工闭环实测 2026-10-21).
 *
 * 人对着云小助说「完成了」，云小助答「好，这件事就算完成了」——它改不了任务的状态，图上
 * 什么都没动。收口是人签的字，签字的地方是卡：所以在发出之前就指向那扇真的门，而不是
 * 把一句话悄悄当成签字（「可以再加一列吗」也以「可以」开头）。只认整句就是一个裁决词的。
 */
const VERDICT = /^(?:完成了?|做完了|好了|可以了?|行了?|没问题了?|就这样吧?|收了|通过|验收|ok|done)[。！!.~～\s]*$/iu

export function verdictDoor(draft: string, cards: readonly StreamCard[]): string | undefined {
  if (!VERDICT.test(draft.trim())) return undefined
  for (const card of cards) {
    if (card.kind !== 'task' || card.resolved) continue
    const accept = card.actions.find(action => action.id === 'accept' && action.available)
    if (accept === undefined) continue
    const label = labelOf(card, accept)
    return `要把这件活收口，按卡上的${accept.n === undefined ? '' : ` ${String(accept.n)}`}「${label}」——${AGENT}改不了任务的状态，说给它不算数。`
  }
  return undefined
}

/** 这一笔要不要先写一句原因。打回、作废要；写确认的「取消」不必（原因可选，快路优先）。 */
function needsReason(card: StreamCard, action: Action): 'required' | 'optional' | undefined {
  if (!action.needsInput) return undefined
  if (card.kind === 'approval') return undefined
  return action.id === 'reject' || action.id === 'void' ? 'required' : 'optional'
}

export interface CardRowProps {
  card: StreamCard
  /** 墙钟。等了多久、几秒后生效都从它算。 */
  now: number
  /** 流里此刻「当前」的那张（J/K、落点、点过它）——数字键答它。 */
  current?: boolean
  /** 作答：进撤回窗。 */
  answer(answer: Answer): void
  /** 私条上的动词走它。不给 = 这张卡长在没有私账的地方，私条整块不画。 */
  inject?: SurfaceInject
  /** 引用指名押：把句柄放进私语道 composer（「押 [card#…]：」），由人把话说完。 */
  pledgeOn?(handle: string): void
  /** 这张刚在这里答过：吸收行下面接「下一件」。值是下一件（没有了 = undefined）。 */
  next?: { readonly need: NeedWire | undefined }
  /** 律九：起草一条等你签的规矩。 */
  proposeRule?(hint: NonNullable<StreamCard['ruleHint']>): void
  /** 点进卡里 = 它成了当前的那张。 */
  focus?(): void
}

export function CardRow(props: CardRowProps): ReactNode {
  const { card } = props
  const staged = useSyncExternalStore(subscribeStaged, stagedNow)
  const pending = staged.find(one => one.kind === card.kind && one.id === card.id)
  return (
    <>
      {pending !== undefined
        ? <Absorbed card={card} now={props.now} pending={{ said: pending.said, deadline: pending.deadline, landing: pending.landing }} />
        : card.resolved
          ? <Absorbed card={card} now={props.now} />
          : card.kind === 'proposal'
            ? <Verdicts {...props} />
            : card.kind === 'commitment' && card.demand === undefined
              ? <Registered card={card} now={props.now} />
              : <OpenCard {...props} />}
      {/* 「下一件」只长在答过的卡下（窗里的也算：不必等 5 秒才往下走）；撤回之后卡又开着，它就不在了。 */}
      {(pending !== undefined || card.resolved) && props.next !== undefined && <NextLine need={props.next.need} now={props.now} />}
      <PledgerTail {...props} />
    </>
  )
}

/**
 * 吸收行 —— 答完的卡收成一行 (§5.2 回答之后).
 *
 * 虚线是「待生效」（还在撤回窗里，按 Z 能撤），实线是「已生效」。已生效的写明**在哪、由谁**
 * 答的：一个对象有好几处投影，这一行就是它们之所以可信的那条出处。
 */
function Absorbed(props: {
  card: StreamCard
  now: number
  pending?: { said: string; deadline: number; landing: boolean }
}): ReactNode {
  const { card, now, pending } = props
  const title = titleOf(card)
  if (pending !== undefined) {
    const left = Math.max(0, Math.ceil((pending.deadline - now) / 1_000))
    return (
      <div className={`${css.absorbed} ${css.absorbedPending}`} data-testid="card-pending">
        <Icon name="check" size={14} className={css.absorbedMark} />
        <span className={css.absorbedText}>
          {pending.said}
          {title === '' ? '' : <span className={css.absorbedTitle}> · {title}</span>}
        </span>
        {pending.landing
          ? <span className={css.absorbedWhen}>正在生效…</span>
          : (
            <>
              <span className={css.absorbedWhen}>{left > 0 ? `${String(left)} 秒后生效` : '马上生效'}</span>
              <button
                type="button"
                className={css.undo}
                onClick={() => { undo(card) }}
              >
                <Icon name="undo" size={13} />撤回<kbd className={css.kbd}>Z</kbd>
              </button>
            </>
          )}
      </div>
    )
  }
  const state = record(card.state)
  const status = text(state.status)
  const answered = card.answered
  const negative = /^(rejected|voided|expired|declined|revoked)$/u.test(status)
  const line = answered !== undefined
    ? `${answered.mine ? '你' : (answered.who ?? '有人')}${whereOf(answered.via)}${answered.via === 'yzj-text' ? `回了「${answered.label}」` : (SAID[`${card.kind}:${answered.actionId}`] ?? `${answered.label}了`)}`
    : SETTLED[status] ?? '已处理'
  return (
    <div className={css.absorbed} data-testid="card-absorbed">
      <Icon name={negative ? 'x' : 'check'} size={14} className={negative ? css.absorbedMarkOff : css.absorbedMark} />
      <span className={css.absorbedText}>
        {line}
        {title === '' ? '' : <span className={css.absorbedTitle}> · {title}</span>}
        {text(state.reason) !== '' && card.kind !== 'approval' && card.kind !== 'lease' && (
          <span className={css.absorbedTitle}>：{text(state.reason)}</span>
        )}
      </span>
      {answered !== undefined && <span className={css.absorbedWhen}>{whenOf(answered.at, now)}</span>}
    </div>
  )
}

/**
 * 登记回执 —— 一条承诺记下了，流里只留一行 (§5.3「✓ 记下了：张锐负责 · 价格页数据 ·
 * 原话「明天」→ 周二 [改]」)。
 *
 * 此前这里是一整张承诺卡：头上「承诺 · 张锐负责」，身上又一句「张锐负责 · 原话…」，说了
 * 两遍，却没说那句原话解析成了哪天——而「明天」到底是哪天，正是登记时最该核对的那一下。
 * 先原话、再结果；认不出的只写原话。改（改期、换人、作废、挂目标）在右栏的来龙去脉里。
 */
function Registered(props: { card: StreamCard; now: number }): ReactNode {
  const { card, now } = props
  const state = record(card.state)
  const executor = record(state.executor)
  const who = text(executor.kind) === 'human' ? (text(executor.name) || '对方') : AGENT
  const what = text(state.what)
  const due = text(state.due)
  const inferred = text(state.parentGoalRef) !== '' && text(state.attachedVia) === 'inferred'
  return (
    <div className={css.absorbed} data-testid="card-registered">
      <Icon name="check" size={14} className={css.absorbedMark} />
      <span className={css.absorbedText} title={what}>
        记下了：{who}负责
        {what === '' ? '' : <span className={css.absorbedTitle}> · {what}</span>}
        {due !== '' && (
          <span className={css.absorbedTitle}>
            {' · '}原话「{due}」{card.dueAt === undefined ? '' : ` → ${dueDayText(card.dueAt, now)}`}
          </span>
        )}
        {inferred && <span className={css.absorbedTitle}> · 挂的目标是猜的</span>}
      </span>
      <button
        type="button"
        className={css.undo}
        title="改期限、换人、挂到别的目标或作废"
        onClick={() => {
          setSpotlight({ kind: 'commitment', id: card.id, title: what || '这一条' })
          revealAside(() => undefined)
        }}
      >
        改
      </button>
    </div>
  )
}

/** 「下一件：验收 Q3 复盘材料初稿 · 李婷等你 13 小时 [N]」——连着处理，不回左栏找。 */
function NextLine(props: { need: NeedWire | undefined; now: number }): ReactNode {
  const { need, now } = props
  if (need === undefined) {
    return (
      <div className={css.next} data-testid="card-next">
        <Icon name="check" size={13} className={css.absorbedMark} />要你的都处理完了
      </div>
    )
  }
  return (
    <button type="button" className={`${css.next} ${css.nextGo}`} data-testid="card-next" onClick={() => { jumpToNeed(need) }}>
      <span className={css.nextTag}>下一件</span>
      <b>{need.verb}</b>
      <span className={css.nextLabel}>{need.label}</span>
      <span className={css.nextWait}>· {waitLine(need.waiting, need.since, now)}</span>
      <kbd className={css.kbd}>N</kbd>
    </button>
  )
}

function OpenCard(props: CardRowProps): ReactNode {
  const { card, now, current, answer, proposeRule, focus } = props
  const state = record(card.state)
  const demand = card.demand
  const blocking = demand?.layer === 'blocking'
  const anchor = `${card.kind}:${card.id}`
  const [reasonFor, setReasonFor] = useState<Action | undefined>(undefined)
  const [reason, setReason] = useState('')
  const [unseen, setUnseen] = useState<Action | undefined>(undefined)
  const [looked, setLooked] = useState(false)
  const [showArgs, setShowArgs] = useState(false)
  /*
    负重档：主动作要按两下 (档位生效面).

    「你先拆，我再补」的意思是把手从自动驾驶上拿回来——一颗按一下就过的按钮，正是三主权
    时刻退化成三剧场时刻的那个手势。第二下不是摩擦，它就是那次裁决本身。
  */
  const weight = (card.strips ?? []).some(strip => strip.kind === 'spread')
  const [arming, setArming] = useState<string | undefined>(undefined)
  const mountedAt = useRef(Date.now())
  const reasonBox = useRef<HTMLInputElement | null>(null)
  const files = filesOf(card)
  const title = titleOf(card)

  const available = card.actions.filter(action => action.available).map(action => ({ ...action, label: labelOf(card, action) }))
  const numbered = available.filter(action => action.n !== undefined).sort((a, b) => (a.n ?? 0) - (b.n ?? 0))
  const secondary = available.filter(action => action.n === undefined && action.secondary === true)

  const said = (action: Action, input?: string): string => {
    const base = `你${SAID[`${card.kind}:${action.id}`] ?? `${action.label}了`}`
    return input === undefined || input === '' ? base : `${base}：${input}`
  }
  const commit = (action: Action, input?: string): void => {
    answer({
      kind: card.kind,
      id: card.id,
      steps: [{
        actionId: action.id,
        ...(input === undefined || input === '' ? {} : { input }),
        dwellMs: Date.now() - mountedAt.current,
      }],
      said: said(action, input),
    })
  }
  const look = (): boolean => {
    const first = files.targets[0]
    if (first !== undefined) {
      openPreview(first)
      setLooked(true)
      return true
    }
    const link = files.links[0]
    if (link !== undefined) {
      window.open(link.href, '_blank', 'noopener')
      setLooked(true)
      return true
    }
    return false
  }
  const press = (action: Action): void => {
    focus?.()
    if (weight && action.style === 'primary' && arming !== action.id) { setArming(action.id); return }
    const need = needsReason(card, action)
    if (need !== undefined) {
      setReasonFor(action)
      setReason('')
      requestAnimationFrame(() => { reasonBox.current?.focus() })
      return
    }
    /*
      验收的设计摩擦，只花在会错的地方 (§9.2 第 5 项)：交付物是文件、而你一眼都没看——
      这是验收唯一常见的错。卡里多一行，给两个出口；别的情况一律不拦。
    */
    if (action.id === 'accept' && files.targets.length > 0 && !looked && unseen === undefined) {
      setUnseen(action)
      return
    }
    commit(action)
  }

  /*
    键盘 (律八)：数字答当前这张，`V` 并排看交付物。哪张是「当前」由中栏定——卡只管
    自己怎么答。
  */
  const pressRef = useRef(press)
  pressRef.current = press
  const lookRef = useRef(look)
  lookRef.current = look
  useEffect(() => registerCardKeys(anchor, (key) => {
    if (key === 'v' || key === 'V') return lookRef.current()
    if (!/^[1-9]$/u.test(key)) return false
    const action = numbered.find(one => one.n === Number(key))
    if (action === undefined) return false
    pressRef.current(action)
    return true
  }), [anchor, numbered.map(one => `${one.id}:${String(one.n)}`).join('|')])

  const why = whyOf(card, state)
  const body = bodyOf(card, state, weight, showArgs, () => { setShowArgs(value => !value) })
  const wait = blocking ? waitingOf(card, now) : undefined

  return (
    <div
      className={`${css.card} ${blocking ? css.blocking : ''} ${current === true ? css.current : ''}`}
      onPointerDown={() => { focus?.() }}
    >
      <div className={css.head}>
        {blocking
          ? (
            <>
              <NeedMark />
              <b className={css.verb}>要你{demand?.verb ?? '答'}</b>
              {wait !== undefined && <span className={css.wait}>{wait}</span>}
            </>
          )
          : <span className={css.quiet}>{quietHeadOf(card, state)}</span>}
      </div>
      {title !== '' && <div className={css.title}>{title}</div>}
      {why.length > 0 && <div className={css.why}>{why.join(' ')}</div>}
      {body}
      {(files.targets.length > 0 || files.links.length > 0) && (
        <div className={css.files}>
          {files.targets.map(target => (
            <button
              type="button"
              key={target.key}
              className={css.file}
              onClick={() => { openPreview(target); setLooked(true) }}
            >
              <Icon name="file" size={14} />
              <span className={css.fileName}>{target.title}</span>
              <span className={css.fileVerb}>并排看<kbd className={css.kbd}>V</kbd></span>
            </button>
          ))}
          {files.links.map(link => (
            <a
              key={link.href}
              className={css.file}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { setLooked(true) }}
            >
              <Icon name="doc" size={14} />
              <span className={css.fileName}>{link.title}</span>
              <span className={css.fileVerb}>在云之家打开<Icon name="ext" size={12} /></span>
            </a>
          ))}
        </div>
      )}
      {card.ruleHint !== undefined && proposeRule !== undefined && (
        <div className={css.rule}>
          <AgentFace size={16} />
          <span>这类写入你已经连续确认 {card.ruleHint.streak} 次，没拒过一次。</span>
          <button
            type="button"
            className={css.ruleGo}
            onClick={() => { if (card.ruleHint !== undefined) proposeRule(card.ruleHint) }}
          >
            以后同类不用问<Icon name="chevR" size={12} />
          </button>
        </div>
      )}
      {unseen !== undefined && (
        <div className={css.warn}>
          <span>你还没打开交付的文件。</span>
          <button type="button" className={css.inline} onClick={() => { look() }}>先看<kbd className={css.kbd}>V</kbd></button>
          <button type="button" className={css.inline} onClick={() => { commit(unseen); setUnseen(undefined) }}>不看，直接通过</button>
        </div>
      )}
      {reasonFor !== undefined
        ? (
          <form
            className={css.reason}
            onSubmit={(event) => {
              event.preventDefault()
              const typed = reason.trim()
              if (needsReason(card, reasonFor) === 'required' && typed === '') return
              commit(reasonFor, typed)
              setReasonFor(undefined)
            }}
          >
            <input
              ref={reasonBox}
              className={css.input}
              value={reason}
              placeholder={needsReason(card, reasonFor) === 'required' ? `${reasonFor.label}的原因（会以你的名义发出）` : '说一句原因（可以不写）'}
              onChange={(event) => { setReason(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setReasonFor(undefined) } }}
            />
            <button
              type="submit"
              className={`${css.btn} ${reasonFor.style === 'danger' ? css.btnDanger : css.btnPrimary}`}
              disabled={needsReason(card, reasonFor) === 'required' && reason.trim() === ''}
            >
              {reasonFor.label}
            </button>
            <button type="button" className={css.inline} onClick={() => { setReasonFor(undefined) }}>算了</button>
            <span className={css.reasonNote}>{UNDO_MS / 1_000} 秒内可以撤回</span>
          </form>
        )
        : (numbered.length > 0 || secondary.length > 0) && (
          <div className={css.foot}>
            {numbered.map((action) => {
              const armed = arming === action.id
              const primary = !weight && action.style === 'primary'
              return (
                <button
                  type="button"
                  key={action.id}
                  className={`${css.btn} ${primary || armed ? css.btnPrimary : ''}`}
                  title={weight && action.style === 'primary' && !armed ? '你定的规矩：这一下只是拿起来，再按一下才算数' : undefined}
                  onClick={() => { press(action) }}
                >
                  <kbd className={css.n}>{action.n}</kbd>
                  {armed ? `再按一次：${action.label}` : `${action.label}${needsReason(card, action) === 'required' ? '…' : ''}`}
                </button>
              )
            })}
            {secondary.map(action => (
              <button type="button" key={action.id} className={css.inline} onClick={() => { press(action) }}>
                {action.label}…
              </button>
            ))}
            {numbered.length > 0 && (
              <span className={css.alt}>
                云之家里回 {numbered.map(action => action.n).join(' / ')} 也行
              </span>
            )}
          </div>
        )}
    </div>
  )
}

/** 不在等你的卡，头上只说它是什么、谁的——不上色（律三）。 */
function quietHeadOf(card: StreamCard, state: Record<string, unknown>): string {
  if (card.kind === 'commitment') {
    const executor = record(state.executor)
    const who = text(executor.kind) === 'human' ? (text(executor.name) || '某人') : AGENT
    return `承诺 · ${who}负责`
  }
  if (card.kind === 'lease') return '规矩 · 生效中'
  if (card.kind === 'task') return `${AGENT}在做`
  if (card.kind === 'waiting') return `${AGENT}在等`
  return ''
}

/** 标题下那一行：为什么这件事停在这里等你。只写事实，不写道理（律一）。 */
function whyOf(card: StreamCard, state: Record<string, unknown>): string[] {
  const status = text(state.status)
  if (card.kind === 'approval') {
    if (status === 'interrupted') return [`${AGENT}重启过，这一步断在半路了。重试会照原样再做一遍。`]
    const deadline = clock(state.deadline)
    return [
      text(state.level) === 'strong'
        ? '这类操作收不回，或者会改变谁看得到——每次都问你。'
        : `照规矩，${approvalVerbs(text(state.toolName)).act}之前先问你一次。`,
      ...(deadline === undefined || status !== 'pending' ? [] : [`${deadline} 前没答就自动取消。`]),
    ]
  }
  if (card.kind === 'task') {
    const round = typeof state.round === 'number' ? state.round : 0
    if (status === 'interrupted' && round > 0) {
      return [`打回过 ${String(round)} 次，改到一半停了。接着改会按你打回的话再改一版；不用再改了，就「就这样收了」。`]
    }
    if (status === 'interrupted') return ['断在半路了。继续会接着做，结果仍然发回原来那个会话。']
    if (status === 'rework') {
      return [`打回过 ${String(round)} 次${text(state.reason) === '' || text(state.reason) === '未说明原因' ? '' : `：${text(state.reason)}`}。${AGENT}在按这个改，改完回到这张卡上。`]
    }
    return [
      ...(text(state.summary) === '' ? [] : [flatten(state.summary, 160)]),
      ...(round > 0 ? [`已经打回过 ${String(round)} 次${text(state.reason) === '' ? '' : `：${text(state.reason)}`}。`] : []),
    ]
  }
  if (card.kind === 'commitment') {
    const executor = record(state.executor)
    const who = text(executor.kind) === 'human' ? (text(executor.name) || '对方') : AGENT
    const due = text(state.due)
    const delivery = record(state.delivery)
    return [
      `${who}负责${due === '' ? '' : ` · 原话「${due}」`}。`,
      ...(text(delivery.claim) === '' ? [] : [`说交了：「${flatten(delivery.claim, 120)}」`]),
      ...(text(state.parentGoalRef) === ''
        ? []
        : [text(state.attachedVia) === 'inferred' ? '挂在一个目标下（推断的，说错了回一句「改挂 …」）。' : '挂在一个目标下。']),
    ]
  }
  if (card.kind === 'lease') {
    const scope = record(state.scope)
    const cls = TOOL_CLASS[text(scope.toolClass)] ?? text(scope.toolClass)
    return [
      `范围：往${cls}里新加东西${text(scope.placeKey) === '' ? '，不限群' : '，只在这一个群'} · ${text(state.periodText)}，到期自动失效，随时可以收回。`,
      '改已有的、删除、建群照旧每次都问。',
    ]
  }
  if (card.kind === 'conflict') {
    return [
      ...(text(state.priorInstruction) === '' ? [] : [`原来让它做：${text(state.priorInstruction)}`]),
      ...(text(state.newInstruction) === '' ? [] : [`新的一句：${text(state.newInstruction)}`]),
    ]
  }
  if (card.kind === 'waiting') {
    return text(state.waitingFor) === '' ? [] : [`在等：${text(state.waitingFor)}`]
  }
  if (card.kind === 'assessment') {
    return text(state.summary) === '' ? [] : [text(state.summary)]
  }
  return []
}

const TOOL_CLASS: Record<string, string> = { doc: '文档', sheet: '表格', calendar: '日程', im: '群消息', file: '文件' }

/** 中间那一块：每一族自己的证据。 */
/** 一眼就知道是给机器的值：长十六进制串、uuid。 */
const OPAQUE_ID = /^(?:[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu

function bodyOf(
  card: StreamCard,
  state: Record<string, unknown>,
  weight: boolean,
  showArgs: boolean,
  toggleArgs: () => void,
): ReactNode {
  if (card.kind === 'approval') {
    const args = Object.entries(record(state.args))
    if (args.length === 0) return null
    // 摘要只放人读得懂的值：24 位的工作区号、uuid 是给机器的，全文在「看参数」里。
    const summary = args
      .map(([, value]) => flatten(value, 40))
      .filter(value => value !== '' && !OPAQUE_ID.test(value))
      .join(' · ')
    return (
      <div className={css.body}>
        {showArgs || weight
          ? (
            <div className={css.fields}>
              <span className={css.fieldKey}>工具</span>
              <span className={`${css.fieldValue} ${css.mono}`}>{text(state.toolName)}</span>
              {args.map(([key, value]) => (
                <span className={css.fieldPair} key={key}>
                  <span className={css.fieldKey}>{key}</span>
                  <span className={css.fieldValue}>{flatten(value, weight ? 4_000 : 400)}</span>
                </span>
              ))}
            </div>
          )
          : summary !== '' && <div className={css.args}>{summary}</div>}
        {!weight && (
          <button type="button" className={css.inline} onClick={toggleArgs}>
            {showArgs ? '收起参数' : '看参数'}
          </button>
        )}
      </div>
    )
  }
  if (card.kind === 'assessment') {
    const lines = Array.isArray(state.lines) ? state.lines : []
    return (
      <div className={css.items}>
        {lines.map((raw, index) => {
          const line = record(raw)
          const verdict = text(line.verdict)
          return (
            <div className={css.item} key={`${card.id}:${String(index)}`}>
              <span className={`${css.mark} ${verdict === 'met' ? css.markOk : verdict === 'partial' ? css.markHold : css.markNo}`}>
                {verdict === 'met' ? '已达成' : verdict === 'partial' ? '部分' : '缺失'}
              </span>
              <span className={css.itemWhat}>{text(line.criterion)}</span>
              {text(line.evidence) !== '' && <span className={css.itemWhy}>{text(line.evidence)}</span>}
            </div>
          )
        })}
      </div>
    )
  }
  if (card.kind === 'commitment' && weight && typeof state.round === 'number' && state.round > 0) {
    return <div className={css.why}>已返工 {String(state.round)} 轮{text(state.reason) === '' ? '' : `：${text(state.reason)}`}</div>
  }
  return null
}

/**
 * 逐条裁决 —— 拆解提案、对账发现、交付推断、立目标 (§5.2 逐条裁决).
 *
 * 每条一排选项；数字键选当前那一条，选完自动跳到下一条；**选满了才能「定下这 N 处」**，
 * 一窗提交。此前是每按一下就落一笔——三条要定的事，第一条按下去它就已经发出去了，
 * 剩下两条还没想好。
 */
function Verdicts(props: CardRowProps): ReactNode {
  const { card, now, current, answer, focus } = props
  const state = record(card.state)
  const items = Array.isArray(state.items) ? state.items : []
  const decisions = record(state.decisions)
  const kindOf = text(state.kind)
  const isGoal = kindOf === 'goal'
  const isFinding = kindOf === 'finding'
  const isDelivery = kindOf === 'delivery'
  const options: readonly (readonly [string, string])[] = isDelivery
    ? [['confirmed', '是交付'], ['rejected', '不是交付']]
    : isFinding
      ? [['confirmed', '成立'], ['rejected', '驳回'], ['transferred', '转办']]
      : isGoal
        ? [['confirmed', '签发'], ['rejected', '驳回']]
        : [['confirmed', '确认'], ['rejected', '驳回'], ['held', '挂起']]
  const open = items.map((_, index) => index).filter((index) => {
    const decided = text(decisions[String(index)])
    return decided === '' || decided === 'held'
  })
  const [picks, setPicks] = useState<Record<number, string>>({})
  const [extra, setExtra] = useState('')
  /**
   * 光标在哪一条：J/K 挪过去的那一条，否则第一条还没选的。数字选完自动跳到下一条没选的；
   * 选满了再按 J/K 能回去改。
   */
  const [at, setAt] = useState<number | undefined>(undefined)
  const cursor = at !== undefined && open.includes(at) ? at : open.find(index => picks[index] === undefined)
  const typed = extra.trim()
  const looksLikeLink = /^(https?:\/\/)?[^\s/]+\.[^\s/]+/u.test(typed)
  const canSign = !isGoal || (typed === '' ? text(state.goalRef) !== '' : looksLikeLink)
  const transferBlocked = open.some(index => picks[index] === 'transferred') && typed === ''
  const full = open.length > 0 && open.every(index => picks[index] !== undefined)
  const signBlocked = isGoal && open.some(index => picks[index] === 'confirmed') && !canSign
  const ready = full && !transferBlocked && !signBlocked
  const settle = card.actions.find(action => action.id === 'settle' && action.available)

  const submit = (): boolean => {
    if (!ready) return false
    const steps = open.map((index) => {
      const pick = picks[index] ?? 'held'
      const input = isGoal
        ? (typed === '' ? undefined : typed)
        : pick === 'transferred' ? `${String(index + 1)} ${typed}` : String(index + 1)
      return { actionId: pick, ...(input === undefined ? {} : { input }) }
    })
    const counts = options
      .map(([id, label]) => [label, open.filter(index => picks[index] === id).length] as const)
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${label} ${String(count)}`)
      .join(' · ')
    answer({ kind: card.kind, id: card.id, steps, said: `你定了 ${String(open.length)} 处（${counts}）` })
    return true
  }
  const pick = (index: number, id: string): void => {
    focus?.()
    const next = { ...picks, [index]: id }
    setPicks(next)
    // 跳到它后面第一条没选的；后面没有了就回到前面没选的；都选了，光标收起，⏎ 定下。
    setAt(open.find(one => one > index && next[one] === undefined) ?? open.find(one => next[one] === undefined))
  }
  /** J/K：在条之间走。走到头不吃这一下——交还给流，去下一张卡。 */
  const step = (down: boolean): boolean => {
    if (open.length === 0) return false
    if (cursor === undefined) {
      if (!full) return false
      setAt(down ? open[0] : open.at(-1))
      return true
    }
    const index = open.indexOf(cursor) + (down ? 1 : -1)
    if (index < 0 || index >= open.length) return false
    setAt(open[index])
    return true
  }

  const pickRef = useRef({ cursor, options, submit, pick, step })
  pickRef.current = { cursor, options, submit, pick, step }
  useEffect(() => registerCardKeys(`${card.kind}:${card.id}`, (key) => {
    const live = pickRef.current
    if (key === 'Enter') return live.submit()
    if (key === 'j' || key === 'J') return live.step(true)
    if (key === 'k' || key === 'K') return live.step(false)
    if (!/^[1-9]$/u.test(key) || live.cursor === undefined) return false
    const option = live.options[Number(key) - 1]
    if (option === undefined) return false
    live.pick(live.cursor, option[0])
    return true
  }), [card.kind, card.id])

  const blocking = card.demand?.layer === 'blocking'
  return (
    <div
      className={`${css.card} ${blocking ? css.blocking : ''} ${current === true ? css.current : ''}`}
      onPointerDown={() => { focus?.() }}
    >
      <div className={css.head}>
        {blocking
          ? (
            <>
              <NeedMark />
              <b className={css.verb}>要你{card.demand?.verb ?? '定'}</b>
              <span className={css.wait}>{waitLine(AGENT, card.at, now)}</span>
            </>
          )
          : <span className={css.quiet}>{isFinding ? `${AGENT}发现的事` : isDelivery ? '像是交了' : isGoal ? '新目标' : '拆解'}</span>}
      </div>
      <div className={css.title}>{text(state.title)}</div>
      {isGoal && text(state.criteria) !== '' && <div className={css.why}>完成标准：{text(state.criteria)}</div>}
      <div className={css.items}>
        {items.map((raw, index) => {
          const item = record(raw)
          const decided = text(decisions[String(index)])
          const live = open.includes(index)
          // 去向按「这一条自己的群 › 卡的群」取，说名字；有群却认不出名字时也不能说成「没有群」。
          const destination = text(item.placeKey) || text(state.placeKey)
          const where = !isGoal && !isFinding && !isDelivery
            ? text(item.placeName) || card.placeNames?.[destination] || (destination === '' ? '' : '它记下的那个群')
            : ''
          return (
            <div
              className={`${css.item} ${live && cursor === index ? css.itemCursor : ''}`}
              key={`${card.id}:${String(index)}`}
              // 点到哪一条，光标就在哪一条：数字键接着答它。
              onPointerDown={() => { if (live) setAt(index) }}
            >
              <span className={css.itemNo}>{index + 1}</span>
              <span className={css.itemText}>
                <span className={css.itemWhat}>{text(item.what)}</span>
                <span className={css.itemWhy}>
                  {isFinding || isDelivery
                    ? (text(item.evidence) === '' ? '' : `依据：${text(item.evidence)}`)
                    : [
                      text(item.executorName) || (isGoal ? '' : '还没定谁'),
                      text(item.due) === '' ? '' : `原话「${text(item.due)}」`,
                      where === '' ? (isGoal ? '' : '没有能发的群，定下后要你自己去说') : `登记发到「${where}」`,
                    ].filter(part => part !== '').join(' · ')}
                </span>
              </span>
              {live
                ? (
                  <span className={css.pills}>
                    {options.map(([id, label], at) => (
                      <button
                        type="button"
                        key={id}
                        className={`${css.pill} ${picks[index] === id ? css.pillOn : ''}`}
                        onClick={() => { pick(index, id) }}
                      >
                        {cursor === index && <kbd className={css.n}>{at + 1}</kbd>}{label}
                      </button>
                    ))}
                  </span>
                )
                : (
                  <span className={`${css.mark} ${decided === 'confirmed' ? css.markOk : decided === 'rejected' ? css.markNo : css.markHold}`}>
                    {decided === 'confirmed' ? '已确认' : decided === 'rejected' ? (isDelivery ? '不是交付' : '已驳回') : decided === 'transferred' ? '已转办' : '已挂起'}
                  </span>
                )}
            </div>
          )
        })}
      </div>
      {(isGoal || isFinding) && open.length > 0 && (
        <input
          className={css.input}
          value={extra}
          placeholder={isGoal
            ? (text(state.goalRef) === '' ? '云之家里目标文档的链接（签发要用它）' : '目标文档链接（要换的话贴新的）')
            : '转办给谁（姓名）'}
          onChange={(event) => { setExtra(event.target.value) }}
        />
      )}
      {signBlocked && (
        <div className={css.warn}>
          {typed === '' ? '贴上目标文档的链接才能签发——目标的正文在云之家里。' : '这看起来不像一个链接。'}
        </div>
      )}
      <div className={css.foot}>
        {open.length > 0 && (
          <button
            type="button"
            className={`${css.btn} ${ready ? css.btnPrimary : ''}`}
            disabled={!ready}
            onClick={() => { submit() }}
          >
            {full ? `定下这 ${String(open.length)} 处` : `还有 ${String(open.filter(index => picks[index] === undefined).length)} 处没选`}
            <kbd className={css.n}>⏎</kbd>
          </button>
        )}
        {settle !== undefined && (
          <button
            type="button"
            className={css.inline}
            onClick={() => { answer({ kind: card.kind, id: card.id, steps: [{ actionId: 'settle' }], said: '你收起了这张卡' }) }}
          >
            收起…
          </button>
        )}
        {open.length > 0 && !isGoal && <span className={css.alt}>云之家里回「确认 1」「驳回 2」也行</span>}
      </div>
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
    <button type="button" key={label} className={css.inline} disabled={busy} title={title} onClick={onClick}>{label}</button>
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
  const lock = <Icon name="lock" size={13} className={css.mirrorMark} />

  return (
    <div className={css.pledgerTail}>
      {note !== undefined && <div className={css.gearNote}>{note}</div>}
      {card.pledgeHandle !== undefined && pledgeOn !== undefined && (
        <div className={css.mirror}>
          {lock}
          <span className={css.twoReadLine}>{tiny('押一句', '对这次裁决押一句可证伪的话——有结果时回到这张卡下面；只有你能看到', () => { pledgeOn(card.pledgeHandle ?? '') })}</span>
        </div>
      )}
      {strips.map((strip, index) => {
        if (strip.kind === 'pledge') {
          const row = strip.row
          return (
            <div key={`pledge:${row.expectationId}`} className={css.mirror}>
              {lock}
              <span className={css.mirrorBody}>
                <span className={css.mirrorNote}>只有你能看到 · 押</span>
                「<b>{row.text}</b>」{row.status === 'settled' ? ' · 已见分晓' : row.premise === 'changed' ? ' · 前提已变' : ` · ${row.checkpointText}见分晓`}
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
              <span className={css.twoReadHead}>{lock} 只有你能看到 · 回执 · <b>{row.type === 'pledged' ? '押过的' : row.type === 'reversed' ? '同意了，被现实推翻' : '没同意，被现实印证'}</b></span>
              <span className={css.twoReadBody}>
                <span className={css.twoReadLine}><b>你当时</b> · {row.verdict.text}</span>
                {row.then.map(photo)}
                <span className={css.twoReadLine}><b>后来</b>{row.later.length === 0 ? ' · 还没有结果——到「我定过的」里补一句' : ''}</span>
                {row.later.map(photo)}
                {row.dismissed
                  ? <span className={css.twoReadLine}>这不是那件事的结果——没记入。{(['q1', 'q2', 'q3', 'q4'] as const).map(id => tiny(ATTRIBUTION_LABEL[id], '记回来', () => { run(() => inject.attribute(row.calibrationId, id)) }))}</span>
                  : row.attributionLabel !== undefined
                    ? (
                      <span className={css.twoReadLine}>
                        <b>{row.attributionLabel}</b> · 已记 · 想改随时改
                        {(['q1', 'q2', 'q3', 'q4'] as const).filter(id => id !== row.attribution).map(id => tiny(ATTRIBUTION_LABEL[id], cellNote(id), () => { run(() => inject.attribute(row.calibrationId, id)) }))}
                        {tiny('以后这类事…', '先看本族的 2×2，再决定改不改规矩', () => { openGear(row.family, row.calibrationId) })}
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
              <span className={css.twoReadHead}>{lock} 你定的规矩 · 先看 · 要求 × 交付</span>
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
            {lock}
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
