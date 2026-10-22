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
  it('浏览器打不开的图片格式,说打不开——不把缓存路径当答案', async () => {
    const topics = await reader([{ id: 'h1', ext: 'heic', body: 'not really an image' }])
    const body = await topics.readAttachment('h1', 'a.heic')
    expect(body).toEqual({ kind: 'binary', size: 19, why: '浏览器打不开 HEIC 格式的图片' })
  })

  it('读得懂的文本原样交出去,由前端按后缀决定怎么渲染', async () => {
    const topics = await reader([{ id: 't1', ext: 'md', body: '# 标题\n正文' }])
    expect(await topics.readAttachment('t1', 'a.md')).toMatchObject({
      kind: 'text', text: '# 标题\n正文', clipped: false,
    })
  })

  /*
    看名字就知道画不了的，不去取字节：一个 46 MB 的安装包，过去要先整个拉下来，
    才说一句「没法预览」。缓存里没有这几个文件、取一次就抛——取了就红。
  */
  it('不能投影的就不硬造 viewer，也不为一句「看不了」把字节取回来', async () => {
    const topics = await reader([])
    expect(await topics.readAttachment('z1', '代码.zip')).toEqual({ kind: 'binary', why: '压缩包这里看不了' })
    expect(await topics.readAttachment('x1', '模板.XLSX')).toEqual({ kind: 'binary', why: 'Excel 表格这里看不了' })
    expect(await topics.readAttachment('a1', 'cmfa.apk')).toEqual({ kind: 'binary', why: '安装包这里看不了' })
    expect(await topics.readAttachment('q1', '数据.parquet')).toEqual({ kind: 'binary', why: 'PARQUET 文件这里看不了' })
  })

  it('长文本截在 200 KB，并说截了', async () => {
    const topics = await reader([{ id: 'l1', ext: 'md', body: 'x'.repeat(300 * 1024) }])
    const body = await topics.readAttachment('l1', 'a.md')
    expect(body).toMatchObject({ kind: 'text', clipped: true, size: 300 * 1024 })
    if (body.kind === 'text') expect(body.text).toHaveLength(200 * 1024)
  })

  /* 网页不能截：截一半的 html 画出来像原件坏了。要么整份，要么说画不全。 */
  it('网页整份交出去，超过 200 KB 也不截；带脚本的说一声', async () => {
    const page = `<html><body>${'<p>段落</p>'.repeat(30_000)}<script>boot()</script></body></html>`
    const topics = await reader([{ id: 'w1', ext: 'html', body: page }, { id: 'w2', ext: 'htm', body: '<p>静态</p>' }])
    const scripted = await topics.readAttachment('w1', 'proto.html')
    expect(scripted).toMatchObject({ kind: 'text', clipped: false, scripted: true })
    if (scripted.kind === 'text') expect(scripted.text).toBe(page)
    expect(await topics.readAttachment('w2', 'a.htm')).not.toHaveProperty('scripted')
  })

  it('消息上写着太大的网页、PDF、图，不取就说——缓存里没有、取一次就抛', async () => {
    const topics = await reader([])
    const big = 14 * 1024 * 1024
    expect(await topics.readAttachment('w9', 'proto.html', big)).toEqual({ kind: 'binary', size: big, why: '这个网页太大，这里画不全' })
    expect(await topics.readAttachment('p9', '年报.pdf', big)).toEqual({ kind: 'binary', size: big, why: '这份 PDF 太大，这里不直接打开' })
    expect(await topics.readAttachment('i9', '截图.png', big)).toEqual({ kind: 'binary', size: big, why: '这张图太大，这里不直接打开' })
  })

  it('大到不能内联的网页说画不全，不交半页', async () => {
    const topics = await reader([{ id: 'w3', ext: 'html', body: 'x'.repeat(6 * 1024 * 1024 + 1) }])
    expect(await topics.readAttachment('w3', 'big.html')).toEqual({
      kind: 'binary', size: 6 * 1024 * 1024 + 1, why: '这个网页太大，这里画不全',
    })
  })
})
