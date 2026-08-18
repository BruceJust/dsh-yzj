import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@dsh-yzj/bridge'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { YzjGatewayClient } from './client.ts'
import { YzjAgentFactory } from './agent-factory.ts'
import { YzjAgentPoller } from './poller.ts'
import { YzjAgentRunner } from './agent-runner.ts'
import { GatewayState } from './state.ts'
import { yzjSessionIdentityProjection } from './projection.ts'
import type {} from './types.ts'

export const name = 'yzj-agent-gateway'
export const inject = [
  'agentDefaultModel', 'agentPresets', 'agents', 'sessions',
  'sessionPersistence', 'sessionProjectionCache', 'sessionProjections',
  'sessionTitle', 'systemPrompt', 'tools', 'workspaceRegistry', 'yzjBridge',
]

const defaultHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const defaultAgentCwd = join(defaultHome, 'yzj-agent', 'workspace')

export interface Config {
  enabled?: boolean
  pollIntervalMs?: number
  groupPages?: number
  contextMessages?: number
  discoveryPages?: number
  aliases?: string[]
  acceptAccountMentions?: boolean
  allowedGroupIds?: string[]
  allowedSenderOpenIds?: string[]
  preset?: string
  cwd?: string
  workspaceTitle?: string
  stateFile?: string
  cliTimeoutMs?: number
  taskTimeoutMs?: number
  maxProgressReplies?: number
  maxConcurrentTasks?: number
  maxReplyChars?: number
  agentIdleMs?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  pollIntervalMs: z.number().step(1).min(1_000).default(5_000),
  groupPages: z.number().step(1).min(1).max(20).default(3),
  contextMessages: z.number().step(1).min(1).max(20).default(20),
  discoveryPages: z.number().step(1).min(1).max(20).default(10),
  aliases: z.array(z.string()).default(['@agent', '@智能体']),
  acceptAccountMentions: z.boolean().default(false),
  allowedGroupIds: z.array(z.string()).default([]),
  allowedSenderOpenIds: z.array(z.string()).default([]),
  preset: z.string().default('standard'),
  cwd: z.string().default(defaultAgentCwd),
  workspaceTitle: z.string().default('云之家 Agent'),
  stateFile: z.string().default(join(defaultHome, 'yzj-agent', 'state.json')),
  cliTimeoutMs: z.number().step(1).min(1_000).default(60_000),
  taskTimeoutMs: z.number().step(1).min(10_000).default(30 * 60_000),
  maxProgressReplies: z.number().step(1).min(0).max(20).default(5),
  maxConcurrentTasks: z.number().step(1).min(1).max(20).default(2),
  maxReplyChars: z.number().step(1).min(200).max(20_000).default(3_500),
  agentIdleMs: z.number().step(1).min(0).default(10 * 60_000),
})

function absolutePath(value: string): string {
  return isAbsolute(value) ? value : resolve(value)
}

async function backfillIdentityProjections(ctx: Context, cwd: string): Promise<void> {
  const headers = await ctx.sessionPersistence.list()
  const candidates = headers.filter(header => (
    header.cwd === cwd && header.id.startsWith('session-yzj-topic-')
  ))
  const concurrency = 4
  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    const batch = candidates.slice(offset, offset + concurrency)
    const results = await Promise.allSettled(batch.map(header => (
      ctx.sessionProjectionCache.coldSnapshot(SessionId(header.id))
    )))
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[yzj-agent-gateway] identity projection backfill failed for ${batch[index]?.id ?? 'unknown'}`,
          result.reason,
        )
      }
    })
  }
}

export function apply(ctx: Context, config: Config): void {
  if (config.enabled === false) return
  ctx.sessionProjections.register(yzjSessionIdentityProjection)
  const pollIntervalMs = config.pollIntervalMs ?? 5_000
  const maxReplyChars = config.maxReplyChars ?? 3_500
  const agentCwd = absolutePath(config.cwd ?? defaultAgentCwd)
  const client = new YzjGatewayClient(ctx, config.cliTimeoutMs ?? 60_000)
  const state = new GatewayState(absolutePath(config.stateFile ?? join(defaultHome, 'yzj-agent', 'state.json')))
  // Cross-package revocation channel: tool-yzj's approval guard consumes this
  // optionally; revocations live in gateway state, never in the Session log.
  ctx.provide('yzjRevocations', { isRevoked: messageId => state.isRevoked(messageId) })
  const factory = new YzjAgentFactory(ctx, client, state, {
    cwd: agentCwd,
    preset: config.preset ?? 'standard',
    maxProgressReplies: config.maxProgressReplies ?? 5,
    maxReplyChars,
    agentIdleMs: config.agentIdleMs ?? 10 * 60_000,
  })
  const runner = new YzjAgentRunner(client, factory, state, {
    taskTimeoutMs: config.taskTimeoutMs ?? 30 * 60_000,
    maxReplyChars,
  })
  const onError = (error: unknown): void => {
    console.error('[yzj-agent-gateway]', error)
  }
  const poller = new YzjAgentPoller(client, state, runner, {
    aliases: config.aliases ?? ['@agent', '@智能体'],
    acceptAccountMentions: config.acceptAccountMentions ?? false,
    groupPages: config.groupPages ?? 3,
    contextMessages: config.contextMessages ?? 20,
    discoveryPages: config.discoveryPages ?? 10,
    pollIntervalMs,
    maxConcurrentTasks: config.maxConcurrentTasks ?? 2,
    allowedGroupIds: new Set(config.allowedGroupIds ?? []),
    allowedSenderOpenIds: new Set(config.allowedSenderOpenIds ?? []),
  }, onError)

  ctx.effect(() => {
    let disposed = false
    let interval: ReturnType<typeof setInterval> | undefined
    void Promise.all([
      state.load(),
      mkdir(agentCwd, { recursive: true }),
    ])
      .then(async () => {
        if (disposed) return
        const workspace = await ctx.workspaceRegistry.create(
          agentCwd, config.workspaceTitle ?? '云之家 Agent',
        )
        factory.setWorkspace(workspace)
        await backfillIdentityProjections(ctx, agentCwd)
        if (disposed) return
        await poller.poll()
        if (!disposed) interval = setInterval(() => void poller.poll(), pollIntervalMs)
      })
      .catch(onError)
    return async () => {
      disposed = true
      if (interval !== undefined) clearInterval(interval)
      await poller.stop()
      await factory.dispose()
    }
  })
}
