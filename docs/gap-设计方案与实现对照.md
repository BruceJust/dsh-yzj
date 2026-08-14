# 云之家-dsh 集成：设计方案 × 已有实现 对照与 Gap 分析

> 对齐对象：`docs/云之家-dsh集成整体方案.md`（v1.6，预研稿，**最终验收基准**；v1.4 基础上补齐工具清单、「一切皆可拖」原则与全量拖拽完整规格）↔ 本仓库现有实现（`packages/bridge`、`packages/tool-yzj`、`packages/ui-yzj`、`packages/bundle`，git c7dd879）
> 核验日期：2026-08-14 之后（实现开发期）
> v1.1 增补：补全实现侧全部工具明细（§2，含设计清单未写明的工具）；新增设计补强「悬浮窗全量拖拽 → composer」（§2A，用户思路）；§15 优先级同步更新。
> 结论先行：**实现完成度约 55%**。架构三组件已立起两个半（bridge ✅、tools ✅、ui 悬浮窗/@/chip/codec ✅），但**确认卡框架、mention 协议、三层通知、yzjReader、skill、影子任务库六块缺口**中，前两块是设计核心，其余四块是 Phase 1/2 验收项。另有两处**实现与设计直接冲突**（mention 协议格式、消息 ref 丢失回源能力），需优先决策。

---

## 1. 总体对照（§3.2 三个组件 + 一个协议）

| 设计（§3.2） | 实现 | 状态 |
|---|---|---|
| **yzj-tools**（host）：4 只读工具 + 1 门控写工具 + `yzjReader` 服务 + dsh skill | `@dsh-yzj/bridge`（`ctx.yzjBridge` 子进程通道）+ `@dsh-yzj/tool-yzj`（41 个工具，六域）+ `src/guard.ts`（pre-execute ask 门禁） | 🟡 工具面远超设计（41 vs 设计清单）；门禁有；**缺 yzjReader 服务、缺 dsh skill 交付物** |
| **yzj-ui**（client）：悬浮窗、@ 候选源、拖放 chip、codec、确认卡、面板跳转服务 | `@dsh-yzj/ui-yzj`：sidebar 按钮 + `shell.overlay` 面板（知识库/日程/会话/我的四 tab）、`inputTriggers` @ 源、composer drop band + chip、`ReferenceCodec.serialize` 回源拉上下文 | 🟡 悬浮窗/@/chip/codec 齐；**缺确认卡（ConversationNodeDefinition）、缺 yzjPanel 跳转服务** |
| **mention token 协议** `@yzj:{type}:{id}`，type ∈ msg/group/person/doc | `yzj:{JSON}` 前缀编码（`encodeRef`），kind ∈ workspace/doc/group/event/contact/message | 🔴 **协议不兼容**，见 §3 |

## 2. 工具清单对照（§5.1）

设计清单 → 实现映射（功能覆盖 ✅，命名不一致）：

| 设计工具 | 门控级别 | 实现工具 | 状态 |
|---|---|---|---|
| `yzj_group_list` | 只读 | `yzj_im_group_recent` | ✅ 命名不同 |
| `yzj_msg_list` | 只读 | `yzj_im_message_list` | ✅ |
| `yzj_kb_read` | 只读 | `yzj_doc_workspace_list/get` + `yzj_doc_list/get/recent` + `yzj_doc_block_list` | ✅ 拆分为 6 个工具 |
| `yzj_contact_search` | 只读 | `yzj_contact_search` + `yzj_contact_get` + `yzj_whoami` | ✅ |
| `yzj_sheet_read` | 只读 | `yzj_sheet_get` + `yzj_sheet_table_get` + `yzj_sheet_record_list` | ✅ |
| `yzj_msg_send` | 标准确认 | `yzj_im_message_send` | ✅ 入 ask 门禁 |
| `yzj_sheet_create` | 标准确认 | `yzj_sheet_create` | ✅ |
| `yzj_sheet_write` | 标准确认 | `yzj_sheet_record_create/update` | ✅ |
| `yzj_sheet_delete` | 强确认 | `yzj_sheet_record_delete` | ✅ 有门禁，但无分级（见 §4） |
| `yzj_doc_create` | 标准确认 | `yzj_doc_create` + `yzj_doc_block_insert` | ✅ |
| `yzj_doc_update` | 标准确认 | `yzj_doc_block_update` + `yzj_doc_rename` + `yzj_doc_move` | ✅（move 亦入 ask 门禁） |
| `yzj_doc_import` | 标准确认 | `yzj_doc_import` | ✅（无门禁） |
| `yzj_kb_create` | 标准确认 | `yzj_doc_workspace_create` | ✅（无门禁） |
| `yzj_event_create/update` | 标准确认 | `yzj_calendar_event_create/update` | ✅（无门禁） |
| `yzj_file_upload` | 标准确认 | `yzj_file_upload` | ✅ 入 ask 门禁 |
| `yzj_doc_delete` | 强确认 | `yzj_doc_delete` | ✅ 入 ask 门禁 |
| `yzj_event_delete` | 强确认 | `yzj_calendar_event_delete` | ✅ 入 ask 门禁 |

