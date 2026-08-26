/**
 * 传送门的唯一一屏：选一个会话。
 *
 * 单独一个文件，因为**板和目标页都要用它**——它长在其中一个消费者体内的话，
 * 另一个要么去 import 一个组件的私处，要么自己抄一份；而抄的那一份迟早在
 * 「该不该问场所」这件事上和原件分道扬镳。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PersonWire, SurfaceInject, TreeWire } from './rpc.ts'
import { registerSeed } from './commission.ts'
import type { Errand } from './store.ts'
import css from './board.module.css'

/**
 * 谁来做 —— 两维真选择的第一维 (委派五步②).
 *
 * 只有两种执行者，而它们的差别不是「谁比较闲」：**agent 是可以被指派的，人是要被
 * 交代的**。派给 agent 的活会在群里被它接下、干完、回帖；派给人的活是一句登记话语，
 * 它确立的是一个听众集合。所以下一步问的问题也不同。
 */
type Executor =
  | { readonly kind: 'agent' }
  | { readonly kind: 'person'; readonly person: PersonWire }

/** What a portal is about to carry, while the operator picks the room. */
export interface Portal {
  /** 带过去的是目标还是一场会——两者落地后的后果不同，见 `Errand.subject`。 */
  readonly subject: 'goal' | 'event'
  readonly goalRef: string
  readonly goalName: string
  readonly voice: 'place' | 'private'
  readonly seed?: string
  readonly title: string
  readonly note: string
  /**
   * 先问**谁来做**，再问在哪儿说 —— 委派五步② 的两维真选择 (v4.21+).
   *
   * 只有委派要这一步，而且顺序不能倒过来：**执行者决定场所的选项集**。派给 agent
   * 的活只在群里说得通（它不在你和同事的私聊里干活）；派给人的活有两种说法——当着
   * 全组说是施压与透明，私下说是留余地——两种都合法，而选哪一种是社交决策。
   *
   * 不填这个字段的传送门（催／差距→委派／为此会准备）只问一件事：在哪儿说。它们的
   * 「谁」早就定了。
   */
  readonly pick?: 'executor'
}

/**
 * 选完之后，那句话的骨架该长什么样。
 *
 * 传送门把**两个只有人能定的东西**带走：谁来做、在哪儿说。骨架跟着这两个走，而内容
 * 一个字都不带——「任务内容由人说，agent 不发明委派内容」。
 */
export interface PortalChoice {
  readonly seed?: string
  readonly call?: boolean
  /** 选了人 = 登记路径的结构化先验 (v3.15 裁决④)。 */
  readonly register?: { readonly openId: string; readonly name: string }
}

/**
 * 传送门落地时交出去的那件差事 —— **一份实现**。
 *
 * 三个消费者（板、目标页、事件枢纽）此前各拼各的 errand，而它们拼的是同一件事。
 * 这种重复不会报错，只会在某一次改动之后开始各说各话——「两级缩放各写各的句子」
 * 那个裂缝刚补过一次，不必再长一个。
 *
 * 选择盖过默认：选了「交给张三」，起头就该是登记句式，而不是传送门那句泛泛的
 * 「关于目标 X：」。
 */
export function errandFor(portal: Portal, choice?: PortalChoice): Errand {
  const seed = choice?.seed ?? portal.seed
  return {
    subject: portal.subject,
    goalRef: portal.goalRef,
    goalName: portal.goalName,
    voice: portal.voice,
    ...(seed === undefined ? {} : { seed }),
    ...(choice?.call === true ? { call: true } : {}),
    ...(choice?.register === undefined ? {} : { register: choice.register }),
  }
}

/**
 * 传送门的唯一一屏：选一个会话。
 *
 * Everything else a delegation needs — who, what, by when — is said in the
 * conversation, in the operator's own words. This asks only the one thing that
 * cannot be derived and must not be guessed: WHERE. 场所是委派话语的一等参数，
 * 人选不推导 (§1.6).
 *
 * The list is conversations, not groups, because a commitment breathes in a
 * window: the registration card lands there, the receipt is read there, and the
 * board's 「打开」 hops back to it. A place with no conversation yet is shown
 * with the reason rather than hidden — an empty list that does not say why is
 * indistinguishable from a broken one.
 */
