/**
 * 一条流 —— 话题里发生过的一切，按时间排成一列 (界面重设计 §5.1).
 *
 * 这一列此前每一行都挂着一根「公 / 私」竖条——它说的是对的（每一行都要说清谁听得见），
 * 可六十行六十根竖条，人就不再看它了。现在听众只在**换了的时候**才说：连续的私下内容
 * （你对云小助说的、它的回话、它的工作步骤、只给你看的卡）收进一条纸色带，带头一句
 * 「只有你和云小助」；带外面的就是群里看得见的。本地会话里没有群，也就没有带——
 * 「没有」不画（律三）。
 *
 * 数据不在这里存：会话节点来自宿主的快照，消息和卡来自 `fused`。这里只负责把它们说清楚。
 */

import { Fragment, type ReactNode } from 'react'
import { clockOf, type StreamRow } from './stream.ts'
import { Avatar } from './Avatar.tsx'
import { CardRow } from './CardRow.tsx'
import { CopyButton } from './Compose.tsx'
import { Attachments, isPlaceholderOnly, withoutImageMarks } from './Attachments.tsx'
import { ArtifactCard } from './ArtifactCard.tsx'
import { artifactRefOf } from './artifacts.ts'
import { AgentFace, Icon } from './icons.tsx'
import { Prose } from './Prose.tsx'
import { AGENT, span } from './words.ts'
import type { Answer } from './answers.ts'
import type { NeedWire, StreamCard, SurfaceInject } from './rpc.ts'
import css from './stream.module.css'

/** 一步多久算「可能卡住了」。一次工具调用、一次等模型回话，正常都在这之内。 */
export const STALL_MS = 3 * 60_000

export interface StreamContext {
  /** 墙钟。有事在跑时每秒走一次。 */
  now: number
  /** 是否是云之家话题。本地会话没有群，也就没有私语带、没有「发到群里」。 */
  hasPlace: boolean
  inject: SurfaceInject
  sessionId?: string | undefined
  openWork: Record<string, boolean>
  toggleWork(key: string): void
  openTrace(): void
  forward(text: string): void
  replyTo(msgId: string, who: string, text: string): void
  askAgentAbout(msgId: string, who: string, text: string): void
  pledgeOn(handle: string): void
  jumpTo(msgId: string): void
  openPlace(): void
  publish(text: string): void
  /* ——— 卡 ——— */
  answer(answer: Answer): void
  currentCard: string | undefined
  setCurrentCard(anchor: string): void
  /** 刚在这里答过的那张——它下面接「下一件」。 */
  justAnswered: string | undefined
  nextNeed: NeedWire | undefined
  proposeRule(hint: NonNullable<StreamCard['ruleHint']>): void
  /* ——— 运行健康度 ——— */
  /** 距上一次有进展过了多久；没在跑就是 undefined。 */
  quietFor: number | undefined
  retryStep(): void
  stop(): void
}

/** 一行属于谁听得见。卡、在跑的、机器行都只给你。 */
function privateRow(row: StreamRow): boolean {
  switch (row.kind) {
    case 'card':
    case 'live':
    case 'sysline':
      return true
    case 'said':
    case 'work':
    case 'message':
      return row.voice === 'private'
    default:
      return false
  }
}

export function StreamRows(props: { rows: readonly StreamRow[]; context: StreamContext }): ReactNode {
  const { rows, context } = props
  const out: ReactNode[] = []
  let band: ReactNode[] = []
  let bandKey = ''
  const flush = (): void => {
    if (band.length === 0) return
    out.push(
      <section className={css.band} key={`band:${bandKey}`} aria-label={`只有你和${AGENT}`}>
        <div className={css.bandHead}><Icon name="lock" size={12} />只有你和{AGENT}</div>
        {band}
      </section>,
    )
    band = []
  }
  const runningWork = rows.some(row => row.kind === 'work' && row.state === 'running')
  for (const row of rows) {
    const node = <Fragment key={row.key}>{renderRow(row, context, runningWork)}</Fragment>
    if (context.hasPlace && privateRow(row)) {
      if (band.length === 0) bandKey = row.key
      band.push(node)
      continue
    }
    flush()
    out.push(node)
  }
  flush()
  return out
}

/** 一段时长，按人说话的样子：38 秒、2 分 10 秒。 */
function took(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  if (ms < 1_000) return '不到 1 秒'
  if (ms < 60_000) return `${String(Math.round(ms / 1_000))} 秒`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return seconds === 0 ? `${String(minutes)} 分钟` : `${String(minutes)} 分 ${String(seconds)} 秒`
}

const SPEAKER: Record<string, string> = {
  operator: '你',
  steering: '你',
  ask: '你',
  askAnswer: AGENT,
  agent: AGENT,
}

