/**
 * 事件枢纽的三个动作 —— 一个读，一个挂，一个把材料送到开会的人眼前。
 *
 * 「为此会准备」在设计里是一个 **CTA（传送门）**，不是一个表单——委派那句话仍然由人
 * 在会话里说。所以这里**没有**「替你把活派出去」的工具：能做的是把一件**已经存在的**
 * 承诺挂到这场会上，以及把会前材料写进日程描述。派活走既有的委派动线。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { asNumber, asRecord, asString, type GraphViewer } from '@yzj-next/graph'
import type { TurnBinding } from '../turns.ts'
import { failureOf } from '../bridge-error.ts'
import { splitAtFence } from '../fence.ts'
import { descriptionFor, eventHub, materialsFor, readinessLine } from './hub.ts'

const output = {
  schema: {
    type: 'object' as const,
    additionalProperties: false as const,
    properties: { content: { type: 'string' as const, required: true as const } },
  },
  render: (_args: unknown, value: { content: string }) => [
    { type: 'text' as const, text: value.content },
  ],
}

function bindingOf(ctx: Context, agent: Agent | undefined): TurnBinding | undefined {
  if (agent === undefined) return undefined
  const turns = ctx.get('yzjTurns')
  return turns?.bindingFor(agent) ?? turns?.defaultBinding()
}

function viewerOf(binding: TurnBinding | undefined): GraphViewer {
  return binding?.viewer ?? { kind: 'place', placeKey: '__unbound__' }
}

/**
 * 看不见时说的那句话 —— 带上**为什么**。
 *
 * 一场会的听众集合由**第一次看见它的那个回合**定下，之后不会变（内核规则：听众在
 * 出生时确立）。所以「在桌面看过一次，群里就再也看不到」是真会发生的一种情况，而
 * 一句光秃秃的「看不到」会让人以为是坏了。说出机制，人才知道该怎么办。
 */
const unseen = '这里看不到这场会——它的可见范围是第一次被看到时定下的，'
  + '如果它当时是在别的会话里被看到的，这边就够不着。到那个会话里问，或者让能看到的人挂。'

/**
 * 把材料清单写进日程描述 —— **线以上是会议主人的**，怎么拼见 {@link descriptionFor}。
 *
 * 这里只剩编排：读回此刻的这场会，算出该写什么，写下去。
 */
async function post(
  ctx: Context, eventId: string, materials: string, posted: string | undefined,
): Promise<{ ok: true; skipped: boolean } | { ok: false; why: string }> {
  const bridge = ctx.get('yzjBridge')
  if (bridge === undefined) return { ok: false, why: '云之家通道未就绪' }
  /*
    改描述必须**连标题一起送** —— 实测撞出来的。

    平台的 modify 接口对只带 description 的请求答 `code=4000 会议标题不能为空`：
    它要的是一份完整的会议，不是一个字段的补丁。所以先读回此刻的标题再一起写。

    读了立刻写，中间不做别的：这一读一写之间要是有人改了会议名，我们会把刚读到的
    那个名字原样写回去——那正是我们该做的（我们没改它）；换成用图里抄下的那份旧
    标题，就会把别人的改名悄悄回滚。描述同理：一起读回来的那份，才是我们该接着写的。
  */
  const current = await bridge.run(['calendar', 'event', 'get', '--id', eventId], { timeoutMs: 20_000 })
  if (!current.ok) return { ok: false, why: failureOf(current, '读不回这场会此刻的样子') }
  const detail = asRecord(current.json)
  const title = asString(detail?.title)
  if (title === undefined || title === '') {
    return { ok: false, why: '读回这场会时它没有标题，不敢只改描述——平台要的是一份完整的会议' }
  }
  // 实测：`calendar event get` 把描述放在 `content` 上，正是 `--description` 写的那个字段。
  const next = descriptionFor(asString(detail?.content) ?? '', materials, posted)
  if (next === undefined) return { ok: true, skipped: true }
  const result = await bridge.run(
    ['calendar', 'event', 'update', '--id', eventId, '--title', title, '--description', next],
    { timeoutMs: 25_000 },
  )
  if (!result.ok) return { ok: false, why: failureOf(result, '写入失败') }
  return { ok: true, skipped: false }
}

/**
 * 把平台上那条日程请进图里。
 *
 * 只抄标题和开始时间，**判断一律回真身**：日程会被人改，我们抄下的那份只用来让行上
 * 有话可说（数据律一）。看不见的日程不请进来——`detail` 打不通就是打不通。
 */
