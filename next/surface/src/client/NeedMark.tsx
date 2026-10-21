/**
 * 「要你」只有一种长相 (律二)：一颗带晕的琥珀点。哪一面要说「这件在等你」，就摆这一颗。
 */

import type { ReactNode } from 'react'
import css from './need.module.css'

export function NeedMark(props: { className?: string | undefined; label?: string | undefined }): ReactNode {
  const { className, label } = props
  return (
    <span
      className={className === undefined ? css.mark : `${css.mark} ${className}`}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    />
  )
}