**实现超配项（设计 §5.1 未写明、实现已落地的工具）**：

| 实现工具 | 作用 | 包装 CLI 命令 | 门控 |
|---|---|---|---|
| `yzj_doc_workspace_get` | 单个知识库详情（名称/成员数/文档数） | `doc workspace get --id` | 只读 |
| `yzj_doc_recent` | 最近访问文档（跨知识库，分页游标） | `doc recent` | 只读 |
| `yzj_doc_download_url` | Office/HTML 节点临时下载链接（30 分钟有效） | `doc download-url --id` | 只读 |
| `yzj_doc_block_list` | 文档块结构（类型/id/文本预览，可锚定子树） | `doc block list` | 只读 |
| `yzj_sheet_table_get` | 单个数据表结构（字段/视图） | `sheet table get` | 只读 |
| `yzj_sheet_table_create` | 新建数据表（fields/views JSON） | `sheet table create` | 写，**未入闸** |
| `yzj_sheet_table_rename` | 重命名数据表 | `sheet table rename` | 写，**未入闸** |
| `yzj_sheet_table_delete` | 删除数据表及其全部记录（不可逆） | `sheet table delete` | 写，ask ✅ |
| `yzj_calendar_event_get` | 单个日程详情 | `calendar event get --id` | 只读 |
| `yzj_calendar_event_participants` | 日程参会人列表 | `calendar event participants` | 只读 |
| `yzj_calendar_room_find` | 单日空闲会议室查询 | `calendar room find` | 只读 |
| `yzj_file_download` | 按 fileId 下载（自动重命名 / `--overwrite` 覆盖） | `file download` | 写，`--overwrite` 时 ask ✅ |
| `yzj_contact_get` | 按 openId 取用户详情（可批量） | `contact user get --open-id` | 只读 |
| `yzj_whoami` | 当前登录用户身份 | `contact user get` | 只读 |

> 说明：写工具的门禁覆盖与设计清单并非一一对应——`yzj_doc_workspace_create`、`yzj_doc_import`、`yzj_calendar_event_create/update`、`yzj_sheet_record_create/update` 等设计列了「标准确认」的写工具**没有**进 `guard.ts` 的 DANGEROUS 表（即不弹确认）。设计 §5.1 明确「全部写工具（消息/文档/知识库/日程/文件/表格）收敛到同一道 pre-execute ask 门禁」，实现只覆盖了「不可逆/有外部副作用」的子集。**这是门禁范围 gap（🟡 偏 🔴）**：标准确认与强确认两级尚未实现，部分标准确认写工具完全无闸。
>
> 当前**已入闸**（`src/guard.ts`）：`yzj_doc_delete`、`yzj_doc_move`、`yzj_doc_block_delete`、`yzj_sheet_table_delete`、`yzj_sheet_record_delete`、`yzj_calendar_event_delete`、`yzj_im_message_send`、`yzj_file_upload`、`yzj_file_download`（`overwrite: true`）。
> 当前**未入闸的标准确认写工具**（对照设计清单）：`yzj_doc_workspace_create`、`yzj_doc_create`、`yzj_doc_rename`、`yzj_doc_import`、`yzj_doc_block_insert`、`yzj_doc_block_update`、`yzj_sheet_create`、`yzj_sheet_table_create`、`yzj_sheet_table_rename`、`yzj_sheet_record_create`、`yzj_sheet_record_update`、`yzj_calendar_event_create`、`yzj_calendar_event_update`。

