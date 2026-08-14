# 云之家 × DeepSeek Harness 集成整体方案（人在闭环版）

> 版本：v1.6（预研稿）
> 日期：2026-08-14
> v1.6 变更：设计收口为可验收的完整设计——§5.1 工具清单主表补「实现工具（已落地）」映射列（设计名 ↔ 实现名，验收对照用）；§5.2 拖放小节扩为「全条目拖拽」完整规格（条目回源对照表 + 四条硬性要求：消息必带 groupId、dbt 附表结构、doc 摘要深度提示、拖入即处理引导）；悬浮窗改为四 tab 设计；§5.4 mention 规则补「消息 ref 必须携带 groupId」；§6 Phase 2 产出与验收同步全量拖拽。
> v1.5 变更：工具清单补齐实现侧已落地的补充工具（§5.1 表后）；公共原则新增第五条「**一切皆可拖**」——悬浮窗内全部条目（知识库/文档/多维表格/日程/会话/消息/联系人）均可拖入 composer 成为带上下文的 chip，统一交给 agent 处理（§4、§5.2）；§1.2 目标 2「拽得动」同步泛化；与实现的逐项对照见 `docs/gap-设计方案与实现对照.md`。
> v1.4 变更：sheet 多维表格读写纳入本期（v1.3 曾排除）——记录读取为只读工具，新建表格/记录写为标准确认，记录删除为强确认；同一门禁与卡片框架，边际成本极低。额外红利：sheet 立即充当**待办功能的预研探针**（影子任务库），待办核心交互在正式功能上线前即可被真实验证。
> v1.3 变更：确认卡从消息专用泛化为**全域写闸门**——知识库（建/改/删/导入）、日程、文件上传等全部写操作纳入统一 pre-execute 门禁，按风险分级（标准确认 / 强确认）；确认卡改为按 domain 分发渲染的通用框架，终态带 deep link 跳回云之家；悬浮窗扩为消息 + 知识库双 tab；新增旅程 4「群讨论沉淀知识库」。sheet 写操作本期不纳入（属待办影子库路线）。
> v1.2 变更：新增**通知机制**（三层：悬浮窗角标轮询 / schedule 驱动的会话内筛选播报 / 浏览器系统通知）。此前 schedule 被归入下期，因其绑定「推送到云之家」；本期澄清：通知落点在 dsh 内部即属只读动作，纳入人在闭环范围。限制：轮询路线无真实时（schedule 最小 5 分钟）、「@我」靠本地文本匹配、需 dsh 进程存活。
> v1.1 变更：范围边界从「只读 vs 反向」重画为「人在闭环 vs 无人值守」。用户驱动的写操作（代发消息）以**确认卡门控**纳入本期；真正移交下期的是无人值守能力（webhook 入站、推送到云之家侧的播报、待办推送）。关键依据：yzj-cli 以用户本人身份登录，`im message send` 即用户本人发送，无需机器人。
> 说明：文中 dsh 相关 API 均经 v0.1 源码核验（核验日期 2026-08-14），dsh 官方明示开发者预览期存在破坏性变更，落地时需按当时版本复核。

---

## 1. 背景与目标

### 1.1 背景

- 云之家（公有云）官方发布了 `@yunzhijia/cli`（v0.1.3，2026-08-13 更新），定位为「人类用户和 AI Agent 打造」的终端工具，npm 安装时自动部署 AI Agent skills；以用户本人身份登录（凭据存 OS 密钥链）。
- DeepSeek 开源了 DeepSeek Harness（dsh，MIT，v0.1 开发者预览），核心理念「万物皆插件」：模型、工具、会话、UI、调度全部为可替换插件，提供 Plugin Store 与完整插件开发教程。
- 我们正处于云之家协同待办功能的预研阶段。本方案是其中「harness 集成 IM」这一条路线的落地设计。

### 1.2 目标

让 dsh 用户在工作台内直接消费云之家内容，并在人的确认下完成写动作：

1. **看得到**：悬浮窗内浏览云之家群消息；
2. **拽得动**：悬浮窗内全部条目——消息、文档/多维表格、日程、会话、联系人、知识库——均可拖进 composer 成为结构化引用，统一交给 agent 处理；
3. **@得到**：@同事 / @群 / @文档，把对应上下文注入当前对话；
4. **查得着**：知识库内容可被 agent 检索引用；
5. **发得出（带闸门）**：agent 的一切写动作——发消息、建/改/删知识库文档、日程变更、文件上传——统一经确认卡由用户点击放行，以用户本人身份执行；卡片可一键跳转悬浮窗核对上下文；
6. **叫得醒**：新消息三层通知——悬浮窗角标、agent 筛选后的会话内播报、浏览器系统通知。

### 1.3 范围界定

**本期 = 人在闭环**：所有动作要么只读，要么经确认卡由用户亲自放行。不需要机器人 token、不需要开放平台应用、不需要管理员配合——全部走本机 yzj-cli 的用户登录态。

**下期 = 无人值守**（本方案仅预留衔接点）：

| 不做 | 原因 |
|---|---|
| 机器人 webhook 通道（群消息自动触发 agent、回复推回群） | 需机器人与常驻 webhook 服务，下期 |
| 推送到云之家侧的播报 / 待办推送 | 无人值守的写推送，依赖机器人，下期（dsh 内部的通知播报属本期，见 §5.3） |
| 待办创建/推进的自动写入 | 待办功能本身处于预研，尚无能力源；本期的「起草待办」可走确认卡 |

---

## 2. 调研结论（均已核验）

