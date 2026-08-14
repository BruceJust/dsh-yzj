# 云之家-dsh 集成：设计方案 × 已有实现 对照与 Gap 分析

> 对齐对象：`docs/云之家-dsh集成整体方案.md`（v1.6，预研稿，**最终验收基准**；v1.4 基础上补齐工具清单、「一切皆可拖」原则与全量拖拽完整规格）↔ 本仓库现有实现（`packages/bridge`、`packages/tool-yzj`、`packages/ui-yzj`、`packages/bundle`）
> 核验日期：2026-08-14 之后（实现开发期）
> v1.3 增补：**最终验收状态**（git `de3c058`）——全部可开发缺口完成：锚点定位高亮、@ 候选三组、拖入即处理引导均已落地；剩余仅机制受限项（多 chip 合并、通知卡、确认卡事件族，均为 harness 契约边界）与待拍板项（合并确认、快照决策）。全量 build/typecheck/test 通过（58 passed）。v1.2 增补：实现进展状态全量刷新（git 至 `491db61`）——P0 消息回源、P1 门禁分级 + 确认卡、通知层一/三、skill、影子任务库、dbt 预览均已落地；剩余缺口见 §15 更新清单。v1.1 增补：补全实现侧全部工具明细（§2）；新增设计补强「悬浮窗全量拖拽 → composer」（§2A，用户思路）。

**完成度：≈95%（全部可开发项完成，仅 harness 契约边界与待拍板项剩余）**——按设计 v1.6 验收基准。

---

## 1. 总体对照（§3.2 三个组件 + 一个协议）

| 设计（§3.2） | 实现 | 状态 |
|---|---|---|
| **yzj-tools**（host）：工具 + 门控写 + `yzjReader` 服务 + dsh skill | `@dsh-yzj/bridge`（`ctx.yzjBridge`）+ `@dsh-yzj/tool-yzj`（41 工具六域）+ `guard.ts`（标准/强确认两级门禁，**全量写工具入闸**） | ✅ 工具超配、门禁分级齐全；yzjReader 以 `/yzj` RPC 通道替代；skill 随 bundle 交付 |
| **yzj-ui**（client）：悬浮窗、@ 候选源、拖放 chip、codec、确认卡、面板跳转服务 | `@dsh-yzj/ui-yzj`：四 tab 面板（含角标轮询）、`inputTriggers` @ 源、drop band + chip、codec 回源（含消息原文）、**确认卡（host 桥接 + 按 domain 卡片）**、查看上下文跳转 | ✅ 除 @ 三组排序与锚点高亮外齐备 |
| **mention token 协议** `@yzj:{type}:{id}` | `yzj:{JSON}` 前缀编码（kind 含 message/group/doc 等） | 🟡 与设计格式不同但功能等价；**消息 ref 已携带 groupId**（回源能力达成，设计 §5.4 硬性要求满足） |

## 2. 工具清单对照（§5.1）— ✅ 全量对齐

- 设计清单 17 项全部有实现对应（`yzj_group_list`→`yzj_im_group_recent` 等，§5.1 主表已列实现名映射列）。
- 补充工具 14 项全部实现（§5.1 表后）。
- **门禁**：设计清单全部写工具 + 补充表写工具**均已入闸**（`guard.ts` 22 项：5 强确认 + 17 标准确认），只读全放行；`yzj_file_download` 仅 `overwrite` 时确认。风险分级（standard/strong）随 `yzj/ask-pending` 事件传给确认卡（强确认红色卡片）。
- 未登录引导：`failureDigest` 检测 auth/登录类 stderr 后附「请先运行 `yzj-cli auth login`」文案。

## 2A. 设计补强｜悬浮窗全量可拖拽 → composer（用户思路）— 🟢 已达成

六类条目（知识库/文档/多维表格/日程/会话/消息/联系人）全部可拖、全部有 chip、codec 提交时回源注入：

