/**
 * 读不到 ≠ 没有 (界面重设计 §5.8)。
 *
 * 一次读失败如果落成空态，屏上就会出现这套系统最不该说的话：左栏「✓ 都处理完了」、
 * 承诺页「还没有承诺」、目标页「这个目标已经不在了」——每一句都像真的，人会照着它往下
 * 做。所以失败的读一律**留着上次读到的**，顶上说一句为什么；一次都没读到过，就说还没
 * 读到，而不是说没有。
 */

import type { ReactNode } from 'react'
import css from './unread.module.css'

/** 上次读到过东西：`stale`；一次都没读到：`never`。 */
export function UnreadLine(props: { readonly had: boolean; readonly className?: string | undefined }): ReactNode {
  return (
    <div className={props.className ?? css.line} role="status">
      {props.had
        ? '这会儿读不到最新的，稍后自动重试 · 下面是上次读到的'
        : '还没读到——工作台这会儿没响应，稍后自动重试'}
    </div>
  )
}

/** 第一次读回来之前：几根灰条，不是空态。空态是一句关于账的断言，而此刻还什么都不知道。 */
export function Skeleton(props: { readonly rows?: number }): ReactNode {
  return (
    <div className={css.skeleton} aria-busy="true" aria-label="正在读">
      {Array.from({ length: props.rows ?? 4 }, (_, index) => <div key={index} className={css.bar} />)}
    </div>
  )
}