## 2A. 设计补强｜悬浮窗全量可拖拽 → composer（用户思路）

> **思路声明（用户）**：悬浮窗里**所有东西**都能拖进 composer，交给 agent 处理。拖拽是统一入口——不区分「引用」与「数据」，任何条目拖入即成带上下文的 chip，提交时经 codec 回源注入，agent 据此处理（总结 / 起草 / 检索 / 写入）。

### 现状对照（panel.tsx 六类数据条目全部带 `draggable` + `onDragStart`）

| 条目（所属 tab） | 可拖 | chip 序列化内容（codec 回源） | 回源能力 |
|---|---|---|---|
| 知识库（知识库 tab） | ✅ | 名称 + 类型 + 文档数/成员数 | ✅ `workspace-get` |
| 文档 / 多维表格节点（知识库 tab） | ✅ | 标题 + 类型 + 更新时间 + 前 10 块文本摘要（≤500 字符） | ✅ `doc-get` + `doc-blocks`；🟡 dbt 节点无块内容 → 摘要为空，只给元信息 |
| 日程（日程 tab） | ✅ | 标题 + 时间 + 组织者 + 描述 | ✅ `event-get` |
| 会话（会话 tab） | ✅ | 名称 + 最近 6 条消息预览 | ✅ `messages` 回源 |
| 消息（会话 tab 消息流） | ✅ | 内容快照 + 时间（**无群归属 → 无法回源拉原文**） | ❌ 见 §3 P0 |
| 联系人（我的 tab 搜索结果） | ✅ | 姓名 + 部门 + 职位 | ✅ `contact-get` |
| 我的身份卡 | —（非数据条目，无可拖语义） | — | — |

**结论：思路已被现有实现承接约 95%**——六类条目全部可拖、全部有 chip、提交时经 codec 异步回源注入上下文；agent 拿到上下文后可自行调 yzj 工具深化处理（如再 `yzj_doc_block_list` 读全文、`yzj_im_message_list` 补上下文）。「拖入 → 指令 → agent 处理」管线已通。

### 补齐缺口

1. **消息回源（P0，与 §3 同源问题）**：拖入消息必须携带 `groupId`，serialize 按 `(groupId, msgId)` 拉原文——否则「拖消息让 agent 处理」只能基于标题快照，这是全量拖拽的头号缺口。
2. **dbt（多维表格）节点拖入附数据预览（P2）**：dbt 节点无块内容，建议 codec 对 `fileSuffix === 'dbt'` 追加 `sheet get` 摘要（表名/字段清单），让 agent 拖入即拿到表结构。
3. **doc 摘要深度提示（P2）**：摘要截断在 10 块 / 500 字符，建议序列化文本尾部显式注明「内容为摘要，完整内容可用 `yzj_doc_block_list` / `yzj_doc_get` 获取」，给 agent 一条自愈路径（工具描述已有先查指引，这里显式化更稳）。
4. **拖入即处理的引导（P2，可选）**：drop 后 composer 出现快捷动作（如「让 agent 总结这段内容」），一键作为用户消息发送，把「拖入 → 发指令」两步并一步；不影响既有插入管线。

> **设计文档同步状态**：以上内容已全部并入设计文档 v1.6（最终验收基准）——§4 公共原则第五条「一切皆可拖」；§5.2 拖放扩为「全条目拖拽」完整规格（条目回源对照表 + 四条硬性要求：消息必带 groupId、dbt 附表结构、doc 摘要深度提示、拖入即处理引导）；悬浮窗四 tab；§5.1 工具清单补齐补充工具并加「实现工具」映射列；§5.4 补消息 groupId 硬性要求；§6 Phase 2 产出与验收同步全量拖拽。

## 3. mention token 协议（§5.4）— 🔴 直接冲突