### 2.1 yzj CLI 能力实测（`@yunzhijia/cli` v0.1.3）

| 域 | 命令 | 本方案用途 |
|---|---|---|
| 认证 | `auth login`（浏览器 / `--device` 设备码），凭据存 OS 密钥链 | 复用其登录态，插件不自建认证 |
| IM | `im message send / list`、`im group`（`chat` 为别名） | `list` 只读拉取；**`send` 经确认卡门控使用** |
| 知识库 | `doc workspace list/get/create`、`doc list/get/recent/block/create/import/download-url` | 知识库检索与文档内容读取 |
| 通讯录 | `contact user search / get` | @同事 的候选数据源 |
| 日历 | `calendar event`、会议室查询 | 本期不用，后续可扩展 |
| 多维表格 | `sheet`（`aitable` 别名）记录读写 | 记录读取（只读）+ 记录/表格写（确认卡门控）；兼作待办预研影子库 |
| 文件 | 上传/下载 | 配合 `doc download-url` 解析 Office 附件 |
| 待办 | **无命令**（已逐一核实） | 待办功能预研的需求输入 |

补充事实：

- 该包**无公开源码仓库**，仅 npm 分发（npm 壳 + Rust 二进制，darwin/linux/win32 × x64/arm64）；
- 自带成熟的 agent 使用规范（`skills/yzj-cli/SKILL.md` + references）：禁止编造 ID、危险操作先确认、参数不确定先跑 `--help`——可直接改造为 dsh skill；
- 支持 `--profile` 多账号、`--endpoint` 覆盖端点（私有云预留）；
- 发送消息为**用户本人身份**（非机器人），这是「确认卡门控的写」无需机器人的依据；
- 有重试机制（超时/5xx 自动重试，3s × 1.5ⁿ，最多 5 次）。

### 2.2 dsh 插件机制核验（源码级）

dsh 为 pnpm monorepo，插件体系基于 Cordis 元框架。与本方案相关的机制逐一核实如下：

**工具注册（host 侧）** — 官方教程第七章给出完整模式：

```ts
export const name = 'greet-tool'
export const inject = ['tools']           // 等待工具注册表就绪
export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: '...',
    parameters: { name: { type: 'string', required: true } },
    output: { schema: {...}, render: (args, value) => [...] },
    async execute(args) { ... },
  }))
}
```

**权限门禁（host 侧）** — `tools/pre-execute` 钩子返回类型化决策，`ask` + `ctx.approval` 实现「执行前询问用户」；`ui-permission-presets` 为已交付的同类实现。这是确认卡的执行闸门。

**UI 插槽（client 侧）** — `packages/client/runtime/src/client/slots.ts`：

- `root` 单槽被 ui-layout 的 AppFrame 占据，其内部声明了 `sidebar` / `conversation` / `details` / **`shell.overlay`** 四个槽位；
- 源码注释明确：**应用级浮层应注册进 `shell.overlay`**——list 型、追加式、默认不拦截指针事件；
- 注册模式（参照 ui-trajectory 实际代码）：

```ts
ctx.slots.inject('conversation.view', () =>
  ctx.slots.register({ name, id, order, locale, label, inject }, Component))
```

**@ 触发管线（client 侧）** — 内置插件 `ui-input-trigger` 提供完整能力，无需自造：

- 检测光标下的 `/` 与 `@`，弹分组候选菜单（渲染于 `conversation.input.overlay` 槽）；
- 插件通过 `ctx.inputTriggers` 注册自定义 InputTriggerSource：

```ts
interface InputTriggerSource {
  trigger: TriggerChar                 // '@'
  name: string                         // 菜单分组名，同 trigger 下唯一
  order?: number                       // 分组排序
  candidates(session, req): Promise<InputTriggerCandidate[]>
  onPick(pick): PickOutcome            // 选中 → 返回 ReferenceInsert
}
interface ReferenceInsert {
  source: string; ref: string          // 引用指针
  label: string                        // chip 显示文案
  clipboardText: string                // 复制/持久化形态
}
interface ReferenceCodec {
  clipboardText(ref): string
  serialize(ref, signal): Promise<string>   // ★ 引用 → 模型可见文本，异步
}
```

**mention 内容注入点（重要）** — `agent/request` 钩子经源码核验只能改 `{provider, model, temperature, ...}`（`LlmCallConfig`），**不改消息内容**。mention 解析的正确机制是 `ReferenceCodec.serialize(ref)`：chip 随 prompt 提交时由 codec 异步序列化为模型可见文本（可回 host 拉取云之家真实内容）。解析天然懒执行、携带引用指针、可溯源。

**自定义对话卡片（client 侧）** — `ConversationNodeDefinition`：把携带稳定业务 id 的持久化事件族关联成 Context，增量构造 State，渲染 keyed Chat 卡片。确认卡即以此实现（`docs/cookbook/adding-a-conversation-node` 有完整教程，含可回放要求：start/update 事件须携带稳定 id，不依赖内存态）。

**调度子系统（下期）** — `packages/schedule`：持久提醒（after/at/every，every ≥ 5 分钟），作为普通轮次回到原 live Session。

### 2.3 参照系与竞品结论

