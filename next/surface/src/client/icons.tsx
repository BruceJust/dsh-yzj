/**
 * 一套线性图标 —— 界面重设计 §6.3.
 *
 * 此前屏上是 emoji 与字符混用：✋ ✓ ● ◫ ⌂ ▢ ⚡ ↗ ‹ ⌄。emoji 不受 token 管，暗色下颜色
 * 失控；字符的基线和粗细跟着当时解析到的字体走，换个平台就换个样子；而且一个符号
 * 身兼数职（⚡ 一度有六种意思）。一个记号只许有一个意思，所以它们收在这一处：16px、
 * 描边 1.6、圆头，颜色永远是 `currentColor`——由所在的那一行决定，不由图标决定。
 */

import type { ReactNode } from 'react'

const PATHS = {
  search: <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></>,
  check: <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />,
  chevR: <path d="M6 3.5 10.5 8 6 12.5" />,
  chevD: <path d="M3.5 6 8 10.5 12.5 6" />,
  chevL: <path d="M10 3.5 5.5 8 10 12.5" />,
  plus: <path d="M8 3v10M3 8h10" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  list: <><path d="M6.5 4.5h6.5M6.5 8h6.5M6.5 11.5h6.5" /><path d="M3 4.5h.5M3 8h.5M3 11.5h.5" /></>,
  folder: <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />,
  hash: <path d="M6.5 2.5 5 13.5M11 2.5 9.5 13.5M2.8 6h10.7M2.5 10h10.7" />,
  lock: <><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>,
  user: <><circle cx="8" cy="5.6" r="2.6" /><path d="M3 13.5c0-2.6 2.2-4.3 5-4.3s5 1.7 5 4.3" /></>,
  users: <><circle cx="6" cy="5.8" r="2.3" /><path d="M2 13c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6" /><circle cx="11.3" cy="6.4" r="1.8" /><path d="M11.2 9.5c1.7 0 2.8 1.2 2.8 3" /></>,
  more: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />,
  ext: <path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5" />,
  undo: <path d="M5 4 2.5 6.5 5 9M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7" />,
  clock: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.3" /></>,
  cols: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M8 3v10" /></>,
  bolt: <path d="M9 1.8 3.8 9h4l-1 5.2L12.2 7h-4z" />,
  at: <><circle cx="8" cy="8" r="2.5" /><path d="M10.5 8v1a1.8 1.8 0 0 0 3.5 0V8a6 6 0 1 0-2.4 4.8" /></>,
  doc: <><path d="M4 2.5h5l3 3V13a.5.5 0 0 1-.5.5h-7.5A.5.5 0 0 1 3.5 13V3a.5.5 0 0 1 .5-.5z" /><path d="M9 2.5V5.5h3M5.5 8.5h5M5.5 11h3.5" /></>,
  sheet: <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M2.5 6.5h11M2.5 10h11M6.5 6.5v7" /></>,
  file: <><path d="M4 2.5h5l3 3V13a.5.5 0 0 1-.5.5h-7.5A.5.5 0 0 1 3.5 13V3a.5.5 0 0 1 .5-.5z" /><path d="M9 2.5V5.5h3" /></>,
  image: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><circle cx="6" cy="6.5" r="1.2" /><path d="m3 12 3.5-3.5 2.5 2.5 1.5-1.5L13 12" /></>,
  calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>,
  target: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.5" /></>,
  local: <><rect x="2.5" y="3" width="11" height="8" rx="1.2" /><path d="M5.5 13.5h5M8 11v2.5" /></>,
  steps: <path d="M3 4.5h10M3 8h7M3 11.5h4" />,
  send: <path d="M2.5 8 13.5 3 10 13.5 7.5 9z M7.5 9 13.5 3" />,
  keyboard: <><rect x="1.5" y="4" width="13" height="8.5" rx="1.5" /><path d="M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 10h6" /></>,
  sun: <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></>,
  eyeOff: <><path d="M2 8s2.2-4 6-4c1.1 0 2 .3 2.9.8M14 8s-2.2 4-6 4c-1.1 0-2.1-.3-2.9-.8" /><path d="M3 13 13 3" /></>,
  pause: <path d="M6 4v8M10 4v8" />,
  redo: <path d="M11 4l2.5 2.5L11 9M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3" />,
  smile: <><circle cx="8" cy="8" r="5.5" /><path d="M5.8 9.6c.6.8 1.3 1.1 2.2 1.1s1.6-.3 2.2-1.1M6 6.4h.01M10 6.4h.01" /></>,
  copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></>,
} as const

export type IconName = keyof typeof PATHS

export function Icon(props: { name: IconName; size?: number; className?: string | undefined; title?: string | undefined }): ReactNode {
  const { name, size = 16, className, title } = props
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title === undefined ? 'true' : undefined}
      role={title === undefined ? undefined : 'img'}
      style={{ flex: 'none' }}
    >
      {title === undefined ? null : <title>{title}</title>}
      {PATHS[name]}
    </svg>
  )
}

/**
 * agent 的唯一形象：渐变底上一颗四角星。
 *
 * 它此前有五种叫法、两种头像（「AI」字块与灰底）。一个会说话的东西只该有一张脸。
 */
export function AgentFace(props: { size?: number; className?: string | undefined }): ReactNode {
  const { size = 28, className } = props
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        width: size, height: size, flex: 'none', borderRadius: '50%',
        background: 'var(--yzj-agent)', color: 'var(--yzj-on-color)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg viewBox="0 0 16 16" width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} fill="currentColor">
        <path d="M8 1.5c.6 3.2 2 4.6 6.5 6.5C10 9.9 8.6 11.3 8 14.5 7.4 11.3 6 9.9 1.5 8 6 6.1 7.4 4.7 8 1.5z" />
      </svg>
    </span>
  )
}
