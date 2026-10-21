/**
 * 图上一条产出边 → 一件工件。
 *
 * 图记的是**血缘**:谁在哪次劳动里产出了什么 URI。卡片要的是**能对它做什么**:
 * 能不能打开来看、能不能下载、能不能推开那扇门。这个文件是这两者之间唯一的
 * 翻译处——写在一个地方,因为流里、右栏里、板上画的必须是同一张卡,而「同一张
 * 卡」如果靠三个调用点各自拼一遍,迟早会拼出三种。
 *
 * 翻译只有一条实质规则:`yzj://file/<id>` 里的 id **就是**附件的 fileId。所以
 * agent 上传的文件和同事拖进群的文件走同一条取字节的路——「文件消息 = 工件的
 * IM 出生形态」在代码里的兑现就是这一行。文档类没有这条路,它翻译成一扇门。
 */

import { extensionOf, fileIdOfUri, safeHref, type ArtifactOrigin, type ArtifactRef } from './preview.ts'

/** 图上那条边说了什么。三处调用点的行各有各的字段,共同的只有这些。 */
export interface ArtifactEdge {
  readonly uri: string
  readonly title: string
  /** 「新建文档」「上传文件」——这条边记下的动词。 */
  readonly action?: string
  readonly toolName?: string
  /** 时间、场所——并进那行灰字的补充信息。 */
  readonly notes?: readonly (string | undefined)[]
  /** 越境、共用会话——要被看见的提醒,各自带着一句为什么。 */
  readonly marks?: readonly ({ readonly label: string; readonly why?: string } | undefined)[]
  /** 出处：从哪个话题、哪句话长出来的。 */
  readonly from?: ArtifactOrigin
}

/**
 * 没记下名字的产出叫什么 —— 不把一串 `yzj://file/1a2b…` 或一条长链接当标题给人看。
 * 说清它是哪一类东西，比一串地址更像一个名字。
 */
export function titleOf(uri: string, title: string): string {
  const named = title.trim()
  if (named !== '' && named !== uri) return named
  if (uri.startsWith('yzj://file/')) return '一个文件'
  if (uri.startsWith('yzj://message/')) return '一条消息'
  if (/\/(sheet|table)s?\//iu.test(uri)) return '一张云之家表格'
  if (/^https?:/iu.test(uri)) return '一篇云之家文档'
  return '一份产出'
}

export function artifactRefOf(edge: ArtifactEdge): ArtifactRef {
  const fileId = fileIdOfUri(edge.uri)
  const href = safeHref(edge.uri)
  // 没记下名字的不拿地址顶上：人读不懂一串地址，key 里还留着它，查问题够用。
  const title = titleOf(edge.uri, edge.title)
  const meta = [edge.action, edge.toolName, ...(edge.notes ?? [])]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ')
  const ext = extensionOf(title)
  const marks = (edge.marks ?? []).filter(
    (mark): mark is { label: string; why?: string } => mark !== undefined,
  )
  return {
    key: `uri:${edge.uri}`,
    title,
    origin: 'agent',
    ...(edge.from === undefined ? {} : { from: edge.from }),
    ...(marks.length === 0 ? {} : { marks }),
    ...(meta === '' ? {} : { meta }),
    ...(ext === undefined ? {} : { ext }),
    ...(fileId === undefined ? {} : { fileId }),
    ...(href === undefined ? {} : { href }),
  }
}