| 参照 | 状态 | 对本方案的意义 |
|---|---|---|
| 飞书 CLI + feishu-claude-code-bridge / lark-channel-bridge / CCBot | 成熟开源生态 | 「IM CLI + agent harness」模式已被完整验证；其发消息前交互确认的做法与本方案确认卡一致 |
| openclaw-yzj（kingdee 官方 org，约 10 星） | 仅消息通道，宿主为 OpenClaw | 证明云之家机器人 HTTP API + Webhook 双向链路可行（下期 channel 的直接参照） |
| 云之家 V11 官方 AI（小云） | 封闭官方功能 | 验证消息摘要/纪要转待办需求成立；本方案差异化 = 开放可编程 + 可观测（Trajectory 溯源）+ 确认卡门控 |
| dsh 插件生态 | 刚开闸，无企业 IM 插件 | 「云之家 × dsh」是空白品类，先发即卡位 |

### 2.4 调研总结论

1. 目标场景**无任何现成产品**；
2. 所需每一块 dsh 机制（浮层槽、@ 管线、引用 codec、权限门禁、自定义对话卡片）**全部是官方已交付能力**，不依赖 hack；
3. 能力缺口只有待办（CLI 无命令），而待办恰是我们预研的功能——不构成阻塞，反而是需求输入；
4. **写操作无需机器人**：CLI 即用户身份，确认卡门控即可安全纳入本期。

---

## 3. 总体架构

### 3.1 架构图

```
┌──────────────────────────── dsh（本地 Web UI）──────────────────────────┐
│                                                                         │
│  ┌─ yzj-ui（client 半插件）─────────────────────────────────────────┐   │
│  │  悬浮球 + 消息面板   ──注册进──▶ shell.overlay（list 槽）          │   │
│  │  @ 候选源           ──注册进──▶ ctx.inputTriggers                  │   │
│  │  拖放 chip          ──复用───▶ ReferenceInsert 管道                │   │
│  │  确认卡 / 通知卡    ──渲染───▶ ConversationNodeDefinition          │   │
│  │  yzjPanel 服务      ◀──卡片跳转── 打开面板并定位锚点消息            │   │
│  │  系统通知           ──自接───▶ 浏览器 Notification（dsh 无封装）    │   │
│  │  ReferenceCodec.serialize() ──异步拉取──┐                          │   │
│  └────────────────────────────────────────│─────────────────────────┘   │
│                                           ▼（连接层调用 host 服务）      │
│  ┌─ yzj-tools（host 半插件）────────────────────────────────────────┐   │
│  │  只读工具：yzj_msg_list / yzj_group_list / yzj_kb_read            │   │
│  │            / yzj_contact_search                                   │   │
│  │  写工具：  yzj_msg_send ──▶ tools/pre-execute 返回 ask            │   │
│  │            ──▶ ctx.approval 等待确认卡放行                         │   │
│  │  服务：yzjReader（mention 解析 / 面板数据 / 增量轮询 diff）        │   │
│  │  通知：schedule every 提醒 ──▶ 到点醒 agent ──▶ 拉增量筛选播报      │   │
│  │  skill：yzj-cli 使用规范（改造自 CLI 自带 SKILL.md）              │   │
│  │                        │ spawn                                     │   │
│  └────────────────────────│──────────────────────────────────────────┘   │
└───────────────────────────│─────────────────────────────────────────────┘
                            ▼
                    yzj-cli（本机，用户本人登录态）
                            ▼ HTTPS
                    云之家公有云 API
```

### 3.2 三个组件 + 一个协议

| 组件 | 形态 | 职责 |
|---|---|---|
| **yzj-tools** | host 插件 | 4 个只读工具 + 1 个门控写工具 + `yzjReader` 服务 + dsh skill |
| **yzj-ui** | client 插件 | 悬浮窗、@ 候选源、拖放 chip、codec、确认卡、面板跳转服务 |
| **mention token 协议** | 纯约定 | `@yzj:{type}:{id}`，type ∈ `msg / group / person / doc` |

协议是三者间唯一契约，也是下期的地基（届时 `@yzj:person:{openId}` 的「发消息」动作已在本期以确认卡形态落地，协议不变）。

### 3.3 四条数据流

1. **拉取流**：模型调只读工具 → host spawn yzj-cli → JSON 结果 → 工具流水线 → 模型；
2. **注入流**：拖放/@ 产生 `ReferenceInsert{ref: "@yzj:msg:xxx"}` → 提交时 `codec.serialize(ref)` → 调 host `yzjReader` 拉真实内容 → 模型可见文本；
3. **展示流**：悬浮窗刷新 → client 调 `yzjReader` → 拉取群列表/消息 → 渲染；
4. **确认流（写）**：模型调 `yzj_msg_send` → `tools/pre-execute` 拦截返回 `ask` → 发 `yzj.send/request` 事件 → 对话流渲染确认卡 → 用户点击 → `ctx.approval` 放行 → 工具执行 → `yzj.send/resolved` 事件 → 卡片流转终态；
5. **通知流**：① 面板轮询 `yzjReader` 增量 diff → 角标；② schedule `every` 到点醒 agent → 拉增量、按规则筛选 → 会话内产出通知卡；③ 前两层命中重点 → 浏览器系统通知。详见 §5.3。

---

## 4. 核心交互设计（用户旅程）

> 主角：小舟（dsh + 云之家用户），老黎（产品经理）。公共原则：**引用即指针、懒解析、写动作必过确认卡、人永远在环、一切皆可拖**——悬浮窗内全部条目均可拖入 composer 成为带上下文的 chip，agent 统一处理（总结 / 起草 / 检索 / 写入）。

### 旅程 1｜悬浮窗看消息

小舟打开 dsh，右下角悬浮球带未读角标 → 点开浮层：群列表 tab + 消息流，手动/定时刷新（走 `yzj_msg_list`）。看到重点讨论，选中几条让 agent「总结这几屏」——摘要按需生成。