| 维度 | 设计 | 实现（`input-source.ts` `encodeRef`） | 影响 |
|---|---|---|---|
| 格式 | `@yzj:{type}:{id}`（冒号分隔指针） | `yzj:{"kind":"...","id":"...","title":"...","url":"...","sub":"..."}`（JSON 前缀） | 协议不可互认；下期「@yzj:person:{openId} 发消息」扩展点不成立 |
| 类型 | msg / group / person / doc | workspace / doc / group / event / contact / message | 实现更宽（含日程），但名字不对齐 |
| **消息指针** | `msg` → id = `{groupId}:{msgId}`，**可完整回源** | `message` 的 `id` 只有 `msgId`，**groupId 未随拖拽载荷传递**（`panel.tsx` drag 时 `url` 未设置；`context.ts` 用 `ref.url` 反推 groupId 得到空串） | **旅程 3 核心断链**：消息 chip 的 `serialize()` 无法回源拉原文，只能注入拖入时的标题+时间快照（"带出处原文注入"在消息场景不成立）。群/文档/日程/联系人 ref 有完整 id，回源正常 |
| 懒解析 | 序列化时刻解析 | ✅ `serialize` 时经 RPC 拉取 | 一致 |
| 失败降级 | 明确提示而非静默 | 🟡 回源失败时仅输出标题头（静默降级，无「解析失败」提示） | 弱于设计 |
| 出处记录 | Trajectory 可回放「引用了哪些云之家内容」 | 🟡 序列化文本随消息落日志，但**无结构化引用事件**（无 `yzj.ref/*` 事件族），回放只能看文本 | 弱于设计 |

**建议**：二选一，尽快定夺。
- A（跟随设计）：把 ref 改为 `@yzj:{type}:{id}` 指针协议，消息 id 用 `{groupId}:{msgId}`；解析统一收敛到 host 侧（yzjReader 服务），client codec 只持有指针。
- B（保留 JSON，最小修复）：继续 `yzj:{json}`，但**拖拽消息时必须携带 groupId**，并在 serialize 里用 `(groupId, msgId)` 回源拉原文。类型名按设计改为 msg/group/person/doc 至少留别名。

## 4. 确认流 / 确认卡（§3.3 流 4、§5.1 统一写门禁、§5.2 确认卡、旅程 7）— 🔴 核心缺口

设计要求：`tools/pre-execute` 按**风险分级表**返回 ask（标准/强确认）→ 发出 `yzj.write/request` 事件（稳定 writeId、domain、操作类型、风险级别、完整参数、关联引用）→ 对话流渲染**按 domain 分发的确认卡**（消息/文档/删除红卡/日程/文件/表格）→ 按钮：确认/编辑/取消/查看上下文 → 用户点击 → `ctx.approval` 放行 → `yzj.write/resolved`（done/cancelled/failed）→ 终态联动（deep link）→ 刷新页面可回放。

实现现状：

| 设计点 | 实现 | 状态 |
|---|---|---|
| pre-execute 返回 ask | `guard.ts` 返回 `{ kind: 'ask', reason }`，由内置 ApprovalService 路由到 **GUI 批准面板** | ✅ 闸门成立（写不落地、有审计） |
| 风险分级（标准/强确认） | 单级 ask，无分级字段 | ❌ |
| `yzj.write/request\|resolved` 事件族 + writeId | 无自定义事件（内置批准面板有自身的 ask/resolve 审计事件，但无业务 writeId、无 domain/风险级别/关联引用元数据） | ❌ |
| 按 domain 分发的确认卡（ConversationNodeDefinition） | 无（工具结果有 `tool.call.toolview` 富卡片，但那是**结果卡**，不是**确认卡**） | ❌ 机制已确认存在（harness 中 ui-conversation 注册面完备） |
| 确认/编辑/取消/查看上下文 | 内置批准面板只有批准/拒绝 | ❌（编辑=塞回 composer 未实现） |
| 终态流转 + 刷新可回放 | 内置面板事件可回放（✓），但无业务卡片态 | 🟡 |
| 终态 deep link | 文档类工具返回 `docLink()` ✅；消息类「跳悬浮窗锚点」❌ | 🟡 |
| 标准确认同会话同目标合并 | 未实现（设计亦标注「待评审拍板」） | ⚪ 待定项 |
| 强确认红色卡片 / 不参与合并 | ❌ | ❌ |