function renderRow(row: StreamRow, context: StreamContext, runningWork: boolean): ReactNode {
  const clock = clockOf(row.time)
  switch (row.kind) {
    case 'divider':
      return <div className={css.divider}><span>{row.label}</span></div>

    case 'sysline':
      return <div className={css.sysline}>{row.text}</div>

    case 'message': {
      const body = withoutImageMarks(row.text, (row.images ?? []).length > 0)
      return (
        <div className={css.msg} data-msg={row.key.startsWith('m:') ? row.key.slice(2) : undefined} data-said-at={row.time}>
          <Avatar
            name={row.who}
            {...(row.avatar === undefined ? {} : { photo: row.avatar })}
            className={css.avatar}
            photoClassName={css.photo}
          />
          <div className={css.main}>
            <div className={css.line}>
              <span className={css.name}>{row.who}</span>
              <span className={css.clock}>{clock}</span>
              <span className={css.verbs}>
                <button type="button" className={css.verb} title="回复这句" onClick={() => { context.replyTo(row.key.slice(2), row.who, row.text) }}>
                  <Icon name="undo" size={14} />回复
                </button>
                <button type="button" className={css.verb} title={`回复这句，并叫上${AGENT}来办`} onClick={() => { context.askAgentAbout(row.key.slice(2), row.who, row.text) }}>
                  <Icon name="at" size={14} />交给{AGENT}
                </button>
                <CopyButton text={row.text} className={css.verb} />
                <button type="button" className={css.verb} title="转发到另一个会话" onClick={() => { context.forward(row.text) }}>
                  <Icon name="redo" size={14} />转发
                </button>
              </span>
            </div>
            {row.quote !== undefined && (
              <div className={css.quoteRow}>
                {row.quoteId === undefined
                  ? <span className={css.quote}>{row.quote}</span>
                  : (
                    <button type="button" className={`${css.quote} ${css.quoteLink}`} title="跳到被回复的那条" onClick={() => { context.jumpTo(row.quoteId as string) }}>
                      {row.quote}
                    </button>
                  )}
                {context.hasPlace && (
                  <button type="button" className={css.quoteMore} title="回群里看这段话的前后" onClick={context.openPlace}>
                    在群里看<Icon name="chevR" size={12} />
                  </button>
                )}
              </div>
            )}
            {isPlaceholderOnly(body, row.file?.name) ? null : <div className={css.text}>{body}</div>}
            <Attachments
              inject={context.inject}
              message={{
                msgId: row.key, fromOpenId: '', fromName: row.who, content: row.text,
                msgType: '', time: row.time, own: false,
                ...(row.images === undefined ? {} : { images: row.images }),
                ...(row.file === undefined ? {} : { file: row.file }),
              }}
            />
          </div>
        </div>
      )
    }

    case 'said': {
      const agent = row.speaker === 'agent' || row.speaker === 'askAnswer'
      const name = SPEAKER[row.speaker] ?? row.speaker
      return (
        <div className={css.msg} data-said-at={agent ? undefined : row.time}>
          {agent
            ? <AgentFace size={28} className={css.face} />
            : <Avatar name={name} className={css.avatar} photoClassName={css.photo} />}
          <div className={css.main}>
            <div className={css.line}>
              <span className={css.name}>{name}</span>
              {row.speaker === 'steering' && <span className={css.tag}>插话</span>}
              {(row.speaker === 'ask' || row.speaker === 'askAnswer') && <span className={css.tag}>快问 · 只问不办</span>}
              <span className={css.clock}>{clock}</span>
              {agent && row.voice === 'private' && (
                <span className={css.verbs}>
                  {context.hasPlace && (
                    <button type="button" className={css.verb} title="以你的名义把这段发到群里——发不发由你定" onClick={() => { context.publish(row.text) }}>
                      <Icon name="users" size={14} />发到群里
                    </button>
                  )}
                  <CopyButton text={row.text} className={css.verb} />
                </span>
              )}
            </div>
            {agent ? <Prose text={row.text} /> : <div className={css.text}>{row.text}</div>}
          </div>
        </div>
      )
    }

    case 'work':
      return <Work row={row} context={context} />

    case 'live':
      return (
        <div className={css.msg}>
          <AgentFace size={28} className={css.face} />
          <div className={css.main}>
            <div className={css.line}>
              <span className={css.name}>{AGENT}</span>
              <span className={css.live}>
                <span className={css.spin} />
                {row.mode === 'text' ? '正在回答' : row.mode === 'thinking' ? '正在想' : '等模型回话'}
              </span>
            </div>
            {row.mode === 'text' && <Prose text={row.text} />}
            {row.mode === 'thinking' && <div className={css.thinking}>{row.text}</div>}
            {/* 没有在跑的工作块时，卡住的提示长在这里。 */}
            {!runningWork && <Stall context={context} />}
          </div>
        </div>
      )

    case 'artifact':
      return (
        <div className={css.artifact}>
          <ArtifactCard
            artifact={artifactRefOf({
              uri: row.artifact.uri,
              title: row.artifact.title,
              action: row.artifact.action,
              notes: [clock],
              marks: [row.artifact.foreign
                ? { label: '写到了别的群', why: '这次写出去的东西落在了别的群里' }
                : undefined],
            })}
          />
        </div>
      )

    default: {
      const anchor = `${row.card.kind}:${row.card.id}`
      return (
        <div className={css.cardRow} data-card={anchor} data-open={row.card.resolved ? undefined : '1'}>
          <CardRow
            card={row.card}
            now={context.now}
            current={context.currentCard === anchor}
            answer={context.answer}
            inject={context.inject}
            pledgeOn={context.pledgeOn}
            {...(context.justAnswered === anchor ? { next: { need: context.nextNeed } } : {})}
            proposeRule={context.proposeRule}
            focus={() => { context.setCurrentCard(anchor) }}
          />
        </div>
      )
    }
  }
}

