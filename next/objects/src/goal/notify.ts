/**
 * 落库即代发 — the mechanical consequence of a confirmed proposal item.
 *
 * 幽灵承诺禁令 (v4.9): a commitment that exists in the graph but was never
 * spoken anywhere is work assigned to somebody who does not know about it. The
 * design's ruling is that registration IS a breath — 没有静默登记，出生本身就是
 * 一次呼吸 — so minting and announcing are one act, not two.
 *
 * It runs off the graph event rather than inside the card's `apply` because
 * `apply` is pure: it decides what becomes true, and sending a message into a
 * real group is not a decision, it is an effect. Putting the effect here also
 * means it happens whichever surface confirmed the item — the desktop button
 * and a 「确认 1,3」 typed into Yunzhijia go through the same door.
 *
 * **The failure mode is the point.** When the utterance cannot be delivered
 * (channel down, place unreachable), the commitment is stamped 「未通知」 and the
 * board says so with the owner's name on it. A silent failure here would
 * recreate the exact ghost the rule forbids, one layer down.
 */

import type { Context } from '@deepseek-ai/cordis'
import { asRecord, asString, type GraphEvent } from '@yzj-next/graph'

/** Attach the listener and run the restart sweep. Returns its disposer. */
export function applyCommitmentNotify(ctx: Context): () => void {
  const announce = async (commitmentId: string, placeKey: string): Promise<void> => {
    let delivered: unknown
    try {
      delivered = await ctx.get('yzjCardChannel')?.deliverToPlace(
        { kind: 'commitment', id: commitmentId }, placeKey,
      )
    } catch (error) {
      console.error('[yzj-next-objects] 代发登记话语失败', error)
      delivered = undefined
    }
    await ctx.yzjGraph.append({
      type: 'commitment/updated',
      data: {
        commitmentId,
        notified: delivered === undefined ? 'failed' : 'sent',
        // The listener set is established BY the utterance (v4.9). Recording it
        // only on success is deliberate: an audience nobody was ever spoken to
        // is a claim about who knows, and it would be false.
        ...(delivered === undefined ? {} : { audience: [placeKey] }),
      },
      actor: { kind: 'agent' },
    })
  }

  /*
    重启补账 (§1.9-1 待答态即图数据可恢复).

    Minting and announcing are two appends, and a crash between them leaves a
    commitment that is neither announced nor marked — the silent ghost this
    whole rule exists to forbid, produced by the rule's own implementation.
    Replay does NOT re-emit `yzj-graph/appended` (the store hydrates directly),
    so nothing would ever retry it.

    The projection registry narrows the recovery from a guess to a small
    window: a card that was delivered has a projection recorded in the graph,
    so a projection means "it was said, just never stamped" and no projection
    means it almost certainly never went out.

    **Almost.** `deliverToPlace` posts the message and registers the projection
    as two separate steps, so a crash in THAT window looks identical to "never
    sent" and this sweep will post it again. The exposure is one duplicated
    registration card in a group after a crash at one specific instant. It is
    accepted deliberately: the alternative error — leaving a real commitment
    unannounced and unmarked — is the ghost the rule exists to forbid, and a
    duplicate is visible while a ghost is not. 宁可重复,不可静默.
  */
  const sweep = (): void => {
    for (const object of ctx.yzjGraph.query(
      { kind: 'operator', openId: '' }, { kind: 'commitment', status: ['open'] },
    )) {
      const state = asRecord(object.state)
      const placeKey = asString(state?.notifyPlaceKey)
      if (placeKey === undefined || asString(state?.notified) !== undefined) continue
      const spoken = ctx.yzjCards.projectionsOf({ kind: 'commitment', id: object.id }).length > 0
      if (spoken) {
        void ctx.yzjGraph.append({
          type: 'commitment/updated',
          data: { commitmentId: object.id, notified: 'sent', audience: [placeKey] },
          actor: { kind: 'agent' },
        }).catch((error: unknown) => {
          console.error('[yzj-next-objects] 补账失败', error)
        })
        continue
      }
      void announce(object.id, placeKey).catch((error: unknown) => {
        console.error('[yzj-next-objects] 重启后补发登记话语失败', error)
      })
    }
  }
  // After the partition is open: the sweep is a query, and a query before
  // hydration would find nothing and report every commitment as fine.
  void ctx.yzjGraph.ready().then(sweep).catch(() => undefined)

  return ctx.on('yzj-graph/appended', (event: GraphEvent) => {
    if (event.type !== 'commitment/opened') return
    const data = asRecord(event.data)
    const placeKey = asString(data?.notifyPlaceKey)
    const commitmentId = asString(data?.commitmentId)
    if (placeKey === undefined || commitmentId === undefined) return
    // Deliberately not awaited: this listener runs on the append path, and
    // blocking a durable write on a network round trip is how one slow group
    // stalls every other write in the process.
    void announce(commitmentId, placeKey).catch((error: unknown) => {
      console.error('[yzj-next-objects] 未能记录代发结果', error)
    })
  })
}
