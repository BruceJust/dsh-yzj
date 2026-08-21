/**
 * The `/yzj-next` RPC channel — how the desktop conversation flow reads a live
 * card and answers it.
 *
 * A PENDING card cannot be rendered from durable tool events, because a call
 * that is still waiting has no result and a REJECTED one never will (TD-4').
 * So the desktop reads the live state from the graph through this channel and
 * answers through the same action bus the text channel uses. One arbiter, two
 * surfaces.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { GraphObject, JsonValue } from '@yzj-next/graph'
import type { CardRef } from './types.ts'

/** Wire shape of one card handed to the browser. */
export interface CardWire {
  readonly kind: string
  readonly id: string
  readonly state: JsonValue
  readonly resolved: boolean
  readonly actions: readonly {
    readonly id: string
    readonly label: string
    readonly style?: 'primary' | 'danger' | 'neutral'
    readonly needsInput: boolean
    /** False when the action exists but this state does not offer it. */
    readonly available: boolean
  }[]
}

type RpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: 'internal'; message: string; details: Record<string, never> } }

const failure = (message: string): RpcResult => ({
  ok: false,
  error: { code: 'internal', message, details: {} },
})

function stringField(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Project one materialized card object onto the wire shape. */
export function projectCard(ctx: Context, object: GraphObject): CardWire | undefined {
  const definition = ctx.yzjCards.definition(object.kind)
  if (definition === undefined) return undefined
  const state = object.state as never
  return {
    kind: object.kind,
    id: object.id,
    state: object.state,
    resolved: definition.isResolved(state),
    actions: definition.actions.map(action => ({
      id: action.id,
      label: action.label,
      ...(action.style === undefined ? {} : { style: action.style }),
      needsInput: action.needsInput === true,
      available: action.available === undefined ? true : action.available(state),
    })),
  }
}

/**
 * Register the channel. Loopback authority only: this endpoint can approve a
 * write, so it is exactly as privileged as the operator's own desktop.
 */
export function applyCardRpc(ctx: Context): void {
  // Every handler below reads `yzjCards` and `yzjGraph` off the SCOPED
  // context, and a property read without its injection throws inside the
  // request rather than at boot. Declaring them is what turns "this endpoint
  // 500s for anybody who has a card" into a startup condition.
  ctx.inject(['connection', 'yzjCards', 'yzjGraph'], (scoped) => {
    scoped.connection.rpc.handle('/yzj-next', async (endpoint: string, payload: unknown): Promise<RpcResult> => {
      switch (endpoint) {
        case 'card-for-call': {
          const sessionAnchor = stringField(payload, 'sessionAnchor')
          const callId = stringField(payload, 'callId')
          if (sessionAnchor === undefined || callId === undefined) {
            return failure('card-for-call requires sessionAnchor and callId')
          }
          const object = scoped.yzjCards.cardForCall(sessionAnchor, callId)
          return {
            ok: true,
            value: { card: object === undefined ? undefined : projectCard(scoped, object) },
          }
        }
        case 'card': {
          const kind = stringField(payload, 'kind')
          const id = stringField(payload, 'id')
          if (kind === undefined || id === undefined) return failure('card requires kind and id')
          const object = scoped.yzjGraph.rawObject(kind, id)
          return {
            ok: true,
            value: { card: object === undefined ? undefined : projectCard(scoped, object) },
          }
        }
        case 'card-act': {
          const kind = stringField(payload, 'kind')
          const id = stringField(payload, 'id')
          const actionId = stringField(payload, 'actionId')
          if (kind === undefined || id === undefined || actionId === undefined) {
            return failure('card-act requires kind, id and actionId')
          }
          const input = stringField(payload, 'input')
          const cardRef: CardRef = { kind, id }
          const result = await scoped.yzjCards.act(
            cardRef, actionId, scoped.yzjCards.desktopActor(), 'desktop', input,
          )
          const object = scoped.yzjGraph.rawObject(kind, id)
          return {
            ok: true,
            value: {
              outcome: result.outcome,
              receipt: result.receipt,
              card: object === undefined ? undefined : projectCard(scoped, object),
            },
          }
        }
        default:
          return failure(`unknown /yzj-next endpoint ${endpoint}`)
      }
    }, { authority: 'loopback' })
  })
}
