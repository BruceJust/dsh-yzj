import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CHANNEL_PROMPT, clipMessage, progressOutput } from './agent-support.ts'
import { YzjTaskLeaseRevokedError } from './errors.ts'
import type { GatewayState } from './state.ts'
import type { YzjTopicRoute, YzjTrigger } from './types.ts'
import type { YzjGatewayClient } from './client.ts'

interface ActiveRun {
  readonly trigger: YzjTrigger
  readonly route: YzjTopicRoute
  progressCount: number
}

export interface AgentFactoryConfig {
  readonly cwd: string
  readonly preset: string
  readonly maxProgressReplies: number
  readonly maxReplyChars: number
  readonly agentIdleMs: number
}

export class YzjAgentFactory {
  private readonly creations = new Map<string, Promise<Agent>>()
  private readonly handles = new Map<string, AgentHandle>()
  private readonly activeRuns = new Map<Agent, ActiveRun>()
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly releases = new Map<string, Promise<void>>()
  private readonly quarantined = new Set<string>()
  private workspace: Workspace | undefined
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly client: YzjGatewayClient,
    private readonly state: GatewayState,
    private readonly config: AgentFactoryConfig,
  ) {}

  setWorkspace(workspace: Workspace): void {
    this.workspace = workspace
  }

  async ensure(route: YzjTopicRoute): Promise<Agent>
  async ensure(sessionId: string, title: string): Promise<Agent>
  async ensure(routeOrSessionId: YzjTopicRoute | string, legacyTitle?: string): Promise<Agent> {
    const sessionId = typeof routeOrSessionId === 'string' ? routeOrSessionId : routeOrSessionId.sessionId
    const title = typeof routeOrSessionId === 'string' ? legacyTitle : routeOrSessionId.title
    if (title === undefined) throw new Error('Yunzhijia topic Session title is required')
    if (this.disposed) throw new Error('Yunzhijia Agent factory is disposed')
    const id = SessionId(sessionId)
    this.clearIdle(id)
    if (this.quarantined.has(id)) {
      throw new Error('Yunzhijia topic Session is quarantined after a non-quiescing timeout')
    }
    const releasing = this.releases.get(id)
    if (releasing !== undefined) await releasing
    if (this.disposed) throw new Error('Yunzhijia Agent factory is disposed')
    const live = this.ctx.agents.get(id)
    if (live !== undefined) {
      if (this.handles.get(id)?.agent !== live) {
        throw new Error('Yunzhijia topic Session is already active outside the Agent gateway')
      }
      await this.ensureMetadata(live, title)
      return live
    }
    const pending = this.creations.get(sessionId)
    if (pending !== undefined) return pending
    const creation = this.create(id, title).finally(() => this.creations.delete(sessionId))
    this.creations.set(sessionId, creation)
    return creation
  }

  activate(agent: Agent, trigger: YzjTrigger, route: YzjTopicRoute): void {
    this.activeRuns.set(agent, { trigger, route, progressCount: 0 })
  }

  assertActive(agent: Agent, messageId: string): void {
    if (this.activeRuns.get(agent)?.trigger.message.msgId !== messageId) {
      throw new YzjTaskLeaseRevokedError()
    }
  }

  deactivate(agent: Agent, scheduleIdle = true): void {
    this.activeRuns.delete(agent)
    if (scheduleIdle) this.scheduleIdle(agent)
    else this.clearIdle(agent.session.id)
  }

  async forceDispose(agent: Agent): Promise<void> {
    const id = agent.session.id
    this.activeRuns.delete(agent)
    this.clearIdle(id)
    const handle = this.handles.get(id)
    if (handle?.agent !== agent) {
      throw new Error('Yunzhijia Agent gateway cannot force-dispose an unowned Agent')
    }
    this.quarantined.add(id)
    const disposal = Promise.resolve().then(() => handle.dispose()).then(() => {
      if (this.handles.get(id) === handle) this.handles.delete(id)
      this.quarantined.delete(id)
    })
    this.releases.set(id, disposal)
    void disposal.then(
      () => { if (this.releases.get(id) === disposal) this.releases.delete(id) },
      () => { if (this.releases.get(id) === disposal) this.releases.delete(id) },
    )
    if (!await this.settlesWithin(disposal, 30_000)) {
      console.error(`[yzj-agent-gateway] Agent disposal did not settle for ${id}; Session quarantined`)
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const hadActiveRuns = this.activeRuns.size > 0
    for (const [agent, active] of this.activeRuns) {
      try {
        this.state.revoke(active.trigger.message.msgId)
      } catch (error) {
        console.error('[yzj-agent-gateway] failed to revoke active task during shutdown', error)
      }
      agent.cancel({ kind: 'disposed' })
    }
    this.activeRuns.clear()
    if (hadActiveRuns) {
      try {
        await this.state.save()
      } catch (error) {
        console.error('[yzj-agent-gateway] failed to persist shutdown revocations', error)
      }
    }
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    this.idleTimers.clear()
    await this.settleBounded(
      [...this.creations.values(), ...this.releases.values()], 'creation/release',
    )
    const handles = [...this.handles.values()]
    this.handles.clear()
    await this.settleBounded(handles.map(handle => handle.dispose()), 'handle disposal')
  }

  private async settlesWithin(task: PromiseLike<unknown>, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve(task).then(() => true, () => false),
        new Promise<false>(resolve => {
          timer = setTimeout(() => resolve(false), timeoutMs)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private async settleBounded(tasks: PromiseLike<unknown>[], label: string): Promise<void> {
    if (tasks.length === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    try {
      await Promise.race([
        Promise.allSettled(tasks),
        new Promise<void>(resolve => {
          timer = setTimeout(() => {
            timedOut = true
            resolve()
          }, 30_000)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    if (timedOut) console.error(`[yzj-agent-gateway] timed out during ${label}`)
  }

  private clearIdle(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId)
    if (timer !== undefined) clearTimeout(timer)
    this.idleTimers.delete(sessionId)
  }

  private scheduleIdle(agent: Agent): void {
    const id = agent.session.id
    if (this.disposed || this.config.agentIdleMs <= 0 || this.handles.get(id)?.agent !== agent) return
    this.clearIdle(id)
    const timer = setTimeout(() => {
      this.idleTimers.delete(id)
      const release = this.releaseIdle(id, agent)
      this.releases.set(id, release)
      void release.finally(() => {
        if (this.releases.get(id) === release) this.releases.delete(id)
      })
    }, this.config.agentIdleMs)
    this.idleTimers.set(id, timer)
  }

  private async releaseIdle(id: SessionId, agent: Agent): Promise<void> {
    const handle = this.handles.get(id)
    if (handle?.agent !== agent || this.activeRuns.has(agent)) return
    this.handles.delete(id)
    try {
      await handle.dispose()
    } catch (error) {
      if (!this.disposed && this.ctx.agents.get(id) === agent) this.handles.set(id, handle)
      console.error('[yzj-agent-gateway] failed to release idle Agent', error)
    }
  }

  private async create(id: SessionId, title: string): Promise<Agent> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const resolvedPreset = await this.ctx.agentPresets.resolve(this.config.preset)
    const setup = async (agentCtx: Context): Promise<void> => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined })
      await this.ctx.agentPresets.mount(agentCtx, resolvedPreset.id)
      agentCtx.systemPrompt.section({ name: 'yzj:agent-channel', order: 90, text: CHANNEL_PROMPT })
      const agent = agentCtx.agent
      if (agent === undefined) throw new Error('yzj agent gateway setup has no scoped agent')
      agentCtx.tools.register(defineTool({
        name: 'yzj_agent_progress',
        description: 'Reply one important progress milestone to the originating Yunzhijia message. Use sparingly during long tasks; never send the final answer with this tool.',
        parameters: {
          message: { type: 'string', required: true, description: 'Short user-facing milestone with concrete progress or a blocker.' },
        },
        output: progressOutput,
        timeoutMs: 30_000,
        isConcurrencySafe: () => false,
        execute: async (args) => this.sendProgress(agent, args.message),
      }))
    }
    const persistence = this.ctx.get('sessionPersistence')
    const persisted = persistence === undefined
      ? false
      : (await persistence.list()).some(header => header.id === id)
    const handle = persisted
      ? await this.ctx.agents.resume({ resumeSessionId: id, agentOptions: selection, setup })
      : await this.ctx.agents.create({
        sessionId: id,
        agentOptions: selection,
        meta: { cwd: this.config.cwd, agentPreset: resolvedPreset.id },
        setup,
      })
    try {
      await this.ensureMetadata(handle.agent, title)
      if (this.disposed) throw new Error('Yunzhijia Agent factory stopped during Agent creation')
      this.handles.set(id, handle)
      return handle.agent
    } catch (error) {
      await handle.dispose()
      throw error
    }
  }

  private async ensureMetadata(agent: Agent, title: string): Promise<void> {
    if (this.workspace !== undefined && agent.session.header.cwd === this.config.cwd) {
      await this.workspace.attachSession(agent.session.id)
    }
    const current = this.ctx.sessionTitle.get(agent.session)
    const managed = this.state.managedTitle(agent.session.id)
    if (current === undefined || current.title === managed) {
      const normalized = current?.title === title
        ? current.title
        : this.ctx.sessionTitle.rename(agent.session, title).title
      this.state.setManagedTitle(agent.session.id, normalized)
      try {
        await this.state.save()
      } catch (error) {
        console.error('[yzj-agent-gateway] failed to persist managed Session title', error)
      }
    }
  }

  private async sendProgress(agent: Agent, message: string): Promise<{ content: string; sent: boolean }> {
    const active = this.activeRuns.get(agent)
    if (active === undefined) return { content: 'No active Yunzhijia task is bound to this Agent.', sent: false }
    if (active.progressCount >= this.config.maxProgressReplies) {
      return { content: 'Progress reply limit reached; continue and provide the final result.', sent: false }
    }
    const body = clipMessage(`【Agent进度】\n${message}`, this.config.maxReplyChars)
    const replyId = await this.client.reply(
      active.trigger.group.groupId,
      active.trigger.message.msgId,
      body,
      () => this.assertActive(agent, active.trigger.message.msgId),
    )
    if (replyId !== undefined) {
      this.state.recordMessageTopic(active.trigger.group.groupId, replyId, active.route.topicRootId)
      try {
        await this.state.save()
      } catch (error) {
        console.error('[yzj-agent-gateway] failed to persist progress topic mapping', error)
      }
    }
    active.progressCount += 1
    return { content: 'Progress milestone sent to the source conversation.', sent: true }
  }
}
