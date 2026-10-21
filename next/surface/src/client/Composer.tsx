/**
 * 输入框 —— 话题和群视图共用这一个 (界面重设计 §5.3).
 *
 * 一次发送同时回答四个问题：话落在哪、说给谁、指的是哪件事、谁听得见。此前它们是四行
 * 常驻的说明（落点条、语态切换、一行提示、发送键），人看惯了就不读了——常驻的说明会
 * 被看惯而失效。现在：
 *
 * - **谁听得见**住在一颗听众标签里，发送键上的字跟着它变（「发给云小助」「发到群里」）；
 * - **会记成什么**、**谁会听不见**只在**有事的时候**出现，在输入框上方那一格；
 * - 那一格同一时刻只说一件事，按要紧排：拟稿 › 听众风险 › 登记预览 › 回复 › 目标。
 *
 * 状态归调用方（它们各自的发送路径不同）；这里只管把它们说清楚。
 */

import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { Icon } from './icons.tsx'
import { AGENT } from './words.ts'
import { registrationFrom } from './registration.ts'
import css from './composer.module.css'

/** 这一句说给谁听。 */
export type Voice = 'private' | 'place' | 'ask'

/** 输入框上方那一格。同一时刻只有一种。 */
export type Hint =
  | { kind: 'draft'; about: string; drop(): void }
  | { kind: 'risk'; text: string; who?: string | undefined; fix?: { label: string; run(): void } | undefined }
  | { kind: 'register'; line: string; ok: boolean; drop(): void }
  | { kind: 'reply'; who: string; text: string; drop(): void }
  | { kind: 'context'; text: string; drop(): void }
  /** 一句发出去之后会发生什么的预告（「会长出一个新话题」）。没有可撤的东西。 */
  | { kind: 'note'; text: string; warn?: boolean }

export interface ComposerProps {
  voice: Voice
  /** 这里能切到哪些。群视图只有「发到群里」。 */
  voices: readonly Voice[]
  setVoice(voice: Voice): void
  /** 群名，听众标签上写的就是它。 */
  placeName?: string | undefined
  /** 这是一间私聊：听众是一个人，不是一个群。标签、图标、说明都跟着变。 */
  direct?: boolean | undefined
  draft: string
  setDraft(draft: string): void
  busy: boolean
  /** 发不了的时候说清是哪一堵墙；undefined = 可以发。 */
  blocked?: string | undefined
  send(): void
  boxRef: MutableRefObject<HTMLTextAreaElement | null>
  hint?: Hint | undefined
  /** 发送键上的字。由调用方定：它知道这句话会去哪。 */
  sendLabel: string
  placeholder: string
  /** 表情、@ 某人、叫上云小助——各个面自己的那几样。 */
  tools?: ReactNode
}

const VOICE_LABEL: Record<Voice, string> = {
  private: `仅你和${AGENT}`,
  place: '发到群里',
  ask: '快问 · 只问不办',
}

