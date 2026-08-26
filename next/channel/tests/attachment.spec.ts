/**
 * 附件字节的规格 (v4.11「能投影则投影」的数据通路).
 *
 * 嗅探是这条路上唯一会**静悄悄地错**的一环:一个错的 mime 不会抛异常,它画出
 * 一张坏图,看起来像网络抖了一下。而这里的输入恰恰不可信——云之家把粘贴的
 * 截图叫 `.png` 而里面是 jpeg,把没有后缀的东西照发。
 *
 * 所以锁两件事:认得出的都要认对,认不出的要**说不认识**(返回 undefined 让
 * 扩展名兜底),而不是随便猜一个。
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { YzjTopicReader, sniffMime, type AttachmentBody } from '../src/topics.ts'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
const ascii = (text: string): number[] => [...text].map(char => char.charCodeAt(0))

describe('字节说它是什么', () => {
  it('认得出预览要用到的那几种', () => {
    expect(sniffMime(bytes(0xFF, 0xD8, 0xFF, 0xE0))).toBe('image/jpeg')
    expect(sniffMime(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))).toBe('image/png')
    expect(sniffMime(bytes(...ascii('GIF89a')))).toBe('image/gif')
    expect(sniffMime(bytes(...ascii('BM'), 0, 0))).toBe('image/bmp')
    expect(sniffMime(bytes(...ascii('%PDF-1.7')))).toBe('application/pdf')
  })

  it('webp 要读到第 8 字节的 brand——前四字节和 wav/avi 一模一样', () => {
    expect(sniffMime(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP')))).toBe('image/webp')
    expect(sniffMime(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toBeUndefined()
  })

  it('认不出就说认不出,不猜——文本没有魔数,该由后缀回答', () => {
    expect(sniffMime(bytes(...ascii('# 标题')))).toBeUndefined()
    expect(sniffMime(bytes())).toBeUndefined()
    // 只读到一半的 png 头不是 png:嗅探要么确定,要么让位。
    expect(sniffMime(bytes(0x89, 0x50))).toBeUndefined()
  })
})

/**
 * 分路:一份字节该被画成什么。
 *
 * 已经落在缓存里的文件不会再走一趟 CLI(附件 id 不变,取过一次就永远不必再取),
 * 所以这里直接摆好缓存来考分路本身——传输层不是这几条规则的一部分。
 */
describe('取回来之后走哪一路', () => {
  const reader = async (
    files: { id: string; ext?: string; body: Uint8Array | string }[],
  ): Promise<YzjTopicReader> => {
    const dir = await mkdtemp(join(tmpdir(), 'yzj-attach-'))
    await mkdir(join(dir, 'attachments'), { recursive: true })
    for (const file of files) {
      const name = file.ext === undefined ? file.id : `${file.id}.${file.ext}`
      await writeFile(join(dir, 'attachments', name), file.body)
    }
    return new YzjTopicReader(
      {} as never, { downloadFile: async () => { throw new Error('不该再取一遍') } } as never,
      {} as never, 'op', 'org', async () => '', async () => ({ ignited: false }),
      async () => ({ ignited: false }),
      new Set(), [], async () => {}, dir,
    )
  }
  const pdf = Uint8Array.from([...'%PDF-1.4\n%âãÏÓ\n'].map(char => char.charCodeAt(0) & 0xFF))
  const png = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4])

  it('PDF 交给浏览器原生阅读器——字节原样递过去', async () => {
    const topics = await reader([{ id: 'p1', ext: 'pdf', body: pdf }])
    const body: AttachmentBody = await topics.readAttachment('p1', 'a.pdf')
    expect(body.kind).toBe('pdf')
    if (body.kind !== 'pdf') return
    expect(Buffer.from(body.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('图片的 mime 来自字节,不来自名字', async () => {
    // 名字说 png,里面是 jpeg——过去这一路会发出 image/png,画出一张坏图。
    const topics = await reader([
      { id: 'i1', ext: 'png', body: Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]) },
      { id: 'i2', ext: 'png', body: png },
    ])
    expect(await topics.readAttachment('i1', 'a.png')).toMatchObject({ kind: 'image', mime: 'image/jpeg' })
    expect(await topics.readAttachment('i2', 'b.png')).toMatchObject({ kind: 'image', mime: 'image/png' })
  })

  it('没有后缀的东西照样认得出来', async () => {
    const topics = await reader([{ id: 'n1', body: png }])
    expect(await topics.readAttachment('n1')).toMatchObject({ kind: 'image', mime: 'image/png' })
  })

  it('SVG 靠后缀进图片这一路——它是文本,没有魔数', async () => {
    const topics = await reader([{ id: 's1', ext: 'svg', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }])
    expect(await topics.readAttachment('s1', 'a.svg')).toMatchObject({
      kind: 'image', mime: 'image/svg+xml',
    })
  })

  /*
    名字说是图片,字节不认识——最典型的是 iPhone 的 HEIC。过去会当作 png 发出去,
    浏览器画出一张破图,看起来像网络抖了一下。
  */
  it('浏览器打不开的图片格式,说打不开并给出它在哪儿', async () => {
    const topics = await reader([{ id: 'h1', ext: 'heic', body: 'not really an image' }])
    const body = await topics.readAttachment('h1', 'a.heic')
    expect(body.kind).toBe('binary')
    if (body.kind !== 'binary') return
    expect(body.why).toContain('HEIC')
    expect(body.savedTo).toContain('h1.heic')
  })

  it('读得懂的文本原样交出去,由前端按后缀决定怎么渲染', async () => {
    const topics = await reader([{ id: 't1', ext: 'md', body: '# 标题\n正文' }])
    expect(await topics.readAttachment('t1', 'a.md')).toMatchObject({
      kind: 'text', text: '# 标题\n正文', clipped: false,
    })
  })

  it('不能投影的就不硬造 viewer——说清是什么、落在哪', async () => {
    const topics = await reader([{ id: 'z1', ext: 'zip', body: 'PKrest' }])
    const body = await topics.readAttachment('z1', 'a.zip')
    expect(body.kind).toBe('binary')
    if (body.kind !== 'binary') return
    expect(body.savedTo).toContain('z1.zip')
  })
})