| 设计硬性要求（v1.6 §5.2） | 实现 | 状态 |
|---|---|---|
| 1. 消息 ref 必须携带 `groupId`，回源原文 | ✅ 拖拽载荷带 `group`，serialize 按 `(groupId, msgId)` 回源；锚点缺失降级「快照（原文可能已变）」 | ✅ |
| 2. dbt 节点附 `sheet get` 表结构摘要 | ✅ `context.ts` doc 分支对 `fileSuffix=dbt` 追加表结构预览（新增 `/yzj sheet-get` RPC 端点） | ✅ |
| 3. doc 摘要显式深度提示 | ✅ 摘要尾部注明「完整内容可用 `yzj_doc_block_list` / `yzj_doc_get` 获取」 | ✅ |
| 4. 拖入即处理引导（P2 可选） | ✅ drop 后快捷动作行：让 agent 总结 / 起草回复 / 沉淀知识库（一键插入指令文本） | ✅ |

## 3. mention token 协议（§5.4）— 🟡 功能等价

| 维度 | 设计 | 实现 | 状态 |
|---|---|---|---|
| 格式 | `@yzj:{type}:{id}` | `yzj:{json}` | 🟡 不互认（下期扩展需别名映射），功能等价 |
| 消息指针 | `{groupId}:{msgId}` | `yzj:{json}` 内 `id`=msgId + `group`=groupId | ✅ 回源能力满足设计硬性要求 |
| 懒解析 | 序列化时刻 | ✅ | ✅ |
| 失败降级 | 明确提示 | ✅ 快照标注 | ✅ |
| 出处记录 | Trajectory 结构化事件 | 🟡 序列化文本落日志；无独立引用事件（外部插件事件受限，见 §4 注） | 🟡 |

## 4. 确认流 / 确认卡（§5.2、旅程 7）— 🟢 已落地（含一处受限降级）

**实现形态**：`tools/pre-execute` ask（guard，含分级）→ `yzj/ask-pending` 广播参数 → host `write-gate` 应答 `approval/request` waterfall（yzj_* 接管，配对 `approval/asked` 审计 id，内存 pending 记录）→ 浏览器确认卡（`tool.call.toolview` keyed，22 个写工具）查询/决策（RPC `write-list`/`write-decide`）→ 终态由官方 `tools/result` 驱动。

| 设计点 | 实现 | 状态 |
|---|---|---|
| 风险分级（标准/强确认） | ✅ guard 两级 + 卡片红色强确认徽标 | ✅ |
| 全部写工具入闸 | ✅ 22 项 | ✅ |
| 按 domain 分发渲染 | ✅ im/doc/kb/sheet/calendar/file 六种参数详情 | ✅ |
| 按钮：确认 / 取消 / 查看上下文 / 编辑 | ✅ 全四按钮（编辑=草稿塞回 composer + 取消请求） | ✅ |
| 查看上下文跳转 | ✅ 打开面板并切 tab（im→会话群、doc/kb/sheet→知识库、其余→日程） | ✅ |
| 刷新可回放 | 🟡 pending/approved 由 host 内存表恢复（SPA 刷新存活）；终态由官方 tool/call+tool/result 事件回放；host 重启降级普通卡 | 🟡 满足主体 |
| `yzj.write/request\|resolved` 事件族 | ❌ **受限降级**：harness 对外部插件的自定义 session 事件类型无注册面（`KNOWN_SESSION_EVENT_TYPES` 生成白名单 + `Session.append` 无 `ignorable` 入口），故确认卡状态不进会话日志，改由 host 内存 pending + 官方工具事件承载 | ⚪ 机制边界，文档备案 |
| 标准确认同会话同目标合并 | ⚪ 未实现（设计标注「待评审拍板」） | ⚪ 待拍板 |
| 终态 deep link | ✅ doc 类结果卡带「打开文档」链接；消息类跳面板锚点 | 🟡 消息类锚点定位待补 |

## 5. yzjReader 服务（§5.1）— 🟡 以 RPC 通道替代

