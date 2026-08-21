/**
 * 工件预览三态的规格 (v4.11).
 *
 * 三条值得锁住的,都是**静悄悄地错**的那一类:
 *
 * - 「预览」这个动词只对得起有字节的东西——把一件云之家在线文档当成文件打开,
 *   得到的是一个永远转圈的框,而不是一个报错;
 * - **切语境即收**——上一个话题里那份文档留在右栏里,看着像是属于眼前这段
 *   对话,而它谁也不属于;
 * - 右栏不在场时(冷启动直接开看板,一个会话都没有)按「预览」必须**仍然有
 *   东西发生**,否则那是所有 bug 里最难被报告的一种:什么都没发生。
 */

import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest'
import { artifactRefOf } from '../src/client/artifacts.ts'
import { parseDelimited, separatorFor } from '../src/client/delimited.ts'
import {
  attachmentState, closePreview, extensionOf, fileIdOfUri, leaveImmersive, openPreview,
  previewSnapshot, rememberAttachment, retryAttachment,
  safeHref, setAsidePreviewHost, setPreviewStage, sizeLabel, subscribePreview, type PreviewTarget,
} from '../src/client/preview.ts'
import { setFrame } from '../src/client/store.ts'

/**
 * 右栏的替身:测试驱动的是 UI 用的同一个接缝。
 *
 * 两个信号都要能单独摆:属性说没收起、宽度说有多宽——因为它们各自兜住一种
 * 失真,而只考其中一个就等于没考另一个。
 */
const aside = (options: { collapsed?: boolean; width?: number } | null): void => {
  setAsidePreviewHost(options === null ? null : {
    getBoundingClientRect: () => ({ width: options.width ?? 0 }),
    closest: () => (options.collapsed === true ? {} : null),
  })
}

const FILE: PreviewTarget = {
  key: 'att:f-1', title: '竞品对比分析.md', fileId: 'f-1', origin: 'im',
}

beforeEach(() => {
  vi.useFakeTimers()
  closePreview()
  aside({ width: 360 })
})
afterEach(() => { vi.useRealTimers() })

describe('三态:谁在被看,看多近', () => {
  it('右栏开着就并排——边看边回,对话不离场', () => {
    openPreview(FILE)
    expect(previewSnapshot().target?.key).toBe('att:f-1')
    expect(previewSnapshot().stage).toBe('aside')
    vi.advanceTimersByTime(1_000)
    expect(previewSnapshot().stage).toBe('aside')
  })

  /*
    实测出来的洞:右栏的槽照样挂载,列宽却是 0——宿主要求有一个非空会话才给
    右栏东西渲染,而从群主楼点开一份文件恰恰常常不满足。那时如果只是把状态
    改了,人看到的是「什么都没发生」。
  */
  it('右栏根本开不出来时,等一拍就走沉浸——而不是什么都不发生', () => {
    aside({ collapsed: true, width: 0 })
    openPreview(FILE)
    expect(previewSnapshot().stage).toBe('aside')
    vi.advanceTimersByTime(800)
    expect(previewSnapshot().stage).toBe('immersive')
  })

  /*
    抽屉是在动画里张开的:样式已经写着 360,计算出来的列宽还是 0px。实测栽在
    这里——只看像素会把一次正常的打开判成「开不出来」,第一次预览莫名跳全屏。
  */
  it('正在动画里张开的抽屉不算关着——宿主写在框上的判断是同步的', () => {
    aside({ collapsed: false, width: 0 })
    openPreview(FILE)
    vi.advanceTimersByTime(800)
    expect(previewSnapshot().stage).toBe('aside')
  })

  it('属性哪天改了名,宽度仍然兜得住真的开着的抽屉', () => {
    // `collapsed` 一律答「开着」时,只有像素说得出真话——反过来也一样。
    aside({ collapsed: true, width: 360 })
    openPreview(FILE)
    vi.advanceTimersByTime(800)
    expect(previewSnapshot().stage).toBe('aside')
  })

  it('抽屉迟一点才开出来,到时候再问一次就不会误降级', () => {
    aside({ collapsed: true, width: 0 })
    openPreview(FILE)
    aside({ width: 360 })
    vi.advanceTimersByTime(800)
    expect(previewSnapshot().stage).toBe('aside')
  })

  it('右栏根本不在场(一个会话都没开),照样得有东西发生', () => {
    aside(null)
    openPreview(FILE)
    vi.advanceTimersByTime(800)
    expect(previewSnapshot().stage).toBe('immersive')
  })

  it('降级只认它自己那一次——中途换了个物就不再追认', () => {
    aside({ collapsed: true, width: 0 })
    openPreview(FILE)
    openPreview({ ...FILE, key: 'att:f-2', fileId: 'f-2' })
    aside({ width: 360 })
    vi.advanceTimersByTime(800)
    expect(previewSnapshot().target?.key).toBe('att:f-2')
    expect(previewSnapshot().stage).toBe('aside')
  })

  it('沉浸与并排之间来回,看的是同一个物', () => {
    openPreview(FILE)
    setPreviewStage('immersive')
    expect(previewSnapshot().stage).toBe('immersive')
    expect(previewSnapshot().target?.key).toBe('att:f-1')
    setPreviewStage('aside')
    expect(previewSnapshot().stage).toBe('aside')
  })

  /*
    退出沉浸不能退进一个看不见的格子。

    这是上面那个洞的另一半:右栏开不出来时预览跳级去了全屏,那么从全屏按 Esc
    「回到并排」就等于把文档弄丢——人按的是返回,得到的是消失。
  */
  it('并排没地方落时,退出沉浸就是关掉——而不是退进看不见的地方', () => {
    aside({ collapsed: true, width: 0 })
    openPreview(FILE)
    vi.advanceTimersByTime(800)
    expect(previewSnapshot().stage).toBe('immersive')
    leaveImmersive()
    expect(previewSnapshot().target).toBeUndefined()
  })

  it('右栏在,退出沉浸就回并排——对话本来就还在旁边', () => {
    openPreview(FILE)
    setPreviewStage('immersive')
    leaveImmersive()
    expect(previewSnapshot().stage).toBe('aside')
    expect(previewSnapshot().target?.key).toBe('att:f-1')
  })

  it('没有东西被看着时,换姿势是空操作', () => {
    setPreviewStage('immersive')
    expect(previewSnapshot().target).toBeUndefined()
  })

  it('通知订阅者——右栏和沉浸层是两个互不相识的槽', () => {
    let beats = 0
    const stop = subscribePreview(() => { beats += 1 })
    openPreview(FILE)
    setPreviewStage('immersive')
    closePreview()
    stop()
    expect(beats).toBe(3)
  })
})