### 旅程 2｜新消息通知：三层触达

小舟专注写方案，dsh 标签页在后台：

1. **角标层**：悬浮窗按群维护 `lastSeenMsgId`，轮询增量 diff——需求群来了 5 条新消息，悬浮球红点 +5；
2. **筛选播报层**：schedule 的 `every: 15min` 提醒到点，agent 醒来拉各关注群增量，按小舟自定的规则（@我的、含 deadline 的、重点群）筛出 2 条，在会话里产出通知卡：「需求群 · 老黎 @ 你：DDL 提前到周四」＋「查看上下文」按钮；
3. **系统通知层**：命中重点规则 → 浏览器弹系统通知（首次使用需授权一次）。

小舟点系统通知 → 聚焦 dsh → 通知卡点「查看上下文」→ `yzjPanel.open()` 跳悬浮窗锚点。

> 设计要点：第一层回答「有没有新消息」，第二层回答「**值不值得看**」（agent 筛选是差异化），第三层解决「人不在 dsh 前台」。固有边界：轮询无真实时（schedule 最小 5 分钟）、「@我」靠本地文本匹配可能漏判、dsh 进程需存活。

### 旅程 3｜拖消息 → 起草 → 确认卡发送（核心闭环）

1. 小舟把需求群三条消息从浮层**拖进 composer**，每条变成 chip（`老黎 · 昨晚 22:14 · 摘要`）；
2. 输入「基于这几条起草个回复」→ chip 经 codec 序列化为带出处原文注入 → agent 起草；
3. agent 调 `yzj_msg_send` → 被门禁拦截 → 对话流弹出**确认卡**：目标群、消息全文、关联的三条引用；
4. 小舟点「查看上下文」→ **悬浮窗自动展开并定位到那三条消息**，核对语境无误；
5. 点「发送」→ 门禁放行 → 以小舟本人名义发进群 → 卡片流转「已发送 ✓ · 在云之家查看」。

### 旅程 4｜群讨论沉淀知识库（全域写闸门的高光场景）

1. 小舟把需求群五条消息拖进 composer：「整理成一篇《接口改造争议与结论》，存到团队知识库的『需求评审』目录下」；
2. agent 先调 `yzj_kb_read` 查目标目录（先查后写，不编造 ID）→ 起草 otl 智能文档 → 调 `yzj_doc_create`；
3. 门禁拦截 → 确认卡：**目标知识库 / 父目录路径、标题、正文预览、关联的五条消息引用**——点「查看上下文」跳悬浮窗知识库 tab 预览落位；
4. 确认 → 创建 → 卡片终态带 deep link「在云之家打开文档」（按 CLI 自带 url-patterns 规则拼链接）；
5. 同会话顺手起草群消息「结论已沉淀到知识库，链接在此」→ 又一张确认卡 → 发送。

> 设计要点：确认卡不是消息专用，而是**所有写操作的统一闸门**；「讨论 → 结论 → 知识库 → 周知群」是企业知识管理的高光闭环，全程人只点两次确认。

### 旅程 5｜@ 拉上下文

composer 输入 `@` → 候选三组（同事 order=0 / 群 order=1 / 文档 order=2）：

- `@群` → 该群最近消息注入；
- `@同事` → 注入「你与他在共群中的近期发言」（仅有权查看的范围，UI 明示）；选中后也可选「起草消息给他」→ 走确认卡；
- `@文档` → 知识库文档正文注入。

### 旅程 6｜知识库问答

「知识库里接口规范怎么写的」→ 模型自主调 `yzj_kb_read` → 带来源回答。预计日常最高频，Phase 1 结束即可用。

### 旅程 7｜确认卡的完整状态机

`待确认`（确认/编辑/取消/查看上下文）→ `已完成 ✓` / `已取消` / `失败（可重试）`。
「编辑」把草稿塞回 composer 修改后再发起；所有状态由 `yzj.write/request|resolved` 事件族驱动，刷新页面可回放不丢状态。

### 旅程 8｜异常分支

| 分支 | 行为 |
|---|---|
| chip 源消息被撤回/删除 | serialize 时发现源不存在 → chip 变灰提示；**拖入时是否留存快照是待拍板决策**（建议留，标注「快照，原文可能已变」） |
| @同事 越权 | 只返回当前用户有权查看的范围，结果中明示边界 |
| 确认卡无人处理 | 工具调用挂起等待，不产生任何写动作；session 恢复后卡片仍可应答 |
| yzj-cli 未登录 | 工具返回结构化错误 + `yzj-cli auth login` 引导文案 |
| 群/文档 ID 失效 | 不猜测、不编造 ID（CLI 规范红线），返回可操作的重新选择提示 |
| 确认疲劳 | 同会话同目标的连续发送可合并为一次确认（尺度待评审拍板） |

---

## 5. 详细设计

### 5.1 yzj-tools（host 插件）

**插件骨架**：`name` / `inject: ['tools']` / `apply(ctx)`，内部 `spawn('yzj-cli', [...])`，统一输出解析（若 CLI 无 JSON 模式则做文本解析适配层，隔离在一处）。

**工具清单**（「实现工具」列为已落地的对应工具名，验收对照以此列为准；设计名与实现名仅命名差异，功能等价）：

