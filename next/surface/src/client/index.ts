/**
 * Browser half of the desktop workbench.
 *
 * It registers ONE `conversation.view` entry. The spike that opened this
 * segment settled why: `conversation.view` is a list slot rendered as tabs, so
 * "replacing the chat chain" was never the available shape — and weaving
 * Yunzhijia messages into the built-in Chat view is closed off at the root,
 * because chat nodes are derived from SESSION EVENTS and putting IM messages
 * there would mean writing custom durable session events, which the host's
 * cold-read whitelist forbids (F4).
 *
 * What IS reachable — and what this does — is to own a pane and render both
 * streams inside it. Same intended form (interleaved), reached without lying
 * to the session log.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { YzjConversationColumn } from './ConversationColumn.tsx'
import { YzjObjectFace } from './ObjectFace.tsx'
import { YzjPreviewOverlay } from './PreviewOverlay.tsx'
import { YzjSidebar } from './Sidebar.tsx'
import { setPreviewOpener } from './preview.ts'
import { createSurfaceInject } from './rpc.ts'

export { YzjConversationColumn, type ConversationColumnProps } from './ConversationColumn.tsx'
export { YzjSidebar, type SidebarProps } from './Sidebar.tsx'
export { YzjObjectFace, type ObjectFaceProps } from './ObjectFace.tsx'
export { YzjBoard, type BoardProps } from './Board.tsx'
export { YzjGoalPage, type GoalPageProps } from './GoalPage.tsx'
export { ArtifactCard, type ArtifactCardProps } from './ArtifactCard.tsx'
export { ArtifactPreview, type ArtifactPreviewProps } from './PreviewPanel.tsx'
export { YzjPreviewOverlay, type PreviewOverlayProps } from './PreviewOverlay.tsx'
export { artifactRefOf, type ArtifactEdge } from './artifacts.ts'
export { parseDelimited, separatorFor } from './delimited.ts'
export {
  closePreview, leaveImmersive, openPreview, previewSnapshot, setPreviewStage, subscribePreview,
  extensionOf, fileIdOfUri, safeHref, setAsidePreviewHost, sizeLabel,
  attachmentState, rememberAttachment, retryAttachment, useAttachmentBody,
  type ArtifactRef, type PreviewStage, type PreviewTarget,
} from './preview.ts'
export { currentFrame, setFrame, subscribeFrame, type Frame } from './store.ts'
export { CardRow, type CardRowProps } from './CardRow.tsx'
export { avatarOf, buildStream, clockOf, type StreamRow, type WorkStep } from './stream.ts'
export {
  createSurfaceInject,
  type FusedWindowWire, type SurfaceInject, type TopicChipWire,
  type TopicDescriptorWire, type TopicMessageWire, type TreeWire,
} from './rpc.ts'

export const inject = ['slots', 'connection', 'sessions', 'workspaces', 'layout']

export function apply(ctx: ClientContext): void {
  const layout = ctx.get('layout') as { openDetails?(): void } | undefined
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const surfaceInject = createSurfaceInject(connection)

  /*
    并排预览要让右栏出现,而按下「预览」的地方——中栏的一条消息、板上一条产出
    行——离这只手隔着五六层 props。装配处交代一次,比把一个跟消息毫无关系的
    回调一路往下传干净。

    只能 open,不能定宽:`ctx.layout` 给的就是 open/close 两个动词。宽度是宿主
    的抽屉(300–520,中栏 ≥640 拖不破),更宽的需求走沉浸态——设计里那条
    「更宽的需求走沉浸态,分隔线不必覆盖全区间」正好落在这道边界上。
  */
  setPreviewOpener(() => { layout?.openDetails?.() })
  const sessions = ctx.get('sessions') as {
    open?(id: string): void
    binding?(id: string): {
      session?: {
        prompt?(content: unknown[], mode: 'queue' | 'steer'): Promise<{ ok: boolean }>
        rename?(title: string): Promise<{ ok: boolean; error?: { message?: string } }>
      }
    } | undefined
    fork?(opts: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>
  } | undefined
  /**
   * The host's workspace runtime. `list` is a snapshot store, not a getter —
   * the sidebar reads it per render so a directory opened just now appears
   * without a reload.
   */
  const workspaces = ctx.get('workspaces') as {
    startSession?(workspaceId?: string): void
    list?: {
      getSnapshot?(): {
        items?: { workspaceId: string; title: string; path: string; sessionIds?: string[] }[]
        /** Registry-global archive set: hidden from every grouping surface. */
        archivedSessionIds?: string[]
      }
    }
    create?(input: { path: string }): Promise<{ workspaceId: string }>
    pickDirectory?(): Promise<string | null>
    archiveSession?(sessionId: string): Promise<void>
    listDirectory?(path?: string): Promise<{
      path: string
      home: string
      crumbs: { name: string; path: string }[]
      entries: { name: string; path: string; hidden: boolean }[]
      truncated: boolean
    }>
  } | undefined

  /**
   * The browsing region of the left column, replacing the host's workspace
   * list.
   *
   * It shadows `sidebar.workspaces` — the region — rather than `sidebar` — the
   * whole column. Two reasons, and the second is the load-bearing one:
   *
   * - what is wrong for this product is the QUESTION the workspace list
   *     answers ("which folder is this session in"), not the column around it;
   * - a slot's children are declared by whoever occupies it, and declaring is
   *     claiming. Shadowing the column would leave `sidebar.settings` declared
   *     by an entry that no longer renders — quietly taking away a seat that
   *     was never ours. Replacing the region leaves every other seat intact.
   */
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      // Ascending rank, lowest renders: below the host's default 0.
      priority: -1,
      inject: () => ({ inject: surfaceInject }),
    },
    props => YzjSidebar({
      inject: props.inject,
      useSessions: props.useSessions as never,
      open: (id: string) => { sessions?.open?.(id) },
      startSession: (workspaceId?: string) => { workspaces?.startSession?.(workspaceId) },
      /**
       * The three verbs a session row owns, wired exactly where the host's own
       * workspace browser wires them — rename through the session's face, fork
       * and archive through their services. Replacing the browsing region took
       * these away from the operator; putting them back is not an addition.
       */
      sessionActions: {
        rename: async (id: string, title: string) => {
          const face = sessions?.binding?.(id)?.session
          if (face?.rename === undefined) throw new Error('这个会话不能重命名')
          const result = await face.rename(title)
          if (result.ok === false) throw new Error(result.error?.message ?? '重命名失败')
        },
        ...(sessions?.fork === undefined
          ? {}
          : {
            fork: async (id: string) => {
              const child = await sessions.fork?.({ sessionId: id, increaseTitle: true })
              if (child !== undefined) sessions.open?.(child)
            },
          }),
        ...(workspaces?.archiveSession === undefined
          ? {}
          : { archive: async (id: string) => { await workspaces.archiveSession?.(id) } }),
      },
      workspaces: {
        items: (workspaces?.list?.getSnapshot?.().items ?? []).map(entry => ({
          id: entry.workspaceId,
          title: entry.title,
          path: entry.path,
          sessionIds: entry.sessionIds ?? [],
        })),
        archivedSessionIds: workspaces?.list?.getSnapshot?.().archivedSessionIds ?? [],
        ...(workspaces?.listDirectory === undefined
          ? {}
          : {
            listDirectory: async (path?: string) => (
              await workspaces.listDirectory?.(path) ?? undefined
            ),
          }),
        ...(workspaces?.pickDirectory === undefined
          ? {}
          : {
            pickDirectory: async () => await workspaces.pickDirectory?.() ?? null,
          }),
        ...(workspaces?.create === undefined
          ? {}
          : {
            create: async (path: string) => {
              const created = await workspaces.create?.({ path })
              return created === undefined ? undefined : { id: created.workspaceId }
            },
          }),
      },
    }),
  ))

  /**
   * The center column, replacing the host's conversation surface entirely.
   *
   * The cost is deliberate and total: the harness's chat and trajectory views,
   * its composer, and every seat they declared go with it. "一个话题一个窗口"
   * is the design's first criterion, and a fused timeline living as one tab
   * beside the unfused one is a claim the product does not actually make.
   *
   * What is NOT duplicated is data. The conversation nodes still come from the
   * host's own snapshot — rendered here, stored nowhere — so the work block is
   * an entry into that detail rather than a second copy of it (§2).
   */
  ctx.slots.inject('conversation', () => ctx.slots.register(
    {
      name: 'conversation',
      priority: -1,
      inject: () => ({ inject: surfaceInject }),
    },
    props => YzjConversationColumn({
      ...(props.sessionId === undefined ? {} : { sessionId: props.sessionId }),
      useSession: props.useSession as never,
      inject: props.inject,
      prompt: async (id, text, mode) => {
        const face = sessions?.binding?.(id)?.session
        if (face?.prompt === undefined) return '这个会话不可输入'
        const result = await face.prompt([{ type: 'text', text }], mode)
        return result?.ok === false ? '发送失败' : undefined
      },
      openSession: (id: string) => { sessions?.open?.(id) },
      // The object face is part of the workbench, not an occasional inspector,
      // so the column opens with the workbench. Called from the column's own
      // mount rather than at plugin apply: the panel actions are not wired
      // until the root entry has mounted.
      openDetails: () => { layout?.openDetails?.() },
    }),
  ))

  /**
   * The right column: what the flow has deposited as things. It replaces the
   * host's tool-details panel, which has nothing to show now that the tool
   * rows it indexed live inside our own work blocks.
   */
  ctx.slots.inject('details', () => ctx.slots.register(
    {
      name: 'details',
      priority: -1,
      inject: () => ({ inject: surfaceInject }),
    },
    props => YzjObjectFace({
      ...(props.sessionId === undefined ? {} : { sessionId: props.sessionId }),
      inject: props.inject,
      // 右栏也要能指路：事件枢纽通向挂在会上的那件活正在干的话题。
      openSession: (id: string) => { sessions?.open?.(id) },
    }),
  ))

  /**
   * 沉浸阅读的那一层 (v4.11 第三态).
   *
   * `shell.overlay` 是 list 槽——**加座,不是顶替**:注册进去不会挤掉别人已经
   * 放在这层的任何东西(而上面三个注册都是顶替,各自付了代价)。它铺在整框
   * 之上、在三列各自的滚动容器之外,这正是全屏深读需要的位置:自己撑一个
   * 全屏容器,或者让右栏长到整屏,都得和宿主的三列网格打架。
   */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay',
      id: 'yzj-artifact-preview',
      inject: () => ({ inject: surfaceInject }),
    },
    props => YzjPreviewOverlay({ inject: props.inject }),
  ))
}