**影响**：旅程 3/4/7 的「确认卡」体验整体缺失；当前写操作走通用批准面板，功能安全但不符合设计的核心差异化（按 domain 的上下文核对 + 一键跳转悬浮窗定位）。

## 5. yzjReader 服务（§5.1）— 🟡 半替代

设计：host 侧解析服务——输入 mention token 或面板查询 → 内容 + 展示元数据（含出处）；**append-only 本地缓存**，为撤回检测与悬浮窗共用。

实现：`ui-yzj` node half 提供 `/yzj` Connection RPC channel（`workspaces/docs/events/groups/messages/whoami/search/doc-get/doc-blocks/workspace-get/event-get/contact-get`，authority loopback）；client 侧 `context.ts` 用**内存 Map** 做 ref→context 缓存。

| 设计点 | 实现 | 状态 |
|---|---|---|
| 面板查询 | RPC channel 全覆盖（超设计：含 event/contact/doc-blocks） | ✅ |
| mention token 解析 | client 侧 `decodeRef` + `fetchRefContext` 自建（非 host 统一服务） | 🟡 功能有、形态不同 |
| append-only 本地缓存 | 内存 Map（`contextCache`），刷新即失；非 append-only 落盘 | ❌ |
| 撤回检测（chip 源被撤回/删除 → 变灰） | 无 | ❌ |
| 出处（Trajectory 可回放） | 无结构化引用事件 | ❌ |

## 6. 悬浮窗（§5.2、旅程 1）— 🟡 大部分达成

| 设计点 | 实现 | 状态 |
|---|---|---|
| 注册进 `shell.overlay` | ✅（`ui-yzj` client `slots.inject('shell.overlay', ...)`，已核验该槽在 harness ui-layout 存在） | ✅ |
| 收起态悬浮球 + 未读角标 | 实现为侧边栏底部按钮（非右下角悬浮球）；群列表有 CLI `unreadCount` 徽标 | 🟡 形态不同；角标靠 CLI 静态值 |
| 展开面板：群 tab + 消息流 | ✅ 会话 tab（最近群列表 → 消息流，双向分页：加载更多会话/更早消息） | ✅ |
| 知识库 tab（文档树预览） | ✅ 知识库 tab（workspace → doc 钻取） | ✅ |
| 手动/定时刷新 | 手动刷新按钮 ✅；定时刷新 ❌ | 🟡 |
| 拖拽消息/文档 | ✅（kind: message/doc/group/event/contact/workspace 均可拖） | ✅ |
| 面板内写操作 | 只读浏览（设计一致：写走对话+确认） | ✅ |
| **第一层通知：lastSeenMsgId diff + 悬浮球红点 +N、30s/3~5min 轮询** | ❌ 未实现 | 🔴 属 §8 通知 |

## 7. @ 候选源与 codec（§5.2、旅程 5）— 🟡 简化实现

| 设计点 | 实现 | 状态 |
|---|---|---|
| `ctx.inputTriggers` 注册 InputTriggerSource | ✅ `applyYzjAtSource`（`registerSource`，harness API 已核验） | ✅ |
| 三组候选：同事 order=0 / 群 order=1 / 文档 order=2 | 单组「云之家」（order=5），组内混排：知识库 → 会话 →（输入查询时）联系人 | ❌ 分组与排序不符合设计；**无文档候选**（知识库下文档需进面板翻，@ 菜单不给文档） |
| @同事 越权边界 | CLI 语义天然限定 ✅；UI 明示边界 ❌ | 🟡 |
| @同事 选中后「起草消息给他」→ 确认卡 | ❌（onPick 仅插入引用） | ❌ |
| ReferenceCodec.serialize 异步回源 | ✅（`context.ts` 按 kind 拉详情/摘要/最近消息） | ✅ |
| 多 chip 序列化按时间排序合并为一个引用块 | ❌（每个 chip 独立 serialize） | ❌ |
| chip 源被撤回/删除 → 变灰 | ❌ | ❌（旅程 8） |
| 拖入时留存快照决策 | ❌ 未留快照也未标注（设计标注为待拍板项） | ⚪ 待拍板 |

