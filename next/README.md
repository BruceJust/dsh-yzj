# yzj-next — P1-lite

会话图内核与 P1-lite 的从零实现。旧 `packages/*` 不改、不删、不 import；它是**已验证模式的证据库**，模式移植（重写）自它，代码不共享。

上位文档：[技术方案 v2.5](../docs/技术方案-终极形态落地.md)（施工图）· [终极形态设计方案 v4.4](../docs/终极形态设计方案.md)（已冻结）· [开发启动指南](../docs/P1-lite开发启动指南.md)（含 M0 事实验证结果）。

## 包与依赖方向

```
bridge   ctx.yzjBridge   yzj-cli 子进程通道（零业务依赖）
graph    ctx.yzjGraph    图内核：append-only 日志 / 快照+尾部重放 / 词汇合并 / viewer 查询 / 订阅 / 读取域钩子
cards    ctx.yzjCards    可应答对象系统：卡型注册表 + 动作总线 + 投影协调 + /yzj-next RPC；client 半 = 会话流卡
objects                  对象族（一包多 cordis 插件）：approval · task/waiting/conflict · commitment/process
                         + 窄工具（commitment_register / commitment_receipt / conflict_flag）+ graph_query + 过程摘要
tools                    41 个 yzj_* 模型工具（doc/im/sheet/calendar/file/contact）+ 审批 guard + 血缘自动记录
channel                  transport（轮询 / 首见续扫 / 分诊 / 回声协议 / 通道健康）
                         + orchestrator（路由 / 命令集 / 投递 / 回合绑定 / 幂等与替身纪律）+ /handoff 授权链
bundle                   装配（cordis.patch.yml）+ 双实例部署
```

```
surface  桌面工作台：融合话题视图（轨迹 × IM 一条时间线）+ 会话头 chip + 双语态 composer + 话题树入口
```

尚未开工（按技术设计附录 A）：`relay`（段 8）· `scheduler`（段 9）· `lightapp`（段 13）。

依赖只向左：`graph`/`bridge` 零业务依赖；`cards` 只依赖 `graph`；`objects` 依赖两内核；`tools` 依赖 `bridge`/`graph`/`objects`（只为 `yzjAsks` 接缝类型）；`channel` 依赖全部注册面。**桌面 actor 由 channel 注入 cards**（`setDesktopActor`），而不是 cards 反查 channel——这条反向依赖是特意断开的。

## 双实例部署（技术方案 §7）

**绝不装进现有 web profile。** 同 profile 双 bundle 在五个共享面撞车：工具同层重名**加载即失败**（dsh-tools 契约明文）、`ctx.approval` waterfall 全局双抢、toolview keyed 座位互相遮蔽、自聊/DM 流无法按群白名单分区、workspace 归属混杂。

```bash
# 1. 建独立实例（独立 DSH_HOME / 端口 / profile），并把七个 workspace 包链进去
export DSH_HOME=~/.dsh-next
dsh plugin --profile web add \
  link:/Users/Apple/Documents/project/dsh-yzj/next/bridge \
  link:/Users/Apple/Documents/project/dsh-yzj/next/graph \
  link:/Users/Apple/Documents/project/dsh-yzj/next/cards \
  link:/Users/Apple/Documents/project/dsh-yzj/next/objects \
  link:/Users/Apple/Documents/project/dsh-yzj/next/tools \
  link:/Users/Apple/Documents/project/dsh-yzj/next/channel \
  link:/Users/Apple/Documents/project/dsh-yzj/next/bundle
```

```bash
# 2. 模型配置：新 DSH_HOME 是空的，没有 settings.yaml 就没有 provider，
#    第一次触发会卡在建 Agent。把现有实例的设置复制过去即可
#    （文件里只有 apiKeyEnv 环境变量名，不含密钥本身）。
cp ~/.dsh/settings.yaml ~/.dsh-next/settings.yaml
```

```bash
# 3. 起在独立端口（现网旧实例占 3080，别碰）
DSH_HOME=~/.dsh-next dsh web --port 3090
```

运行态落点全部在 `$DSH_HOME` 下，与 `~/.dsh` 互不污染：

| 数据 | 位置 | 主权 |
|---|---|---|
| 图日志（产品级事实） | `~/.dsh-next/yzj-next/graph/<accountKey>/graph.jsonl` + `snapshot.json` | 自有词汇 |
| 通道运行态（游标/去重/出站登记） | `~/.dsh-next/yzj-next/channel-state.json` | 非事实，不入图 |
| 会话日志（turn 级事实） | DSH 自己的 session 存储 | 官方词汇，**绝不 append 自定义事件类型** |

群白名单在 [`bundle/cordis.patch.yml`](./bundle/cordis.patch.yml)：自聊 + 两个测试群。

**触发词在试运行期是 `@next` / `@下一代`，不是 `@agent`。** 原因：旧 gateway 的 allow-list 为空 = 监听所有群（含两个测试群），而云之家侧没有 deny-list 能把测试群从它手里拿走——**群分区分不开这两个系统，触发词才分得开**。同一句 `@agent` 会被两套系统同时接管。平价切换（旧 gateway 停机）后改回 `@agent`。

平价切换 = 放开白名单接管全部群 + 触发词改回 `@agent` → 旧实例停 gateway；回退反向。

## M1 竖切能做什么

测试群里 `@next 帮我在知识库建一个文档` →

1. `channel` 分诊命中触发 → 在该话题的 Session 里起一回合；
2. 模型调 `yzj_doc_create` → `tools` 的 guard 命中写清单 → 记录 ask 详情 → 返回 `ask`；
3. DSH 审批 seam 把问题交给 `objects` 的应答器 → 图上开 `approval` 对象 → 投影两面：
   - 桌面会话流：`tool.call.toolview` 座位实时读图渲染确认卡（按钮）；
   - 云之家自聊：自足文本 + `[card#approval:…]` 句柄 + 回复引导；
4. 任一面应答 → 动作总线单点裁决（先答先赢，落败方拿高声冲突回执）→ 放行/拒绝；
5. 终态回声补发到已投影的文本面（消息不可编辑，CTA 不能永久悬空）。

超时自动拒绝、重启中断可恢复、一次性重试、差额补投，全部在 [`objects/src/approval`](./objects/src/approval) 与其 spec 里。

回合结束还会：开/关任务对象、按证据晋升承诺（写动作/期限/委派语气才铸）、把**过程摘要**（血缘产出 + 确认记录 + 仍在等待）附在终态回帖上，并把任务卡投影到那条回帖——所以回复「验收」或「打回 <原因>」就能定终态。

**命令集**：`/new` `/reset` `/cancel` `/done` `/reject` `/link` `/handoff` `/fork` `/status`。`/handoff` 会先亮出解析到的**群名 + 群 ID**、做成员与白名单预检，再经确认卡放行；任何一步失败都降级为「agent 拟稿 + 你自己发」，绝不猜。

**通道健康**：连续 3 次轮询失败就在图上开一个系统级等待对象（登录态失效会直接说要重跑 `yzj-cli auth login`），恢复即关闭——系统对自己的离线不可以失明。

## 测试

```bash
pnpm test
```

一条命令跑全仓（旧包 + `next/`）。`next/` 的 spec 直接跑源码（vitest alias），不需要先 build。真实 CLI 探针（`next/tools/tests/doc.spec.ts`）在机器未登录时自跳过。