export function RoomPicker(props: {
  portal: Portal
  inject: SurfaceInject
  close(): void
  go(sessionId: string, choice?: PortalChoice): void
}): ReactNode {
  const { portal, inject, close, go } = props
  const [tree, setTree] = useState<TreeWire | undefined>(undefined)
  const [filter, setFilter] = useState('')
  /*
    ① 谁来做 —— 只有委派问这一步 (委派五步②).

    `undefined` 是「还没选」，不是「没人」：这一屏在选定之前不该显示任何场所，因为
    **场所的选项集由执行者决定**，先摆出来的那一份必然是猜的。
  */
  const [executor, setExecutor] = useState<Executor | undefined>(undefined)
  const needsExecutor = portal.pick === 'executor' && executor === undefined
  /*
    没有合适的场所时，可以**当场造一个** (设计 v4.18「新建专项群」格).

    这一格是这样长出来的：选场所这一屏此前默认「合适的听众集合已经存在」，而一个刚
    定下来的目标最常见的情形恰恰是**还没有它自己的群**。缺了这一格，人要跳出去、在
    云之家建群、回来、刷新、再选——四步搬运，而其中三步是纯损耗。

    但它不能做成「顺手就建」：建群是**创造一个新的听众集合**，从此这批人听得见这里的
    每一句话。所以它是一张要填的表、要按的签发键，而不是列表里一个一点就有的选项。
  */
  const [minting, setMinting] = useState(false)

  useEffect(() => { void inject.tree().then(setTree) }, [inject])

  const all = (tree?.places ?? []).map(entry => ({
    placeKey: entry.place.placeKey,
    groupName: entry.place.groupName,
    /** `yzj-dm-` 是私聊。场所的**种类**决定这句话会让谁听见，所以它不是装饰。 */
    direct: entry.place.placeKey.startsWith('yzj-dm-'),
    topics: entry.topics.filter(topic => (
      filter.trim() === ''
      || topic.label.includes(filter.trim())
      || entry.place.groupName.includes(filter.trim())
    )),
  })).filter(entry => entry.topics.length > 0)

  /*
    场所的选项集由执行者决定 (委派五步②)。

    - **派给 agent**：只有群。它不在你和某个同事的私聊里干活——那间屋子里没有它，
      一句话发过去谁都不会应。
    - **派给人**：两种都合法，而它们是**两句不同的话**——当着全组说是施压与透明，
      私下说是留余地。所以私聊不是被过滤掉的次等选项，它和群并列。

    与那个人的私聊按名字认：平台不给「这个私聊的对面是谁」的字段，而私聊场所的名字
    就是对面那个人。认不出来不假装认得——下面那一段会如实说没有。
  */
  const groups = all.filter(entry => !entry.direct)
  const theirDm = executor?.kind === 'person'
    ? all.filter(entry => entry.direct && entry.groupName === executor.person.name)
    : []
  const places = executor?.kind === 'person' ? [...theirDm, ...groups] : groups

  /** 选完之后那句话的骨架：受话 + 句式，内容一个字都不带。 */
  const choice = (): PortalChoice | undefined => {
    if (executor === undefined) return undefined
    return executor.kind === 'agent'
      // 派给 agent：骨架就是受话本身，做什么由人说。
      ? { call: true }
      : {
        call: true,
        seed: registerSeed(executor.person.name),
        // 选了人，这句话就是在登记他的承诺——分类在这一刻定，不必等群里跑一次 turn。
        register: { openId: executor.person.openId, name: executor.person.name },
      }
  }

  if (needsExecutor) {
    return (
      <div className={css.mask} onClick={close}>
        <div
          className={css.sheet}
          role="dialog"
          aria-label={portal.title}
          onClick={(event) => { event.stopPropagation() }}
        >
          <div className={css.sheetHead}>
            <span className={css.sheetTitle}>① 谁来做？</span>
            <button type="button" className={css.sheetClose} onClick={close} aria-label="关闭">×</button>
          </div>
          <div className={css.sheetNote}>
            {portal.subject === 'event' ? '这场会' : '目标'}：<b>{portal.goalName}</b>
            <br />
            先定人，再定在哪儿说——<b>执行者决定场所的选项集</b>：派给 agent 的活只在群里说得通，
            派给人的活公开说与私下说是两句不同的话。
          </div>
          <button
            type="button"
            className={css.execPick}
            onClick={() => { setExecutor({ kind: 'agent' }) }}
          >
            🤖 交给 agent 做
            <span className={css.execNote}>它在群里接单、回帖、交付；私聊里没有它</span>
          </button>
          {/*
            **第②层：近处候选，每个带出处**（v4.24 选项集三层）。

            此前这一格只有两层——agent 恒首位，然后直接掉进全组织通讯录搜索。于是最常见
            的那次委派（就是刚才那个目标里的那个人）也要重新打一遍名字，而**打字是在重新
            回忆一件系统已经知道的事**。

            出处是硬要求：一个说不出自己为什么在这里的候选，和「系统觉得你想找谁」没有
            区别，而后者正是「人选不推导」禁止的东西。候选只缩小选项集——搜索那一层
            始终在，谁都没被挡住。
          */}
          <NearbyExecutors
            inject={inject}
            {...(portal.subject === 'goal' ? { goalRef: portal.goalRef } : {})}
            pick={person => { setExecutor({ kind: 'person', person }) }}
          />
          <ExecutorSearch inject={inject} pick={person => { setExecutor({ kind: 'person', person }) }} />
          <div className={css.sheetFoot}>
            <span className={css.sheetHint}>
              选完直接传送——这不是一张表单：要做什么、什么时候前，都在会话里用你自己的话说。
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={css.mask} onClick={close}>
      <div
        className={css.sheet}
        role="dialog"
        aria-label={portal.title}
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.sheetHead}>
          <span className={css.sheetTitle}>
            {executor === undefined ? portal.title : '② 在哪儿说？'}
          </span>
          <button type="button" className={css.sheetClose} onClick={close} aria-label="关闭">×</button>
        </div>
        <div className={css.sheetNote}>
          {/* 一场会不是一个目标。标签跟着东西走，不跟着组件走。 */}
          {portal.subject === 'event' ? '这场会' : '目标'}：<b>{portal.goalName}</b>
          {executor !== undefined && (
            <>
              {' · '}
              {executor.kind === 'agent' ? '交给 agent' : `交给 ${executor.person.name}`}
              {/* 选错了人不该只能关掉重来——两维里的第一维要回得去。 */}
              <button
                type="button"
                className={css.execBack}
                onClick={() => { setExecutor(undefined) }}
              >
                换个人
              </button>
            </>
          )}
          <br />
          {executor === undefined
            ? portal.note
            : executor.kind === 'agent'
              ? 'agent 在群里接单——挑一个它在岗的群，这句话说出去就是一次公开委派。'
              : '当着全组说是施压与透明，私下说是留余地——两种都合法，这个选择不该由系统替你做。'}
        </div>
        <input
          className={css.input}
          value={filter}
          autoFocus
          placeholder="过滤群或话题…"
          onChange={(event) => { setFilter(event.target.value) }}
        />
        <div className={css.rooms}>
          {tree === undefined
            ? <div className={css.goalEmpty}>正在读会话…</div>
            : places.length === 0
              ? (
                <div className={css.goalEmpty}>
                  没有可跳进去的话题。
                  {' '}
                  承诺是在<b>话题</b>里呼吸的——先在群里 @ 一句让话题长出来，再回来委派。
                </div>
              )
              : places.map(entry => (
                <div className={css.roomGroup} key={entry.placeKey}>
                  <div className={css.roomPlace}>
                    {entry.groupName}
                    {/*
                      **这句话会让谁听见**，写在场所名旁边而不是等人自己推断。
                      公开登记与私下登记是两句不同的话，而它们在列表里长得一模一样。
                    */}
                    {executor?.kind === 'person' && (
                      <span className={css.roomKind}>
                        {entry.direct ? '私下登记 · 只有你和 TA' : '公开登记 · 全群可见'}
                      </span>
                    )}
                    {executor?.kind === 'agent' && (
                      <span className={css.roomKind}>公开委派 · 全群可见</span>
                    )}
                  </div>
                  {entry.topics.map(topic => (
                    <button
                      type="button"
                      className={css.room}
                      key={topic.sessionId}
                      onClick={() => { go(topic.sessionId, choice()) }}
                    >
                      {topic.label}
                    </button>
                  ))}
                </div>
              ))}
          {/*
            和这个人**还没有过私聊**时，如实说。

            私下登记这条路此刻走不通，理由是「那间屋子还不存在」——而这是可以自己动手
            解决的（去云之家私聊一句），所以说清楚比把这一格藏起来有用。藏起来的后果是
            人以为这个产品只支持公开登记。
          */}
          {executor?.kind === 'person' && theirDm.length === 0 && (
            <div className={css.goalEmpty}>
              和 <b>{executor.person.name}</b> 还没有过私聊，所以「私下登记」这条路暂时没有落点——
              先在云之家给 TA 发一句，话题长出来之后就会出现在这里。
            </div>
          )}
          {/*
            尾项，不是首项。

            一屏之内「造一个新的」永远排在「用现成的」后面：默认该是复用一个已经存在的
            听众集合，新建是那个默认不成立时才走的路。
          */}
          {tree !== undefined && !minting && (
            <button
              type="button"
              className={css.roomNew}
              onClick={() => { setMinting(true) }}
            >
              ＋ 新建专项群 —— 没有合适的场所时
            </button>
          )}
        </div>
        {minting && (
          <NewPlace
            portal={portal}
            inject={inject}
            cancel={() => { setMinting(false) }}
          />
        )}
        <div className={css.sheetFoot}>
          <span className={css.sheetHint}>
            {portal.subject === 'event'
              ? '跳过去之后 composer 会带着这场会的提示——句子由你说，发出去才算数；这一步不给话题装载任何语境。'
              : '跳过去之后 composer 会带着目标 chip——句子由你说，发出去才算数。'}
          </span>
        </div>
      </div>
    </div>
  )
}


