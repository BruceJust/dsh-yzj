/**
 * ⌘K 与 Esc 链 (界面重设计 P5 · §8 · 律八).
 *
 * - **⌘K 是捷径不是入口**：它能去的地方，左栏、承诺页里都有；空着的时候不摊开整本，
 *   隐身档下连地方都不给。
 * - **一下 Esc 只做一件事**：关预览 › 取消选中 › 回到原处。
 */

import { describe, expect, it } from 'vitest'
import type { BoardRowWire, InboxView, ObjectRowWire } from '../src/client/rpc.ts'
import { matchPalette, paletteItems } from '../src/client/Palette.tsx'
import { escape, KEYMAP } from '../src/client/keys.ts'
import { closePreview, openPreview, previewSnapshot } from '../src/client/preview.ts'
import { currentSpotlight, setSpotlight } from '../src/client/store.ts'

const inbox = {
  needs: [{ ref: { kind: 'commitment', id: 'c-9' }, sessionId: 's-1', verb: '验收', label: 'Q3 复盘材料初稿', where: '产品讨论群', since: 0 }],
  counts: { confirm: 0, review: 0, running: 0 },
  firstOf: {},
  places: [{
    placeKey: 'yzj-group-g1', groupName: '产品讨论群', conversationKind: 'group', tone: 'idle', badge: '', archived: 0,
    topics: [{ sessionId: 's-1', placeKey: 'yzj-group-g1', title: '竞品对比表', placeName: '产品讨论群', preview: '', tone: 'idle', badge: '' }],
  }],
  conversations: [
    { placeKey: 'yzj-group-g1', name: '产品讨论群', kind: 'group', lastMsgTime: 0, preview: '', unread: 0, onDuty: true, selfChat: false },
    { placeKey: 'yzj-dm-u2', name: '李婷', kind: 'direct', lastMsgTime: 0, preview: '', unread: 0, onDuty: true, selfChat: false },
  ],
  topicSessionIds: ['s-1'],
  commitments: { open: 1, overdue: 0 },
  pledger: { enabled: true },
} as unknown as InboxView

const row = {
  id: 'c-1', what: '月结 T+3 出报表', executorKind: 'human', who: '郑慧', overdue: false, status: 'open',
  remindable: true, direction: 'owed-to-me', signal: 'evidence', lastSignalAt: 0, inferredGoal: false,
} as unknown as BoardRowWire
const artifact: ObjectRowWire = {
  uri: 'yzj://file/f-1', title: '竞品对比.md', action: '上传文件', placeKey: 'yzj-files', time: 1,
  from: { label: '竞品对比表', sessionId: 's-1', at: 1 },
}

describe('⌘K：到已有地方的捷径', () => {
  const items = paletteItems({ inbox, board: { rows: [row], goals: [], unattached: [] }, artifacts: [artifact] })

  it('要你、地方、话题、承诺、产出都在，产出带出处', () => {
    const groups = new Set(items.map(item => item.group))
    for (const group of ['要你', '去哪', '地方', '话题', '承诺', '产出'] as const) expect(groups.has(group)).toBe(true)
    expect(items.find(item => item.group === '产出')?.sub).toBe('来自「竞品对比表」')
    expect(items.find(item => item.label === '我定过的')).toBeDefined()
  })

  it('每个词都要命中；按组排好', () => {
    expect(matchPalette(items, '竞品').map(item => item.group)).toEqual(['话题', '产出'])
    expect(matchPalette(items, '郑慧 报表').map(item => item.label)).toEqual(['月结 T+3 出报表'])
    expect(matchPalette(items, '李婷')[0]?.sub).toBe('私聊')
  })

  it('空着的时候不摊开整本：要你、去哪、几个地方；隐身档下只给去哪和做', () => {
    const blank = matchPalette(items, '')
    expect(blank.some(item => item.group === '承诺' || item.group === '产出')).toBe(false)
    expect(blank[0]?.group).toBe('要你')
    expect(matchPalette(items, '', true).every(item => item.group === '去哪' || item.group === '做')).toBe(true)
  })

  /*
    演示隐身有落点 (D10 · R14)：⌘K 里就能开、能关。隐身档下自聊搜不到，「今天自己办了的」不给。
  */
  it('「开始演示」在 ⌘K 里；隐身档下变「结束演示」，自聊和「自己办了的」不出现', () => {
    expect(items.find(item => item.key === 'do:stealth')?.label).toBe('开始演示')
    const hidden = paletteItems({
      inbox: {
        stealth: true,
        conversations: [{ placeKey: 'self', name: '我', kind: 'direct', selfChat: true, onDuty: true, unread: 0, lastMsgTime: 0, preview: '' }],
      } as never,
      autoToday: 3,
    })
    expect(hidden.find(item => item.key === 'do:stealth')?.label).toBe('结束演示')
    expect(hidden.some(item => item.key === 'place:self')).toBe(false)
    expect(hidden.some(item => item.key === 'go:auto')).toBe(false)
  })
})

describe('Esc 链：一下只做一件事', () => {
  it('关预览 › 取消选中', () => {
    setSpotlight({ kind: 'commitment', id: 'c-1', title: 'x' })
    openPreview({ key: 'k', title: 'a.md', origin: 'agent', fileId: 'f' })
    expect(escape()).toBe(true)
    expect(previewSnapshot().target).toBeUndefined()
    expect(currentSpotlight()).toBeDefined()
    expect(escape()).toBe(true)
    expect(currentSpotlight()).toBeUndefined()
    closePreview()
  })

  it('键盘表写的是人话，每个键一行', () => {
    expect(KEYMAP.map(entry => entry.keys)).toContain('⌘K')
    expect(KEYMAP.map(entry => entry.keys)).toContain('Esc')
    for (const entry of KEYMAP) expect(entry.does).not.toMatch(/[a-z]{4,}/u)
  })
})
