import type { YzjSessionIdentityProjection } from '@dsh-yzj/bridge'
import type { SessionSummary, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'

export interface WorkspaceSessionHierarchyNode {
  readonly id: string
  readonly label: string
  readonly kind?: 'group' | 'direct' | 'legacy'
}

export interface WorkspaceSessionHierarchyClaim {
  readonly path: readonly WorkspaceSessionHierarchyNode[]
  readonly leafLabel?: string
  readonly aliases?: readonly string[]
}

export interface WorkspaceSessionHierarchyInput {
  readonly session: SessionSummary
  readonly workspace: WorkspaceView
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    yzjSessionIdentity: YzjSessionIdentityProjection | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'workspace/session-hierarchy': (
      input: WorkspaceSessionHierarchyInput,
    ) => WorkspaceSessionHierarchyClaim | undefined
  }
}

interface LegacyTitleParts {
  readonly kind: 'group' | 'direct'
  readonly group: string
  readonly topic: string
}

function legacyTitleParts(title: string): LegacyTitleParts | undefined {
  if (title.startsWith('私聊 · ')) {
    const group = title.slice('私聊 · '.length).trim()
    return group === '' ? undefined : { kind: 'direct', group, topic: group }
  }
  if (!title.startsWith('群 · ')) return undefined
  const parts = title.slice('群 · '.length).split(' · ')
  const group = parts.shift()?.trim() ?? ''
  const topic = parts.join(' · ').trim()
  if (group === '' || topic === '') return undefined
  return { kind: 'group', group, topic }
}

function currentTitle(session: SessionSummary): string {
  return session.title?.trim() || session.displayTitle.trim()
}

function projectedClaim(
  session: SessionSummary,
  identity: YzjSessionIdentityProjection,
): WorkspaceSessionHierarchyClaim {
  const title = currentTitle(session)
  const parsed = legacyTitleParts(title)
  const manuallyRenamed = identity.managedTitle !== '' && title !== identity.managedTitle
  const group = identity.groupName || parsed?.group || identity.groupId
  if (identity.conversationKind === 'direct') {
    return {
      path: [{ id: `direct:${identity.accountKey}`, label: '私聊', kind: 'direct' }],
      leafLabel: manuallyRenamed ? title : group,
      aliases: [title, group],
    }
  }
  const topic = manuallyRenamed
    ? title
    : identity.topicLabel || parsed?.topic || title
  return {
    path: [{ id: identity.channelKey, label: group, kind: 'group' }],
    leafLabel: topic,
    aliases: [title, group, topic],
  }
}

/** Interpret one durable Yunzhijia identity as a generic Workspace tree claim. */
export function projectYzjSessionHierarchy(
  input: WorkspaceSessionHierarchyInput,
): WorkspaceSessionHierarchyClaim | undefined {
  const { session, workspace } = input
  const identity = session.projectionValues?.yzjSessionIdentity
  if (identity !== undefined && identity !== null) return projectedClaim(session, identity)

  const isGatewayWorkspace = /[/\\]yzj-agent[/\\]workspace[/\\]?$/.test(workspace.path)
  if (!isGatewayWorkspace || !session.id.startsWith('session-yzj-')) return undefined
  return {
    path: [{ id: 'yzj:legacy', label: '历史会话', kind: 'legacy' }],
    leafLabel: currentTitle(session),
    aliases: [currentTitle(session)],
  }
}
