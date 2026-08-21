/**
 * Automatic lineage recording.
 *
 * Provenance is the canonical unbackfillable fact: nobody will ever go back
 * and write down which turn produced which document. So every successful write
 * tool records one `lineage/produced` edge from its own result, with no model
 * cooperation required — a tool that forgot to mention what it made still
 * leaves the edge.
 *
 * Why it matters beyond tidiness: "tracing forwards is easy, circling the
 * contamination is impossible" is what destroys trust after a bad edit. The
 * derived chain is what makes "which artifacts descend from this one" a query
 * instead of an archaeology project.
 *
 * `placeKey` is mandatory on every reference (TD-15) because crossing
 * detection has no input without it.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { TurnBinding } from '@yzj-next/objects'
import { asArray, asRecord, asString } from './shared.ts'

/** One artifact a write produced, as the graph records it. */
interface ProducedArtifact {
  readonly uri: string
  readonly placeKey: string
  readonly kind: string
  readonly title?: string
}

/** How one tool's arguments and result name what it just produced. */
interface LineageSpec {
  readonly action: string
  readonly kind: string
  extract(args: Record<string, unknown>, data: Record<string, unknown>): ProducedArtifact[]
}

/**
 * The place a knowledge-base artifact belongs to. The knowledge base is the
 * real place; when only the node id is in hand (block-level edits carry no
 * workspace), the node itself scopes it — honest and stable, and precise
 * enough for crossing detection to compare against a group.
 */
function docPlace(args: Record<string, unknown>, id: string): string {
  const workspace = asString(args.workspace)
  return workspace === '' ? `yzj-doc-${id}` : `yzj-kb-${workspace}`
}

function docArtifact(
  args: Record<string, unknown>,
  data: Record<string, unknown>,
  kind: string,
  fallbackId?: string,
): ProducedArtifact[] {
  const id = asString(data.id) || (fallbackId ?? '')
  if (id === '') return []
  const title = asString(asRecord(data.record).title) || asString(args.title)
  return [{
    uri: asString(data.link) || `yzj://doc/${id}`,
    placeKey: docPlace(args, id),
    kind,
    ...(title === '' ? {} : { title }),
  }]
}

