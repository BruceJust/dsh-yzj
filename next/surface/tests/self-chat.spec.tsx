// @vitest-environment jsdom
/**
 * 自聊处处同名 —— 文件预览实测时顺路看到：左栏叫它「我 · 审批通道」，点进去屋子却叫
 * 「代少兵」，输入框写「发给代少兵…」，听众标签是「代少兵 · 私聊」。私聊的「群名」是
 * 对方的名字，自聊的对方是自己。
 */

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Composer } from '../src/client/Composer.tsx'
import { SELF_CHAT } from '../src/client/words.ts'
import { SELF_CHAT_NAME } from '../src/rpc.ts'

let root: Root | undefined
let host: HTMLElement | undefined

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount() })
  host?.remove()
  root = undefined
})

function composer(props: { placeName: string; direct?: boolean; selfChat?: boolean }): HTMLElement {
  host = document.createElement('div')
  document.body.append(host)
  const mounted = createRoot(host)
  root = mounted
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  act(() => {
    mounted.render(
      <Composer
        voice="place" voices={['place']} setVoice={() => undefined}
        placeName={props.placeName} direct={props.direct} selfChat={props.selfChat}
        draft="" setDraft={() => undefined} busy={false} send={() => undefined}
        boxRef={createRef<HTMLTextAreaElement>()} sendLabel="发出" placeholder="…"
      />,
    )
  })
  return host
}

describe('自聊在屏上处处同名', () => {
  it('浏览器这一半和服务端是同一个名字', () => {
    expect(SELF_CHAT).toBe(SELF_CHAT_NAME)
  })

  it('自聊的听众标签说「只有你看得见」，不说「代少兵 · 私聊」', () => {
    const view = composer({ placeName: SELF_CHAT, direct: true, selfChat: true })
    expect(view.textContent).toContain('只有你看得见')
    expect(view.textContent).not.toContain('私聊')
  })

  it('别人的私聊照旧写「李婷 · 私聊」', () => {
    expect(composer({ placeName: '李婷', direct: true }).textContent).toContain('李婷 · 私聊')
  })
})
