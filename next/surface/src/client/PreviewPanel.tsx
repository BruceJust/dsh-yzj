/**
 * 工件预览:一份内容,两种姿势 (v4.11 D13⑥).
 *
 * **能投影则投影**。md 富渲染、pdf 交给浏览器自带的阅读器、html 进沙箱、图片
 * 直接看、csv 画成表——剩下的**不硬造 viewer**:说清它是什么、已经放在哪儿
 * 了,比画一个假的阅读框有用。
 *
 * 「预览不是运行」是这里唯一一条硬规矩。同事传进群的 html 是一个自包含单页,
 * 它可以带任何脚本;把它塞进这个文档里就等于让它和承载 RPC 通道的那一页同源。
 * 所以它进 `<iframe sandbox="">`——没有脚本、没有同源、没有表单、没有导航。
 * 安全性来自**结构**,不来自「我把每种花招都想到了」这种赌注。
 *
 * PDF 是那条规矩唯一的例外,而且是设计明写的例外:它要的是浏览器**原生**
 * 阅读器(翻页、搜索、缩放都是免费的),而 `sandbox` 会把插件一起关掉——于是
 * 得到一个空框。原生阅读器本身跑在独立进程里、默认关掉 PDF 脚本,隔离由它
 * 提供,不由我们提供。
 *
 * 真身唯一:这里画出来的一切都是投影,**下载与云之家打开永远在头上那一行**。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AttachmentBodyWire, SurfaceInject } from './rpc.ts'
import {
  extensionOf, sizeLabel, setPreviewStage, closePreview, leaveImmersive, useAttachmentBody,
  type PreviewStage, type PreviewTarget,
} from './preview.ts'
import { parseDelimited, separatorFor } from './delimited.ts'
import { markdownToHtml, previewDocument } from './markdown.ts'
import css from './preview.module.css'

/** 表格预览的记录窗口:一屏能读的量,读不完的那部分说出来。 */
const TABLE_ROWS = 200

/**
 * PDF 的字节,变成浏览器肯打开的一个地址。
 *
 * blob 而不是 `data:` —— Chromium 对 data: 文档的框架导航是关着的,而 PDF
 * 阅读器正是通过那条路加载的,于是 data URL 会得到一个静悄悄的空框。blob 走
 * 的是正常的资源加载路径。
 *
 * 撤销必须发生:一份 6MB 的 PDF 不撤销就一直挂在文档上,翻十个文件就是 60MB。
 */
function usePdfUrl(base64: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (base64 === undefined) {
      setUrl(undefined)
      return undefined
    }
    const raw = atob(base64)
    const bytes = new Uint8Array(raw.length)
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
    const made = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    setUrl(made)
    return () => { URL.revokeObjectURL(made) }
  }, [base64])
  return url
}

/** 文本按后缀分路:读的东西渲染成读的样子,别的照原样。 */
function textShape(ext: string | undefined): 'markdown' | 'html' | 'table' | 'plain' {
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'csv' || ext === 'tsv' || ext === 'tab') return 'table'
  return 'plain'
}

