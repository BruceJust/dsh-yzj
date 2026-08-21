/**
 * 沉浸态:深读 (v4.11 第三态).
 *
 * 长文和多页 PDF 需要整块屏幕;并排是为了**边看边回**,沉浸是为了**读进去**。
 * 两种意图,所以两种态——而不是一个「大一点的预览」。
 *
 * 住在 `shell.overlay` 里,那是整框之上、在所有列的滚动容器之外的一层,而且是
 * **加座**不是顶替:注册进去不会挤掉任何已有的东西。自己撑一个全屏容器、
 * 或者让右栏长到整屏,都得和宿主的三列网格打架。
 *
 * Esc 回并排(不是关掉),因为退出深读的人想回到对话——而那份文档本来就还在
 * 旁边开着。这条在 `PreviewPanel.tsx` 里实现,和沉浸态本身住在一起。
 */

import type { ReactNode } from 'react'
import type { SurfaceInject } from './rpc.ts'
import { ArtifactPreview } from './PreviewPanel.tsx'
import { usePreview } from './preview.ts'
import tokens from './tokens.module.css'
import css from './preview.module.css'

export interface PreviewOverlayProps {
  inject: SurfaceInject
}

export function YzjPreviewOverlay(props: PreviewOverlayProps): ReactNode {
  const preview = usePreview()
  if (preview.target === undefined || preview.stage !== 'immersive') return null
  return (
    <div className={`${tokens.tokens} ${css.overlay}`}>
      <ArtifactPreview target={preview.target} stage="immersive" inject={props.inject} />
    </div>
  )
}
