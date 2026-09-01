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

export interface PrivateCardProps {
  row: PrivateRowWire
  busy: boolean
  /** 返回宿主的原话；`undefined` = 成功。回执要原样带回来，不合成一句「失败了」。 */
  act(actionId: string, input?: string): Promise<void>
}

export function PrivateCard(props: PrivateCardProps): ReactNode {
  const { row, busy, act } = props
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
              <b>当时</b>：{String(state.thenText ?? '')}
              {'\n'}<b>事实</b>：{String(state.factText ?? '')}
              {Array.isArray(state.evidence) && state.evidence.length > 0
                ? `\n证据：${(state.evidence as string[]).join('；')}`
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
      <div className={css.privateFoot}>
        私账对象 · 不进收件箱（左栏计数不会因这张卡变化——三不入）· 不老化 · 不可催
        —— 这本账的债主是你自己
      </div>
    </div>
  )
}
