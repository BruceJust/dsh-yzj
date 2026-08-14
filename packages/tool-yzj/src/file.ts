/**
 * File-domain tools: upload local files to the Yunzhijia file service
 * (returns fileIds usable for IM messages and rich-text images) and download
 * files by fileId. Uploads land on the server immediately; overwriting
 * downloads are gated by the approval guard.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  runValue, yzjToolOutput,
  asRecord, asString, clipJson,
} from './shared.ts'
import type { YzjToolBudget } from './shared.ts'

/** Register the file-domain tools. */
export function applyFileTools(ctx: Context, budget: YzjToolBudget): void {
  ctx.tools.register(defineTool({
    name: 'yzj_file_upload',
    description: 'Upload local file(s) to the Yunzhijia file service (single file ≤ 30MB; up to 5 concurrent). Returns fileIds usable for IM file messages and rich-text images. Uploads are immediate — requires user confirmation.',
    parameters: {
      files: { type: 'array', required: true, items: { type: 'string' }, description: 'Local file paths; multiple files are allowed (name flag then is rejected).' },
      name: { type: 'string', description: 'Uploaded file name; single file only.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      if (args.files.length === 0) {
        throw new Error('yzj_file_upload: at least one file path is required')
      }
      if (args.name !== undefined && args.files.length > 1) {
        throw new Error('yzj_file_upload: --name is only allowed for a single file')
      }
      const command = ['file', 'upload']
      for (const file of args.files) command.push('--file', file)
      if (args.name !== undefined) command.push('--name', args.name)
      return runValue(ctx, budget, 'file upload', command, (json) => {
        const payload = asRecord(json)
        const fileId = asString(payload.fileId ?? payload.file_id ?? payload.id)
        const content = fileId === ''
          ? `uploaded ${args.files.length} file(s)`
          : `uploaded ${args.files[0]} → fileId ${fileId}`
        return { content, data: { payload: clipJson(payload, { maxChars: budget.maxMetaChars }), fileId } }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'yzj_file_download',
    description: 'Download a file by fileId to the local machine. Output may be a directory or file path; without --output the name comes from the server. Without --overwrite an existing file is auto-renamed (report.pdf → report (1).pdf).',
    parameters: {
      id: { type: 'string', required: true, description: 'File id (from yzj_file_upload or an IM attachment).' },
      output: { type: 'string', description: 'Output directory or file path.' },
      overwrite: { type: 'boolean', description: 'Overwrite an existing file; requires user confirmation.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      const command = ['file', 'download', '--id', args.id]
      if (args.output !== undefined) command.push('--output', args.output)
      if (args.overwrite === true) command.push('--overwrite')
      return runValue(ctx, budget, 'file download', command, () => ({
        content: `downloaded ${args.id}${args.output === undefined ? '' : ` → ${args.output}`}`,
        data: { id: args.id, output: args.output ?? '', overwrite: args.overwrite === true },
      }))
    },
  }))
}
