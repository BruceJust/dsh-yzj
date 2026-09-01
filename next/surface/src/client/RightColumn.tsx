/**
 * 右栏的**路由分派** —— 对象面账本律的工程本体 (v2.2 / PTD-28).
 *
 * 右栏没有自己的身份：**右栏 = f(当前会话, tab)**，切会话即整体重算。这个文件就是
 * 那个 `f` 的第一段——按当前 frame 的 kind 分派到哪一棵组件树：
 *
 * ```
 * kind = vault  → 私账证据面组件树（VaultObjectFace）
 * 其余一切会话  → 组织侧对象面组件树（ObjectFace）
 * ```
 *
 * **「组织侧右栏结构性不含私账对象」靠分派达成，不靠条件过滤**（PTD-25 同款刀法）：
 * 过滤器会被绕过——有人加一个新字段、忘记补一条 `if`，私账内容就上了组织侧的屏；
 * 而分派不会，因为 `ObjectFace` 的静态 import 图里根本没有私账组件，它**画不出来**。
 * 断言㉙ 扫的就是那张 import 图。
 *
 * 分派点自己当然两棵树都认识——那正是「分派」的意思。它是**路由**，不是任何一侧的
 * 组件树。
 *
 * 私账内容进入组织侧屏幕区域的唯一通道是**人签发的回喂显示**（后视镜条 / 条尾两读），
 * 而它们是**行内条，永不进右栏**；且整层受演示隐身档管辖（服务端在隐身档下当作没有
 * 私账层，见 `rpc.ts:pledgerDesk`）。
 */

import { useSyncExternalStore, type ReactNode } from 'react'
import type { SurfaceInject } from './rpc.ts'
import { YzjObjectFace } from './ObjectFace.tsx'
import { YzjVaultObjectFace } from './VaultObjectFace.tsx'
import { currentFrame, pushFrame, subscribeFrame } from './store.ts'

export interface RightColumnProps {
  sessionId?: string
  inject: SurfaceInject
  openSession?(sessionId: string): void
}

export function YzjRightColumn(props: RightColumnProps): ReactNode {
  const { sessionId, inject, openSession } = props
  const frame = useSyncExternalStore(subscribeFrame, currentFrame)

  if (frame.kind === 'vault') {
    return (
      <YzjVaultObjectFace
        inject={inject}
        /*
          一跳回真身 = **会话级导航**：整屏换账本，而不是在这一栏里打开组织侧的活视图。

          用 `pushFrame` 是为了 Back 回得到金库——对表的语境还在，人回得来。
        */
        {...(openSession === undefined
          ? {}
          : {
            openSession: (id: string) => {
              pushFrame({ kind: 'session' }, 0)
              openSession(id)
            },
          })}
        openGoal={(goalRef) => { pushFrame({ kind: 'goal', goalRef, goalName: goalRef }, 0) }}
      />
    )
  }

  return (
    <YzjObjectFace
      {...(sessionId === undefined ? {} : { sessionId })}
      inject={inject}
      {...(openSession === undefined ? {} : { openSession })}
    />
  )
}