## 8. 三层通知（§5.3）— 🔴 全部未实现

| 层 | 设计 | 实现 | 可行性 |
|---|---|---|---|
| 1 悬浮窗角标 | 按群维护 `lastSeenMsgId`，`im message list --type new` 增量 diff；展开 30s / 收起 3~5min 轮询 | ❌（仅有 CLI `unreadCount` 静态展示） | 可行，RPC channel 已支持 `type: new` + `msgId` 锚点 |
| 2 schedule 筛选播报 | `every` 持久提醒（≥5min）→ 原 session 普通轮次 → agent 拉增量筛选 → 通知卡（`yzj.notify/*` ConversationNode） | ❌ | 可行：harness `schedule_create` 工具已核验存在 |
| 3 浏览器系统通知 | 自接 Notification API（harness 无封装，已核验全仓无 `new Notification`） | ❌ | 可行，需自接 |

## 9. 面板跳转服务 yzjPanel（§5.2）— ❌ 未实现

无 `yzjPanel.open({ groupId, anchorMsgId })` 服务；面板无锚点定位/高亮能力。确认卡缺失使该服务无消费者，属联动缺口（P2 确认卡落地时一并实现）。

## 10. dsh skill（§5.1）— ❌ 未随仓库交付

设计：改造 CLI 自带 SKILL.md（红线「禁止编造 ID」「写前先查」+ 新增「不得主动群发」+ 四种 mention 使用引导），作为插件交付物。
实现：仓库内无 skill 文件；README 仅说明外部 `~/.agents/skills/yzj-cli` 保留为兜底。工具 description 中零散体现了「先查 ID」（如 sheet 工具要求先 `yzj_sheet_get`），但**无成文 skill**。

## 11. 影子任务库（待办预研探针，§5.1 顺带）— ❌ 未实现

设计：一张多维表格当轻量任务库，字段对齐未来待办 API（`todo_id` / 标题 / `status` 状态机 / 负责人 openId / DDL / 来源消息链接 / 推进日志），agent 经 `yzj_sheet_write` + 确认卡创建推进，每条卡点收集待办 API 需求。
实现：sheet 写工具具备（可手工建表），但**无影子库表结构模板、无 skill 引导**，探针未激活。

## 12. 安全与异常分支（§5.5、旅程 8）— 🟡

| 设计点 | 实现 | 状态 |
|---|---|---|
| 写动作单点门禁、无旁路 | ✅ guard.ts 单一钩子 | ✅ |
| 身份=用户本人、凭据走 keychain | ✅ bridge 直启 CLI，harness 不接触 token | ✅ |
| 审计（谁确认的、发的什么） | ✅ 批准面板 ask/resolve 对落会话日志 | ✅ |
| 确认卡展示完整目标与全文 | 内置批准面板展示 reason + 参数 | 🟡 无折叠截断问题，但无业务卡片 |
| 未登录 → 结构化错误 + `yzj-cli auth login` 引导文案 | 🟡 failureDigest 输出 exit+stderr，**无 auth login 引导文案** | 🟡 |
| ID 失效 → 不编造、可操作提示 | ✅ 工具 description 强调先查；错误透传 stderr | ✅ |
| 确认卡无人处理 → 挂起不写 | ✅ 内置批准面板挂起语义一致 | ✅ |

## 13. 旅程与阶段验收对照（§4、§6）

| 旅程 | 状态 | 缺口 |
|---|---|---|
| 1 悬浮窗看消息 | 🟡 | 无角标轮询/定时刷新（浏览可用） |
| 2 三层通知 | 🔴 | 全缺 |
| 3 拖→起草→确认卡→发送 | 🟡 | 拖+起草 ✅；**消息原文回源断链（§3）**；确认卡/查看上下文/终态流转 ❌ |
| 4 讨论沉淀知识库 | 🟡 | 工具链 ✅（含 docLink）；确认卡/落位预览 ❌ |
| 5 @ 拉上下文 | 🟡 | 单组简化 ✅；三组/文档候选/起草消息 ❌ |
| 6 知识库问答 | ✅ | 工具齐备 |
| 7 确认卡状态机 | 🔴 | 未实现（内置面板仅批准/拒绝） |
| 8 异常分支 | 🟡 | 结构化错误 ✅；灰 chip/越权明示/引导文案 ❌ |