export function Composer(props: ComposerProps): ReactNode {
  const {
    voice, voices, setVoice, placeName, direct = false, draft, setDraft, busy, blocked, send, boxRef,
    hint, sendLabel, placeholder, tools,
  } = props
  /** 听众标签上的字：群写「发到群里 · 群名」，私聊写「李婷 · 私聊」。 */
  const labelOf = (option: Voice): string => (
    option === 'place' && placeName !== undefined
      ? direct ? `${placeName} · 私聊` : `发到群里 · ${placeName}`
      : VOICE_LABEL[option]
  )
  const iconOf = (option: Voice): 'user' | 'users' | 'bolt' | 'lock' => (
    option === 'place' ? direct ? 'user' : 'users' : option === 'ask' ? 'bolt' : 'lock'
  )
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  /*
    听众风险要被**读到**，不是被闪过 (律四)。

    回车是肌肉记忆：提示条刚亮出来、人还没抬眼，手已经按下去了。所以风险在场时，第一下
    回车只让提示条闪一下；第二下才发。点发送键（上面写着「仍只发给云小助」）不拦——那是
    读过了的人。
  */
  const [nudged, setNudged] = useState(false)
  useEffect(() => { setNudged(false) }, [hint?.kind === 'risk' ? hint.text : ''])

  useEffect(() => {
    if (!menu) return undefined
    const away = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node) !== true) setMenu(false)
    }
    document.addEventListener('mousedown', away)
    return () => { document.removeEventListener('mousedown', away) }
  }, [menu])

  const canSend = !busy && draft.trim() !== '' && blocked === undefined
  const risky = hint?.kind === 'risk'
  const cycle = (): void => {
    if (!voices.includes('place') || !voices.includes('private')) return
    setVoice(voice === 'place' ? 'private' : 'place')
  }

  return (
    <div className={`${css.composer} ${voice === 'place' ? css.pub : voice === 'ask' ? css.ask : css.pri}`}>
      {hint !== undefined && (
        <div
          className={`${css.hint} ${hint.kind === 'risk' || (hint.kind === 'note' && hint.warn === true) ? css.hintRisk : ''} ${hint.kind === 'register' && hint.ok ? css.hintOk : ''} ${risky && nudged ? css.hintShake : ''}`}
          data-testid={`composer-hint-${hint.kind}`}
        >
          {hintBody(hint)}
        </div>
      )}
      <textarea
        ref={boxRef}
        className={css.input}
        value={draft}
        disabled={busy}
        rows={2}
        placeholder={placeholder}
        onChange={(event) => { setDraft(event.target.value) }}
        onKeyDown={(event) => {
          // 输入法正在选字时，回车是「选这个词」，不是「发出去」。
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === '.' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            cycle()
            return
          }
          if (event.key === 'Escape') {
            event.currentTarget.blur()
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (!canSend) return
            if (risky && !nudged) { setNudged(true); return }
            send()
          }
        }}
      />
      <div className={css.bar}>
        <div className={css.audienceWrap} ref={menuRef}>
          <button
            type="button"
            className={`${css.audience} ${risky ? css.audienceRisk : ''}`}
            aria-haspopup={voices.length > 1 ? 'menu' : undefined}
            disabled={voices.length < 2}
            title={voices.length > 1 ? '换一个听众（⌘.）' : undefined}
            onClick={() => { setMenu(value => !value) }}
          >
            <Icon name={iconOf(voice)} size={14} />
            <span className={css.audienceText}>
              {labelOf(voice)}
              {hint?.kind === 'risk' && hint.who !== undefined ? ` · ${hint.who}听不见` : ''}
            </span>
            {voices.length > 1 && <Icon name="chevD" size={12} />}
          </button>
          {menu && (
            <div className={css.menu} role="menu">
              {voices.map(option => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={option === voice}
                  key={option}
                  className={`${css.menuItem} ${option === voice ? css.menuOn : ''}`}
                  onClick={() => { setVoice(option); setMenu(false); boxRef.current?.focus() }}
                >
                  <Icon name={iconOf(option)} size={14} />
                  <span className={css.menuText}>
                    <b>{labelOf(option)}</b>
                    <span>
                      {option === 'private'
                        ? direct ? `${placeName ?? '对方'}看不见。${AGENT}照常干活。` : `群里的人看不见。${AGENT}照常干活。`
                        : option === 'place'
                          ? direct ? `以你本人的名义发，${placeName ?? '对方'}看得见。` : '以你本人的名义发，群里所有人看得见。'
                          : '问一个数得一个数：不开任务，不写任何东西。'}
                    </span>
                  </span>
                  {option === voice && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className={css.tools}>{tools}</span>
        {blocked !== undefined && <span className={css.blocked}>{blocked}</span>}
        <button
          type="button"
          className={`${css.send} ${voice === 'place' ? css.sendPub : ''}`}
          disabled={!canSend}
          onClick={send}
        >
          {sendLabel}
          <Icon name="send" size={14} />
        </button>
      </div>
    </div>
  )
}

function hintBody(hint: Hint): ReactNode {
  switch (hint.kind) {
    case 'draft':
      return (
        <>
          <Icon name="doc" size={14} className={css.hintMark} />
          <span className={css.hintText}>
            {AGENT}拟的稿，改成你的话再发。这是在催「{hint.about}」，不会另记一条。
          </span>
          <button type="button" className={css.hintDrop} onClick={hint.drop} aria-label="不用这份稿"><Icon name="x" size={12} /></button>
        </>
      )
    case 'risk':
      return (
        <>
          <Icon name="eyeOff" size={14} className={css.hintMark} />
          <span className={css.hintText}>{hint.text}</span>
          {hint.fix !== undefined && (
            <button type="button" className={css.hintFix} onClick={hint.fix.run}>{hint.fix.label}</button>
          )}
        </>
      )
    case 'register':
      return (
        <>
          <Icon name={hint.ok ? 'check' : 'doc'} size={14} className={css.hintMark} />
          <span className={css.hintText}>{hint.line}</span>
          <button type="button" className={css.hintDrop} onClick={hint.drop} title="不登记了，就当一句普通的话" aria-label="不登记了"><Icon name="x" size={12} /></button>
        </>
      )
    case 'reply':
      return (
        <>
          <Icon name="undo" size={14} className={css.hintMark} />
          <span className={css.hintText}>回复 <b>{hint.who}</b>：<span className={css.hintQuote}>{hint.text}</span></span>
          <button type="button" className={css.hintDrop} onClick={hint.drop} aria-label="不回复了"><Icon name="x" size={12} /></button>
        </>
      )
    case 'note':
      return (
        <>
          <Icon name={hint.warn === true ? 'eyeOff' : 'bolt'} size={14} className={css.hintMark} />
          <span className={css.hintText}>{hint.text}</span>
        </>
      )
    default:
      return (
        <>
          <Icon name="target" size={14} className={css.hintMark} />
          <span className={css.hintText}>{hint.text}</span>
          <button type="button" className={css.hintDrop} onClick={hint.drop} aria-label="不带了"><Icon name="x" size={12} /></button>
        </>
      )
  }
}

/**
 * 登记预览的那一行 —— **会记成什么，在发出前就亮出来** (律四).
 *
 * 用的是发送后落库的**同一个函数**（`registrationFrom`）：预览说「会记下」，发出去就真的
 * 记下；预览说认不出，发出去就真的只是一句话。两处各写一个解析，就会出现预览答应了、
 * 落库没兑现的那一天。
 */
export function registrationLine(
  draft: string, register: { readonly name: string },
): { line: string; ok: boolean } {
  const parsed = registrationFrom(draft, register.name)
  if (parsed === undefined) {
    return { line: `这句话里还认不出要登记的事——这样发出去，不会记成 ${register.name} 的承诺。`, ok: false }
  }
  return {
    line: `发出后会记下：${register.name}负责 · ${parsed.what}${parsed.due === undefined ? '' : ` · 原话「${parsed.due}」`}`,
    ok: true,
  }
}

/** 时间与派活的字眼：一句话里同时有人名和它们，多半是在说「谁什么时候做什么」。 */
const ASSIGNING = /(今天|明天|后天|大后天|周[一二三四五六日天末]|星期[一二三四五六日天]|下周|月底|月初|年底|\d+\s*[号日点]|之前|以前|前把|负责|跟进|搞定|补上|补一下|处理|交给|做完|弄好|出一版|发我|给我)/u

/**
 * 听众风险的本地判断 (律四) —— **只在私语里、只在句子点了某个人做某件事时**。
 *
 * 「张锐周五前把价格页补上」说在私语里，张锐一个字都听不见——群里没人知道，承诺不成立，
 * 而说的人以为说好了。这里不调模型：人名来自这段对话里真说过话的人，派活来自时间和动作
 * 的字眼。两样都命中才提醒，宁可漏一次，不在每一句闲聊上亮琥珀色。
 */
export function audienceRiskOf(draft: string, voice: Voice, people: readonly string[]): string | undefined {
  if (voice !== 'private') return undefined
  const text = draft.trim()
  if (text.length < 4 || !ASSIGNING.test(text)) return undefined
  const named = people
    .filter(name => name.length >= 2 && name !== AGENT && text.includes(name))
    .sort((left, right) => right.length - left.length)[0]
  return named
}