| 工具（设计名） | 实现工具（已落地） | 包装命令 | 门控级别 | 说明 |
|---|---|---|---|---|
| `yzj_group_list` | `yzj_im_group_recent` | `im group` 列表 | 无（只读） | 群 id/名称/最近活跃 |
| `yzj_msg_list` | `yzj_im_message_list` | `im message list` | 无（只读） | `group_id`、`msg_id?`、`type: newest/old/new`、`limit` |
| `yzj_kb_read` | `yzj_doc_workspace_list/get` + `yzj_doc_list/get` + `yzj_doc_block_list` | `doc workspace list` + `doc list/get` + `doc block list` | 无（只读） | 知识库树 / 文档正文 |
| `yzj_contact_search` | `yzj_contact_search`（+ `yzj_contact_get`） | `contact user search/get` | 无（只读） | @同事 候选源 |
| `yzj_sheet_read` | `yzj_sheet_get` + `yzj_sheet_table_get` + `yzj_sheet_record_list` | `sheet` 记录读取 | 无（只读） | 表格/工作表/记录查询 |
| `yzj_msg_send` | `yzj_im_message_send` | `im message send` | 标准确认 | 目标/内容/关联引用入卡 |
| `yzj_sheet_create` | `yzj_sheet_create` | `sheet` 新建多维表格 | 标准确认 | 卡片含表结构（字段清单） |
| `yzj_sheet_write` | `yzj_sheet_record_create/update` | `sheet` 记录新增/更新 | 标准确认 | 卡片显示记录内容；**影子任务库的写入入口** |
| `yzj_sheet_delete` | `yzj_sheet_record_delete` | `sheet` 记录删除 | **强确认** | 同删除类规则 |
| `yzj_doc_create` | `yzj_doc_create` + `yzj_doc_block_insert` | `doc create` + `doc block insert` | 标准确认 | 卡片含落位路径与正文预览 |
| `yzj_doc_update` | `yzj_doc_block_update` / `yzj_doc_rename` / `yzj_doc_move` | `doc block update` / `doc rename` / `doc move` | 标准确认 | 卡片显示变更前后对比 |
| `yzj_doc_import` | `yzj_doc_import` | `doc import` | 标准确认 | 批量导入前显示文件清单 |
| `yzj_kb_create` | `yzj_doc_workspace_create` | `doc workspace create` | 标准确认 | 新建知识库 |
| `yzj_event_create` / `yzj_event_update` | `yzj_calendar_event_create` / `yzj_calendar_event_update` | `calendar event` 新建/修改 | 标准确认 | 卡片显示时间与参与人 |
| `yzj_file_upload` | `yzj_file_upload` | `file` 上传 | 标准确认 | 卡片显示文件与去向 |
| `yzj_doc_delete` | `yzj_doc_delete`（+ `yzj_doc_block_delete`） | `doc delete` / `doc block delete` | **强确认** | 不可逆：红色卡片 + 完整路径，不参与合并确认 |
| `yzj_event_delete` | `yzj_calendar_event_delete` | `calendar event` 删除 | **强确认** | 同上 |

**实现已落地的补充工具**（设计清单未列、已在实现中验证可用的扩展；门控级别按设计分级标注，实际入闸情况见 gap 对照文档 §2）：

| 工具 | 包装命令 | 门控级别 | 说明 |
|---|---|---|---|
| `yzj_whoami` | `contact user get` | 无（只读） | 当前登录用户身份 |
| `yzj_contact_get` | `contact user get --open-id` | 无（只读） | 按 openId 取用户详情（可批量） |
| `yzj_doc_workspace_get` | `doc workspace get` | 无（只读） | 单个知识库详情 |
| `yzj_doc_recent` | `doc recent` | 无（只读） | 最近访问文档（分页游标） |
| `yzj_doc_download_url` | `doc download-url` | 无（只读） | Office/HTML 临时下载链接（30 分钟有效） |
| `yzj_doc_block_list` | `doc block list` | 无（只读） | 文档块结构读取（拖入文档的全文回源） |
| `yzj_sheet_table_get` | `sheet table get` | 无（只读） | 数据表结构（字段/视图） |
| `yzj_sheet_table_create` | `sheet table create` | 标准确认 | 新建数据表（fields/views JSON） |
| `yzj_sheet_table_rename` | `sheet table rename` | 标准确认 | 重命名数据表 |
| `yzj_sheet_table_delete` | `sheet table delete` | **强确认** | 删除数据表及其全部记录，不可逆 |
| `yzj_calendar_event_get` | `calendar event get` | 无（只读） | 日程详情 |
| `yzj_calendar_event_participants` | `calendar event participants` | 无（只读） | 日程参会人 |
| `yzj_calendar_room_find` | `calendar room find` | 无（只读） | 单日空闲会议室查询 |
| `yzj_file_download` | `file download` | 标准确认（覆盖时） | 按 fileId 下载；`--overwrite` 覆盖已有文件需确认 |

**顺带：待办预研探针（影子任务库）**。用一张多维表格当轻量任务库，字段直接按未来待办 API 设计：`todo_id`（稳定 ID）/ 标题 / `status`（pending→in_progress→done 状态机）/ 负责人 openId / DDL / **来源消息链接**（拖入消息的溯源链）/ 推进日志。agent 经 `yzj_sheet_write` + 确认卡创建和推进记录——待办的核心交互（创建/分配/推进/查逾期）在正式功能上线前即可被真实使用验证，**每条卡点都是一条待办 API 需求**；正式功能上线后影子库可平滑迁移。

**统一写门禁**：`ctx.on('tools/pre-execute', ...)` 按工具名查风险分级表——只读直接放行；标准确认 / 强确认工具返回 `ask` 并发出 `yzj.write/request` 事件（含稳定 `writeId`、domain、操作类型、风险级别、完整参数、关联引用）→ `ctx.approval` 挂起等待 → 用户点击后放行或拒绝 → `yzj.write/resolved`（done / cancelled / failed + 结果或错误）。规则：删除类永远强确认且不参与合并；标准确认可同会话同目标合并（尺度评审拍板）；skill 层「写前先查、禁止编造 ID」对全部写工具生效。

