/**
 * 一个人的脸 —— **有真的就画真的，没有才画缩写**。
 *
 * 这一格此前有三份各自的实现（会话列表、群视图、话题流），而只有会话列表那份记得平台
 * 给得出真人头像。另外两份一律画名字缩写——于是一旦显示名退回成 openId（通讯录那一趟
 * 没问成时的兜底），屏幕上出现的就是**一个数字**：它不是谁的缩写，只是一串 id 的第一位。
 *
 * 收成一份的理由不是整洁：三份里有两份漏了同一件事，而它们看起来都「正常工作」。
 *
 * 两条纪律写在这里：
 *
 * - **拿不到头像不等于这个人没有头像**——退回缩写是降级显示，不是一句关于他的断言；
 * - **认不出是谁就画中性记号**（`avatarOf` 负责），绝不拿 id 的首位冒充人的缩写。
 */

import type { ReactNode } from 'react'
import { avatarOf } from './stream.ts'

export function Avatar(props: {
  /** 显示名。缩写与配色都从它来。 */
  name: string
  /** 真人头像。拿不到就没有这一格。 */
  photo?: string
  /**
   * 外框与图片的类名——每个面有自己的尺寸与形状，所以由调用方给。
   *
   * 可空：CSS module 的类型是 `string | undefined`（构建期才知道有没有这条规则），
   * 而这个组件不该因为那件事逼每个调用方去断言。
   */
  className: string | undefined
  photoClassName: string | undefined
  /**
   * 演示隐身档：把脸也收掉。
   *
   * 和会话列表那一份同一条——隐身要藏的是「谁在找我」的全部线索，只藏名字而留着头像，
   * 等于没藏。
   */
  hidden?: boolean
}): ReactNode {
  const { name, photo, className, photoClassName, hidden } = props
  const face = avatarOf(name)
  return (
    <span className={className} style={{ background: face.color }}>
      {photo === undefined || hidden === true
        ? face.text
        : (
          <img
            className={photoClassName}
            src={photo}
            alt=""
            /*
              取不到就退回缩写，而不是留一个碎图标。
              头像是 CDN 上的东西，它挂掉是网络的事，不该在别人的名字旁边留一个破图。
            */
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
        )}
    </span>
  )
}
