/**
 * 资源 tab —— **唯一跨账本恒定格** (v2.2 对象面账本律③).
 *
 * 三个 tab 的账本归属各自恒定：
 *
 * - **当前** 跟会话走（账本随之换：组织侧会话是组织的物，金库是判例的证据）；
 * - **记忆** 是 agent 的复利（金库语境下空态明标，两本复利账不合流）；
 * - **资源** 是组织侧的全局浏览器，**在哪个账本里都是同一格**。
 *
 * 所以它必须是**同一个组件**，不是两处长得像的实现——「恒定」如果靠两份代码各自
 * 保持一致，它就只是暂时一致。断言㉙ 断的正是这一点。
 *
 * 恒定的方向是**单向**的：私账语境里看得见组织的物（操作者的可见域本来就含着它们，
 * 零泄漏），组织语境里永远看不见私账的物——**耦合单向律（图 → 金库）在显示层的投影**。
 * 这个文件因此只认组织侧的行，它的 import 图里没有任何私账的东西。
 */

import type { ReactNode } from 'react'
import type { ObjectRowWire } from './rpc.ts'
import { ArtifactCard } from './ArtifactCard.tsx'
import { artifactRefOf } from './artifacts.ts'
import css from './objects.module.css'

export interface ResourceTabProps {
  rows: readonly ObjectRowWire[]
  /** 空的时候说清为什么空——空态也要有出生故事。 */
  empty: ReactNode
}

export function ResourceTab(props: ResourceTabProps): ReactNode {
  const { rows, empty } = props
  if (rows.length === 0) return <div className={css.calm}>{empty}</div>
  return (
    <>
      {/*
        和中栏那条产出行、承诺板那个抽屉画的是同一张卡——**一个物不配两套 UI**。
        能取到字节的（agent 上传的文件）点开就在这一栏并排看，取不到的
        （云之家在线文档）给一扇门。
      */}
      {rows.map(row => (
        <ArtifactCard
          key={`${row.uri}:${String(row.time)}`}
          artifact={artifactRefOf({
            uri: row.uri, title: row.title, action: row.action, notes: [row.placeKey],
          })}
        />
      ))}
    </>
  )
}