**yzjReader 服务**：供 client 调用的解析服务，输入 mention token 或面板查询，输出内容 + 展示元数据（含出处）。append-only 本地缓存，为「撤回检测」和悬浮窗共用。

**dsh skill**：改造 CLI 自带 `SKILL.md`——保留「禁止编造 ID」「写前先查」红线，补充规则：**任何 `yzj_msg_send` 必须基于用户明确要求起草，不得主动群发**；补充四种 mention 的使用引导。

### 5.2 yzj-ui（client 插件）

**悬浮窗**：注册进 `shell.overlay`。收起态为右下角圆球（未读角标），展开态为可拖拽定位面板，四 tab——知识库（工作区 → 文档树钻取）、日程（当日）、会话（最近群 → 消息流）、我的（身份 + 通讯录搜索），每个 tab 带手动刷新，会话 tab 支持双向分页（加载更多会话 / 更早消息）。数据经 `yzjReader`。

**@ 候选源**：实现 `InputTriggerSource` 注册进 `ctx.inputTriggers`；`candidates()` 实时调 `yzj_contact_search` / `yzj_group_list` / 知识库检索（防抖 + AbortSignal）；`onPick()` 返回 `ReferenceInsert`。

**ReferenceCodec**：`serialize(ref)` → 调 `yzjReader` → 返回带来源的文本块：

```
[引用 · 群「需求评审」· 老黎 · 2026-08-13 22:14]
接口改造这版必须周五前定，性能方案还没影……
```

**拖放（全条目，设计原则「一切皆可拖」）**：悬浮窗内**全部条目**——知识库、文档/多维表格节点、日程、会话、消息、联系人搜索结果——均提供拖拽手柄，`dragstart` 写 `dataTransfer.setData('application/x-yzj-ref', ref)`（只传指针）；composer drop 时构造与 `onPick` 相同的 `ReferenceInsert` 走同一插入管道。拖入即成带上下文的 chip，提交时经 codec 回源注入，agent 统一处理（总结 / 起草 / 检索 / 写入）。多条 chip 序列化时按时间排序合并为一个引用块。

**条目回源规格**（chip 提交时 codec 按条目类型回源注入）：

| 条目 | chip 序列化内容（codec 回源） | 回源端点 |
|---|---|---|
| 知识库 | 名称 + 类型 + 文档数/成员数 | `workspace-get` |
| 文档 | 标题 + 类型 + 更新时间 + 前 10 块文本摘要（≤500 字符，尾部注明「完整内容可用 `yzj_doc_block_list` / `yzj_doc_get` 获取」） | `doc-get` + `doc-blocks` |
| 多维表格节点 | 标题 + 类型 + **表结构摘要**（`sheet get`：表名/字段清单） | `doc-get` + `sheet get` |
| 日程 | 标题 + 时间 + 组织者 + 描述 | `event-get` |
| 会话 | 名称 + 最近若干条消息预览 | `messages` |
| 消息 | **原文**（按 `(groupId, msgId)` 回源拉取，非拖入快照）+ 时间 + 发送人 | `messages` |
| 联系人 | 姓名 + 部门 + 职位 | `contact-get` |

**硬性要求**：

1. **消息 ref 必须携带 `groupId`**（ref = `{groupId}:{msgId}`，见 §5.4）——「拖消息让 agent 处理」的前提；禁止只存 `msgId`（无法回源原文），是旅程 3 的依赖项；
2. **dbt（多维表格）节点回源附 `sheet get` 表结构摘要**——拖入即让 agent 拿到表结构，而非空摘要；
3. **doc 摘要显式提示深度边界**——截断时注明可用的补全工具，给 agent 自愈路径；
4. **拖入即处理引导（P2 可选）**——drop 后 composer 出现快捷动作（如「让 agent 总结这段内容」），一键作为用户消息发送，把「拖入 → 发指令」两步并一步；不影响既有插入管线。

**确认卡（ConversationNodeDefinition，全域通用框架）**：

- 事件族：`yzj.write/request`（start：`writeId`、domain、风险级别、操作摘要、完整参数、关联引用、Turn/Step 坐标）、`yzj.write/resolved`（update：终态 + 结果）——满足可回放要求，不依赖内存态；
- 渲染：一个 keyed Chat 卡片框架，按 domain 分发子组件——消息卡（目标+全文）、文档卡（落位路径+正文预览/前后对比）、删除卡（红色强确认样式）、日程卡（时间+参与人）、文件卡（文件+去向）、表格卡（表结构/记录内容摘要）；
- 按钮：确认 / 编辑 / 取消 / 查看上下文；
- 终态联动：成功卡片带 deep link——消息类跳悬浮窗消息锚点；文档类按 CLI 自带 url-patterns 规则拼云之家文档 URL，「在云之家打开」；
- 悬浮窗四 tab（知识库 / 日程 / 会话 / 我的）与确认卡联动：「查看上下文」按 domain 落到对应 tab——消息类落会话 tab 并定位锚点消息；文档类落知识库 tab 预览落位。

**面板跳转服务 `yzjPanel`**：client 侧共享服务。卡片「查看上下文」调 `yzjPanel.open({ groupId, anchorMsgId })` → 面板展开、切到对应群、滚动定位锚点消息并高亮。确认卡与悬浮窗两个插件仅靠该服务通信，保持解耦。