/**
 * 近处候选 —— 执行者选择的第②层。
 *
 * 三条来源**都是事实**：这个目标里已经有谁在干（已在语境）、你最近委派过谁（时间事实）。
 * 设计里还有第三条「当前场所成员（在场事实）」，而**平台没有群成员列表 API**（三墙之
 * 一）——拿不到就不摆，不假装有。
 *
 * 一个候选都没有时**整格消失**，不留一句「暂无候选」：第一次用这个产品的人本来就没有
 * 近处，那不是缺失。
 */
function NearbyExecutors(props: {
  inject: SurfaceInject
  goalRef?: string
  pick(person: PersonWire): void
}): ReactNode {
  const { inject, goalRef, pick } = props
  const [rows, setRows] = useState<readonly { openId: string; name: string; why: string }[]>([])

  useEffect(() => {
    void inject.delegateCandidates(goalRef).then(setRows)
  }, [inject, goalRef])

  if (rows.length === 0) return null
  return (
    <div className={css.rooms}>
      {rows.map(row => (
        <button
          type="button"
          className={css.room}
          key={row.openId}
          onClick={() => { pick({ openId: row.openId, name: row.name }) }}
        >
          {row.name}
          {/* 出处就印在候选上：它凭什么在这里，人一眼看得见，也就一眼能否掉。 */}
          <span className={css.roomWhy}>{row.why}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * 按名字找那个人 —— 两维真选择的第一维。
 *
 * 搜的是**全组织通讯录**：群成员列表平台没有 API（三墙之一），所以搜不出「这个人在
 * 不在那个群」。那一问由选场所的人自己知道，界面如实说明，不假装校验过。
 *
 * 和建群那一格是同一份搜索纪律（单调票号：后发先至的旧回包不许覆盖新的），但**不共用
 * 一份实现**——那一格选的是一群人、这一格选的是一个人，合并之后第一次改动就会在
 * 「选完之后要不要继续留在列表里」这件事上分道扬镳。
 */
function ExecutorSearch(props: {
  inject: SurfaceInject
  pick(person: PersonWire): void
}): ReactNode {
  const { inject, pick } = props
  const [keyword, setKeyword] = useState('')
  const [found, setFound] = useState<PersonWire[]>([])
  /** 通讯录读不了时宿主的原话；空串 = 读得动。 */
  const [broken, setBroken] = useState('')
  const ticket = useRef(0)

  useEffect(() => {
    const query = keyword.trim()
    if (query === '') { setFound([]); return undefined }
    const mine = ticket.current + 1
    ticket.current = mine
    const timer = setTimeout(() => {
      void inject.people(query).then((result) => {
        if (ticket.current !== mine) return
        setFound(result.people)
        // 读不了 ≠ 没有：把一次故障说成「没搜到这个名字」，人会照着假答案往下做。
        setBroken(result.error ?? '')
      })
    }, 220)
    return () => { clearTimeout(timer) }
  }, [keyword, inject])

  return (
    <>
      <input
        className={css.input}
        value={keyword}
        placeholder="或者交给一个人——按名字找…"
        onChange={(event) => { setKeyword(event.target.value) }}
      />
      {found.length > 0 && (
        <div className={css.rooms}>
          {found.map(person => (
            <button
              type="button"
              className={css.room}
              key={person.openId}
              onClick={() => { pick(person) }}
            >
              {person.name}
              {person.department === undefined ? '' : ` · ${person.department}`}
            </button>
          ))}
        </div>
      )}
      {keyword.trim() !== '' && found.length === 0 && broken === '' && (
        <div className={css.goalEmpty}>通讯录里没搜到这个名字。</div>
      )}
      {broken !== '' && (
        <div className={css.goalEmpty}>通讯录读不了（{broken}）——这不等于没有这个人。</div>
      )}
    </>
  )
}

/**
 * 新建一个专项群 —— 一次主权时刻，同时裁三件事 (设计 v4.18).
 *
 * 建群 = **创造一个新的听众集合**。从此这批人听得见这里说的每一句话，而这件事没有
 * 撤销键：群可以解散，谁在那段时间里听见了什么收不回来。所以它长成一张要填的表、
 * 一枚要按的签发键，而不是列表里一个一点就有的选项——**摩擦刀的用法**：平台让建群
 * 变容易了，而建群的难度本来在保护听众集合，所以设计的动向是把新能力放进门里。
 *
 * 三件事一次裁完，因为它们是同一个决定的三个面：
 *
 * - **谁听得见**（群名 + 成员）；
 * - **agent 在不在岗**（「接入」勾选）——合同默认最严是**系统的**默认，不是不许人在
 *   签发的同一刻一并开启；专项群默认勾上，因为它存在的理由就是让 agent 在这儿干活；
 * - **它从哪句话里长出来**（出生血缘，表上不出现——它由发起这次传送门的语境自动携带）。
 *
 * 不勾「接入」也可以，但**代发之前要警示**：agent 听不见这个群，登记卡发过去没有人
 * 接收回执。出生要有呼吸，而呼吸包括**回执可达**——一条落了库却没人应答得了的承诺，
 * 正是幽灵承诺换了个形状。
 *
 * **建完不自动跳进去**，这是一处如实的缺口而不是设计取舍：新群里一条消息都没有，
 * 因而没有话题可跳；能说话的地方是它的主楼，而主楼要按 `placeKey` 导航——那条路由
 * 此刻只到宿主手里（`setFrame`），传送门够不着。所以这里如实说「它会出现在会话
 * 列表里」，而不是跳去一个应用还不认识的场所然后显示一片空白。
 */
function NewPlace(props: {
  portal: Portal
  inject: SurfaceInject
  cancel(): void
}): ReactNode {
  const { portal, inject, cancel } = props
  const [name, setName] = useState(portal.subject === 'goal' ? portal.goalName : '')
  const [keyword, setKeyword] = useState('')
  const [found, setFound] = useState<PersonWire[]>([])
  /** 通讯录读不了时宿主的原话；空串 = 读得动。 */
  const [broken, setBroken] = useState('')
  const [picked, setPicked] = useState<PersonWire[]>([])
  const [serve, setServe] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ served: boolean } | undefined>(undefined)
  const [error, setError] = useState('')
  /*
    搜人是**单调的**：后发先至的那一次回包不许覆盖更新的一次。

    输入框的每一次改动都开一次搜索，而网络不保证顺序——不记票号的话，一次慢的旧查询
    回来会把新查询的结果盖掉，看起来就是「搜出来的人和我打的字对不上」。
  */
  const ticket = useRef(0)
  useEffect(() => {
    const query = keyword.trim()
    if (query === '') { setFound([]); return undefined }
    const mine = ticket.current + 1
    ticket.current = mine
    const timer = setTimeout(() => {
      void inject.people(query).then((result) => {
        if (ticket.current !== mine) return
        setFound(result.people)
        // 读不了 ≠ 没有：把一次故障说成「没搜到这个名字」，人会照着假答案往下做。
        setBroken(result.error ?? '')
      })
    }, 220)
    return () => { clearTimeout(timer) }
  }, [keyword, inject])

  const toggle = (person: PersonWire): void => {
    setPicked(current => (current.some(one => one.openId === person.openId)
      ? current.filter(one => one.openId !== person.openId)
      : [...current, person]))
  }

  if (result !== undefined) {
    return (
      <div className={css.newPlace}>
        <div className={css.newPlaceHead}>群建好了：<b>{name.trim()}</b></div>
        <div className={css.newPlaceNote}>
          {result.served
            ? 'agent 已经接入这个群，登记卡的回执有人接收。'
            /*
              这一句是这一格存在的一半理由。

              不接入就建群，登记消息发过去没有任何东西在听——承诺落了库、群里也看得见
              那句话，可**回执没有接收方**。板上会一直显示「在跟」，而它永远等不到动静。
              说清楚，并给出那条仍然走得通的路（自己盯、自己回来记）。
            */
            : '⚠️ agent **没有**接入这个群：登记卡发过去也不会有人接收回执，板上那条承诺会一直等不到动静。'
              + '要么到「场所合同」里把接单打开，要么这次自己亲发、自己回来把回执记上。'}
          <br />
          它会在下一次轮询之后出现在左边的会话列表里；委派那句话到那儿去说——句子由你说，发出去才算数。
        </div>
        <div className={css.newPlaceActions}>
          <button type="button" className={css.newPlacePrimary} onClick={cancel}>知道了</button>
        </div>
      </div>
    )
  }

  return (
    <div className={css.newPlace}>
      <div className={css.newPlaceHead}>新建专项群 —— 这会创造一个新的听众集合</div>
      <input
        className={css.input}
        value={name}
        placeholder="群名称"
        onChange={(event) => { setName(event.target.value) }}
      />
      <input
        className={css.input}
        value={keyword}
        placeholder="按名字找人加进来（2-10 人，不含你自己）…"
        onChange={(event) => { setKeyword(event.target.value) }}
      />
      {picked.length > 0 && (
        <div className={css.newPlacePicked}>
          {picked.map(person => (
            <button
              type="button"
              className={css.newPlaceChip}
              key={person.openId}
              onClick={() => { toggle(person) }}
            >
              {person.name} ×
            </button>
          ))}
        </div>
      )}
      {found.length > 0 && (
        <div className={css.newPlaceFound}>
          {found.map(person => (
            <button
              type="button"
              className={css.room}
              key={person.openId}
              onClick={() => { toggle(person) }}
            >
              {person.name}
              {person.department === undefined ? '' : ` · ${person.department}`}
              {picked.some(one => one.openId === person.openId) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
      {/* 读不了 ≠ 没有。建群这一步尤其不能糊弄：名单错了，听众集合就错了。 */}
      {broken !== '' && (
        <div className={css.newPlaceError}>通讯录读不了（{broken}）——这不等于没有这个人。</div>
      )}
      {/*
        搜的是**全组织**，不是这个群——群成员列表平台没有 API（三墙之一）。
        如实说，不假装校验过。
      */}
      <div className={css.newPlaceHint}>搜的是全公司通讯录 · 谁该进这个群，只有你知道</div>
      <label className={css.newPlaceServe}>
        <input
          type="checkbox"
          checked={serve}
          onChange={(event) => { setServe(event.target.checked) }}
        />
        接入 agent（不勾的话，发到这个群的登记卡不会有人接收回执）
      </label>
      {error !== '' && <div className={css.newPlaceError}>{error}</div>}
      <div className={css.newPlaceActions}>
        <button type="button" className={css.newPlaceGhost} onClick={cancel} disabled={busy}>取消</button>
        <button
          type="button"
          className={css.newPlacePrimary}
          disabled={busy || name.trim() === '' || picked.length < 2 || picked.length > 10}
          onClick={() => {
            setBusy(true)
            setError('')
            void inject.createPlace({
              name: name.trim(),
              members: picked.map(person => person.openId),
              serve,
              // 出生血缘：这次传送门是从哪个目标/哪场会发起的，群就从那儿长出来。
              sourceAnchor: `portal:${portal.subject}:${portal.goalRef}`,
              ...(portal.subject === 'goal' ? { goalRef: portal.goalRef } : {}),
            }).then((outcome) => {
              setBusy(false)
              if (outcome.error !== undefined) { setError(outcome.error); return }
              setResult({ served: outcome.served === true })
            })
          }}
        >
          {busy ? '正在建…' : `签发并建群（${String(picked.length)} 人）`}
        </button>
      </div>
      <div className={css.newPlaceHint}>
        按下就是签发——建群是创造一个新的听众集合，比在现成的群里挑一个更需要你点头。
      </div>
    </div>
  )
}
