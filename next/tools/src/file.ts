/**
 * File-domain tools: upload to the Yunzhijia file service (returns the fileIds
 * IM messages and rich-text images consume) and download by fileId. An upload
 * lands on the server the instant it succeeds, so it asks; a download only
 * asks when it would overwrite something local.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  asRecord, asString, clipJson, counted, runValue, titled, yzjToolOutput,
  type YzjToolBudget,
} from './shared.ts'

/** Register the file-domain tools. Returns the disposer for all of them. */
export function applyFileTools(ctx: Context, budget: YzjToolBudget): () => void {
  const disposers: (() => void)[] = []
  const register = (definition: Parameters<typeof ctx.tools.register>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }

  register(defineTool({
    name: 'yzj_file_upload',
    description: 'Upload local file(s) to the Yunzhijia file service (single file ≤ 30MB; up to 5 concurrent). Returns fileIds usable for IM file messages and rich-text images. Uploads are immediate — requires user confirmation.',
    presentCall: args => titled(counted('上传文件', args.files), 'edit'),
    parameters: {
      files: { type: 'array', required: true, items: { type: 'string' }, description: 'Local file paths; multiple files are allowed (the name flag is then rejected).' },
      name: { type: 'string', description: 'Uploaded file name; single file only.' },
    },
    output: yzjToolOutput,
    timeoutMs: budget.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args) {
      if (args.files.length === 0) throw new Error('yzj_file_upload: at least one file path is required')
      if (args.name !== undefined && args.files.length > 1) {
        throw new Error('yzj_file_upload: --name is only allowed for a single file')
      }
      const command = ['file', 'upload']
      for (const file of args.files) command.push('--file', file)
      if (args.name !== undefined) command.push('--name', args.name)
      return runValue(ctx, budget, 'file upload', command, (json) => {
        const payload = asRecord(json)
        const fileId = asString(payload.fileId ?? payload.file_id ?? payload.id)
        return {
          content: fileId === ''
            ? `uploaded ${String(args.files.length)} file(s)`
            : `uploaded ${String(args.files[0])} → fileId ${fileId}`,
          data: { payload: clipJson(payload, { maxChars: budget.maxMetaChars }), fileId },
        }
      })
    },
  }))

  register(defineTool({
    name: 'yzj_file_download',
    description: 'Download a file by fileId to the local machine. Output may be a directory or file path; without --output the name comes from the server. Without --overwrite an existing file is auto-renamed (report.pdf → report (1).pdf).',
    presentCall: args => titled(`下载文件 ${args.id}`, 'fetch'),
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

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
