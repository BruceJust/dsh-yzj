/**
 * 选一个人 —— **一次选中，不是一串字**。
 *
 * 这套界面里凡是「哪位同事」的地方，此前有两种写法，而两种都在造假身份：
 *
 * - 立目标的 owner 框收自由文本，然后把**名字当成 openId** 写进账本。通讯录里有五位
 *   李婷，在那种记法里她们是同一个人——而这条承诺日后归谁、谁看得见、谁能修，全靠
 *   这个 id；
 * - 移交那两个框反过来，要求人**手打一个 openId**。没有人背得下同事的 openId，所以
 *   它要么没人用，要么被贴进一个错的——而错的 openId 不会报错，它只是把这条承诺交给
 *   一个不存在的人，然后安静地待在板上。
 *
 * 两头都指向同一件事：**身份只能来自通讯录**。所以打字在这里只是搜索，落到表单上的
 * 必须是一次选中；没选中就是没选中，由每个用它的地方自己说清那意味着什么（立目标是
 * 「算我的」，移交是「交不出去」）——这个组件不替它们编默认。
 *
 * 搜的是**全组织**：群成员列表平台没有 API（三墙之一），所以「他在不在这个群」这一问
 * 我们答不了，也不假装答得了。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PersonWire, SurfaceInject } from './rpc.ts'
import css from './person.module.css'

export interface PersonPickerProps {
  inject: SurfaceInject
  /** 已经选中的那个人；`undefined` = 还没选。 */
  picked: PersonWire | undefined
  onPick(person: PersonWire | undefined): void
  placeholder: string
  /** 取消选中时那颗 chip 的 title——说清「取消」之后落到哪儿。 */
  clearTitle: string
  /** 搜不到人时补一句：没选中人，在这个场景里意味着什么。 */
  emptyTail?: string
}

export function PersonPicker(props: PersonPickerProps): ReactNode {
  const { inject, picked, onPick, placeholder, clearTitle, emptyTail } = props
  const [keyword, setKeyword] = useState('')
  const [hits, setHits] = useState<readonly PersonWire[]>([])
  const [look, setLook] = useState<'idle' | 'looking' | 'empty'>('idle')
  /** 只有最新那一次搜索可以画——慢回包会把新结果盖回旧的。 */
  const ticket = useRef(0)

  useEffect(() => {
    const word = keyword.trim()
    if (word === '' || picked !== undefined) {
      setHits([])
      setLook('idle')
      return undefined
    }
    setLook('looking')
    // 每敲一个字打一次通讯录 = 一次没人要的洪水。等手停下来再问。
    const timer = setTimeout(() => {
      ticket.current += 1
      const mine = ticket.current
      void inject.people(word).then((found) => {
        if (mine !== ticket.current) return
        setHits(found)
        setLook(found.length === 0 ? 'empty' : 'idle')
      })
    }, 220)
    return () => { clearTimeout(timer) }
  }, [inject, keyword, picked])

  if (picked !== undefined) {
    return (
      <button
        type="button"
        className={css.picked}
        title={clearTitle}
        onClick={() => { onPick(undefined) }}
      >
        {picked.name}
        {picked.department === undefined ? '' : ` · ${picked.department}`}
        <span className={css.drop}>×</span>
      </button>
    )
  }

  return (
    <>
      <input
        className={css.input}
        value={keyword}
        placeholder={placeholder}
        onChange={(event) => { setKeyword(event.target.value) }}
      />
      {look === 'looking' && <span className={css.note}>在通讯录里找…</span>}
      {/*
        **打字不等于选中了人。** 这一句必须出现：框里留着字而没选中人，落下去的是这个
        场景自己的默认，而人以为自己已经指定了。
      */}
      {look === 'empty' && (
        <span className={css.note}>
          通讯录里没有叫这个名字的人。{emptyTail ?? ''}
        </span>
      )}
      {hits.length > 0 && (
        <div className={css.hits}>
          {hits.map(person => (
            <button
              type="button"
              key={person.openId}
              className={css.hit}
              onClick={() => { onPick(person); setKeyword(''); setHits([]) }}
            >
              <b>{person.name}</b>
              <span className={css.meta}>
                {[person.department, person.jobTitle].filter(part => part !== undefined).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