describe('切语境即收', () => {
  it('换框架就收起——那份文档不属于新的场景', () => {
    openPreview(FILE)
    setFrame({ kind: 'board' })
    expect(previewSnapshot().target).toBeUndefined()
    setFrame({ kind: 'session' })
  })

  it('收起也把姿势归零,下一次打开从并排开始', () => {
    openPreview(FILE)
    setPreviewStage('immersive')
    closePreview()
    expect(previewSnapshot().stage).toBe('aside')
  })
})

describe('工件统一:一条产出边变成一张卡', () => {
  it('agent 上传的文件走和 IM 附件同一条取字节的路', () => {
    const ref = artifactRefOf({ uri: 'yzj://file/abc123', title: '周报.pdf', action: '上传文件' })
    expect(ref.fileId).toBe('abc123')
    expect(ref.ext).toBe('pdf')
    expect(ref.origin).toBe('agent')
    // 我们自己的记号不是一扇能推开的门。
    expect(ref.href).toBeUndefined()
  })

  it('云之家在线文档只给门——它是活的,复制品会过期', () => {
    const ref = artifactRefOf({
      uri: 'https://www.yunzhijia.com/doc/d-1', title: 'Q3 目标', action: '新建文档',
    })
    expect(ref.fileId).toBeUndefined()
    expect(ref.href).toBe('https://www.yunzhijia.com/doc/d-1')
  })

  it('既无字节又无门的边,是一行记录', () => {
    const ref = artifactRefOf({ uri: 'yzj://message/g-1/m-1', title: '', action: '发送消息' })
    expect(ref.fileId).toBeUndefined()
    expect(ref.href).toBeUndefined()
    // 标题空着就顶上 URI:难看,但一眼指得出是哪条边忘了记名字。
    expect(ref.title).toBe('yzj://message/g-1/m-1')
  })

  it('补充信息并进小字,缺席的那些不留下分隔符', () => {
    expect(artifactRefOf({
      uri: 'yzj://file/x', title: 'a.md', action: '上传文件',
      notes: ['19:50', undefined, ''],
    }).meta).toBe('上传文件 · 19:50')
  })

  /*
    统一那张卡的时候,越境和「归不了属」一度被并进了那行灰字——警告降级成了
    装饰,而它们各自带的那句「为什么」直接消失。提醒必须和小字分开走。
  */
  it('提醒不进小字,而且各自带着那句为什么', () => {
    const ref = artifactRefOf({
      uri: 'yzj://file/x',
      title: 'a.md',
      action: '上传文件',
      notes: ['19:50'],
      marks: [{ label: '写到了别的场所', why: '越境是要被看见的' }, undefined],
    })
    expect(ref.meta).toBe('上传文件 · 19:50')
    expect(ref.meta).not.toContain('写到了别的场所')
    expect(ref.marks).toEqual([{ label: '写到了别的场所', why: '越境是要被看见的' }])
  })

  it('没有提醒就不留一个空的提醒位', () => {
    expect(artifactRefOf({
      uri: 'yzj://file/x', title: 'a.md', marks: [undefined, undefined],
    }).marks).toBeUndefined()
  })

  it('同一个 URI 在三处画出的是同一张卡', () => {
    const left = artifactRefOf({ uri: 'yzj://file/x', title: 'a.md', action: '上传文件' })
    const right = artifactRefOf({ uri: 'yzj://file/x', title: 'a.md', notes: ['本群'] })
    expect(left.key).toBe(right.key)
  })
})

