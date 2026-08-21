/**
 * 事件（obj-event）—— 日程五边模型的图这一侧 (§5.6).
 *
 * 一个日程条目在云之家上已经有真身了，所以这一族**不复制它**：标题、时间、参会人
 * 都从平台读，图上只记平台答不了的那些边。实测（v3.10）证实这个分工不是洁癖而是
 * 必需——`workData{msgId,groupId}` 是官方给的「这条日程由哪条消息生出来」字段，
 * 可它**只声明在 create/modify 上，`detail` 不返回**：写得进，读不回。那条出生边
 * 要么记在我们这儿，要么谁也说不出它。
 *
 * 五条边，各自的落点：
 *
 * - **服务**（这场会为哪个目标开）→ `event/linked`，`goalRef`；
 * - **生成**（哪条消息生出了它）→ `event/observed` 的 `bornFrom`——平台读不回的那条；
 * - **操作**（谁改了它）→ 平台自己的证据，不抄；
 * - **触发**（为这场会要准备什么）→ `event/linked` 挂上的承诺；
 * - **聚合**（重复会议）→ 平台的 `batchId`，读得回，不抄。
 *
 * **材料就绪度不是字段**。它是「挂在这场会上的承诺此刻各处于什么状态」的一次推导——
 * 存成字段就要有人维护它，而设计的验收句正是「不需要任何人去维护」。
 */

import { z, type GraphFamily } from '@yzj-next/graph'
import { asRecord, asString } from '@yzj-next/graph'

/** 一场会在图上留下的东西。真身在云之家，这里只有它答不了的部分。 */
export interface EventState {
  readonly eventId: string
  /** 平台上那条日程的标题，抄一份只为了行上有话可说——判断一律回真身。 */
  readonly title?: string
  readonly startAt?: number
  /**
   * 哪条消息生出了这场会 (五边之「生成」).
   *
   * 平台有 `workData{msgId,groupId}` 这个官方字段，但**只能写不能读**（`detail`
   * 不返回它）。所以「这场会是从哪句话里长出来的」这件事，不在这里记就没有第二处。
   */
  readonly bornFrom?: string
  /** 这场会为哪个目标开。 */
  readonly goalRef?: string
  /** 为这场会准备的承诺。挂接是可纠的默认，不是裁决。 */
  readonly prepares?: readonly string[]
  /** 材料清单已经写进日程描述里的那一版——写过什么不该跟着平台被改而变。 */
  readonly postedMaterials?: string
}

export const eventFamily: GraphFamily = {
  kind: 'event',
  events: {
    /**
     * 我们看见了这场会。
     *
     * 「observed」而不是「created」：**日程不是我们建的**（多数时候），我们只是把
     * 它请进图里好挂东西。用 created 会让下一个人以为图是它的出生地。
     */
    'event/observed': {
      schema: z.object({
        eventId: z.string().min(1),
        title: z.string().optional(),
        startAt: z.number().int().optional(),
        bornFrom: z.string().optional(),
        audience: z.array(z.string()).optional(),
      }),
    },
    /**
     * 把一件事挂到这场会上 —— 服务边与触发边共用一个动词。
     *
     * `goalRef` 是「这场会为哪个目标开」，`commitmentId` 是「为这场会要准备什么」。
     * 一次只挂一样，因为它们是两条不同的边，合成一个事件会让「解开哪一条」变成
     * 一个说不清的问题。
     */
    'event/linked': {
      schema: z.object({
        eventId: z.string().min(1),
        goalRef: z.string().optional(),
        commitmentId: z.string().optional(),
        /** 怎么挂上的。推断出来的要亮出来可纠——和承诺挂接同一条纪律。 */
        via: z.enum(['explicit', 'inferred', 'inherited']).default('explicit'),
      }),
    },
    /** 解开。写空串而不是删——更正即追加。 */
    'event/unlinked': {
      schema: z.object({
        eventId: z.string().min(1),
        commitmentId: z.string().optional(),
        goalRef: z.string().optional(),
      }),
    },
    /**
     * 材料清单写进了日程描述 —— 全参会人可见的那一份。
     *
     * 和目标回写同一个道理：图上齐全不等于开会的人知道。他们看的是日程条目。
     */
    'event/materials-posted': {
      schema: z.object({
        eventId: z.string().min(1),
        /*
          字段名就叫 `postedMaterials` —— 和读它的那一侧同名。

          第一版这里写 `materials`，而枢纽读的是 `postedMaterials`：**永远读到
          undefined**。后果不是少一句话，是「写过就不再写」这道闸永远不闭合——每调用
          一次就往一份全参会人看的日程描述里重写一遍，而会前简报永远在催「快去写」。
          实跑时才现形，单元测试当时根本没覆盖这条路。
        */
        postedMaterials: z.string(),
        /*
          不叫 `status`：图的查询层把对象 state 上的 `status` 当作对象自己的状态来
          过滤（`query({status})`）。一场会的状态不是「写没写成材料清单」。
        */
        postedStatus: z.enum(['written', 'failed']),
        postedDetail: z.string().optional(),
      }),
    },
  },
  objectIdOf: (_type, data) => asString(asRecord(data)?.eventId),
  /**
   * 挂接是累加的，不是覆盖。
   *
   * 浅合并会让第二次挂接把第一次挂上的那条顶掉——一场会准备三件事，图上只剩最后
   * 一件，而没有任何地方会报错。
   */
  reduce: (previous, event) => {
    const base = asRecord(previous) ?? {}
    const next = asRecord(event.data) ?? {}
    const current = Array.isArray(base.prepares) ? base.prepares.map(String) : []
    if (event.type === 'event/linked') {
      const commitmentId = asString(next.commitmentId)
      return {
        ...base,
        ...next,
        prepares: commitmentId === undefined || current.includes(commitmentId)
          ? current
          : [...current, commitmentId],
      }
    }
    if (event.type === 'event/unlinked') {
      const commitmentId = asString(next.commitmentId)
      return {
        ...base,
        // 解开目标写空串：更正即追加，空串是「解开过」的痕迹，删掉就没有痕迹了。
        ...(asString(next.goalRef) === undefined ? {} : { goalRef: '' }),
        prepares: commitmentId === undefined
          ? current
          : current.filter(id => id !== commitmentId),
      }
    }
    return { ...base, ...next, prepares: current }
  },
}

/** 事件 id 就是平台的日程 id——不另铸一个，那会多出一张要维护的对照表。 */
export function eventIdOf(platformId: string): string {
  return platformId
}