async function observe(
  ctx: Context, eventId: string, binding: TurnBinding | undefined,
): Promise<{ ok: true; title?: string; description?: string } | { ok: false; why: string }> {
  const bridge = ctx.get('yzjBridge')
  if (bridge === undefined) return { ok: false, why: '云之家通道未就绪' }
  /*
    每次都去读一遍真身，哪怕图上已经有它了。

    图上那份标题是第一次看见它时抄的，**再也不会更新**（`observed` 只写一次）。会议
    改名之后，简报头上印的还是旧名字——一份印着旧会议名的会前材料，比没有更容易让人
    走错屋。抄下的那份只用来让行上有话可说，判断与显示一律回真身（数据律一）。
  */
  const result = await bridge.run(['calendar', 'event', 'get', '--id', eventId], { timeoutMs: 20_000 })
  if (!result.ok) return { ok: false, why: failureOf(result, '读不到这条日程') }
  const detail = asRecord(result.json)
  const title = asString(detail?.title)
  const startAt = asNumber(detail?.startDate)
  /*
    描述也一起带回来 —— **同一次读白送的**。

    「材料到底送到没有」此前是问图里那份抄件的，而抄件只知道「我们写过」：有人把那段
    从日程里删了，它不会知道，于是简报说已经送到、参会的人打开日程什么都没有。那是
    幽灵承诺换了个通道复活，这个仓库为它修过不止一次了。真身就在手上，没有理由问抄件。
  */
  const description = asString(detail?.content)
  const seen = (): { ok: true; title?: string; description?: string } => ({
    ok: true,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
  })
  if (ctx.yzjGraph.rawObject('event', eventId) !== undefined) return seen()
  await ctx.yzjGraph.append({
    type: 'event/observed',
    data: {
      eventId,
      ...(title === undefined ? {} : { title }),
      ...(startAt === undefined ? {} : { startAt }),
      /*
        出生边只能记在这儿 (v3.10 实测).

        平台有 `workData{msgId,groupId}` 这个官方字段，可它只声明在 create/modify
        上——`detail` 不返回。「这场会从哪句话里长出来」写得进、读不回，所以不在这里
        记就没有第二处。当前回合是从一条消息触发的，那条消息就是我们知道的出处。
      */
      ...(binding?.messageId === undefined ? {} : { bornFrom: `yzj:${binding.messageId}` }),
      ...(binding?.audience === undefined ? {} : { audience: [...binding.audience] }),
    },
    actor: { kind: 'agent' },
  })
  return seen()
}