/*
  取到的字节可以永远记着(fileId 不变),**一次失败不行**。

  通道没就绪、token 刚过期、CLI 抖了一下——这些都会让一次取失败,而且都会自己
  好。曾经把两者塞进同一张表,于是「取不到这个文件」会挂到刷新页面为止,而且
  没有任何再试的门:一次偶然被说成了一个事实。
*/
describe('失败不是不变的事实', () => {
  it('没取到就是没取到,不写进那张不会过期的表', () => {
    rememberAttachment('f-miss', undefined)
    expect(attachmentState('f-miss')).toMatchObject({ missing: true, busy: false })
    expect(attachmentState('f-miss').body).toBeUndefined()
  })

  it('再试一次就真的会再走一趟宿主', () => {
    rememberAttachment('f-retry', undefined)
    expect(attachmentState('f-retry').missing).toBe(true)
    retryAttachment('f-retry')
    // 回到「还没取」,而不是留在「取不到」——下一次读会重新发出去。
    expect(attachmentState('f-retry')).toMatchObject({ missing: false, busy: true })
  })

  it('重试不会把已经取到的字节一起丢掉', () => {
    const body = { kind: 'text', text: 'x', size: 1, clipped: false } as const
    rememberAttachment('f-ok', body)
    retryAttachment('f-ok')
    expect(attachmentState('f-ok').body).toBe(body)
  })

  it('从没问过的 id 是「还没取」,不是「取不到」', () => {
    expect(attachmentState('f-unknown')).toMatchObject({ missing: false, busy: true })
  })
})

describe('URI 与名字的那几个小判断', () => {
  it('只认严格的 file URI——多一段路径就不是它', () => {
    expect(fileIdOfUri('yzj://file/abc')).toBe('abc')
    expect(fileIdOfUri('yzj://file/abc/def')).toBeUndefined()
    expect(fileIdOfUri('yzj://doc/abc')).toBeUndefined()
    expect(fileIdOfUri('https://x/file/abc')).toBeUndefined()
  })

  it('后缀决定怎么投影,所以点号的位置要较真', () => {
    expect(extensionOf('r29-summary.v2.MD')).toBe('md')
    expect(extensionOf('README')).toBeUndefined()
    expect(extensionOf('.gitignore')).toBeUndefined()
    expect(extensionOf('trailing.')).toBeUndefined()
    expect(extensionOf('/a/b.c/plain')).toBeUndefined()
  })

  it('只有 http(s) 算门——`javascript:` 会在承载 RPC 通道的这一页里执行', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('yzj://file/x')).toBeUndefined()
    expect(safeHref('https://a/b')).toBe('https://a/b')
  })

  it('大小写成人会说出口的那个单位', () => {
    expect(sizeLabel(undefined)).toBe('')
    expect(sizeLabel(0)).toBe('')
    expect(sizeLabel(39)).toBe('39 B')
    expect(sizeLabel(18 * 1024)).toBe('18.0 KB')
    expect(sizeLabel(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})

describe('表格投影:一张表不该排成一堵墙', () => {
  it('引号里的分隔符是内容,不是分隔符', () => {
    expect(parseDelimited('a,"b,c",d', ',')).toEqual([['a', 'b,c', 'd']])
  })

  it('引号里的换行也是内容——地址列几乎总是这样', () => {
    expect(parseDelimited('h1,h2\n"多\n行",x', ',')).toEqual([['h1', 'h2'], ['多\n行', 'x']])
  })

  it('连着两个引号是一个引号', () => {
    expect(parseDelimited('"他说""好""",b', ',')).toEqual([['他说"好"', 'b']])
  })

  it('末尾没有换行也是一行——丢掉它就是丢掉最后一条记录', () => {
    expect(parseDelimited('a,b\nc,d', ',')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('空行不算记录,CRLF 不留残迹', () => {
    expect(parseDelimited('a,b\r\n\r\nc,d\r\n', ',')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('tsv 走制表符', () => {
    expect(separatorFor('tsv')).toBe('\t')
    expect(separatorFor('csv')).toBe(',')
    expect(parseDelimited('a\tb', separatorFor('tsv'))).toEqual([['a', 'b']])
  })
})
