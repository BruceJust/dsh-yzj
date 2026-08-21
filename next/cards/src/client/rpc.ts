/**
 * Browser-side face of the `/yzj-next` channel. Plain callbacks over JSON —
 * the card component never sees the connection handle.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

/** Wire shape of one card, mirroring the node half's projection. */
export interface CardWire {
  kind: string
  id: string
  state: Record<string, unknown>
  resolved: boolean
  actions: {
    id: string
    label: string
    style?: 'primary' | 'danger' | 'neutral'
    needsInput: boolean
    available: boolean
  }[]
}

export interface CardActOutcome {
  outcome: 'applied' | 'superseded' | 'duplicate' | 'unauthorized'
  receipt: string
  card?: CardWire
}

/** The injected data face the desktop card receives. */
export interface CardInject {
  /** The card a tool call is blocked on, if any. */
  fetchForCall(sessionId: string, callId: string): Promise<CardWire | undefined>
  /** Re-read one card's live state. */
  fetchCard(kind: string, id: string): Promise<CardWire | undefined>
  /** Answer through the same action bus the text channel uses. */
  act(kind: string, id: string, actionId: string, input?: string): Promise<CardActOutcome | undefined>
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

export function createCardInject(connection: ConnectionHandle | undefined): CardInject {
  const call = async (endpoint: string, payload: Record<string, unknown>): Promise<unknown> => {
    if (connection === undefined) return undefined
    const result = await connection.rpc.call('/yzj-next', endpoint, payload)
    return result.ok ? result.value : undefined
  }
  const cardOf = (value: unknown): CardWire | undefined => {
    const card = asRecord(value).card
    return card === undefined ? undefined : card as unknown as CardWire
  }
  return {
    fetchForCall: async (sessionId, callId) => (
      cardOf(await call('card-for-call', { sessionAnchor: sessionId, callId }))
    ),
    fetchCard: async (kind, id) => cardOf(await call('card', { kind, id })),
    act: async (kind, id, actionId, input) => {
      const value = await call('card-act', {
        kind, id, actionId, ...(input === undefined ? {} : { input }),
      })
      return value === undefined ? undefined : value as unknown as CardActOutcome
    },
  }
}
