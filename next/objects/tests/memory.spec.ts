/**
 * Memory specs. The rules under test are the ones that decide whether the
 * memory panel is worth reading: where a lesson gets FILED (never the model's
 * choice), that it can be traced back, that it can die, and that a dead one
 * stops reaching the next turn.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { YzjGraph, asRecord, asString } from '@yzj-next/graph'
import { applyMemoryTools, memoriesFor, memoryIdFor } from '../src/memory/tools.ts'
import type { TurnBinding } from '../src/turns.ts'

const BINDING: TurnBinding = {
  viewer: { kind: 'place', placeKey: 'yzj-group-g1' },
  decider: 'op-1',
  accountKey: 'acct-1',
  accountOpenId: 'op-1',
  accountOrgId: 'org-1',
  topicKey: 'yzj-topic-1',
  placeKey: 'yzj-group-g1',
  audience: ['yzj-group-g1'],
  messageId: 'msg-1',
}

interface CapturedTool {
  name: string
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<{ content: string; memoryId?: string }>
}

const EXEC = { agent: { session: { id: 'session-1' } } }

let ctx: Context
let graph: YzjGraph
let tools: Map<string, CapturedTool>

function stateOf(id: string): Record<string, unknown> | undefined {
  return asRecord(graph.rawObject('memory', id)?.state)
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'yzj-next-memory-'))
  ctx = new Context()
  graph = new YzjGraph(ctx, { root })
  await graph.selectAccount('acct-1')
  ctx.provide('yzjTurns', { bindingFor: () => BINDING, defaultBinding: () => BINDING })
  const captured: CapturedTool[] = []
  ctx.provide('tools', {
    register: (definition: CapturedTool) => { captured.push(definition); return () => undefined },
  })
  applyMemoryTools(ctx)
  tools = new Map(captured.map(tool => [tool.name, tool]))
})

describe('memory_note', () => {
  it('files a place lesson under the PLACE, not under anything the model named', async () => {
    // The model chooses the axis — a judgement. It never chooses the
    // coordinate: one that could would file what one group said under another
    // group's memory, and then read it back out loud there.
    const result = await tools.get('memory_note')?.execute({
      summary: '对账差异一律逐条列出，不直接改数', axis: 'place',
    }, EXEC)
    expect(stateOf(String(result?.memoryId))).toMatchObject({
      axis: 'place', scope: 'yzj-group-g1', status: 'live',
      summary: '对账差异一律逐条列出，不直接改数',
    })
    expect(graph.rawObject('memory', String(result?.memoryId))?.audience)
      .toEqual(['yzj-group-g1'])
  })

  it('routes the entity and org axes to their own coordinates', async () => {
    const entity = await tools.get('memory_note')?.execute({ summary: 'a', axis: 'entity' }, EXEC)
    const org = await tools.get('memory_note')?.execute({ summary: 'b', axis: 'org' }, EXEC)
    expect(stateOf(String(entity?.memoryId))?.scope).toBe('op-1')
    expect(stateOf(String(org?.memoryId))?.scope).toBe('org-1')
  })

  it('always records where it was learned', async () => {
    // 出生③: a distillation whose source was not written down at write time can
    // never be traced back afterwards.
    const result = await tools.get('memory_note')?.execute({
      summary: '周报周五出', axis: 'place', quote: '以后周报都周五出',
    }, EXEC)
    expect(stateOf(String(result?.memoryId))?.sourceAnchors)
      .toEqual(['yzj:msg-1', 'quote:以后周报都周五出'])
  })

  it('does not write the same lesson twice', async () => {
    const first = await tools.get('memory_note')?.execute({ summary: '同一条', axis: 'place' }, EXEC)
    const second = await tools.get('memory_note')?.execute({ summary: '同一条', axis: 'place' }, EXEC)
    expect(second?.memoryId).toBe(first?.memoryId)
    expect(second?.content).toContain('未重复写入')
    expect(memoriesFor(ctx, 'place', 'yzj-group-g1')).toHaveLength(1)
  })

  it('can learn a lesson again after it was forgotten', async () => {
    /*
      Reported in use: 「之前已经 agent 记录的记忆，再次打开会话又没了」.

      The id is content-derived, so re-learning resolves to the same object —
      which is the point. But the idempotency check looked at the object's
      EXISTENCE, and a forgotten memory is a tombstone that exists forever. So
      the second telling answered 「这条已经记过了」, wrote nothing, and the
      memory tab stayed empty: the lesson had become unrecordable.
    */
    const first = await tools.get('memory_note')?.execute({ summary: '会回来的', axis: 'place' }, EXEC)
    await tools.get('memory_forget')?.execute({ memoryId: String(first?.memoryId), reason: '当时以为不对' }, EXEC)
    expect(memoriesFor(ctx, 'place', 'yzj-group-g1')).toHaveLength(0)

    const again = await tools.get('memory_note')?.execute({ summary: '会回来的', axis: 'place' }, EXEC)
    expect(again?.content).not.toContain('未重复写入')
    expect(memoriesFor(ctx, 'place', 'yzj-group-g1')).toHaveLength(1)
  })

  it('keeps the same sentence separate on two different axes', () => {
    expect(memoryIdFor('place', 'yzj-group-g1', 'x'))
      .not.toBe(memoryIdFor('org', 'yzj-group-g1', 'x'))
  })
})

describe('memory_forget', () => {
  async function note(summary = '旧口径'): Promise<string> {
    const result = await tools.get('memory_note')?.execute({ summary, axis: 'place' }, EXEC)
    return String(result?.memoryId)
  }

  it('retires a memory and stops it reaching the next turn', async () => {
    // A store that only grows is one people stop trusting the first time it
    // repeats something that stopped being true.
    const id = await note()
    expect(memoriesFor(ctx, 'place', 'yzj-group-g1')).toHaveLength(1)
    await tools.get('memory_forget')?.execute({ memoryId: id, reason: '口径改了' }, EXEC)
    expect(stateOf(id)).toMatchObject({ status: 'forgotten', reason: '口径改了' })
    expect(memoriesFor(ctx, 'place', 'yzj-group-g1')).toEqual([])
  })

  it('keeps the distillation itself on the record after it is dropped', async () => {
    const id = await note('会被忘掉的')
    await tools.get('memory_forget')?.execute({ memoryId: id }, EXEC)
    // Correction is an append: the lesson and the reason it was dropped both
    // survive, so "why did it stop saying that" is answerable.
    expect(graph.rawEvents(['memory/distilled'])).toHaveLength(1)
    expect(graph.rawEvents(['memory/forgotten'])).toHaveLength(1)
    expect(asString(stateOf(id)?.summary)).toBe('会被忘掉的')
  })

  it('says so plainly when the memory does not exist', async () => {
    const result = await tools.get('memory_forget')?.execute({ memoryId: 'mem-nope' }, EXEC)
    expect(result?.content).toContain('找不到')
  })

  it('is idempotent', async () => {
    const id = await note()
    await tools.get('memory_forget')?.execute({ memoryId: id }, EXEC)
    const again = await tools.get('memory_forget')?.execute({ memoryId: id }, EXEC)
    expect(again?.content).toContain('已经是遗忘状态')
    expect(graph.rawEvents(['memory/forgotten'])).toHaveLength(1)
  })
})
