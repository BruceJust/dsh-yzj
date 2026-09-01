/**
 * 私语通道的两位新住客 —— 立约邀约卡与校准回执卡 (私账层 §4/§7).
 *
 * 它复用组织侧的**卡语法**（动作、可用性、终态、先答先赢）而不复用它的存储：这张
 * 卡的状态活在第二本账上，所以「可应答对象」的任何聚合查询在**定义域**上就碰不到
 * 它——三不入靠存储分离，不靠 filter。
 *
 * 三条它自己说的话，都写在卡上而不是文档里：
 *
 * - **不进收件箱、不进决断条、不进任何徽标.** 左栏的计数不会因为这张卡变化，现在
 *   就可以核对。
 * - **不老化、不可催、不成欠账.** 未答的邀约与回执静躺在这里——这本账的债主是你
 *   自己。
 * - **产婆术：输入框是空的.** 「帮我写」只给维度（过不过？返几轮？影响下一步吗？），
 *   不给句子。你打进去的那句话一个字节不改地落账（原话直存律）。
 */

import { useState, type ReactNode } from 'react'
import type { PrivateRowWire } from './rpc.ts'
import css from './vault.module.css'

/** 一张照片里的那句话。读不出就说实话，不给空串。 */
function textOf(value: unknown): string {
  const text = (value as { text?: unknown } | null | undefined)?.text
  return typeof text === 'string' ? text : '（这一段没有留下快照）'
}

export interface PrivateCardProps {
  row: PrivateRowWire
  busy: boolean
  /** 返回宿主的原话；`undefined` = 成功。回执要原样带回来，不合成一句「失败了」。 */
  act(actionId: string, input?: string): Promise<void>
  /**
   * 就地合环 —— 开镜（给了 `patternKey`）或调档（没给）。
   *
   * 不给这个 prop，这张卡就不长那一行：私语流之外的地方（比如群视图里）本来就
   * 不该有合环动词。
   */
  loopback?(
    family: string, patternKey: string | undefined, on: boolean,
    gear?: 'lease' | 'default' | 'weight',
  ): Promise<void>
  /**
   * 把这张回执的证据摆到右栏 —— **对表不出屏在这里最要紧**（#61 澄清①）.
   *
   * 设计点名的是「判例 / 预期 / **回执**」三种行。前两种长在金库的清单里；而
   * 回执是**四格真正被按下的地方**——边看证据边下归因，说的就是这一张卡。
   *
   * 不给这个 prop 就不长那颗按钮：私语流也出现在自聊里，而那儿没有右栏——
   * 一颗按了什么都不会发生的「证据」，比没有更糟。
   */
  showEvidence?(id: string): void
}

