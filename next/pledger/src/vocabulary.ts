/**
 * 私账事件族全量 —— these types exist ONLY in the pledger store (分册 §3).
 *
 * The organization graph gains **zero** new event types and **zero** new
 * fields. That is not tidiness: it is half of the single-direction double lock
 * (PTD-4). The other half is the import ban — 组织侧包 import pledger 即 CI 红.
 *
 * Three absences in this file are load-bearing, and each replaces a runtime
 * check somebody could forget to write:
 *
 * - **`expectation/updated` 不存在** (PTD-6). 改笔的通道在词汇表上就没有：改赌注 =
 *   撤回 + 不可再立。堵的是「临近检验点改口」那条自欺通道。
 * - **墓碑事件不存在** (v1.1). 更正全走追加（answered 追加 / dismissed→reopened /
 *   withdrawn 留痕），整账销毁是唯一抹除。
 * - **判例与模式没有事件**. 判例 = `calibration/answered` 留痕本身；模式 = 纯派生
 *   查询。没有累积存储就没有档案可建——模式滚动律的机械保证 (§3 末).
 */

import { z, type GraphFamily, type JsonValue } from '@yzj-next/graph'
import { asRecord, asString } from '@yzj-next/graph'

const orgAnchor = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  graphSeq: z.number().int().optional(),
  label: z.string().optional(),
})

/** 事实源三分的 schema 形态 —— ambient 那一支**没有构造函数** (断言⑮). */
const factRef = z.union([
  z.object({
    source: z.literal('org'),
    anchor: orgAnchor,
    why: z.enum(['reopened', 'lineage', 'assessed']),
  }),
  z.object({ source: z.literal('noted'), factId: z.string().min(1) }),
])

const idOf = (key: string) => (_type: string, data: JsonValue): string | undefined => (
  asString(asRecord(data)?.[key])
)

/**
 * 预期（对话式立约）—— 一句可证伪的赌注，说出来的，不是表单里填的.
 *
 * `text` 走**原话直存律** (v1.1 / PTD-12): 它由编排层从人的话语原文锚定注入，
 * 而模型工具的 schema 上根本没有这个参数——「agent 不得生成不得改写」不靠 prompt
 * 恳求，靠参数面。
 *
 * `checkpoint` 是**两层**（与主册 due 同构）：`text` 是当初说出口的那句话，`ts` 只在
 * 真解析得出来的时候才有。把「明早评审后」硬解析成一个人没承诺过的时间戳，是拿我们的
 * 解析冒充他的赌注。
 */
export const expectationFamily: GraphFamily = {
  kind: 'expectation',
  events: {
    'expectation/opened': {
      schema: z.object({
        expectationId: z.string().min(1),
        text: z.string().min(1),
        checkpoint: z.object({ text: z.string().min(1), ts: z.number().int().optional() }),
        verdictRef: orgAnchor,
        evidenceRefs: z.array(orgAnchor).default([]),
        /** The invite this bet was spoken into. 立约时窗的留痕 (PTD-13). */
        inviteId: z.string().min(1),
        family: z.string().min(1),
        status: z.literal('testing').default('testing'),
        /** 幂等锚 = verdictRef —— 同一裁决至多一次 opened. */
        idemKey: z.string().min(1),
      }),
    },
    /**
     * 唯一退出动词。撤回留痕不删史——**前提消失时撤回是诚实不是失败**。
     *
     * 撤回之后同 verdictRef 的 opened 被幂等锚吸收成 no-op：这就是「改赌注 = 撤回 +
     * 不可再立」的兑现（断言③）。
     */
    'expectation/withdrawn': {
      schema: z.object({
        expectationId: z.string().min(1),
        reason: z.string().default(''),
        status: z.literal('withdrawn').default('withdrawn'),
      }),
    },
    /** 对表归档——由校准回执归因触发；检验中 → 已对表的迁移时刻。 */
    'expectation/settled': {
      schema: z.object({
        expectationId: z.string().min(1),
        calibrationRef: z.string().min(1),
        status: z.literal('settled').default('settled'),
      }),
    },
    /**
     * 检验点到了，agent 在私语域问过一次结果了。
     *
     * 它是**这一次跟进已经花掉了**的留痕，不是状态迁移。落库而不是记在内存里，因为
     * host 内存不是真身：不落，重启之后 agent 会把「问一次」再问一次，而 P1 明标是
     * 问一次不再追（§9）。
     */
    'expectation/asked': {
      schema: z.object({
        expectationId: z.string().min(1),
        asked: z.literal(true).default(true),
      }),
    },
  },
  objectIdOf: idOf('expectationId'),
}

