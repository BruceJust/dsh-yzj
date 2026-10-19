/**
 * `outbound` 族 —— agent 对外说的每一句话（技术方案-下一代ERP账本 §3.1 路二 / §13.5）。
 *
 * 出站此前只登记在 `channel-state.json` 里：那是回声抑制用的指纹表，会被修剪、会被覆盖，
 * 不是事实。一年后有人问「它那天在群里替谁说了什么」，指纹表答不上来。
 *
 * 发言可以**发送之后**再记（写工具必须先记后做）：发言本身就落在场所里，是公开、持久的
 * 证据；写的效果可能落在别处、不可逆。所以这里写失败只报错，不撤回消息。
 *
 * 只存摘要，不复制正文：正文在场所里，账上存的是「这一句是它」的指纹——不在日志里再造一份
 * 谁都读得到的聊天记录。
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { z, type GraphFamily } from '@yzj-next/graph'

export const OUTBOUND_POSTED = 'outbound/posted'

/** 接纳本回合的那条消息，及其发送者——发言的授权就是它。 */
export interface OutboundAdmission {
  readonly messageId: string
  readonly senderOpenId: string
}

/** 一次成功的 agent 出站，落账的形状。 */
export interface OutboundPosted {
  readonly msgId: string
  readonly groupId: string
  readonly replyMsgId?: string
  /** 已签名正文的 sha256 hex。 */
  readonly contentDigest: string
  readonly authority:
    | ({ readonly kind: 'message' } & OutboundAdmission)
    | { readonly kind: 'operator'; readonly openId: string; readonly via: 'proactive' }
}

export const outboundFamily: GraphFamily = {
  kind: 'outbound',
  events: {
    [OUTBOUND_POSTED]: {
      schema: z.object({
        msgId: z.string().min(1),
        groupId: z.string().min(1),
        replyMsgId: z.string().optional(),
        contentDigest: z.string().regex(/^[0-9a-f]{64}$/u),
        authority: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('message'), messageId: z.string().min(1), senderOpenId: z.string().min(1) }),
          // 主动发言（在岗声明、登记回执……）：寄生期，操作者对自己实例的默认行为负责。
          z.object({ kind: z.literal('operator'), openId: z.string().min(1), via: z.literal('proactive') }),
        ]),
      }),
    },
  },
}

/** 正文的指纹。 */
export function contentDigest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** 把一次出站落成一行。 */
export async function recordOutbound(ctx: Context, posted: OutboundPosted): Promise<void> {
  const { replyMsgId, authority } = posted
  await ctx.yzjGraph.append({
    type: OUTBOUND_POSTED,
    data: {
      msgId: posted.msgId,
      groupId: posted.groupId,
      ...(replyMsgId === undefined ? {} : { replyMsgId }),
      contentDigest: posted.contentDigest,
      authority: authority.kind === 'message'
        ? { kind: 'message', messageId: authority.messageId, senderOpenId: authority.senderOpenId }
        : { kind: 'operator', openId: authority.openId, via: authority.via },
    },
    actor: { kind: 'agent' },
  })
}