export function PrivateCard(props: PrivateCardProps): ReactNode {
  const { row, busy, act, loopback, showEvidence } = props
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const state = row.state
  const isInvite = row.kind === 'invite'
  const available = row.actions.filter(action => action.available)
  const dismissed = state.status === 'dismissed'

  return (
    <div className={css.privateCard} data-testid={`private-${row.kind}`}>
      <div className={css.privateHead}>
        <span className={css.domain}>{isInvite ? '立约' : '校准回执'}</span>
        <span className={css.privateTitle}>
          {isInvite ? '立个预期？ · 一次性邀约，不追问' : '当时裁决 × 后来事实'}
        </span>
      </div>
      <div className={css.privateBody}>
        {isInvite
          ? (
            <>
              {String(state.sourceLine ?? '')}
              {'\n'}检验点：{String(state.checkpointText ?? '')}
              {'\n'}立了，结果回来就能对表。不立也不影响任何组织侧流程——
              回执照样会来（<b>裁决本身即隐式预期</b>）。
            </>
          )
          : (
            <>
              {/*
                **正文三段全部渲染照片**（立此存照律）。

                `fact.text` / `evidence[].text` 是写入那一刻定格的人可读快照——
                这张卡因此在组织侧对象墓碑之后、在拷走的目录里，一个字都不会少。
              */}
              <b>当时</b>：{String(state.thenText ?? '')}
              {'\n'}<b>事实</b>：{textOf(state.fact)}
              {Array.isArray(state.evidence) && state.evidence.length > 0
                ? `\n证据：${(state.evidence as { text?: string }[]).map(one => one.text ?? '').join('；')}`
                : ''}
              {dismissed
                ? '\n已标注「配对错了」：这条事实与该裁决无关，判例未入账（宁空勿错）。'
                : '\n归因由你下，我不代下——候选注只给证据与假设，不给心理判词。'}
            </>
          )}
      </div>

      {/*
        产婆术的输入框：**空的，没有预填**。

        给句子就是替人写好了赌注，而一句不是你自己想出来的赌注，对表的时候对的是
        别人的判断。占位符只说维度。
      */}
      {draft !== undefined && (
        <div className={css.actions}>
          <textarea
            className={css.input}
            rows={2}
            autoFocus
            placeholder="一句可证伪的赌注，由你说：过不过？返几轮？影响下一步吗？"
            value={draft}
            onChange={(event) => { setDraft(event.target.value) }}
          />
        </div>
      )}

      <div className={css.actions}>
        {/*
          证据面入口 —— **只在回执上，只在有右栏的地方**。

          邀约卡问的是「要不要立个预期」，那一刻还没有事实可对；回执问的是
          「当时 × 后来」，而那正是需要把证据摆在旁边的一问。
        */}
        {!isInvite && showEvidence !== undefined && (
          <button
            type="button"
            className={css.verb}
            disabled={busy}
            title="右栏摆开这条回执的证据：当时的裁决、后来的事实、当时在档的那几条。边看边答。"
            onClick={() => { showEvidence(row.id) }}
          >
            证据
          </button>
        )}
        {available.map(action => (
          <button
            key={action.id}
            type="button"
            className={`${css.verb} ${action.style === 'primary' ? css.primary : ''}`}
            disabled={busy}
            onClick={() => {
              if (!action.needsInput) { void act(action.id); return }
              if (draft === undefined) { setDraft(''); return }
              const text = draft.trim()
              if (text === '') return
              void act(action.id, text).then(() => { setDraft(undefined) })
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      {/*
        就地合环行 —— **`answered` 终态必带** (v2.0 / #62-B5 / 断言⑳).

        判断刚出炉、动机最热的那一刻在这里，不在金库里。**金库是汇总处不是唯一
        入口**：#61 那条「凡只能在金库获得的能力即违规」，对它自己也生效。
      */}
      {row.loopback !== undefined && loopback !== undefined && (
        <div className={css.actions}>
          <span className={css.privateFoot} style={{ marginTop: 0 }}>
            {row.loopback.note}
          </span>
          <button
            type="button"
            className={`${css.verb} ${row.loopback.mirrorOn ? css.primary : ''}`}
            disabled={busy || row.loopback.patternKey === undefined}
            title={row.loopback.patternKey === undefined
              ? '这一族还没有重复出现的判例——模式浮现之后才有镜子可开'
              : '回喂环：给这一族的卡片开后视镜，此后它们旁边会亮出你自己的判例'}
            onClick={() => {
              const one = row.loopback
              if (one?.patternKey === undefined) return
              void loopback(one.family, one.patternKey, !one.mirrorOn)
            }}
          >
            🪞 {row.loopback.mirrorOn ? '关镜' : '给这类卡开后视镜'}
          </button>
          <button
            type="button"
            className={css.verb}
            disabled={busy}
            title="负重：摆开证据、不预选、无一键通过——「你先拆，我再补」"
            onClick={() => {
              const one = row.loopback
              if (one === undefined) return
              void loopback(one.family, undefined, false, one.gear === 'weight' ? 'default' : 'weight')
            }}
          >
            ⚖ 调档：{row.loopback.gear === 'weight' ? '回默认' : '负重'}
          </button>
        </div>
      )}
      <div className={css.privateFoot}>
        私账对象 · 不进收件箱（左栏计数不会因这张卡变化——三不入）· 不老化 · 不可催
        —— 这本账的债主是你自己
        {row.zone === 'settled' ? ' · 已沉降：不再打扰，但这一行仍然可动' : ''}
      </div>
    </div>
  )
}
