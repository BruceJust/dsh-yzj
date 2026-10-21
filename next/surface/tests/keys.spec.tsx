// @vitest-environment jsdom
/**
 * 各屏自己的键先过一道门 (律八)。
 *
 * 此前数字、V、J/K、N、Z 各自只查「在不在打字」：`?` 那张表开着时按 1，答掉的是底下那张
 * 卡；规则面板开着时按 N，人被带去了别的群。
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { commandKey, escape, openPalette, useBackKey } from '../src/client/keys.ts'

const press = (key: string, target: EventTarget = document.body): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
  openPalette('closed')
})

describe('commandKey', () => {
  it('a bare key on the page is a command', () => {
    expect(commandKey(press('1'))).toBe(true)
  })

  it('not while typing', () => {
    const box = document.createElement('textarea')
    document.body.append(box)
    expect(commandKey(press('1', box))).toBe(false)
  })

  it('not while a dialog or menu is over the page', () => {
    const sheet = document.createElement('div')
    sheet.setAttribute('role', 'dialog')
    document.body.append(sheet)
    expect(commandKey(press('1'))).toBe(false)
  })

  it('not while ⌘K or the key sheet is open', () => {
    openPalette('help')
    expect(commandKey(press('n'))).toBe(false)
  })
})

describe('useBackKey', () => {
  /*
    父屏没有返回可登记时，不许清掉子屏登记的那一个：子屏的 effect 先跑，父屏的后跑，
    此前父屏那一下 `back = undefined` 让群视图里的 Esc 回不去。
  */
  it('a screen with nothing to register leaves the other screen\'s Back alone', () => {
    let went = 0
    const goBack = (): void => { went += 1 }
    function Child(): null { useBackKey(goBack); return null }
    function Parent(): React.ReactNode { useBackKey(undefined); return <Child /> }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => { root.render(<Parent />) })
    expect(escape()).toBe(true)
    expect(went).toBe(1)
    act(() => { root.unmount() })
  })
})