### 5.3 通知机制

**第一层：悬浮窗角标（client 轮询）**
面板按群维护 `lastSeenMsgId`，经 `yzjReader` 增量拉取（`im message list --type new`）做 diff：面板展开时约 30s 一轮，收起时 3~5 分钟一轮。产出悬浮球红点与群 tab 角标。`yzj-cli` 群列表是否自带未读数列为 P0 验证项；若无则完全靠本地 diff。

**第二层：schedule 驱动的会话内筛选播报（host）**
用户或 skill 引导创建 `every` 持久提醒（≥5 分钟，建议 15 分钟起）。到点 dispatch 为原会话的一个普通轮次：agent 调只读工具拉增量 → 按用户规则筛选 → 产出通知文本，client 渲染为通知卡（复用 ConversationNodeDefinition，事件族 `yzj.notify/*` 携带锚点 token，可回放）。host 侧执行，浏览器标签页关闭也能跑，事后打开仍可见。前置：dsh 进程存活。

**第三层：浏览器系统通知（client 自接）**
dsh 当前无任何 Notification API 封装（全仓核验为零），由 yzj-ui 自行接浏览器 Notification：首次使用引导授权；命中重点规则时弹通知；点击回调 → 聚焦标签页 + `yzjPanel.open(锚点)`。限制：标签页须开着。

**下期替换**：webhook/机器人通道落地后，第一层轮询替换为真推送，第二层筛选逻辑不变（只是触发源从定时器换成事件）。

### 5.4 mention token 协议

```
@yzj:{type}:{id}

type = msg    → id 为 {groupId}:{msgId}     （拖入的消息）
     = group  → id 为 {groupId}              （@群）
     = person → id 为 {openId}               （@同事）
     = doc    → id 为 {docId}                （@文档）
```

规则：token 只含指针；解析以序列化时刻为准；解析失败降级为明确提示而非静默丢弃；所有解析记录出处（Trajectory 可回放「本轮对话引用了哪些云之家内容」）；确认卡中携带的关联引用同样用 token 表达，「查看上下文」按 token 定位。**实现硬性要求：消息 ref 必须携带 `groupId`（`msg` 的 id 为 `{groupId}:{msgId}`），禁止仅存 `msgId`——否则 chip 无法回源原文，「拖消息让 agent 处理」不成立（旅程 3 依赖，§5.2 硬性要求 1）。**

### 5.5 安全与权限

- **写动作单点门控**：全部写工具（消息/文档/知识库/日程/文件/表格）收敛到同一道 pre-execute ask 门禁 + 风险分级表，无旁路；skill 层再声明一次；
- **身份**：发送即用户本人身份，无机器人冒充问题；确认卡必须展示完整目标与全文，不允许折叠截断；
- **数据边界**：@同事拉上下文 = 当前登录用户有权查看的范围，UI 明示；
- **凭据**：复用 yzj-cli 的 OS 密钥链，插件不接触 token 明文；
- **审计**：每次确认/放行/执行均落在 append-only 会话日志，Trajectory 可回放「谁确认的、发的什么」；
- **快照决策**：拖入 chip 是否留存内容快照，需产品拍板（隐私 vs 可用性）。

---

## 6. 实施路线与验收

### Phase 0｜环境验证（约 1 天）

```bash
npx @deepseek-ai/dsh web        # 跑通 dsh
npm i -g @yunzhijia/cli         # 安装 CLI
yzj-cli auth login              # 浏览器登录
yzj-cli im message list --group-id <id>   # 验证消息读取
yzj-cli doc workspace list                 # 验证知识库
```

跑通 dsh 官方插件教程第 7 章（工具注册全链路）。

### Phase 1｜yzj-tools（约 2~3 天）

产出：host 插件 + 5 个只读工具 + 全域写工具（含 sheet，统一 pre-execute ask 门禁 + 风险分级，先用 dsh 内置确认 UI 跑通）+ yzjReader + dsh skill + **影子任务库表结构**（sheet 实现，字段对齐未来待办 API）。
**验收**：旅程 6（知识库问答）达成；「给老黎发条消息说方案周五给」与「把刚才的结论建篇文档存进知识库」均被门禁正确拦截并要求确认，删除类操作呈现强确认；「把这条消息建成任务分给老黎、DDL 周五」经确认卡写入影子任务库；`every` 提醒能到点唤醒 agent——**此时已有日常使用价值**。

### Phase 2｜yzj-ui（约 8~10 天）

产出：悬浮窗（知识库 / 日程 / 会话 / 我的四 tab，**全条目可拖拽**）+ @ 三组候选 + 拖放 chip（§5.2 回源规格 + 四条硬性要求）+ codec + 全域确认卡（按 domain 分发渲染）+ 面板跳转 + 三层通知。
**验收**：旅程 3 全闭环——拖三条消息进 composer（**消息 chip 提交时回源注入原文，非标题快照**），agent 起草，确认卡弹出，点「查看上下文」跳转悬浮窗定位锚点，核对后点发送，消息以本人身份进群，卡片流转「已完成」；**全量拖拽验收**——六类条目（知识库/文档/多维表格/日程/会话/联系人）逐一拖入均成 chip 且回源内容符合 §5.2 规格表，dbt 节点拖入附表结构摘要，消息 chip 验证原文回源；旅程 4（讨论沉淀知识库，含文档 deep link 回跳）与旅程 1/2/5/7/8 同步验收，其中旅程 2 需验证「dsh 在后台时，schedule 播报 + 系统通知」的完整触达链。