function TablePreview(props: { text: string; ext: string | undefined }): ReactNode {
  const rows = parseDelimited(props.text, separatorFor(props.ext))
  if (rows.length === 0) return <div className={css.note}>这个表里没有内容。</div>
  const [header, ...body] = rows
  const shown = body.slice(0, TABLE_ROWS)
  return (
    <>
      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead>
            <tr>{(header ?? []).map((cell, index) => <th key={`h${String(index)}`}>{cell}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((line, index) => (
              <tr key={`r${String(index)}`}>
                {line.map((cell, column) => <td key={`c${String(column)}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {body.length > shown.length && (
        <div className={css.note}>
          共 {body.length} 行，这里显示了前 {shown.length} 行——完整的一份请下载。
        </div>
      )}
    </>
  )
}

/** 取回来的字节,画成它自己。 */
function Body(props: {
  target: PreviewTarget
  body: AttachmentBodyWire
  ext: string | undefined
}): ReactNode {
  const { target, body, ext } = props
  const pdfUrl = usePdfUrl(body.kind === 'pdf' ? body.base64 : undefined)

  if (body.kind === 'image') {
    return <img className={css.image} src={`data:${body.mime};base64,${body.base64}`} alt={target.title} />
  }
  if (body.kind === 'pdf') {
    /*
      没有内置阅读器就说没有。

      这一路整条都押在浏览器自带的 viewer 上;它不在的时候,一个空的 iframe
      正是「硬造一个 viewer」——一个什么都不显示、也什么都不解释的阅读框。
    */
    if (navigator.pdfViewerEnabled === false) {
      return (
        <div className={css.note}>
          这个浏览器没有内置 PDF 阅读器，所以这里画不出它。
          <div className={css.noteFoot}>用上面的「下载」拿到本机，再用系统的阅读器打开。</div>
        </div>
      )
    }
    return pdfUrl === undefined
      ? <div className={css.note}>正在准备阅读器…</div>
      /* 沙箱会连原生阅读器一起关掉——见文件头。 */
      : <iframe className={css.frame} src={pdfUrl} title={target.title} />
  }
  if (body.kind === 'binary') {
    return (
      <div className={css.note}>
        {body.why}。已经取到本地：
        <code className={css.path}>{body.savedTo}</code>
        <div className={css.noteFoot}>用上面的「下载」把它放进「下载」文件夹，或者到云之家里打开。</div>
      </div>
    )
  }

  const shape = textShape(ext)
  if (shape === 'table') return <TablePreview text={body.text} ext={ext} />
  if (shape === 'markdown' || shape === 'html') {
    return (
      <iframe
        className={css.frame}
        sandbox=""
        title={target.title}
        srcDoc={shape === 'markdown' ? previewDocument(markdownToHtml(body.text)) : body.text}
      />
    )
  }
  return (
    <>
      <pre className={css.plain}>{body.text}</pre>
      {body.clipped && (
        <div className={css.note}>太长了，只显示了前面一段——完整的一份请下载。</div>
      )}
    </>
  )
}

export interface ArtifactPreviewProps {
  target: PreviewTarget
  stage: PreviewStage
  inject: SurfaceInject
}

/**
 * 头一行 + 内容。两种姿势共用,因为它们看的是同一份东西——沉浸只是同一个
 * 预览被放大,不是另一个视图。共用还有一个后果:切姿势不重新取字节。
 */
export function ArtifactPreview(props: ArtifactPreviewProps): ReactNode {
  const { target, stage, inject } = props
  const ext = target.ext ?? extensionOf(target.title)
  const read = useAttachmentBody(target.fileId, target.title, inject)
  const [saved, setSaved] = useState('')

  const download = useCallback((): void => {
    if (target.fileId === undefined) return
    setSaved('正在取…')
    void inject.saveAttachment(target.fileId, target.title).then((result) => {
      setSaved(result.error ?? `已下载到：${result.savedTo ?? '(未知路径)'}`)
    })
  }, [inject, target.fileId, target.title])

  // 换一个物就把上一次的下载回执丢掉——它说的是另一个文件的事。
  useEffect(() => { setSaved('') }, [target.key])

  /*
    Esc 从沉浸回到并排,不是直接关掉。

    深读退出来的人想回到对话,而对话旁边**本来就还开着**那份文档;一路关到底
    等于替他决定「你看完了」。
  */
  useEffect(() => {
    if (stage !== 'immersive') return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        leaveImmersive()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [stage])

  return (
    <div className={`${css.panel} ${stage === 'immersive' ? css.immersive : css.aside}`}>
      <div className={css.head}>
        <span className={css.name} title={target.title}>{target.title}</span>
        {sizeLabel(target.size) !== '' && <span className={css.size}>{sizeLabel(target.size)}</span>}
        {/* 预览不等于拿到手:不管什么类型、多大,都要能真的下载下来。 */}
        {target.fileId !== undefined && (
          <button type="button" className={css.act} onClick={download} title="下载到本机">⬇ 下载</button>
        )}
        {target.href !== undefined && (
          <a
            className={css.act}
            href={target.href}
            target="_blank"
            rel="noreferrer noopener"
            title="在云之家打开真身"
          >
            云之家 ↗
          </a>
        )}
        <button
          type="button"
          className={css.act}
          title={stage === 'aside' ? '沉浸阅读（Esc 返回并排）' : '退出沉浸（回到并排，对话不离场）'}
          onClick={() => { if (stage === 'aside') setPreviewStage('immersive'); else leaveImmersive() }}
        >
          {stage === 'aside' ? '⤢' : '⤡'}
        </button>
        <button type="button" className={css.act} aria-label="关闭预览" onClick={closePreview}>×</button>
      </div>

      {stage === 'aside' && (
        <div className={css.hint}>
          并排 · <b>边看边回</b>，对话不离场 · 拖这一栏左缘调宽（中栏 ≥640 拖不破）· 更宽按 ⤢
        </div>
      )}
      {saved !== '' && <div className={css.saved}>{saved}</div>}

      <div className={css.body}>
        {read.busy
          ? <div className={css.note}>正在从云之家取这个文件…</div>
          : read.missing || read.body === undefined
            ? (
              /*
                「取不到」几乎总是暂时的:通道没就绪、token 刚过期、CLI 抖了一下。
                只说结论不给门,人唯一能做的就是刷新整页。
              */
              <div className={css.note}>
                这次没取到。可能是通道刚断了一下，也可能它已经被撤回、或者当前账号看不到它。
                <div className={css.retryRow}>
                  <button type="button" className={css.act} onClick={read.retry}>再试一次</button>
                </div>
              </div>
            )
            : <Body target={target} body={read.body} ext={ext} />}
      </div>
    </div>
  )
}