/**
 * 图外事实的人工补登 —— 环3 的词汇地板 (v1.1 / PTD-11).
 *
 * 「跟踪≠监工」对私账同样适用：系统不猜图外。线下评审、口头反馈、邮件结果的唯一入口
 * 是**人在私语域一句话补登**（同组织侧补登语法）。没有这一型，事实回流环只对图内
 * 结构性事实成立 = 环断。
 *
 * `text` 同样走原话直存律：人的原话，模型无此参数。
 */
export const factFamily: GraphFamily = {
  kind: 'fact',
  events: {
    'fact/noted': {
      schema: z.object({
        factId: z.string().min(1),
        text: z.string().min(1),
        /** 显式指认，零推断：这条事实说的是哪一次裁决 / 哪一个预期。 */
        about: z.object({
          kind: z.enum(['verdict', 'expectation']),
          verdictRef: orgAnchor.optional(),
          expectationId: z.string().optional(),
        }),
        /** 私语话语锚——这句话是在哪儿说的。 */
        anchor: z.string().optional(),
      }),
    },
  },
  objectIdOf: idOf('factId'),
}

/**
 * 校准回执 —— 恒带「校准」前缀 (#61 收紧⑥).
 *
 * 与组织侧交付回执 `receipt/*` 词汇卫生分立：两者在一屏上永远不该被读成同一种东西。
 * 组织侧回执说「这件事办完了」，校准回执说「你当时那个判断，后来怎么样了」。
 */
export const calibrationFamily: GraphFamily = {
  kind: 'calibration',
  events: {
    'calibration/opened': {
      schema: z.object({
        calibrationId: z.string().min(1),
        verdictRef: orgAnchor,
        factRef,
        /** 无则为隐式预期路径——裁决本身即预期。 */
        expectationId: z.string().optional(),
        /**
         * 证据行：**只许事实与假设措辞，禁心理判词**（v4.25r 显示层收紧）。
         *
         * 「差距条目②当时已在档」是证据；「没当回事」是替人写好的归因，违规。
         * 这是 prompt 纪律仅存的一处（原话直存律拿走了另外两处），配 review 断言。
         */
        evidence: z.array(z.string()).default([]),
        /** 当时那句话——预期原文，或隐式预期的措辞。回执正文的「当时」半边。 */
        thenText: z.string().default(''),
        /** 后来那件事——事实的一句话。回执正文的「事实」半边。 */
        factText: z.string().default(''),
        family: z.string().min(1),
        status: z.literal('open').default('open'),
        /** 幂等锚 =（裁决边, 事实边）——同一事实多次回流不重复出执（断言④）。 */
        idemKey: z.string().min(1),
      }),
    },
    /**
     * 归因由**人**下，agent 不代下。可纠 = 追加（最新生效，更正即追加律）。
     *
     * 没有 `answered/corrected` 这种事件：改归因就是再 append 一条 answered，
     * 折叠取最新。史不改，最新生效。
     */
    'calibration/answered': {
      schema: z.object({
        calibrationId: z.string().min(1),
        attribution: z.enum(['q1', 'q2', 'q3', 'q4']),
        status: z.literal('answered').default('answered'),
      }),
    },
    /**
     * 第五出口「配对错了」——事实与裁决无关（宁空勿错的私账版）。
     *
     * 吸收态：判例不入任何派生查询；同 idemKey 不再出执（断言④）。
     */
    'calibration/dismissed': {
      schema: z.object({
        calibrationId: z.string().min(1),
        status: z.literal('dismissed').default('dismissed'),
      }),
    },
    /** dismissed 的纠回（更正即追加，不改史）——四格重新可答。 */
    'calibration/reopened': {
      schema: z.object({
        calibrationId: z.string().min(1),
        status: z.literal('open').default('open'),
      }),
    },
  },
  objectIdOf: idOf('calibrationId'),
}

/**
 * 立约邀约 —— 一次性，不追问、不老化、不催.
 *
 * **`invite/opened` 与 `invite/pledged` 是本实现补上的两型。** 分册 §3 的词汇表只
 * 列了 `declined` 与 `reopened`，可 §2 同时要求「邀约/回执/预期的待答态全部落日志，
 * 重启可恢复」——一张只活在内存里的邀约卡，重启即蒸发，而它正是立约时窗的那把锁
 * （§4：P1 立约仅经现行邀约卡）。两型补在这里，和 v1.1 补 `fact/noted` 是同一种
 * 补法：环少一节，就把那一节的词汇地板铺上。
 */
