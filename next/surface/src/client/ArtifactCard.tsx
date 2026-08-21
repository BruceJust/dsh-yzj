/**
 * 一件工件,一张卡 (v4.11「工件统一」).
 *
 * 同事拖进群的 PDF 和 agent 交付的 md 是**同一种图居民**:工件。血缘不同——
 * 一个生于一条 IM 消息,一个生于一次劳动——但一个物不配两套 UI。这个文件存在
 * 的全部理由,就是让那句话在代码里成立:中栏的文件消息、中栏的产出行、右栏
 * 的对象面、承诺板的产出抽屉,画的是同一张卡。
 *
 * 卡上的按钮**按真的够得着什么**亮灭,不按血缘。有字节就能预览、能下载;有
 * 链接就能推开那扇门;两样都没有就只是一行名字——这比画一个按下去什么都不
 * 发生的「预览」诚实。
 */

import type { ReactNode } from 'react'
import { extensionOf, openPreview, sizeLabel, usePreview, type ArtifactRef } from './preview.ts'
import css from './artifact.module.css'

/**
 * 角标只放后缀。图标画得再像一个文件,也说不出它是 md 还是 pdf。
 *
 * 和「按什么投影」用的是同一条取后缀的规则(`extensionOf`)——两处各写一份的话,
 * 迟早出现角标写着 MD、预览却按纯文本渲染的一个物两种说法。
 */
function badgeOf(artifact: ArtifactRef): string {
  const ext = artifact.ext ?? extensionOf(artifact.title)
  return ext === undefined || ext.length > 4 ? '文件' : ext.toUpperCase()
}

export interface ArtifactCardProps {
  artifact: ArtifactRef
  /** 紧凑行:承诺板的产出抽屉里一屏要放下十几条。 */
  dense?: boolean
}

export function ArtifactCard(props: ArtifactCardProps): ReactNode {
  const { artifact, dense } = props
  const looking = usePreview().target?.key === artifact.key
  const shell = `${css.card} ${dense === true ? css.dense : ''} ${looking ? css.looking : ''}`

  const face = (
    <>
      <span className={css.badge}>{badgeOf(artifact)}</span>
      <span className={css.text}>
        {/*
          真实文件名不该被省略号吃掉——它常常就是这条消息的全部信息量
          (`r29-summary.md` 和 `r29-summary-v2.md` 差在末尾)。给两行,断词
          按任意字符,长英文名也撑不破卡片。
        */}
        <span className={css.title}>{artifact.title}</span>
        {(artifact.meta !== undefined || sizeLabel(artifact.size) !== '') && (
          <span className={css.meta}>
            {[sizeLabel(artifact.size), artifact.meta].filter(part => part !== undefined && part !== '').join(' · ')}
          </span>
        )}
        {/*
          提醒自己一行,而且带着 title 里那句为什么。

          越境和「归不了属」都是**关于这条记录本身可信到什么程度**的话;混进
          「2.0 KB · 云之家文件」里,读的人只会当它是又一段出处。
        */}
        {artifact.marks !== undefined && artifact.marks.length > 0 && (
          <span className={css.marks}>
            {artifact.marks.map(mark => (
              <span className={css.mark} key={mark.label} title={mark.why}>{mark.label}</span>
            ))}
          </span>
        )}
      </span>
    </>
  )

  // 有字节:整张卡就是「打开来看」,右边留一个下载。
  if (artifact.fileId !== undefined) {
    const target = { ...artifact, fileId: artifact.fileId }
    return (
      <span className={css.row}>
        <button
          type="button"
          className={shell}
          title={looking ? '正在旁边看着它' : '打开预览（在右边并排看，对话不离场）'}
          onClick={() => { openPreview(target) }}
        >
          {face}
          <span className={css.arrow}>{looking ? '◉' : '›'}</span>
        </button>
      </span>
    )
  }

  /*
    没有字节,只有门。

    云之家的在线文档是一个**活的**东西,此刻可能已经被别人改过了;把它复制成
    一份预览就是在说一句会过期的话(数据律 1:真身唯一)。门永远是对的。
  */
  if (artifact.href !== undefined) {
    return (
      <span className={css.row}>
        <a
          className={shell}
          href={artifact.href}
          target="_blank"
          rel="noreferrer noopener"
          title="真身在云之家——打开看到的永远是当下那一份"
        >
          {face}
          <span className={css.arrow}>↗</span>
        </a>
      </span>
    )
  }

  return (
    <span className={css.row}>
      <span className={`${shell} ${css.inert}`} title={artifact.key}>{face}</span>
    </span>
  )
}
