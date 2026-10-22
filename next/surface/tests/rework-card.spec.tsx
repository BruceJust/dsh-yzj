// @vitest-environment jsdom
/**
 * 返工闭环在桌面上 (实测 2026-10-21).
 *
 * 一件 8/18 打回的活挂了两个月：卡上没有一个动词可按；人对云小助说「完成了」，云小助答
 * 「好，这件事就算完成了」，图上什么都没动。
 *
 * - 打回之后的卡说清人还能做什么：「就这样收了」「接着改」，而不是又一个「通过验收」；
 * - 话说成了裁决的样子，输入框在发出之前指向卡上那扇真的门。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { labelOf } from '@yzj-next/cards'
import { approvalVerbs as familyVerbs, taskCard } from '@yzj-next/objects'
import { CardRow, verdictDoor } from '../src/client/CardRow.tsx'
import type { StreamCard } from '../src/client/rpc.ts'
import { approvalVerbs } from '../src/client/words.ts'

/** 照服务端的样子编一张任务卡：动作、字、号都从家族来——测的是家族到按钮这一整段。 */
function task(state: Record<string, unknown>): StreamCard {
  const full = { taskId: 'tsk-kb', what: '@next 帮我看下我有哪些知识库', topicKey: 't', sourceAnchor: 'yzj:m', ...state }
  let n = 0
  const actions = taskCard.actions
    .filter(action => action.available?.(full as never) ?? true)
    .map(action => ({
      id: action.id,
      label: labelOf(action, full),
      needsInput: action.needsInput === true,
      available: true,
      ...(action.secondary === true ? { secondary: true } : { n: (n += 1) }),
    }))
  return { kind: 'task', id: 'tsk-kb', at: 0, seq: 1, resolved: false, actions, state: full }
}

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount() })
  host?.remove()
  root = undefined
})

function mount(card: StreamCard): HTMLElement {
  host = document.createElement('div')
  document.body.append(host)
  const mounted = createRoot(host)
  root = mounted
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  act(() => { mounted.render(<CardRow card={card} now={Date.now()} answer={() => undefined} />) })
  return host
}
const buttons = (view: HTMLElement): string[] => [...view.querySelectorAll('button')].map(button => button.textContent ?? '')

describe('打回之后的卡', () => {
  it('返工中：「就这样收了」，并说清云小助在按什么改', () => {
    const view = mount(task({ status: 'rework', round: 1, reason: '口径不对，要按可编辑权限重新数' }))
    expect(buttons(view)).toContain('1就这样收了')
    expect(view.textContent).toContain('打回过 1 次：口径不对，要按可编辑权限重新数。云小助在按这个改')
  })

  it('返工停了：「接着改」「就这样收了」，说清两条路各是什么', () => {
    const view = mount(task({ status: 'interrupted', round: 1, reason: '打回之后没有接着改' }))
    expect(buttons(view)).toEqual(expect.arrayContaining(['1就这样收了', '2接着改']))
    expect(view.textContent).toContain('改到一半停了')
  })

  it('答复：卡头说「云小助答了」，不说「要你验收」，也不说「在做」', () => {
    const view = mount(task({ status: 'answered', summary: '星期四。' }))
    expect(view.textContent).toContain('云小助答了')
    expect(view.textContent).not.toContain('要你')
    expect(buttons(view)).toEqual(expect.arrayContaining(['1收下', '2打回重做…']))
  })

  it('刚交付的照旧是「通过验收」', () => {
    expect(buttons(mount(task({ status: 'terminal', summary: '40 个知识库' })))).toContain('1通过验收')
  })
})

describe('话说成了裁决的样子', () => {
  const rework = task({ status: 'rework', round: 1 })

  it('「完成了」指向卡上的门，说清说给云小助不算数', () => {
    expect(verdictDoor('完成了', [rework])).toBe('要把这件活收口，按卡上的 1「就这样收了」——云小助改不了任务的状态，说给它不算数。')
    expect(verdictDoor('可以了。', [rework])).toBeDefined()
    expect(verdictDoor('OK', [task({ status: 'terminal' })])).toContain('「通过验收」')
  })

  it('不是裁决的话不拦——「可以再加一列吗」也以「可以」开头', () => {
    expect(verdictDoor('可以再加一列吗', [rework])).toBeUndefined()
    expect(verdictDoor('完成了吗？', [rework])).toBeUndefined()
  })

  it('没有等着收口的活，不指', () => {
    expect(verdictDoor('完成了', [])).toBeUndefined()
    // 答复不等人收口。
    expect(verdictDoor('完成了', [task({ status: 'answered', summary: '星期四。' })])).toBeUndefined()
    expect(verdictDoor('完成了', [task({ status: 'open' })])).toBeUndefined()
  })
})

describe('确认卡的字，两份不分家', () => {
  /*
    浏览器包引不到 objects，桌面那一份 `approvalVerbs` 只好抄一份——用来说「写之前先问你」
    里的那个「写」。按钮上的字已经由家族编进线上了；这里钉住两份不各说各的。
  */
  it('桌面那份和家族那份，四类工具说同样的话', () => {
    for (const tool of ['/handoff', 'yzj_im_message_send', 'yzj_doc_delete', 'yzj_doc_create']) {
      expect(approvalVerbs(tool), tool).toEqual(familyVerbs(tool))
    }
  })
})
