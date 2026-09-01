/**
 * 金库 —— **这个设计唯一新增的「面」**，而且它住在私语侧 (私账层 §7).
 *
 * 组织的图记承诺的一生（承诺板、目标枢纽），金库记**你的判断**的一生——两处永不
 * 合流。它是一次查询的投影，和承诺板同一种东西：这里没有第二本账要维护。
 *
 * 三条它必须守住的规矩：
 *
 * - **每一行既可见又可动**（金库行内动词族，v1.1 §7）。检验中能撤回、待对表能补登
 *   事实、已对表能改归因、模式能开后视镜、换挡台能换挡——一个只能读的金库，会把
 *   「回路」退化成「一个要打开的 app」，而那正是这条设计从头到尾在躲的死法。
 *   **说明文字占位同罪**：写着「可以撤回」却没有撤回按钮，和没有撤回是一回事。
 * - **已撤回区一个动词都没有.** 撤回是终态：前提消失时撤回是诚实，而诚实退出不悔棋。
 * - **五不做写在脚上.** 无分数、无排名、无画像、无建议倾向、无团队视图——故意没有
 *   的东西不说出来，看起来就只是还没做。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type {
  EvidenceFaceWire, PrivateRowWire, SurfaceInject,
  VaultCaseWire, VaultExpectationWire, VaultViewWire,
} from './rpc.ts'
import { PrivateCard } from './PrivateCard.tsx'
import tokens from './tokens.module.css'
import css from './vault.module.css'

export interface VaultProps {
  inject: SurfaceInject
  back(): void
}

const ATTRIBUTIONS: readonly { id: 'q1' | 'q2' | 'q3' | 'q4'; label: string }[] = [
  { id: 'q1', label: '对了 · 因判断' },
  { id: 'q2', label: '对了 · 因运气' },
  { id: 'q3', label: '错了 · 因判断' },
  { id: 'q4', label: '错了 · 因世界' },
]

const when = (at: number): string => new Date(at).toLocaleString('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

export function YzjVault(props: VaultProps): ReactNode {
  const { inject, back } = props
  const [view, setView] = useState<VaultViewWire | undefined>(undefined)
  const [rows, setRows] = useState<readonly PrivateRowWire[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState('')
  /** 哪一行正开着输入框：撤回理由 / 补登事实 / 立约。 */
  const [editing, setEditing] = useState<{ key: string; text: string } | undefined>(undefined)
  /**
   * 右栏此刻摆的是哪一行的证据。
   *
   * `undefined` = **默认态**：待对表首项的备料。打开金库就是**人发起的回看时刻**——
   * 持镜人条款说的「人发起」在这里有了一个确切的时刻定义，agent 此刻聚合证据合法
   * （**备料不定案**：右栏摆的是当时的话，四格仍然在中栏、仍然由你按）。
   */
  const [selected, setSelected] = useState<{ kind: 'calibration' | 'expectation'; id: string } | undefined>(undefined)
  const [evidence, setEvidence] = useState<EvidenceFaceWire | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<readonly { zone: string; id: string; text: string }[]>([])
  /** 取走生成的两份文件。**读操作**：生成前后事件流一行不增。 */
  const [takeout, setTakeout] = useState<{ casebook: string; readme: string } | undefined>(undefined)

  const reload = useCallback(async (): Promise<void> => {
    const [next, stream, face] = await Promise.all([
      inject.vault(),
      inject.privateRows(),
      selected === undefined
        ? inject.vaultEvidence()
        : inject.vaultEvidence(selected.kind, selected.id),
    ])
    setView(next)
    setRows(stream.rows)
    setEvidence(face)
  }, [inject, selected])

  useEffect(() => {
    void reload()
    // 五秒一次，和左栏同一个节拍。这里没有缓存——视图从不是真身。
    const timer = setInterval(() => { void reload() }, 5_000)
    return () => { clearInterval(timer) }
  }, [reload])

  /** 每一个写动词的同一条路：带回宿主的原话，然后重读。 */
  const run = useCallback(async (
    action: () => Promise<{ error?: string }>,
  ): Promise<void> => {
    setBusy(true)
    try {
      const result = await action()
      setError(result.error)
      if (result.error === undefined) setEditing(undefined)
      await reload()
    } finally {
      setBusy(false)
    }
  }, [reload])

  if (view === undefined) {
    return (
      <div className={`${tokens.tokens} ${css.vault}`}>
        <div className={css.head}>
          <span className={css.title}>🔒 我的判断（金库）</span>
          <button type="button" className={css.back} onClick={back}>‹ 返回</button>
        </div>
        <div className={css.body}>
          <div className={css.empty}>
            账本还没打开——云之家身份还没就绪，或者这个部署没有启用私账层。
            <br />
            <b>中途关掉不会删数据</b>：已有的目录原样保留，重开即续。销毁是唯一的删除路径，
            而它要你亲手把那句话打出来。
          </div>
        </div>
      </div>
    )
  }

  const verbButton = (
    label: string, title: string, onClick: () => void, on = false,
  ): ReactNode => (
    <button
      type="button"
      className={`${css.verb} ${on ? css.verbOn : ''}`}
      title={title}
      disabled={busy}
      onClick={onClick}
    >
      {label}
    </button>
  )

  /** 行内输入：撤回理由、补登事实、立约的赌注。**原话直存**——不预填任何内容。 */
  const inlineInput = (
    key: string, placeholder: string, submit: (text: string) => Promise<{ error?: string }>,
  ): ReactNode => (
    editing?.key === key
      ? (
        <div className={css.actions}>
          <textarea
            className={css.input}
            rows={2}
            autoFocus
            /* 产婆术：**空的**。「帮我写」只给维度，不给句子。 */
            placeholder={placeholder}
            value={editing.text}
            onChange={(event) => { setEditing({ key, text: event.target.value }) }}
          />
          {verbButton('记下', '一个字节不改地落账', () => {
            const text = editing.text.trim()
            if (text === '') return
            void run(() => submit(text))
          })}
          {verbButton('算了', '不记', () => { setEditing(undefined) })}
        </div>
      )
      : null
  )

  const expectationRow = (row: VaultExpectationWire, withdrawn: boolean): ReactNode => (
    <div key={row.expectationId}>
      <div className={css.row}>
        <span className={css.mark}>
          {withdrawn ? '↩' : row.premise === 'changed' ? '⚠' : row.zone === 'settled' ? '·' : row.due ? '⏳' : '🌱'}
        </span>
        <span className={css.rowMain}>
          「{row.text}」 · <b>
            {withdrawn
              ? '已撤回'
              : row.zone === 'settled'
                ? '未对表（已沉降）'
                : row.due ? '已过检验点，待对表' : '检验中'}
          </b>
          {/*
            **锚死显形，且只显形** (PTD-18)。

            `unknown` 不显形——组织图不可达时说一句「前提已变」是编造。而 `changed`
            给的是**双出口**，不是一个通知：撤回（诚实）或照旧对表（你说了算）。
            系统**不自动写 withdrawn**：代撤即代产。
          */}
          {row.premise === 'changed' && !withdrawn && (
            <span className={css.rowNote}>
              ⚠ <b>前提已变</b>：「{row.verdict.text}」已作废 / 已移交。
              撤回是诚实，照旧对表也完全正当——这一格由你自己下。
            </span>
          )}
          <span className={css.rowNote}>
            检验点：{row.checkpointText}
            {' · '}当时裁决：{row.verdict.text}
            {' · '}出生：{when(row.bornAt)}
            {row.asked ? ' · agent 已在私语通道问过一次结果（问一次，不再追）' : ''}
            {withdrawn && row.withdrawnReason !== undefined
              ? ` · 理由：${row.withdrawnReason}`
              : ''}
            {withdrawn
              ? ' · 撤回是终态：前提消失时撤回是诚实，不是失败'
              : ' · 不老化 · 不可催 —— 这本账的债主是你自己'}
          </span>
        </span>
        {/*
          已撤回区**一个动词都没有**，而那是一个有理由的终态，不是遗漏。
          所以这里不画一个灰按钮：灰按钮是「你不配」的展示，不渲染才是「这条路不存在」。
        */}
        <span className={css.verbs}>
          {/* 右栏归集这一行的证据。**同一屏**——对表不出屏。 */}
          {verbButton(
            '证据',
            '右栏摆开这一行的证据：摘要为主、锚为辅。边看边答，不必离开这一屏。',
            () => { setSelected({ kind: 'expectation', id: row.expectationId }) },
            selected?.kind === 'expectation' && selected.id === row.expectationId,
          )}
          {row.verbs.includes('note-fact') && verbButton(
            '补登事实',
            '图外的事实（线下评审、口头反馈、邮件结果）只能由你说——系统不猜图外',
            () => { setEditing({ key: `note:${row.expectationId}`, text: '' }) },
          )}
          {row.verbs.includes('withdraw') && verbButton(
            '撤回',
            '前提消失时撤回是诚实，不是失败。撤回留痕不删史，且同一裁决不可再立。',
            () => { setEditing({ key: `withdraw:${row.expectationId}`, text: '' }) },
          )}
          {/* 锚死显形的**第二个出口**：什么都不写——把这一行当作照旧，是你的选择。 */}
          {row.verbs.includes('settle-anyway') && verbButton(
            '照旧对表',
            '前提变了，但你的判断照旧对表——事实回流来的时候，回执照样会出',
            () => { setError('前提变了，但你的判断照旧对表——事实回流来的时候，回执照样会出。') },
          )}
        </span>
      </div>
      {inlineInput(
        `note:${row.expectationId}`,
        '后来到底怎么样了？用你自己的话说一句。',
        text => inject.noteFact({ text, expectationId: row.expectationId }),
      )}
      {inlineInput(
        `withdraw:${row.expectationId}`,
        '为什么撤回？（留空也行——前提消失本身就是理由）',
        text => inject.withdrawExpectation(row.expectationId, text),
      )}
    </div>
  )

  const caseRow = (row: VaultCaseWire): ReactNode => (
    <div key={row.calibrationId}>
      <div className={css.row}>
        <span className={css.tag}>{row.attributionLabel}</span>
        <span className={css.rowMain}>
          {row.thenText}
          <span className={css.rowNote}>
            事实：{row.fact.text}
            {' · '}对表：{when(row.at)}
            {' · '}当时裁决：{row.verdict.text}
          </span>
        </span>
        <span className={css.verbs}>
          {/*
            **对表不出屏**：证据摆在右栏，四格答在这一行上——一屏之内完成。

            把证据放进另一个页面，四格就得凭记忆答；而「凭记忆答的归因」正是这本账
            最不想收的那一种数据。
          */}
          {verbButton(
            '证据',
            '右栏摆开当时的裁决与事实快照——边看边下归因，不必离开这一屏',
            () => { setSelected({ kind: 'calibration', id: row.calibrationId }) },
            selected?.kind === 'calibration' && selected.id === row.calibrationId,
          )}
          {/* 改归因 —— 更正即追加，最新生效，史不改。 */}
          {editing?.key === `attr:${row.calibrationId}`
            ? ATTRIBUTIONS.map(cell => verbButton(
              cell.label,
              '归因由你下，我不代下',
              () => { void run(() => inject.reattribute(row.calibrationId, cell.id)) },
              cell.id === row.attribution,
            ))
            : verbButton(
              '改归因',
              '更正即追加，最新生效——这本账允许你重新看待一件旧事，不允许你假装从没那么看过',
              () => { setEditing({ key: `attr:${row.calibrationId}`, text: '' }) },
            )}
        </span>
      </div>
    </div>
  )

  /*
    私语流只画**展开态**那些。

    折进去的那几张不是被藏了——它们在归并条后面（一跳金库）；沉降的那些在「未对表」
    区。**堆积是催办的被动形态**：平铺一屏未答，会自己长出欠账感，而这本账的债主
    只有你自己。
  */
  const openRows = rows.filter(row => (
    row.zone === 'live' && (!row.resolved || row.loopback !== undefined)
  ))
  const foldedCount = rows.filter(row => row.zone === 'folded').length

  return (
    <div className={`${tokens.tokens} ${css.vault}`}>
      <div className={css.head}>
        <span className={css.title}>🔒 我的判断（金库）</span>
        <span className={css.sub}>
          第二本账 · 组织的图记承诺的一生，这里记你的判断的一生 —— 两处永不合流
        </span>
        <button type="button" className={css.back} onClick={back}>‹ 返回</button>
      </div>

      {/* 硬合同五条 + 单向耦合：一份人看不见的合同不是合同。 */}
      <div className={css.contract}>
        {view.contract.map(chip => (
          <span key={chip.label} className={css.chip} title={chip.how}>{chip.label}</span>
        ))}
      </div>

      <div className={css.body}>
        <div className={css.stream}>
        {error !== undefined && <p className={css.error}>{error}</p>}

        {/*
          金库内检索 —— **第七接缝是预留的，这里不是它** (v2.0 / #62-D10).

          主册 §7 目前没有跨会话的内容搜索面，所以私账的检索 P1 就长在金库里：
          零组织侧接缝、组织侧的索引器**结构性地不认识**这个 store。将来全局搜索面
          落座时，provider 按 viewer 注册（place 会话中**不存在**而非被过滤）。
        */}
        <div className={css.searchRow}>
          <input
            className={css.input}
            value={query}
            placeholder="在这本账里找一句话（只搜这本账 · 结果不进任何导出投影）"
            onChange={(event) => {
              const text = event.target.value
              setQuery(text)
              void inject.vaultSearch(text).then(setHits)
            }}
          />
        </div>
        {query.trim() !== '' && (
          hits.length === 0
            ? <div className={css.empty}>这本账里没有这句话。（搜的只是这本账——组织侧的检索器不认识这个存储。）</div>
            : hits.map(hit => (
              <div key={`${hit.zone}:${hit.id}`} className={css.hit}>
                <span className={css.tag}>{hit.zone}</span>
                <span>{hit.text}</span>
              </div>
            ))
        )}

        {/*
          私语流 —— 未答的立约邀约与校准回执，静躺在这里.

          它们**不进收件箱、不进决断条、不进任何徽标**（三不入），所以这里是它们在
          桌面上的另一个家。不老化、不可催、不成欠账。
        */}
        {openRows.length > 0 && (
          <>
            <div className={css.section}>
              私语流 · 未答的邀约与回执
              <span className={css.sectionNote}>
                {' '}· 不进收件箱 / 决断条 / 任何徽标 · 不老化 · 不可催
              </span>
            </div>
            {openRows.map(row => (
              <PrivateCard
                key={`${row.kind}:${row.id}`}
                row={row}
                busy={busy}
                loopback={(family, patternKey, on, gear) => run(async () => (
                  patternKey === undefined
                    ? inject.shiftGear(family, gear ?? 'weight', 'receipt')
                    : inject.toggleMirror(family, patternKey, on, 'receipt')
                ))}
                act={(actionId, input) => run(async () => {
                  const result = await inject.pledgerAct(row.kind, row.id, actionId, input)
                  /*
                    应答的**回执要原样带回来**。

                    「你不是这张卡的决策人」「这一条已经答过了」「归因可以改，撤回不
                    可悔棋」——每一句都指向不同的下一步。压成一句「失败了」，人只能猜。
                  */
                  if (result?.outcome === 'applied') return {}
                  return { error: result?.receipt ?? '这张卡没有回应。' }
                })}
              />
            ))}
            {/*
              折叠归并条 —— **是门不是徽标**：一句话 + 一次跳转，没有数字角标。

              最新一张保持展开（最近的语境不折叠），其余折进来。折起来不等于藏起来：
              这一条推开就是金库，逐级兑付合规。
            */}
            {foldedCount > 0 && (
              <div className={css.empty}>
                另有 {foldedCount} 张待对表已折起 —— 它们都在下面的六区里，
                <b>不变红、不计数、不催</b>。
              </div>
            )}
          </>
        )}

        <div className={css.section}>
          检验中的预期
          <span className={css.sectionNote}> · 立约时刻出生，不可回填、不可改笔</span>
        </div>
        {view.testing.length === 0
          ? <div className={css.empty}>{view.emptyBecause ?? '空。没有检验中的预期。'}</div>
          : view.testing.map(row => expectationRow(row, false))}

        {view.awaiting.length > 0 && (
          <>
            <div className={css.section}>
              待对表
              <span className={css.sectionNote}> · 过了检验点，等一句事实</span>
            </div>
            {view.awaiting.map(row => expectationRow(row, false))}
          </>
        )}

        <div className={css.section}>
          已对表
          <span className={css.sectionNote}> · 四格是判例的标签，不是分数的原料</span>
        </div>
        {view.settled.length === 0
          ? <div className={css.empty}>还没有已对表的判例。回执由事实回流触发——不立预期也照样会来。</div>
          : view.settled.map(caseRow)}

        {view.sunk.length > 0 && (
          <>
            <div className={css.section}>
              未对表（已沉降）
              <span className={css.sectionNote}>
                {' '}· 超过 {String(view.settleDays)} 天没对表就沉到这儿 ——
                <b>不变红、不计数、不催</b>，但**每一行仍然可动**
              </span>
            </div>
            {view.sunk.map(row => expectationRow(row, false))}
          </>
        )}

        {view.withdrawn.length > 0 && (
          <>
            <div className={css.section}>
              已撤回
              <span className={css.sectionNote}> · 只读：撤回是终态，诚实退出不悔棋</span>
            </div>
            {view.withdrawn.map(row => expectationRow(row, true))}
          </>
        )}

        {/*
          换挡台 —— **回路的合环阀** (#61).

          它从「设置页」升格成这个位置，是因为模式浮现之后必须有一条**回到下一次裁决
          时刻**的合法通道。没有它，金库就是你自己的 Viva Goals：一个要记得来查的
          目的地 app。
        */}
        <div className={css.section}>
          换挡台 · 三档位定律：租约 ← 默认 → 负重
          <span className={css.sectionNote}> · 按提案族 · 档位私有 · 回路的合环阀</span>
        </div>
        {view.gears.map(row => (
          <div key={row.family} className={css.row}>
            <span className={css.rowMain}>
              <b>{row.label}</b>（{row.what}）
              <span className={css.rowNote}>
                {row.evidence.join(' · ')}
                {row.leaseAvailable ? '' : ` · ${row.leaseNote ?? ''}`}
              </span>
            </span>
            <span className={css.verbs}>
              {(['lease', 'default', 'weight'] as const).map(gear => (
                <button
                  key={gear}
                  type="button"
                  className={`${css.verb} ${row.gear === gear ? css.verbOn : ''}`}
                  disabled={busy || (gear === 'lease' && !row.leaseAvailable)}
                  title={gear === 'lease'
                    ? row.leaseNote ?? '全自动：这类裁决不再需要你'
                    : gear === 'weight'
                      ? '负重：摆开证据、不预选、无一键通过——「你先拆，我再补」'
                      : '默认：agent 提案，人裁决'}
                  onClick={() => { void run(() => inject.shiftGear(row.family, gear, 'vault')) }}
                >
                  {gear === 'lease' ? '租约' : gear === 'weight' ? '负重' : '默认'}
                </button>
              ))}
            </span>
          </div>
        ))}

        {/* 邀约频率行 —— 疲劳治理的**唯一**恢复入口。重开主权在人。 */}
        {view.invites.map(row => (
          <div key={`inv:${row.family}`} className={css.row}>
            <span className={css.rowMain}>
              <b>立约邀约频率 · {row.label}</b>
              <span className={css.rowNote}>
                {row.quiet
                  ? `已停问（连续 ${String(row.declinedInARow)} 次不立——人用脚投票就是应答）`
                  : `照常问（连续不立 ${String(row.declinedInARow)} 次）`}
                {' · '}重新打开的主权在这里
              </span>
            </span>
            <span className={css.verbs}>
              {verbButton(
                '重新打开',
                '降频的唯一恢复动词，入口只在金库',
                () => { void run(() => inject.reopenInvites(row.family)) },
              )}
            </span>
          </div>
        ))}

        {/*
          全局日配额行 —— **扩触发面必同扩治理面**。

          族级降频治的是「这一类你不想聊」，日配额治的是「今天已经够了」。两层各管
          一件事：少了族级，你得为每一类各拒三次；少了全局，五个族各问两次就是十次。
          `0` 是合法值——一个不能被关到零的「可调」，是假的可调。
        */}
        <div className={css.row}>
          <span className={css.rowMain}>
            <b>全局日配额</b>
            <span className={css.rowNote}>
              今天已开口 {String(view.quota.usedToday)} / {String(view.quota.quota)} 次
              {' · '}扩触发面必同扩治理面：五个入口各自克制，合起来仍是骚扰
              {view.quota.quota === 0 ? ' · 现在是全关' : ''}
            </span>
          </span>
          <span className={css.verbs}>
            {[0, 1, 2, 3].map(value => (
              <button
                key={value}
                type="button"
                className={`${css.verb} ${view.quota.quota === value ? css.verbOn : ''}`}
                disabled={busy}
                title={value === 0 ? '全关邀约——这也是一个合法的答案' : `每天至多问 ${String(value)} 次`}
                onClick={() => { void run(() => inject.setQuota(value)) }}
              >
                {value === 0 ? '全关' : String(value)}
              </button>
            ))}
          </span>
        </div>

        {/*
          归因分布镜 —— **陈列是镜子，解读是教练** (v2.0 / #62-C8).

          单次归因防不住「永远选 q4」，分布能；而一旦系统替你解读分布（「你在推卸
          责任」），它就从镜子变回了教练。所以这一行**只有四个数字**：服务端那个
          查询的返回类型里一个 string 都没有，文案取自静态常量表。
        */}
        <div className={css.section}>
          归因分布 · 每个数字是门
          <span className={css.sectionNote}>
            {' '}· 近 {String(view.window.days)} 天 · 只陈列不解读——结论你自己下
          </span>
        </div>
        <div className={css.row}>
          <span className={css.rowMain}>
            {(['q1', 'q2', 'q3', 'q4'] as const).map(cell => (
              <span key={cell} className={css.tag} style={{ marginRight: 6 }}>
                {view.distribution.labels[cell]}：{String(view.distribution[cell])}
              </span>
            ))}
            <span className={css.rowNote}>
              四格防两种自欺：把运气当实力（②伪装成①）、把误判赖给世界（③伪装成④）。
            </span>
          </span>
        </div>

        <div className={css.section}>
          模式 · 每个数字是门
          <span className={css.sectionNote}>
            {' '}· 滚动派生（近 {String(view.window.days)} 天）非累积档案 —— 金库照现在的你，不给你建档案
          </span>
        </div>
        {view.patterns.length === 0
          ? (
            <div className={css.empty}>
              近 {String(view.window.days)} 天没有重复出现的判例。
              模式是**滚动派生**的：窗外的判例仍然在日志里，只是不参与这一次计数。
            </div>
          )
          : view.patterns.map(row => (
            <div key={row.patternKey} className={css.row}>
              <span className={css.mark}>⚠</span>
              <span className={css.rowMain}>
                {row.label}：<b>{String(row.count)} 次</b>
                <span className={css.rowNote}>
                  派生自你自己的判例——不是系统的意见：
                  {row.cases.slice(0, 3).map(one => ` 「${one.thenText}」→${one.factText}`).join('；')}
                  {row.mirror ? ' · 后视镜已开：该族卡片旁会亮出这些判例（仅你可见）' : ''}
                </span>
              </span>
              <span className={css.verbs}>
                {verbButton(
                  `🪞 后视镜：${row.mirror ? '开' : '关'}`,
                  '回喂环：后视镜是负重档的显示形态——你签发的私账规则，默认不开、随时可关；'
                  + 'agent 只执行显示',
                  () => { void run(() => inject.toggleMirror(row.family, row.patternKey, !row.mirror)) },
                  row.mirror,
                )}
              </span>
            </div>
          ))}

        <div className={css.refuse}>
          <b>金库五不做</b>：{view.refusals.join(' · ')}。
          <br />
          P′ 四资产里只有**判断**被机制化——表达归产婆术、品味归磨稿亲笔、志向归目标作者权、
          关系归社交摩擦不碰；品味与志向的量化**明拒**。金库只陈列判例与对表，结论你自己下。
        </div>

        {/*
          取走与销毁 —— **数据主权归人**.

          组织扣押成长账本就是 Org–P–Org′。所以「在哪儿」必须说得出来，「删掉」必须
          做得到，而且是两段式：不可逆的终态由人签发，签发要有一次真的动作。
        */}
        <div className={css.destroy}>
          <div className={css.section}>取走与销毁</div>
          <div className={css.empty}>
            这本账在：<code>{view.directory ?? '（还没打开）'}</code>
            <br />
            <b>目录自包含</b>：没有外部索引、组织图里也没有任何指回来的引用——拷走这个目录
            就是取走全账。组织与他人**不可导出**。
          </div>
          {/*
            **拷得走 ≠ 取得走**（v2.0 / #62-A2）。

            一串带 id 的 JSON 行是「可拷贝」，不是「可取走」——逐级兑付定律对取走律
            同样成立。所以这里当场生成一份**人可读**的判例册：每条三段（当时/事实/
            证据）全是文本，锚只作括注。它**不解析任何锚**，也**不写任何事件**——
            读自己的账是自由。
          */}
          <div className={css.destroyRow}>
            <button
              type="button"
              className={css.verb}
              disabled={busy}
              title="生成人可读的判例册 + README。读操作：生成前后这本账的事件流一行不增。"
              onClick={() => {
                void inject.vaultExport().then((result) => {
                  setTakeout(result)
                  if (result === undefined) setError('这本账还没打开，导不出东西来。')
                })
              }}
            >
              取走：生成判例册
            </button>
            <span className={css.rowNote}>
              判例册是**纯文本**：没有本系统、没有组织图的环境里也读得完整
            </span>
          </div>
          {takeout !== undefined && (
            <div className={`${css.empty} ${css.take}`}>{takeout.casebook}</div>
          )}
          <div className={css.destroyRow}>
            <input
              className={css.input}
              value={confirm}
              placeholder={`销毁不可逆：原样输入「${view.destroyPhrase}」以确认`}
              onChange={(event) => { setConfirm(event.target.value); }}
            />
            <button
              type="button"
              className={css.danger}
              disabled={busy || confirm !== view.destroyPhrase}
              title="销毁 = 删掉整个目录。这是这本账唯一的删除路径——更正一律走追加。"
              onClick={() => {
                void run(async () => {
                  const result = await inject.destroyVault(confirm)
                  if (result.error === undefined) setConfirm('')
                  return result
                })
              }}
            >
              销毁整本账
            </button>
          </div>
        </div>
        </div>

        {/*
          右栏 —— **中栏是流、右栏是物**，金库的物 = 判例的证据 (#61 澄清①).

          三层，顺序不能反：

          - **摘要为主.** 第一行永远是私账自存的那张照片。组织图断了，这一栏零缺字。
          - **锚为辅.** 「回真身 ↗」是一跳，不是内容的来源；活性探测只回状态。
          - **锚死显形.** 真身没了，快照原样在场 + 一枚徽记。`unknown` 不显形——
            读不到组织图时说一句「真身已变」是编造。

          预览分层：锚活着时的只读预览由 **surface 去调组织侧既有的对象面通道**
          （viewer=operator，操作者本来就看得见这些对象）；**pledger 一层不取内容**。
          于是锚死时预览消失、快照仍在、对表继续。
        */}
        <aside className={css.aside}>
          <div className={css.section}>
            证据面 · 右栏是物
            <span className={css.sectionNote}> · 摘要为主 · 锚为辅 · 锚死显形</span>
          </div>
          {evidence === undefined
            ? (
              <div className={css.empty}>
                还没有可摆的证据。证据来自**写下判断的那一刻**——没有那一刻，这里就该是空的。
              </div>
            )
            : (
              <>
                <div className={css.rowNote} style={{ marginBottom: 6 }}>{evidence.title}</div>
                {evidence.rows.map((one, index) => (
                  <div
                    key={`${one.at}:${String(index)}`}
                    className={`${css.evidenceRow} ${one.premise === 'changed' ? css.evidenceDead : ''}`}
                  >
                    {/* 第一行永远是照片。**它不是从锚解析出来的**。 */}
                    {one.text}
                    <span className={css.evidenceMeta}>
                      {new Date(one.at).toLocaleString('zh-CN', { hour12: false })}
                      {one.mark === undefined ? '' : ` · ⚠ ${one.mark}`}
                      {one.anchor === undefined
                        ? ' · 无锚：这一段只有快照，本来就跳不回去'
                        : ` · ${one.anchor.kind}:${one.anchor.id}（回真身用的坐标，内容不来自它）`}
                    </span>
                  </div>
                ))}
                <div className={css.rowNote}>{evidence.note}</div>
              </>
            )}

          {/*
            记忆 tab 的**空态出生故事** —— 金库 ≠ 记忆 (#61 澄清③).

            这一栏在会话面里是「记忆」。在金库语境下它永远是空的，而**恰好为空和
            不可能有是两句话**：工程上蒸馏管道对这本账没有通路（依赖方向铁律），
            反向也禁（pledger 的依赖面上没有 memory 服务）。
          */}
          <div className={css.section}>记忆</div>
          <div className={css.empty}>
            空，而且**永远为空**：金库内容永不入记忆库。
            <br />
            记忆是 agent 的复利、金库是人的复利——两本复利账不合流，也互不蒸馏。
          </div>
        </aside>
      </div>
    </div>
  )
}