/** Tool name → what it produces. Only successful calls reach this table. */
export const LINEAGE_SPECS: Record<string, LineageSpec> = {
  yzj_doc_create: {
    action: '新建文档', kind: 'doc',
    extract: (args, data) => docArtifact(args, data, 'doc'),
  },
  yzj_doc_rename: {
    action: '重命名文档', kind: 'doc',
    extract: (args, data) => docArtifact(args, data, 'doc', asString(args.id)),
  },
  yzj_doc_move: {
    action: '移动文档', kind: 'doc',
    extract: (args, data) => docArtifact(args, data, 'doc', asString(args.id)),
  },
  yzj_doc_block_insert: {
    action: '写入文档内容', kind: 'doc',
    extract: (args, data) => docArtifact(args, data, 'doc', asString(args.id)),
  },
  yzj_doc_block_update: {
    action: '更新文档内容', kind: 'doc',
    extract: (args, data) => docArtifact(args, data, 'doc', asString(args.id)),
  },
  yzj_doc_import: {
    action: '导入文档', kind: 'doc',
    extract: (args, data) => {
      const list = Array.isArray(data.list) ? data.list : []
      return list.flatMap((entry) => {
        const node = asRecord(entry)
        const id = asString(node.id)
        if (id === '') return []
        const title = asString(node.title) || asString(node.fileName)
        return [{
          uri: `yzj://doc/${id}`,
          placeKey: docPlace(args, id),
          kind: 'doc',
          ...(title === '' ? {} : { title }),
        }]
      })
    },
  },
  yzj_doc_workspace_create: {
    action: '新建知识库', kind: 'workspace',
    extract: (_args, data) => {
      const id = asString(asRecord(data.record).id)
      return id === '' ? [] : [{ uri: `yzj://kb/${id}`, placeKey: `yzj-kb-${id}`, kind: 'workspace' }]
    },
  },
  yzj_sheet_create: {
    action: '新建多维表格', kind: 'sheet',
    extract: (args, data) => docArtifact(args, data, 'sheet'),
  },
  yzj_sheet_table_create: {
    action: '新建数据表', kind: 'sheet',
    extract: (args, data) => docArtifact(args, data, 'sheet', asString(args.id)),
  },
  yzj_sheet_record_create: {
    action: '新增表格记录', kind: 'sheet',
    extract: (args, data) => docArtifact(args, data, 'sheet', asString(args.id)),
  },
  yzj_sheet_record_update: {
    action: '更新表格记录', kind: 'sheet',
    extract: (args, data) => docArtifact(args, data, 'sheet', asString(args.id)),
  },
  yzj_calendar_event_create: {
    action: '新建日程', kind: 'event',
    extract: (args, data) => {
      const id = asString(data.id)
      if (id === '') return []
      const title = asString(args.title)
      return [{
        uri: `yzj://event/${id}`,
        placeKey: 'yzj-calendar',
        kind: 'event',
        ...(title === '' ? {} : { title }),
      }]
    },
  },
  yzj_file_upload: {
    action: '上传文件', kind: 'file',
    extract: (args, data) => {
      const fileId = asString(data.fileId)
      if (fileId === '') return []
      /*
        名字要记下来,因为这条边是**可预览的**那一类。

        `yzj://file/<id>` 里的 id 就是附件的 fileId,所以 agent 交付的文件和同事
        拖进群的文件走同一条取字节的路(v4.11 工件统一)。而取回来之后靠什么
        决定怎么投影?后缀。标题空着,卡上就只剩一行 `yzj://file/1a2b…`,预览
        器也认不出它是 md 还是 pdf——一个本来能读的东西被自己的血缘记录弄丢了。
      */
      const named = asString(args.name) || asString(asArray(args.files)[0])
      const title = named.split(/[/\\]/u).pop() ?? ''
      return [{
        uri: `yzj://file/${fileId}`,
        placeKey: 'yzj-files',
        kind: 'file',
        ...(title === '' ? {} : { title }),
      }]
    },
  },
  yzj_im_message_send: {
    action: '发送消息', kind: 'message',
    extract: (args, data) => {
      const msgId = asString(data.msgId)
      const groupId = asString(args.groupId)
      if (msgId === '' || groupId === '') return []
      return [{ uri: `yzj://message/${groupId}/${msgId}`, placeKey: `yzj-group-${groupId}`, kind: 'message' }]
    },
  },
}

/**
 * Register the lineage recorder on `tools/result` — an observation seam whose
 * failures are contained, which is what provenance recording should be: it
 * must never turn a successful write into a failed one.
 */
export function applyLineage(ctx: Context): () => void {
  return ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    const spec = LINEAGE_SPECS[exec.name]
    if (spec === undefined || result.isError) return
    const value = asRecord(result.value)
    const data = asRecord(value.data)
    const args = asRecord(exec.arguments)
    let artifacts: ProducedArtifact[]
    try {
      artifacts = spec.extract(args, data)
    } catch (error) {
      console.error(`[yzj-next-tools] lineage extraction failed for ${exec.name}`, error)
      return
    }
    if (artifacts.length === 0) return

    const turns = ctx.get('yzjTurns')
    const binding: TurnBinding | undefined = exec.agent === undefined
      ? undefined
      : turns?.bindingFor(exec.agent) ?? turns?.defaultBinding()
    const topicKey = binding?.topicKey ?? `session:${String(exec.agent?.session.id ?? 'desktop')}`

    for (const artifact of artifacts) {
      void ctx.yzjGraph.append({
        type: 'lineage/produced',
        data: {
          topicKey,
          artifact: { ...artifact },
          action: spec.action,
          toolName: exec.name,
        },
        actor: { kind: 'agent' },
      }).catch((error: unknown) => {
        console.error('[yzj-next-tools] failed to record lineage', error)
      })
    }
  })
}