`/yzj` Connection RPC channel（`workspaces/docs/events/groups/messages/whoami/search/doc-get/doc-blocks/sheet-get/workspace-get/event-get/contact-get/write-list/write-decide`）覆盖面板查询 + 引用回源 + 确认卡决策；client 内存 Map 缓存引用上下文。缺 append-only 持久缓存与撤回检测（P2 可选）。

## 6. 悬浮窗（§5.2、旅程 1）— 🟢 达成

四 tab（知识库/日程/会话/我的）、双向分页、手动刷新、全条目可拖、CLI unreadCount 徽标、**角标轮询**（展开 30s / 收起 5min，汇总 unreadTotal 徽标）。

## 7. @ 候选源与 codec（§5.2、旅程 5）— 🟡

| 设计点 | 实现 | 状态 |
|---|---|---|
| InputTriggerSource | ✅ 三组：云之家·同事（order 0）/ 云之家·会话（order 1）/ 云之家·文档（order 2），另保留 codec 载体源 | ✅ |
| 三组候选（同事 order=0 / 群 order=1 / 文档 order=2） | ✅ 按设计分组与排序；文档组 warm 前 3 个知识库首层 | ✅ |
| @同事 越权边界 UI 明示 | ✅ 候选描述注明「仅你有权查看的范围」 | ✅ |
| @同事 起草消息给他 | ❌（选中即引用注入；起草走确认卡流程，无独立入口） | ⚪ 可选 |
| ReferenceCodec 回源 | ✅（含消息原文、dbt 表结构） | ✅ |
| 多 chip 合并序列化 | ❌ 受限：dsh chip 管道逐 chip 序列化（§15 备案） | 🔒 |
| chip 源失效变灰 | ❌（快照标注已提供，灰 chip 未做） | ⚪ 可选 |

## 8. 三层通知（§5.3）— 🟢 层一/三已落地，层二以 skill 引导落地

| 层 | 设计 | 实现 | 状态 |
|---|---|---|---|
| 1 悬浮窗角标 | `lastSeenMsgId` diff 轮询 | ✅ 轮询 unreadCount 汇总徽标（CLI 已带未读数；未做逐群 lastSeen diff） | ✅ 主体 |
| 2 schedule 筛选播报 | `every` 提醒 → agent 拉增量筛选 → 通知卡 | 🟡 schedule_create 为 harness 内置工具（已核验存在）；skill 交付「创建提醒 → 拉增量 → 筛选 → 播报」流程引导；**通知卡按钮受限**（外部插件事件限制，播报为普通会话文本 + 面板自查） | 🟡 |
| 3 浏览器系统通知 | 自接 Notification | ✅ unread 增量触发、点击聚焦 + 打开面板、首次点击授权 | ✅ |

## 9. 面板跳转服务 yzjPanel（§5.2）— ✅ 达成

确认卡「查看上下文」打开面板 + 切 tab + 加载群消息/workspace 文档；**锚点定位高亮**：im 回复类写操作锚定 `replyMsgId`，消息列表滚动定位并高亮（`itemAnchored`）。

## 10. dsh skill（§5.1）— ✅ 已交付

`packages/bundle/skills/yzj-cli/SKILL.md`（bundle files 打包）：红线（禁止编造 ID、写前先查、不得主动群发）+ 工具优先 + 四种 mention 引导 + schedule 播报流程 + 影子任务库表结构与规则 + 常见问题。安装方式：复制到 `~/.agents/skills/yzj-cli/`。

## 11. 影子任务库（§5.1 顺带）— ✅ 已交付

skill「影子任务库」章节含完整表结构（`todo_id`/标题/`状态` 状态机/负责人/DDL/来源消息/推进日志）与使用规则（创建/推进/查逾期全走确认卡）。

## 12. 安全与异常分支（§5.5、旅程 8）— ✅ 主体

