/**
 * Write-gate specs: the confirmation-card bridge answers the
 * `approval/request` waterfall for yzj tools, pairs the audit id, exposes
 * pending records, settles decisions, and lets the official `tools/result`
 * event drive the terminal status. Non-yzj requests delegate via next().
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { applyWriteGate, type YzjApprovalOutcome, type YzjWriteRecord } from '../src/write-gate.ts'

interface FakeEvent { type: string; data: unknown }

function sessionOf(events: FakeEvent[]) {
  return {
    id: 's1',
    events: [
      { type: 'turn/start', data: { turn: 1 } },
      ...events,
    ],
  }
}

interface Harness {
  ctx: Context
  gate: ReturnType<typeof applyWriteGate>
  ask: (over: Partial<Parameters<Context['emit']>[1]> & object) => void
  request: (over?: {
    toolName?: string
    callId?: string
    reason?: string
    signal?: { aborted: boolean; addEventListener: () => void; removeEventListener: () => void }
  }) => Promise<YzjApprovalOutcome>
}

function mount(events: FakeEvent[] = []): Harness {
  const ctx = new Context()
  const gate = applyWriteGate(ctx)
  const session = sessionOf(events)
  const ask = (over: { callId: string; toolName: string; level: 'standard' | 'strong'; reason: string; args: Record<string, unknown> }): void => {
    ctx.emit('yzj/ask-pending', over)
  }
  const request = (over: {
    toolName?: string
    callId?: string
    reason?: string
    signal?: { aborted: boolean; addEventListener: () => void; removeEventListener: () => void }
  } = {}): Promise<YzjApprovalOutcome> =>
    ctx.waterfall('approval/request', {
      agent: { session },
      toolName: over.toolName ?? 'yzj_im_message_send',
      callId: over.callId ?? 'c1',
      ...over.reason === undefined ? {} : { reason: over.reason },
      ...over.signal === undefined ? {} : { signal: over.signal },
    }, () => Promise.resolve<YzjApprovalOutcome>('unavailable'))
  return { ctx, gate, ask, request }
}

function asked(callId = 'c1', id = 'w1'): FakeEvent {
  return { type: 'approval/asked', data: { id, callId } }
}

function recordOf(list: YzjWriteRecord[], id: string): YzjWriteRecord {
  const found = list.find(record => record.writeId === id)
  if (found === undefined) throw new Error(`record ${id} not found`)
  return found
}

describe('applyWriteGate', () => {
  it('delegates non-yzj requests to the next answerer', async () => {
    const h = mount()
    const outcome = await h.request({ toolName: 'bash' })
    expect(outcome).toBe('unavailable')
    expect(h.gate.list('s1')).toEqual([])
  })

  it('pairs the audit id and exposes a pending record with the ask args', async () => {
    const h = mount([asked()])
    h.ask({ callId: 'c1', toolName: 'yzj_im_message_send', level: 'standard', reason: '云之家操作确认：发送 IM 消息', args: { groupId: 'g1', content: 'hello' } })
    const pending = h.request()
    const list = h.gate.list('s1')
    expect(list.length).toBe(1)
    expect(list[0]).toMatchObject({
      writeId: 'w1', callId: 'c1', domain: 'im', level: 'standard',
      args: { groupId: 'g1', content: 'hello' }, status: 'pending',
    })
    // The waterfall stays open until decided.
    let settled = false
    void pending.then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(settled).toBe(false)
  })

  it('decide allowed-once settles the waterfall and marks approved', async () => {
    const h = mount([asked()])
    h.ask({ callId: 'c1', toolName: 'yzj_im_message_send', level: 'standard', reason: 'r', args: {} })
    const pending = h.request()
    expect(h.gate.decide('w1', 'allowed-once')).toBe(true)
    await expect(pending).resolves.toBe('allowed-once')
    expect(recordOf(h.gate.list('s1'), 'w1').status).toBe('approved')
    // A second decide on the settled record is a no-op.
    expect(h.gate.decide('w1', 'rejected')).toBe(false)
  })

  it('decide rejected settles as cancelled', async () => {
    const h = mount([asked()])
    h.ask({ callId: 'c1', toolName: 'yzj_doc_delete', level: 'strong', reason: 'r', args: { id: 'd1' } })
    const pending = h.request()
    expect(h.gate.decide('w1', 'rejected')).toBe(true)
    await expect(pending).resolves.toBe('rejected')
    expect(recordOf(h.gate.list('s1'), 'w1').status).toBe('cancelled')
    expect(recordOf(h.gate.list('s1'), 'w1').level).toBe('strong')
  })

  it('an aborted signal settles cancelled', async () => {
    let abortListener: (() => void) | undefined
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: () => void) => { abortListener = listener },
      removeEventListener: () => { abortListener = undefined },
    }
    const h = mount([asked()])
    h.ask({ callId: 'c1', toolName: 'yzj_im_message_send', level: 'standard', reason: 'r', args: {} })
    const pending = h.request({ signal })
    expect(recordOf(h.gate.list('s1'), 'w1').status).toBe('pending')
    abortListener?.()
    await expect(pending).resolves.toBe('cancelled')
    expect(recordOf(h.gate.list('s1'), 'w1').status).toBe('cancelled')
  })

  it('tools/result drives the terminal status after approval', async () => {
    const h = mount([asked()])
    h.ask({ callId: 'c1', toolName: 'yzj_im_message_send', level: 'standard', reason: 'r', args: {} })
    void h.request()
    h.gate.decide('w1', 'allowed-once')
    h.ctx.emit('tools/result', { name: 'yzj_im_message_send', callId: 'c1' }, { isError: false, content: [{ type: 'text', text: 'sent' }] })
    expect(recordOf(h.gate.list('s1'), 'w1').status).toBe('done')
    expect(recordOf(h.gate.list('s1'), 'w1').error).toBeUndefined()
  })

  it('an error result marks the record failed with the digest text', async () => {
    const h = mount([asked()])
    h.ask({ callId: 'c1', toolName: 'yzj_doc_create', level: 'standard', reason: 'r', args: {} })
    void h.request()
    h.gate.decide('w1', 'allowed-once')
    h.ctx.emit('tools/result', { name: 'yzj_doc_create', callId: 'c1' }, { isError: true, content: [{ type: 'text', text: 'yzj doc create failed (exit 7)' }] })
    expect(recordOf(h.gate.list('s1'), 'w1').status).toBe('failed')
    expect(recordOf(h.gate.list('s1'), 'w1').error).toContain('exit 7')
  })

  it('list filters by callId', async () => {
    const h = mount([asked('c1', 'w1'), asked('c2', 'w2')])
    h.ask({ callId: 'c1', toolName: 'yzj_im_message_send', level: 'standard', reason: 'r', args: {} })
    h.ask({ callId: 'c2', toolName: 'yzj_doc_create', level: 'standard', reason: 'r', args: {} })
    void h.request({ callId: 'c1' })
    void h.request({ callId: 'c2' })
    expect(h.gate.list('s1', 'c1').map(r => r.writeId)).toEqual(['w1'])
    expect(h.gate.list('s1', 'c2').map(r => r.writeId)).toEqual(['w2'])
    expect(h.gate.list('other-session').length).toBe(0)
  })

  it('a missing audit pair delegates to the next answerer', async () => {
    const h = mount([])
    const outcome = await h.request({ callId: 'c1' })
    expect(outcome).toBe('unavailable')
    expect(h.gate.list('s1')).toEqual([])
  })
})