| 阶段 | 设计交付 | 实现 | 完成度 |
|---|---|---|---|
| P0 环境验证 | — | 已跑通（验收脚本佐证） | ✅ |
| P1 yzj-tools | 插件+只读+写工具+门禁+yzjReader+skill+影子库 | 工具+门禁 ✅；yzjReader 🟡（RPC 替代）；skill ❌；影子库 ❌ | ~70% |
| P2 yzj-ui | 悬浮窗+@+chip+codec+确认卡+跳转+三层通知 | 悬浮窗/@/chip/codec ✅；确认卡 ❌；跳转 ❌；通知 ❌ | ~40% |

## 14. 工程侧注意事项（非设计 gap，但影响落地）

1. **环境可移植性**：各包 `package.json` 的 harness 依赖均为 macOS 绝对路径 `link:/Users/guoxinshan/dev/deepseek-harness/...`；`.acceptance/*.mjs` 同样绑定 macOS playwright 路径。本机（Windows，`D:\dev\deepseek-harness`）无法 `pnpm install`/构建/跑验收。README 已注明「仅限本机开发」，但发布/换机前必须改相对路径或版本范围。
2. **测试**：bridge 单测（fake CLI）+ tool-yzj 真实 CLI 冒烟（无 CLI 时自跳）+ UI 组件单测已具备；缺确认卡/通知相关测试（随功能补齐）。
3. **写工具门禁范围**（§2 注）：设计「全部写工具入闸」，实现仅「不可逆/副作用」入闸。建议按设计补齐标准确认集，或书面更新设计（若产品接受新建知识库/导入/日程创建免确认）。

---

## 15. Gap 汇总与建议优先级

### 🔴 P0 — 与设计直接冲突/核心断链
1. **消息 ref 丢失 groupId**（§3 / §2A）：拖入消息 chip 无法回源拉原文，「带出处原文注入」与「全量拖拽」均不成立。最小修复：拖拽载荷补 `groupId`，serialize 用 `(groupId, msgId)` 回源。
2. **mention 协议格式**（§3）：`yzj:{json}` vs `@yzj:{type}:{id}`——统一（选 A 跟随设计或 B 保留 JSON 补字段），并让类型名至少留 msg/group/person/doc 别名。
3. **写工具门禁范围**（§2）：标准确认/强确认分级 + 全量写工具入闸（或书面修订设计）。

### 🟠 P1 — 设计核心未落地（Phase 1/2 验收项）
4. **确认卡框架**（§4）：`yzj.write/request|resolved` 事件族 + ConversationNodeDefinition 按 domain 分发 + 风险分级 + 确认/编辑/取消/查看上下文 + 终态 deep link。机制已核验可用（harness 有完整注册面与教程）。
5. **yzjPanel 锚点跳转服务**（§9）：面板增加 `open({groupId, anchorMsgId})` 定位高亮，供确认卡「查看上下文」消费。
6. **三层通知**（§8）：① 面板 `lastSeenMsgId` diff 轮询角标；② `schedule_create`（≥5min）→ agent 筛选播报 + `yzj.notify/*` 通知卡；③ 自接浏览器 Notification。
7. **dsh skill 交付物**（§10）：仓库内落地改造版 SKILL.md（红线 + 不主动群发 + mention 引导）。
8. **影子任务库**（§11）：表结构模板 + skill 引导，激活待办预研探针。

### 🟡 P2 — 体验细化
9. @ 候选三组（同事/群/文档）分组与排序、文档候选。
10. 未登录引导文案（`yzj-cli auth login`）、@同事 越权 UI 明示。
11. 多 chip 合并序列化、chip 灰化（源失效）、快照决策标注。
12. 工程可移植性：link 依赖相对化。
13. 全量拖拽配套（§2A，设计原则已入 v1.5）：dbt 节点拖入附表结构预览、doc 摘要深度提示、drop 后快捷处理引导。

---

*本文档为对照记录，不替代 v1.4 设计原文；标注「待拍板」的项目维持原设计的决策归属。*