export function applyEventTools(ctx: Context): () => void {
  const disposers: (() => void)[] = []
  const register = (definition: Parameters<typeof ctx.tools.register>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }

  register(defineTool({
    name: 'event_brief',
    description: 'Read one meeting as a hub: what work is hanging off it, what each of those has produced, and whether the materials are ready. Use it when asked "这个会准备好了吗" / "开会前要看什么" — the readiness is DERIVED from the state of the commitments hanging on the meeting, so it is never stale and nobody maintains it.',
    presentCall: args => ({ card: 'generic', title: `看这场会：${String(args.eventId)}`, kind: 'read' }),
    parameters: {
      eventId: { type: 'string', required: true, description: 'Yunzhijia calendar event id.' },
    },
    output,
    timeoutMs: 25_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const binding = bindingOf(ctx, exec.agent)
      const seen = await observe(ctx, args.eventId, binding)
      if (!seen.ok) return { content: `看不了这场会：${seen.why}` }
      const hub = eventHub(ctx, viewerOf(binding), args.eventId)
      if (hub === undefined) return { content: unseen }
      const lines = [
        // 真身此刻叫什么，就印什么——图上那份是第一次看见时抄的，不会更新。
        `【${seen.title ?? hub.title ?? hub.eventId}】`,
        readinessLine(hub),
        ...(hub.goalRef === undefined ? [] : [`为这个目标开：${hub.goalRef}`]),
        ...hub.prepares.map(item => (
          `- [${item.status}] ${item.what} — ${item.who}`
          + (item.artifacts.length === 0
            ? ''
            : `\n  产出：${item.artifacts.map(a => `${a.title} ${a.uri}`).join(' / ')}`)
        )),
        // 问的是**此刻的日程**，不是图里那份抄件（见 observe 里那段）。
        ...(splitAtFence(seen.description ?? '').ledger === undefined
          ? ['材料清单还没写进日程描述——参会的人看不到它。用 event_post_materials 送过去。']
          : []),
      ]
      return { content: lines.join('\n') }
    },
  }))

  register(defineTool({
    name: 'event_link',
    description: 'Hang an existing commitment (or a goal) on a meeting — "这件事是为那个会准备的". This does NOT delegate anything: creating the work is a delegation utterance somebody says in a conversation. Use it to connect work that already exists, so the meeting can report its own readiness.',
    presentCall: args => ({ card: 'generic', title: `挂到这场会：${String(args.eventId)}`, kind: 'edit' }),
    parameters: {
      eventId: { type: 'string', required: true, description: 'Yunzhijia calendar event id.' },
      commitmentId: { type: 'string', description: 'Commitment being prepared for this meeting.' },
      goalRef: { type: 'string', description: 'The goal this meeting serves.' },
    },
    output,
    timeoutMs: 25_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (args.commitmentId === undefined && args.goalRef === undefined) {
        return { content: '要挂什么？给一个 commitmentId（为它准备）或 goalRef（为它开会）。' }
      }
      const binding = bindingOf(ctx, exec.agent)
      const seen = await observe(ctx, args.eventId, binding)
      if (!seen.ok) return { content: `挂不上：${seen.why}` }
      /*
        这个回合看不见这场会，就不能往它身上挂东西。

        `observe` 里那次存在性检查走的是 raw 读（它要判断的是「图上有没有」，那是
        结构不是措辞）。少了下面这一问，一个别处的会话就能把自己的承诺挂进另一个
        场所的会里——而它自己什么也看不见，只会收到一句「挂上了」。既写了别人的
        对象，又对自己撒了谎。
      */
      if (eventHub(ctx, viewerOf(binding), args.eventId) === undefined) {
        return { content: unseen }
      }
      /*
        挂一件这个回合看不见的承诺 = 把它的存在说了出去。

        承诺 id 是可以被猜的（哈希但不长），而「挂上了」这件事本身会让它出现在这场
        会的简报里。所以先问一句看不看得见——和目标挂接同一条纪律。
      */
      if (args.commitmentId !== undefined
        && ctx.yzjGraph.object(viewerOf(binding), 'commitment', args.commitmentId) === undefined) {
        return { content: '这里看不到这条承诺，挂不上去。' }
      }
      await ctx.yzjGraph.append({
        type: 'event/linked',
        data: {
          eventId: args.eventId,
          via: 'explicit',
          ...(args.commitmentId === undefined ? {} : { commitmentId: args.commitmentId }),
          ...(args.goalRef === undefined ? {} : { goalRef: args.goalRef }),
        },
        actor: { kind: 'agent' },
      })
      const hub = eventHub(ctx, viewerOf(binding), args.eventId)
      return { content: hub === undefined ? unseen : `挂上了。${readinessLine(hub)}` }
    },
  }))

  register(defineTool({
    name: 'event_post_materials',
    description: 'Write the meeting\'s material list into the calendar event description, so every attendee sees it where they already look. Only artifacts that actually exist are listed — a description full of "待办" is a second board, not a briefing. Goes through the normal write confirmation.',
    presentCall: args => ({ card: 'generic', title: `把会前材料写进日程 ${String(args.eventId)}`, kind: 'edit' }),
    parameters: {
      eventId: { type: 'string', required: true, description: 'Yunzhijia calendar event id.' },
    },
    output,
    timeoutMs: 30_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const binding = bindingOf(ctx, exec.agent)
      const hub = eventHub(ctx, viewerOf(binding), args.eventId)
      if (hub === undefined) return { content: unseen }
      const materials = materialsFor(hub)
      if (materials === undefined) {
        return { content: '挂在这场会上的事还没有留下任何产出——现在写进去，参会的人只会看到一串待办。' }
      }
      const outcome = await post(ctx, args.eventId, materials, hub.postedMaterials)
      if (outcome.ok && outcome.skipped) {
        return { content: '这份材料清单已经在日程描述里了，没有变化。' }
      }
      await ctx.yzjGraph.append({
        type: 'event/materials-posted',
        data: {
          eventId: args.eventId,
          postedMaterials: materials,
          postedStatus: outcome.ok ? 'written' : 'failed',
          ...(outcome.ok ? {} : { postedDetail: outcome.why }),
        },
        actor: { kind: 'agent' },
      })
      return {
        content: outcome.ok
          ? `材料清单已写进日程描述，参会的人打开日程就能看到：\n${materials}`
          : `没写进去（${outcome.why}）——参会的人**看不到**这份清单，需要你另想办法送过去。`,
      }
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