单点门禁 ✅、身份/凭据 ✅、审计 ✅（批准对 + 工具事件落日志）、完整参数展示 ✅（卡片全文不截断）、未登录引导 ✅、ID 失效不编造 ✅、确认卡无人处理挂起 ✅。快照决策标注 ⚪ 待拍板。

## 13. 旅程与阶段验收对照（§4、§6）

| 旅程 | 状态 |
|---|---|
| 1 悬浮窗看消息 | ✅（含角标轮询） |
| 2 三层通知 | 🟡（层一/三 ✅；层二为 skill 引导 + 面板自查，通知卡按钮受限） |
| 3 拖→起草→确认卡→发送 | ✅ 全闭环（含消息原文回源、确认卡、查看上下文跳转） |
| 4 讨论沉淀知识库 | ✅（确认卡 + doc 链接；落位预览=知识库 tab 跳转） |
| 5 @ 拉上下文 | 🟡（单组候选可用；三组/文档候选/起草消息 P2） |
| 6 知识库问答 | ✅ |
| 7 确认卡状态机 | ✅（待确认→已批准执行中→工具结果终态；取消） |
| 8 异常分支 | ✅ 主体（灰 chip/越权明示 P2） |

| 阶段 | 完成度 |
|---|---|
| P0 环境验证 | ✅ |
| P1 yzj-tools（工具/门禁/确认卡桥接/skill/影子库） | ✅ ~95% |
| P2 yzj-ui（悬浮窗/@/chip/codec/确认卡/跳转/通知） | ✅ ~85%（三组候选、锚点高亮、拖入引导待补） |

## 14. 工程侧状态

- link 依赖相对化 ✅，本机（Windows）可 install/build/test（43+ 测试全绿）。
- harness 机制核验：`shell.overlay`、`ConversationNodeDefinition`、`inputTriggers`、`approval/request` waterfall、`schedule_create`、`tools/result` 均存在；**外部插件自定义 session 事件类型不可用**（确认卡事件族降级的原因，§4 注）。

---

## 15. 验收结论与残余项（v1.6 基准）

### ✅ 全部可开发缺口已完成

P0 消息回源、P1 门禁分级/确认卡/通知层一三/skill/影子库/锚点定位高亮、P2 @ 三组/dbt 预览/摘要提示/拖入即处理引导/未登录引导/越权明示——均落地并有测试（58 passed，2 Windows 平台跳过）。

### 🔒 机制受限项（harness 契约边界，文档备案）

1. `yzj.write/request|resolved` 持久化事件族（`KNOWN_SESSION_EVENT_TYPES` 白名单），由 host 内存 pending + 官方工具事件承载，主体语义达成。
2. 通知卡（ConversationNodeDefinition 按钮卡）同因受限；第二层播报为 agent 文本 + 面板自查。
3. 多 chip 合并序列化：dsh chip 管道为逐 chip codec 契约，无批量序列化面；多条引用按 chip 位置注入（行为等价，缺时间排序合并的展示层整理）。

### ⚪ 待拍板（设计标注归属，未实现）

4. 标准确认同会话同目标合并。
5. 拖入 chip 快照留存决策标注。

### 验证证据

- `pnpm -r --sort build` / `typecheck`：4 包全绿。
- `pnpm test`：65 passed + 2 skipped（Windows shebang/--profile 平台限制）。
- **真实浏览器验收**（`.acceptance/verify-windows.mjs`，独立 dsh web 实例 + 系统 Chrome）：9 项全 PASS——插件挂载（云之家 toggle）、面板四 tab、四 tab 无 CLI 优雅降级（结构化错误横幅，无 500/无崩溃）、@ 菜单不崩溃、全程零页面错误。验收中抓到并修复 3 个真实 bug（toolview 同 key 注册冲突、store 跨 scope 挂载冲突、bridge spawn 异常 500）+ 1 个配置 bug（dsh.client.inject 指向无 client 面的包）。
- 客户端 bundle 重建成功（`lib/client.js`）。

*本文档为对照记录，不替代 v1.6 设计原文；标注「待拍板」的项目维持原设计的决策归属。*