export const inviteFamily: GraphFamily = {
  kind: 'invite',
  events: {
    'invite/opened': {
      schema: z.object({
        inviteId: z.string().min(1),
        family: z.string().min(1),
        verdictRef: orgAnchor,
        /**
         * 出处 —— **只能是组织侧事实** (#61 收紧⑤).
         *
         * 生成器的输入面只含本次裁决对象及其组织图锚，不含任何 pgraph 查询：
         * 「镜子等人来照」的实现形态是**生成器根本看不见镜子** (PTD-9)。
         */
        evidenceRefs: z.array(orgAnchor).default([]),
        /** 出处那一句话。agent 开口必有出处，无出处即无内容。 */
        sourceLine: z.string().default(''),
        status: z.literal('open').default('open'),
        /** 幂等锚 = verdictRef：一次裁决至多一张邀约。 */
        idemKey: z.string().min(1),
      }),
    },
    /** 邀约不立留痕——疲劳治理的计数原料（连续 3 次 → 该族降频停问）。 */
    'invite/declined': {
      schema: z.object({
        inviteId: z.string().min(1),
        family: z.string().min(1),
        status: z.literal('declined').default('declined'),
      }),
    },
    /** 立了。邀约的终态，也是立约时窗关上的那一刻。 */
    'invite/pledged': {
      schema: z.object({
        inviteId: z.string().min(1),
        expectationId: z.string().min(1),
        status: z.literal('pledged').default('pledged'),
      }),
    },
    /**
     * 重开主权在人、入口在金库——降频的唯一恢复动词。
     *
     * **纯边**（无 `objectIdOf`）：它说的是一个**族**从此重新可问，不是某一张卡
     * 变了状态。降频本身也是纯派生（数 declined 与 reopened 的先后），所以这里
     * 没有第二个对象要维护。
     */
    'invite/reopened': {
      schema: z.object({ family: z.string().min(1) }),
    },
  },
  objectIdOf: (type, data) => (
    type === 'invite/reopened' ? undefined : asString(asRecord(data)?.inviteId)
  ),
}

/**
 * 换挡史 —— 私有.
 *
 * 「设为租约」的**租约本体 = 组织图 lease/granted 既有事件**（创建走强确认既有，
 * guard 消费它）；本事件只记**你换过挡** (PTD-7)。免确认是组织侧行为，其审计必须
 * 留在组织侧；而「你为什么把这一族调松了」是你自己的账。
 */
export const gearFamily: GraphFamily = {
  kind: 'gear',
  events: {
    'gear/shifted': {
      schema: z.object({
        family: z.string().min(1),
        gear: z.enum(['lease', 'default', 'weight']),
        entry: z.enum(['tail', 'vault']),
        /** 换挡那一刻，证据行长什么样。环境快照律的私账形态。 */
        evidenceSnapshot: z.string().optional(),
      }),
    },
  },
  objectIdOf: idOf('family'),
}

/**
 * 后视镜 —— 回喂环的合环阀 (#61).
 *
 * **人预先签发的私账规则，不是 agent 临场的好意。** 你在金库对某个提案族开启后视镜，
 * 此后该族卡片旁（仅你可见的桌面渲染层）显示你的相关判例 chip；默认不开、随时可关，
 * agent 只执行显示。
 */
export const mirrorFamily: GraphFamily = {
  kind: 'mirror',
  events: {
    'mirror/toggled': {
      schema: z.object({
        family: z.string().min(1),
        patternKey: z.string().min(1),
        on: z.boolean(),
        /** `${family}:${patternKey}` — 幂等地址，最新生效。 */
        mirrorId: z.string().min(1),
      }),
    },
  },
  objectIdOf: idOf('mirrorId'),
}

/** Every family the private ledger folds. Registered on the pgraph store at boot. */
export const PLEDGER_FAMILIES: readonly GraphFamily[] = [
  expectationFamily,
  factFamily,
  calibrationFamily,
  inviteFamily,
  gearFamily,
  mirrorFamily,
]

/**
 * 三不入的结构性根据，写成一句可断言的话.
 *
 * These families declare **no** `pendingStatuses`. `pendingAnswerables()` runs
 * on the organization store and folds only families registered there, so a
 * private object cannot appear in the inbox, the decision bar, or any badge —
 * **零 filter** (PTD-2). This constant exists so 断言① can assert the absence
 * rather than trust it.
 */
export const PLEDGER_KINDS: readonly string[] = PLEDGER_FAMILIES.map(family => family.kind)