### 工作量汇总

| 阶段 | 内容 | 估算 |
|---|---|---|
| P0 | 环境与教程 | 1 天 |
| P1 | tools 插件（含门禁） | 2~3 天 |
| P2 | UI 插件（含确认卡、跳转、三层通知） | 8~10 天 |
| 缓冲 | dsh 版本跟进/联调 | 2 天 |

---

## 7. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| dsh v0.1 破坏性变更（官方明示） | 高 | 锁定验证过的版本开发；工具注册/事件为核心稳定面，slot/inputTrigger/ConversationNode 属变动面，P2 开工前先升级复核契约 |
| 确认疲劳（写都需点击） | 中 | 风险分级化解：只读不弹、标准确认可同会话同目标合并（尺度评审拍板）、删除类永远强确认；宁可烦不可错 |
| 误删除等不可逆写操作 | 中 | 删除类强确认卡（红色 + 完整目标路径）；skill 层声明删除前必须复述目标 |
| yzj-cli 无源码仓库、行为不可审计 | 中 | 输出适配层隔离；版本锁范围；与 CLI 维护团队（内部）建联 |
| CLI 无 JSON 输出模式（待确认） | 中 | P0 验证；若无则文本解析适配层，并向官方提需求 |
| 隐私合规（@同事拉上下文） | 中 | 严格限定当前用户可见范围；UI 明示边界；评审过法务口径 |
| 消息量大时性能 | 低 | yzjReader 本地缓存 + 增量拉取（msg_id 锚点 + type=new/old） |
| 轮询频率与服务器压力 | 低 | 角标轮询合并为单次多群 diff；schedule 下限 5 分钟；关注群数量设上限 |
| 「@我」漏判 | 低 | 本地匹配规则可配置；向 CLI 团队提「提及我」查询需求 |

---

## 8. 预留：无人值守能力衔接点（下期，不展开）

- **机器人入站通道**：参照 openclaw-yzj（HTTP API + Webhook + msgId 去重），群消息 → `followup()` 进 session；本期确认卡的事件族设计可直接复用为「机器人建议动作→人远程确认」；
- **真·实时通知**：webhook/机器人落地后替换轮询（§5.3 第一层触发源由定时器换成事件，第二层筛选逻辑不变）；推送到云之家侧的播报需机器人；
- **待办**：CLI 待办命令缺失，正是预研功能的 API 需求输入——建议正式待办功能自带：稳定 ID、状态机、幂等创建、变更 webhook、deep link；mention 协议届时扩展 `type = todo`。

---

## 9. 附录

### A. yzj CLI 实测命令清单（v0.1.3）

```
yzj-cli auth login [--device] / logout
yzj-cli contact user search --keyword <词> / user get --open-id <id...>
yzj-cli im message send --group-id <id> --msg-type text --content <文本>   ← 确认卡门控
yzj-cli im message list --group-id <id> [--msg-id <id>] [--type newest|old|new] [--limit 10]
yzj-cli im group ...（群组管理）
yzj-cli doc workspace list [--type personal|enterprise] / get / create
yzj-cli doc list --workspace <id> [--parent-id <id>] / get / recent / block ...
yzj-cli doc download-url --id <id>（Office 附件临时下载，30 分钟有效）
yzj-cli calendar event ... / room ...
yzj-cli sheet ...（多维表格，aitable 别名）
yzj-cli file ...（上传/下载）
全局 flags：--profile <名>  --endpoint <https url>  --debug  --verbose
```

### B. dsh 关键 API 速查（源码路径）

| 用途 | API | 位置 |
|---|---|---|
| 工具注册 | `ctx.tools.register(defineTool({...}))` | `docs/cordis-tutorial/07-into-the-harness.zh.md` |
| 权限门禁（确认闸门） | `tools/pre-execute` 返回 `ask` + `ctx.approval` | `docs/cookbook/extension-cookbook.zh.md`、`packages/client/ui-permission-presets` |
| 自定义对话卡片 | `ConversationNodeDefinition` + keyed Chat renderer | `docs/cookbook/adding-a-conversation-node.zh.md` |
| 浮层槽位 | `ctx.slots.register({...}, Component)` 进 `shell.overlay` | `packages/client/ui-layout/src/client/index.ts`、`packages/client/runtime/src/client/slots.ts` |
| 注册范式参照 | `ctx.slots.inject(name, () => ctx.slots.register(...))` | `packages/client/ui-trajectory/src/client/index.ts` |
| @ 触发源 | `ctx.inputTriggers` + `InputTriggerSource` | `packages/client/ui-input-trigger/src/types.ts` |
| 引用序列化 | `ReferenceCodec.serialize(ref, signal)` | 同上 |
| 请求钩子（仅 call config，不可用于注入） | `agent/request` → `LlmCallConfig` | `packages/core/agent/src/runtime-types.ts` |
| 调度（通知播报用） | `schedule_create` 工具（after/at/every，every ≥5min，持久） | `packages/schedule/schedule/README.md`、`docs/subsystems/schedule.zh.md` |
| 系统通知（dsh 无封装，自接） | 浏览器 Notification API | yzj-ui 插件自行接入 |

### C. 参考来源

- yzj CLI：<https://www.npmjs.com/package/@yunzhijia/cli>（v0.1.3 实测）
- DeepSeek Harness：<https://github.com/deepseek-ai/deepseek-harness>（master 源码核验，2026-08-14）
- openclaw-yzj：<https://github.com/kingdee/openclaw-yzj>
- 云之家开放平台：<https://open.yunzhijia.com/>
