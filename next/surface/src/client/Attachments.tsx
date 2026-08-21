/**
 * 人真的发给彼此的东西,画成它自己。
 *
 * 一间房子在图片的位置印「[图片]」、在文档的位置印「[文件]:x.md」,画出来的
 * 不是那场对话,是那场对话的占位符。
 *
 * **字节来自宿主,而且只能来自宿主。** 云之家的附件没有公开地址。
 * `static.yunzhijia.com/image/<group>/<id>` 长得完全像一个,而且答 200——但它
 * 发的是一枚通用图标:两张不同的照片取回来字节完全相同、108×108,一个 39 字节
 * 的 markdown 取回来是 18KB 的 png。建在那个地址上的一切都在画占位图,包括
 * 每一个「下载」链接——它递给人的是一枚顶着文档名字的 96×96 图标。
 *
 * 所以每个附件带的是 ID,宿主经 CLI 取真身(唯一能拿到真东西的路)并按 id 缓存,
 * 这里**要用的时候才问**:缩略图等它滚进视野,正文等有人打开它。急切加载等于
 * 每渲染一次就为每张图派出一个进程,一屋子截图会把机器卡死。
 *
 * 打开之后的三态(流内卡 → 并排 → 沉浸)不在这里——这里只是**流内卡**,点一下
 * 把它交给预览(见 `preview.ts`)。文件和图片交给同一张 `ArtifactCard`,因为
 * 它们和 agent 交付的工件是同一种图居民(v4.11 工件统一)。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SurfaceInject, TopicMessageWire } from './rpc.ts'
import { openPreview, useAttachmentBody, type PreviewTarget } from './preview.ts'
import { ArtifactCard } from './ArtifactCard.tsx'
import css from './attach.module.css'

export { isPlaceholderOnly } from './stream.ts'

/** 一条 IM 附件的工件身份。同一个 fileId 在流里和预览里是同一个 key。 */
function targetOf(
  part: { fileId: string; name?: string; ext?: string; size?: number },
  fallbackTitle: string,
): PreviewTarget {
  return {
    key: `att:${part.fileId}`,
    title: part.name ?? fallbackTitle,
    fileId: part.fileId,
    origin: 'im',
    ...(part.ext === undefined ? {} : { ext: part.ext }),
    ...(part.size === undefined ? {} : { size: part.size }),
  }
}

/**
 * 一张图,滚进视野才去取。
 *
 * `IntersectionObserver` 而不是急切加载:一个群的历史里能有几十张截图,每一张
 * 都是一个 CLI 进程和一兆的 base64。滚过去应该不花钱。
 */
function Picture(props: {
  image: NonNullable<TopicMessageWire['images']>[number]
  inject: SurfaceInject
}): ReactNode {
  const { image, inject } = props
  const [visible, setVisible] = useState(false)
  const holder = useRef<HTMLButtonElement | null>(null)

  /*
    富文本里嵌的图,字节根本拿不到。

    它们是另一个 id 空间:CDN 地址给的是占位图标,`file download` 直接回
    `code=2005, Get download info failed`。说清是哪一堵墙,比转一圈再给一句
    「取不到」诚实——后者会让人以为是网络抖了一下。
  */
  const reachable = image.inline !== true
  const read = useAttachmentBody(visible && reachable ? image.fileId : undefined, image.name, inject)
  const src = read.body?.kind === 'image'
    ? `data:${read.body.mime};base64,${read.body.base64}`
    : undefined
  const why = !reachable
    ? '这张图嵌在富文本里，云之家没开下载口'
    : read.missing
      ? '这次没取到，点一下重试'
      : read.body !== undefined && read.body.kind !== 'image'
        ? read.body.kind === 'binary' ? read.body.why : '这不是一张图'
        : '取图中…'

  useEffect(() => {
    const node = holder.current
    if (node === null) return undefined
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true)
    }, { rootMargin: '200px' })
    watcher.observe(node)
    return () => { watcher.disconnect() }
  }, [])

  /*
    取到了就点开看,没取到就点一下再试——同一个手势,因为对按的人来说是同一件
    事:「我要看这张图」。取不到时把点击变成死的,等于让人对着一句「取不到」
    干瞪眼。
  */
  const open = useCallback((): void => {
    if (src !== undefined) openPreview(targetOf(image, '图片'))
    else if (read.missing) read.retry()
  }, [image, src, read])

  /*
    槽保住图片的真实宽高比,哪怕它还是空的。

    平台把尺寸告诉了我们,占住位置就不会在读者眼皮底下把整屋消息往下顶——在
    一条滚动的对话里,跳动比慢更难受。
  */
  const ratio = image.w !== undefined && image.h !== undefined && image.w > 0
    ? { aspectRatio: `${String(image.w)} / ${String(image.h)}` }
    : undefined
  return (
    <button
      type="button"
      ref={holder}
      className={css.thumb}
      title={src === undefined ? why : '点开在右边看大图'}
      style={ratio}
      onClick={open}
    >
      {src === undefined
        ? <span className={css.pending}>{why}</span>
        : <img src={src} alt={image.name ?? '图片'} />}
    </button>
  )
}

export function Attachments(props: {
  message: TopicMessageWire
  inject: SurfaceInject
}): ReactNode {
  const { message, inject } = props
  const images = message.images ?? []
  if (images.length === 0 && message.file === undefined) return null
  return (
    <>
      {images.length > 0 && (
        <div className={css.images}>
          {images.map((image, index) => (
            // 同一张图可以合法地在一条消息里出现两次,所以下标是身份的一部分
            // ——只用 id 会撞。
            <Picture key={`${image.fileId}:${String(index)}`} image={image} inject={inject} />
          ))}
        </div>
      )}
      {message.file !== undefined && (
        <ArtifactCard
          artifact={{
            key: `att:${message.file.fileId}`,
            title: message.file.name,
            fileId: message.file.fileId,
            origin: 'im',
            meta: '云之家文件',
            ...(message.file.ext === undefined ? {} : { ext: message.file.ext }),
            ...(message.file.size === undefined ? {} : { size: message.file.size }),
          }}
        />
      )}
    </>
  )
}