/**
 * 工作步骤 —— 收起时一行，在做时摊开 (§5.1).
 *
 * 做完的：「云小助做了 4 步 · 38 秒 ›」。人要的是「它做完了没、做了多久」，步骤是点开才
 * 看的证据。在做的：默认摊开，每一步用工具自己的说法写在左边、工具名等宽小字靠右——
 * 「在干什么」才是这时候有用的事实。
 */
function Work(props: { row: Extract<StreamRow, { kind: 'work' }>; context: StreamContext }): ReactNode {
  const { row, context } = props
  const running = row.state === 'running'
  const open = context.openWork[row.key] ?? running
  const failed = row.steps.filter(step => step.state === 'failed').length
  const doing = row.steps.findIndex(step => step.state === 'running')
  const stalled = running && context.quietFor !== undefined && context.quietFor >= STALL_MS
  const head = running
    ? stalled
      ? `${AGENT}在做 · 第 ${String(doing < 0 ? row.steps.length : doing + 1)} 步，${span(context.quietFor ?? 0)}没进展`
      : `${AGENT}在做 · 第 ${String(doing < 0 ? row.steps.length : doing + 1)} 步`
    : `${AGENT}做了 ${String(row.steps.length)} 步`
  return (
    <div className={`${css.work} ${stalled ? css.workStall : ''} ${row.state === 'failed' ? css.workFail : ''}`}>
      <button type="button" className={css.workHead} aria-expanded={open} onClick={() => { context.toggleWork(row.key) }}>
        {running
          ? <span className={`${css.spin} ${stalled ? css.spinStall : ''}`} />
          : <AgentFace size={16} />}
        <span className={css.workTitle}>{head}</span>
        {!running && row.ms > 0 && <span className={css.workMeta}>· {took(row.ms)}</span>}
        {failed > 0 && <span className={css.workBad}>· {failed} 步没成功</span>}
        <Icon name="chevR" size={12} className={`${css.workChev} ${open ? css.workChevOpen : ''}`} />
      </button>
      {open && (
        <div className={css.steps}>
          {row.steps.map((step, index) => (
            <div className={`${css.step} ${step.state === 'failed' ? css.stepFail : ''} ${step.state === 'running' ? css.stepRun : ''}`} key={`${row.key}:${String(index)}`}>
              <span className={css.stepMark}>
                {step.state === 'running'
                  ? <span className={css.spinSmall} />
                  : step.state === 'failed' ? <Icon name="x" size={12} /> : <Icon name="check" size={12} />}
              </span>
              <span className={css.stepText} title={step.detail}>{step.detail === '' ? step.tool : step.detail}</span>
              <span className={css.stepTool}>{step.tool}</span>
              <span className={css.stepTime}>
                {step.state === 'running'
                  ? took(step.since === undefined ? 0 : context.now - step.since)
                  : took(step.ms ?? 0)}
              </span>
            </div>
          ))}
          <button type="button" className={css.trace} onClick={context.openTrace}>
            看完整过程<Icon name="chevR" size={12} />
          </button>
        </div>
      )}
      {running && <Stall context={context} />}
    </div>
  )
}

/**
 * 运行健康度 (§5.1) —— 「空转 20 分钟毫不知情」的那一格.
 *
 * 不是「要你」：它没在等你拍板。可它可能卡住了，而只有你停得下来。两个动词都走既有的
 * 路——重试是一句插话（和你自己打出来一样），停下是宿主自己的取消。
 */
function Stall(props: { context: StreamContext }): ReactNode {
  const { context } = props
  if (context.quietFor === undefined || context.quietFor < STALL_MS) return null
  return (
    <div className={css.stall} data-testid="stall">
      <span>不是要你拍板——但它可能卡住了，{span(context.quietFor)}没有任何进展。</span>
      <button type="button" className={css.stallBtn} onClick={context.retryStep}>让它重试这一步</button>
      <button type="button" className={css.stallBtn} onClick={context.stop}>停下</button>
    </div>
  )
}
