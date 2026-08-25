/**
 * Card delivery — the `YzjCardChannel` seam the object families consume.
 *
 * The message carries a HANDLE, not a state (卡片三定律 ②): the body is
 * self-sufficient prose plus `[card#type:id]`, and the live state is always
 * read back from the graph. That is what makes the terminal echo work at all —
 * a Yunzhijia text message cannot be edited, so the decision arrives as a NEW
 * message pointing at the same handle rather than as an edit of the old one.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CardProjection, CardRef, YzjCardChannel } from '@yzj-next/cards'
import { YZJ_TEXT_SURFACE } from '@yzj-next/objects'
import { groupIdFromPlaceKey, placeKeyFor } from './protocol.ts'
import type { YzjChannelClient } from './client.ts'

export class YzjCardDelivery implements YzjCardChannel {
  constructor(
    private readonly ctx: Context,
    private readonly client: YzjChannelClient,
    private readonly operatorOpenId: string,
  ) {}

  /**
   * Put one card in the operator's own chat and register the projection. Every
   * fragment id is registered, so a reply anchored to any of them resolves.
   */
  async deliverToOperator(cardRef: CardRef): Promise<CardProjection | undefined> {
    const rendered = this.ctx.yzjCards.renderText(cardRef)
    if (rendered === undefined) return undefined
    const body = rendered.replyHints.length === 0
      ? rendered.body
      : `${rendered.body}\n（可回复：${rendered.replyHints.join(' / ')}）`
    const sent = await this.client.send({ toOpenId: this.operatorOpenId }, body)
    if (sent.msgId === undefined || sent.groupId === undefined) return undefined
    const projection: CardProjection = {
      cardRef,
      surface: YZJ_TEXT_SURFACE,
      msgAnchors: [sent.msgId],
      placeKey: placeKeyFor('direct', sent.groupId),
    }
    await this.ctx.yzjCards.project(projection)
    return projection
  }

  /**
   * Put one card in a place (a group or the operator's own chat, whichever the
   * place key names) and register the projection there.
   */
  async deliverToPlace(
    cardRef: CardRef,
    placeKey: string,
    replyTo?: string,
  ): Promise<CardProjection | undefined> {
    const groupId = groupIdFromPlaceKey(placeKey)
    if (groupId === undefined) return undefined
    // 投给一间屋子：卡里引用的别的对象要按**那间屋子**的可见域裁剪 (v4.22 裁决①)。
    const rendered = this.ctx.yzjCards.renderText(cardRef, placeKey)
    if (rendered === undefined) return undefined
    const body = rendered.replyHints.length === 0
      ? rendered.body
      : `${rendered.body}\n（可回复：${rendered.replyHints.join(' / ')}）`
    const sent = await this.client.send({ groupId }, body, replyTo)
    if (sent.msgId === undefined) return undefined
    const projection: CardProjection = {
      cardRef,
      surface: YZJ_TEXT_SURFACE,
      msgAnchors: [sent.msgId],
      placeKey,
    }
    await this.ctx.yzjCards.project(projection)
    return projection
  }

  /** Post one line onto an existing projection, anchored to its first fragment. */
  async echo(projection: CardProjection, text: string): Promise<void> {
    const groupId = projection.placeKey === undefined
      ? undefined
      : groupIdFromPlaceKey(projection.placeKey)
    if (groupId === undefined) return
    await this.client.send({ groupId }, text, projection.msgAnchors[0])
  }
}
