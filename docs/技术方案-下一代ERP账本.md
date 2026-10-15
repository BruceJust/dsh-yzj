# 技术方案：下一代 ERP 的账——一条日志，三本账

> 2026-10-15 · **v1.1（交付前自审）**。v1.0 是北极星，能讲清方向，但不能直接交开发：
> - 它和三条冻结决策冲突（#58 受领、#63 分区、#64 私账），也和技术方案 §4 冲突（`audience` / `idemKey` 不进信封）；
> - 它新造了一批与现有约 80 个事件类型重叠的名字；
> - 它有三处与代码事实不符：
>   - 「守门人是 agent 通往外部的唯一通路」不对：群回复走 `channel` 出站，不经守门人；
>   - 「租约知道 agent 在为哪条承诺干活」不对：租约只按工具类划范围；
>   - 研发版 P0 举例写错了；
> - 它有一处自相矛盾：I1 只认租约，但代码里放行有三种授权来源。
>
> v1.1 的处理：
> - §1.4 逐条对齐冻结设计；
> - §2.3 给出概念与代码词汇的对照，复用为主；
> - 信封只加 `prev / hash` 两个字段；
> - **§13 把 E0 写到开发级，可以直接交开发 agent**。§13 经过一次冷读测试（一个没看过讨论的 agent 只凭本节和代码写实施计划），它找出的歧义、与代码不符处和风险都已写回；
> - 代码扫描另外找到四处不经守门人的直接写（§3.1 路三，G1–G4），E0 只登记，E0.5 在 bridge 收口；
> - §14 的 E1–E5 是设计级，开工前要先拍板 §14 列出的开放问题，**开发 agent 不得自行补全**。
>
> 2026-10-14 · v1.0。
>
> **读法**：§1–§11 讲为什么、长成什么样；§12 是现状对照；§13 是 E0 开发规格；§14 是后续各期与开放问题；§15 是断言。
> **配套沙盘**：[恒测加急单](./next-erp-scenario.html) · [小记的一个赌注](./next-erp-rnd-scenario.html)。两页的「日志原文」演示本册的分类规则。**沙盘里的事件名（`utterance`、`judgment/decided`……）是讲概念用的示意词汇，不是代码词汇**；代码词汇以 §2.3 为准。
> **冻结设计优先**：《终极形态设计方案》决策 #22–64、《技术方案-终极形态落地》、《私账层-终极设计》。本册与它们冲突时，以它们为准；本册只在 §1.4 列出的地方提出对齐方式。

---

## 0. 一句话与总判据

**只存发生过的话和事，其余全部重算。**

人说的话、agent 做的事、世界发生的事，写进一条只追加、成链的日志。钱账、承诺账、判断账、责任图、判断队列，以及旧系统看见的样子，都是这条日志的纯函数。人的回程律不是一份月报，而是写入时的约束。

**总判据**：一年后，一个当时不在场的人，不问任何人，能不能从日志复原这几件事：谁、凭什么信息、做了什么决定、结果如何、钱花在哪。

**E0 的一句话**：经过守门人的写工具和 agent 的对外发言，每一次都在只追加、成链的日志里留下一行，写明是哪个人授权的；日志被改过，能被发现。其余不经守门人的出站写（G1–G4），由 E0.5 在 bridge 统一收口。

---

## 1. 第一性：一条账值什么

### 1.1 账 = 证据

账的价值是**当证据用**：用来对质一个更愿意忘掉的人，读的人当时不在场。每条记录必须有三样东西：

| 要素 | 含义 | 缺了会怎样 |
|---|---|---|
| 谁说的 | 能对应到一个身份 | 「我没答应过」无法反驳 |
| 凭什么 | 出处，指回原始的消息、文档、调用 | 记录与事实对不上时，不知道该信哪个 |
| 什么时候知道的 | 记录时刻；需要时再记发生时刻 | 无法公平评价当时的判断 |

再加一条：**只追加**。改错是追加一行，不是修改。

### 1.2 旧 ERP 的病在入口

记录是事后由人补录的描述，是第二份工作，而第二份工作一定滞后、一定失真。沙盘里旧系统那一侧的「要等」和「没记下」都是这么来的。

### 1.3 后 AGI 的反转

生成信息的成本趋近于零，稀缺的变成**有人签了字**。模型可以起草一切，只有人的签收才产生事实。由此推出三条：

1. **记账不是第二份工作**：入口必须在行动路径上（会话、守门人、出站）。
2. **能重算的不存**：状态、余额、队列、比值都是投影。
3. **改错是追加**：改错本身也是证据。

### 1.4 与冻结设计的对齐

| 冻结设计 | v1.0 的冲突 | v1.1 的对齐 |
|---|---|---|
| **#58** 受领是证据，不是义务；系统绝不索要受领 | 写了「没受领的不进承诺账」和受领超时 | 承诺照旧在登记时开启（`commitment/opened`）。账的诚实靠**证据级别**，不靠排除：登记这一行的依据，是委派人说出口的那句话（`sourceAnchor`）；受领是执行者另外留下的证据（受领三态）。**任何投影都不得把「登记」显示成「受领」**。系统不催受领 |
| **#63** 公域承诺的真身 = 登记者实例的图；寄生期一个操作者一个实例一个分区 | 假设一个租户一条日志 | 寄生期：分区 = 实例的账户分区（现状）；哈希链按分区成链；镜像是镜像实例自己的行，不跨分区成链。「一个组织一条日志」要等寄生期之后的服务端组织实例（E4） |
| **#64** 押只在 pgraph（私账）；无分数、无排名、无团队视图 | 把「押」写进了组织日志 | 组织日志只存**裁决**（现有 `approval` / `confirm` / `proposal` 的 decided 类事件），以及裁决人**主动公开写下的检验点**（字段名 `checkpoint`，不叫「押」，E1）。私押照旧在 pgraph。检验点到期的结论按单条裁决可见，听众 = 那次裁决的听众；**任何组织侧投影都不按人聚合** |
| **技术方案 §4**：`audience` / `idemKey` 不是信封字段；幂等锚由编排层或族状态机计算，绝不由模型传入 | 写进了信封 | 照旧放在 `data`。v1.1 的信封只加 `prev / hash`，其余新概念都是族字段 |
| **现有词汇**（约 80 个事件类型） | 新造了一批重叠的名字 | 一律复用现有类型；只在 §2.3 明列的地方新增 |
| **墓碑律**（`tombstone/appended`） | 另造了 `*/reversed` | 更正一律用现有的 tombstone 加一行新行 |

---

## 2. 原子：日志里只有四种行

### 2.1 四种行

| 行 | 产生者 | 必带 | 例子 |
|---|---|---|---|
| **人说的** `said` | 人（`actor.kind` = `person` / `operator`） | `actor.openId`，以及动作的锚（卡片动作或消息 id） | 拍板、验收、签收移交、签发租约 |
| **agent 做的** `did` | agent（`actor.kind` = `agent`） | 授权来源（§3.1）；最终能解析到一个人 | 写文档、发消息、登记承诺、解析一条回复 |
| **世界的** `seen` | 外部系统 | 出处（系统、单据号、摘要） | 银行流水、模型账单、对方回执（E1 起才有专门的摄入；E0 里没有这类行） |
| **规则推出** `ruled` | 系统（`actor.kind` = `system`） | 规则 id 与版本、`causedBy` | 日志起点、动作结果不明、展开判断需求（E1） |

**两条判别规则**：

1. **`atom` 不存，靠推导。** 它由 `actor.kind` 加族声明唯一决定（`atomOf`，§13.2），按本册自己的规矩，能重算的不存。
2. **只要有模型参与产生，这一行就是 `did`，永远不是 `ruled`。** `ruled` 只能由确定性代码产生：给定规则版本和起因，结果可以复现。模型的输出不可复现，所以它是 agent 的动作，必须有授权来源。

### 2.2 什么写入，什么不写

一件事要写进日志，必须满足以下三条之一：

- (a) 有人说了；
- (b) agent 或系统**对外界或对人**做了动作，比如写、发、通知、排进日程；
- (c) 外界告诉了我们。

其余一律是投影。

**「派生状态不写」的精确定义**：如果一个字段的值是其他行的函数，它就不得出现在任何行里。例如：悬空 = 回执数少于承诺数；判断需求「已判」= 存在对应的裁决。**由一次言语行为本身造成的状态迁移，可以带 `status`**，例如 `lease/granted` 的 `active`、`approval/decided` 的 `approved`。现有族就是这么写的，不改。

| 沙盘里的事 | 写不写 | 理由 |
|---|---|---|
| 「J1 已判」 | 不写 | 由裁决行算出 |
| 「P2 悬空：到 3,000 / 4,500」 | 不写 | 由回执对承诺算出 |
| 「J3 排今天 16:00」 | 写（E1） | 系统把时间放进了老陈的日程，并给他发了卡 |
| 「J2 → 推翻」 | 写（E1） | 是裁决：会通知当事人，可以被申诉 |

### 2.3 概念与代码词汇对照（开发以此为准）

| 本册 / 沙盘的概念 | 代码里已有的（复用） | 新增（期） |
|---|---|---|
| 人在群里说的话 | **不整体入图**。被引用为起因时，用现有锚字段（`sourceAnchor` / `anchor` / `messageId`） | `utterance/cited`（E1）：一条消息成为某行起因时落一行，存发送者、时间、正文摘要。为的是消息在 IM 里被撤回后，证据仍在 |
| 承诺：登记、受领、交付、验收、作废、移交 | `commitment/opened`；受领三态字段与 `receipt/recorded`；`commitment/delivered` / `closed` / `voided` / `transferred` | 无 |
| 守门人放行一次写 | 无（现状不留记录） | `action/released`、`action/settled`、`action/outcome-unknown`（E0） |
| agent 对外发言（回复、回执、在岗声明…） | 无（出站登记在 `channel-state.json`，不是事实） | `outbound/posted`（E0） |
| 守门人转人 | `approval/opened` → `approval/decided` | 无 |
| 租约 | `lease/*` | 无（E0 只改 `covers` 的返回值） |
| 判断需求：出生、排期、撤销 | 触发①（守门人转人）就是 `approval/opened`；其余没有 | `judgment/*`（E1，设计级） |
| 拍板 | `approval/decided`、`confirm/decided`、`proposal/item-decided` | `checkpoint` 字段（E1） |
| 结账 | 无。注意 pledger 的 `verdict/filed` 是私账归档，**不是**组织结账 | E1 |
| 外部观测 | `event/observed`（actor 是 agent，所以是 `did`） | 外部摄入（E1–E2） |
| 钱 | 无 | `money/*`（E2） |
| 日志起点 | 无 | `ledger/genesis`（E0） |
| 更正 | `tombstone/appended` | 无 |

---

## 3. 记录怎么产生

### 3.1 agent 的对外动作：三条出站路

**路一：`WRITE_SPECS` 里的写工具。** 经过守门人（`next/tools/src/guard.ts`）。放行时的授权来源有四种，现状**都不留记录**：

| 授权来源 | 现状代码 | 能追到的人 |
|---|---|---|
| `lease` 租约命中 | guard.ts:317，`covers()` 只返回布尔值 | 签发租约的人（`grantedBy`） |
| `message` 接纳本回合的消息授权（标准写） | guard.ts:327 | 发消息的人（`TurnBinding` 现在没有这个字段，E0 补上） |
| `approval` 人在确认卡上批准 | `approval/opened` → `approval/decided` | `decidedBy` |
| `operator` 无须确认的写（`spec.when` 为假）且本回合没有可用的接纳消息；或确认由宿主自己的审批界面完成 | guard.ts:311 直接放行；answerer.ts:93/98/102 交给宿主 | 本实例的操作者（寄生期，操作者对自己实例的默认行为负责；宿主的审批界面只在操作者桌面上） |

E0 的做法：每次被放行的写，在 `tools/execute` 里**先**写 `action/released`（带授权来源），**再**执行，执行后写 `action/settled`。

**路二：agent 对外发言。** `channel/src/client.ts` 的 `send(origin='agent')`，包括回复、回执、在岗声明、让位通知。它带署名，但不经守门人。E0：每次发送成功（拿到 `msgId`）后写 `outbound/posted`，只存摘要，不复制正文。授权来源：本回合的接纳消息；没有就是 `operator`（主动发言）。

为什么发言可以发送后再记：发言本身就落在场所里，是公开、持久的证据。写工具的效果可能落在别处、不可逆，所以必须先记后做。

**路三：不经守门人的直接写。** 冷读和代码扫描找到四处，它们直接调 `ctx.yzjBridge.run`，既不在 `WRITE_SPECS` 里，也不留记录：

| # | 位置 | 写什么 | 备注 |
|---|---|---|---|
| G1 | `objects/src/event/tools.ts:79`（`event_post_materials`） | 改日程描述 | 工具描述里写着「Goes through the normal write confirmation」，**实际不经确认**：描述与行为不符 |
| G2 | `objects/src/goal/body.ts:55`、`:93`（`goal_propose`） | 建文档、写块 | 提案文档在人签收之前就已建好 |
| G3 | `objects/src/goal/writeback.ts:169` | 往目标文档写块 | 发生在人签收之后，自有 `goal/writeback-*` 事件，但不带授权来源 |
| G4 | `surface/src/rpc.ts:4038` | 建群 | 桌面上由操作者点的，等于人自己动手 |

**第一性的结论**：守门人决定「谁授权」，而效果真正发生的地方是 **bridge**（yzj-cli 子进程通道）。所以覆盖一切出站写的唯一收口点是 bridge：写类 CLI 命令必须带授权来源，否则 bridge 拒绝执行。bridge 是零业务依赖的包，不能直接写图，要通过注入的钩子实现。这一步放在 E0.5（§14）。E0 先覆盖路一和路二，路三只登记为缺口，不改行为。

**读不记**：读工具不改变世界，不写行。回合里读了什么，留在 DSH 会话日志里。

**崩溃**：云之家接口**没有幂等键**，所以**不得自动重试**。启动时发现「放行了、没结算」的行，就写一行 `action/outcome-unknown`，交人去看。

### 3.2 人的承诺（对齐 #58）

- 登记成本 = 说一句话（#58）。agent 从一句话登记 `commitment/opened`，`sourceAnchor` 指向那句话。这一行是 `did`：agent 的登记动作，起因是委派人的话。
- 受领三态（#58）：缺席表示已登记，这是观察型承诺的正常起点；有值表示受领证据或拒领。**系统不索要受领。**
- 账的诚实：任何投影显示一条承诺时，都要显示它的证据级别，是「某人在某场所登记」还是「执行者已受领」，绝不把前者显示成后者。
- 跨组织时，对方的受领由对方账本签名（E5）。

### 3.3 判断（E1，设计级；先看清现状）

**现状**：
- 判断需求的触发①（守门人转人）已经是 `approval/opened`；
- 拍板已经是现有 decided 类事件；
- 私账层已经在测每个人的停留和等待中位数（`next/pledger/src/judg.ts`）。

**E1 要补的**，开工前须先拍板 §14 的 Q1–Q5：

1. **出生**：除了触发①，还有两种触发：
   - 触发②：一个外部事实和某条承诺矛盾。这需要承诺有可机读的数量和日期，现在 `what` 是一段文本。
   - 触发③：会话里出现了相互竞争的方案。

   由模型识别出来的需求，按 §2.1 是 `did: judgment/proposed`，**不是** `ruled`。
2. **归属**：模型只做分类（「这是选做什么」「这是金额代码怎么审」），归谁由图上的**职责**查出来。比如研发版里，金额代码怎么审归「定研发规范的老秦」。职责现在没有对象，是 Q1。先后关系存成 `blockedBy`。
3. **排期**：按队列排序（到期时间、`blockedBy`）。是否订进日历是 Q3。
4. **拍板**：现有 decided 事件加上可选的公开 `checkpoint {signal, at}`，再加当时所见的摘要（证据快照内容寻址存放）。
5. **结账**：检验点到期，读到信号就写 `ruled: judgment/settled`；信号模糊时由人结账（`said`）。申诉也是追加一行。

### 3.4 钱（E2）

- 银行流水、发票、工资、云账单留在原系统，新账只存**引用**（系统、单据号、金额、币种、摘要）和**归属**（引用 → 承诺 / 裁决 / 赌注）。没有归属的钱进入「未归属」投影，月结时要么清零，要么由人签字留存。
- **agent 算力的归属路径**（v1.0 写错了，租约并不知道承诺）：
  1. 每回合的 token 用量，取自 DSH 会话日志的 usage；
  2. 找到本回合的 `topicKey`；
  3. 找到 `executor.kind = 'agent'` 且 `topicKey` 相同的承诺。

  桌面自发的回合没有承诺，就落「未归属」。价格表是 Q6。

### 3.5 示例：9 月 1 日（沙盘示意词汇）

沙盘「日志原文」里，研发版林岚选「两个都做原型」那天的输出（正文略有删节）：

```
#0002  9/1 09:30  did    agent/observed      实验 agent  新用户 D7 31.0%……   ✓ 租约「实验 agent」→ 林岚
#0003  9/1 10:00  said   utterance           林岚「这里能押一注，大家有什么主意？」      ✓ 签名：林岚，群消息
#0004  9/1 10:02  said   utterance           阿哲「做拍照记账吧……」                    ✓ 签名：阿哲，群消息
#0005  9/1 10:04  said   utterance           小吴「先做个记账模板……」                  ✓ 签名：小吴，群消息
#0006  9/1 10:06  ruled  judgment/demanded   J1「押什么？」→ 林岚（产品负责人）· 排期 今天 15:00
                                                         ✓ 由 #0003、#0004、#0005 引出
#0007  9/1 10:06  ruled  judgment/demanded   J2「金额解析这块新代码，人审还是机器审？」→ 老秦 · blockedBy J1
#0008  9/1 15:00  said   judgment/decided    J1 = 两个都做原型 · 检验：内测留存过 60%，10/15 读数
                                                         ✓ 签名：林岚，判断卡；当时所见 4 条已冻结
#0009  9/1 15:10  said   commitment/opened   P6 阿哲 → 林岚 · 两个原型，全员内测 · 9 月 4 日
不写入 9/1 15:12  投影   J1 状态 = 已判       由 #0008 算出
```

对应到代码词汇：
- `utterance` 对应 E1 的 `utterance/cited`。
- 沙盘里的 `judgment/demanded` 由确定性规则产生，所以标成 `ruled`；**现实中若由模型识别，就是 `did: judgment/proposed`**。
- `judgment/decided` 对应现有 decided 事件加 `checkpoint`。
- 沙盘里阿哲受领后才写 `commitment/opened`。现实中按 #58，登记即开启，受领是另一份证据。

---

## 4. 信封

**E0 只改信封的两个字段**，其余新概念都是族字段，见 §2.3：

```ts
interface GraphEvent<D = JsonValue> {
  readonly v: 1 | 2            // E0 起写 2；读兼容 1
  readonly sv: number
  readonly seq: number
  readonly time: number        // = 记录时刻。不改名
  readonly type: string
  readonly data: D             // audience / idemKey / authority / causedBy 等都在这里（技术方案 §4）
  readonly actor: GraphActor   // 不改：'operator' | 'agent' | 'system' | 'person'
  readonly prev?: string       // v=2 必有：上一行 v2 的 hash；genesis 为 64 个 '0'   ← E0 新增
  readonly hash?: string       // v=2 必有                                         ← E0 新增
}
```

- **hash** = `sha256(canonicalJson({ v, sv, seq, time, type, data, actor, prev }))`，结果为 64 位小写 hex。
- **canonicalJson**：沿用 `objects/src/approval/family.ts` 现有的实现，E0 把它挪进 graph 内核。规则：对象键按 UTF-16 码元升序；值为 `undefined` 的键丢弃；字符串和数字用 `JSON.stringify`，有限数的输出与 RFC 8785 一致。
- 沙盘里每行的 `⛓` 是 6 位 FNV，只是演示，**不是**规格。
- **大字段不进日志**：agent 的推理过程、证据快照、附件放内容寻址存储，日志只存摘要。

---

## 5. 恒等式 = 写入约束

| # | 约束 | 期 | 执行方式 |
|---|---|---|---|
| I1 | `WRITE_SPECS` 里的工具每执行一次，执行之前恰好有一行 `action/released`。其中的 `authority` 是四种之一，且能解析到人（§3.1）。路三（G1–G4）在 E0.5 收口到 bridge 后纳入 | **E0** | 写入失败或无法解析时，**不执行**（fail closed） |
| I2 | 每一次 `send(origin='agent')` 成功，恰好有一行 `outbound/posted` | **E0** | 写入失败只记错误，不撤回消息（消息已经在场所里） |
| I3 | 只追加；v2 行逐行成链 | **E0** | 加载时校验，断链就报告（§13.1） |
| I4 | `ruled` 行的 `data` 必带 `rule {id, version}` 和非空的 `causedBy`；`ledger/genesis` 豁免 | E0（只适用于 `action/outcome-unknown`）/ E1 全面 | 写入拒绝 |
| I5 | `said` 行必带 `actor.openId` | E0 只审计（先量后禁）/ E1 起写入拒绝 | 审计报告 |
| I6 | 承诺任一时刻恰好有一个持有人 | 现有移交分叉模型已保证（#59）；E0 只审计 | 审计报告 |
| I7 | 判断需求必有归属人；归属人缺席就生成移交需求 | E1 | — |
| I8 | 拍板必带当时所见的摘要 | E1 | — |
| I9 | 钱的引用要么有归属，要么进「未归属」 | E2 | — |

为什么不能分三个库存：恒等式要靠构造成立，不能靠对账成立。复式记账的发明就在于一笔交易同时写两边。

---

## 6. 投影

| 投影 | 折叠自 | 回答 |
|---|---|---|
| 承诺账 | `commitment/*`、回执 | 谁欠谁什么，证据到哪一级了 |
| 判断账（E1） | 裁决、检验点、结账 | 哪条裁决押了什么，结论如何 |
| 钱账（E2） | `money/*` | 钱花在哪条承诺、哪一注上 |
| 责任图 | 以上全部 + 租约 + `action/*` | 出了事，此刻找谁 |
| 判断队列 / 计划对象（E1） | 判断需求与裁决 | 现在有什么在等人拍板，排在谁那里 |
| 判断档案 | **pgraph**，不在组织日志里（#64） | 我在哪类裁决上的判断值它的摩擦（只有本人可见） |
| 旧系统视图 | 全部，按旧规则有损投影 | 旧 ERP 此刻会怎么答。沙盘的 `oldOf()` 证明旧 ERP 是同一条日志的有损投影 |

**规矩**：

- 投影 = f(日志前缀, 折叠版本, 规则版本)，必须是纯函数。快照只是缓存，要记自己由哪一版折叠逻辑算出（`GRAPH_FOLD_VERSION`；仓库付过一次学费：16 个对象对不上）。
- **反应器只在实时追加时跑**：订阅 `yzj-graph/appended`，在 hydrate 或 refold 时**绝不触发**，否则重放一次就会重复通知一遍。反应器产生的 `ruled` 行带幂等键 = `hash(rule.id@version + causedBy)`。
- 没有任何组织侧投影返回「人名 × 分数」。

---

## 7. 时间

- `time` 是记录时刻。**发生时刻**只在来源自带时间戳时记（例如消息的发送时间），作为族字段 `effectiveAt`（E3），不进信封。二者之差按类型统计，就是账的健康度。
- 回看「那一刻我们知道什么」= 只折叠 `time ≤ 那一刻` 的前缀。沙盘的 `viewAt(k)` 就是这个操作。
- 法账影子重放（E3+）：新规则版本在全部历史上重放，与旧版本的投影做差，对表通过后才签发。

---

## 8. 更正、申诉、遗忘

- **更正**：现有的 `tombstone/appended` 加一行新行。内核的折叠已经能处理墓碑（`next/graph/src/store.ts`）。
- **申诉**（E1）：等于对那条结论再开一个判断需求。
- **遗忘**（E3）：加密粉碎。敏感字段用主体密钥加密，删除 = 销毁密钥；链里存的是密文，所以链仍然完整。「主体」怎么划是 Q8。场所合同 `memoryPolicy: 'never'` 的场所，只记结构、不记内容。

---

## 9. 可见域：这是能记下来的前提，不是合规项

承诺和判断的账，等于每个人的诺言和失误的全记录。它一旦变成监控工具，人们就会把话挪到私聊里说，入口一枯，账就空了。

- 听众继承自产生它的那句话（设计 v4.4；技术方案 §4 由族在 `data` 里声明）。
- 每次读取都过读取域钩子（`GraphReadHook`）。观看者由编排层绑定，永远不是模型能传的参数。
- **派生行的听众**（E1，Q4 的建议默认）：起因各自听众的**交集**，再并上被路由到的那个人。用交集，是因为并集会泄漏。
- 判断档案归本人（pgraph）。组织侧不按人聚合，不打分。

---

## 10. 物理存储

| 层级 | 形态 | 何时 |
|---|---|---|
| L0（现在，寄生期） | 每个实例账户分区一份 `graph.jsonl` 加 `snapshot.json`，单进程单写者（`next/graph/src/log.ts`）；**哈希链按分区** | E0–E3 |
| L1 | 服务端组织实例；Postgres 事件表，按租户列表分区、按月子分区；每分区一个写序列器 | E4。触发条件：寄生期结束，或单分区的写入、回放时间超过阈值 |
| L2 | 每个法人主体一个分区；跨主体 = 双边事件 + 清算服务 | E5 |

L1 草图：

```sql
create table ledger_event (
  tenant_id uuid not null, seq bigint not null,
  v smallint not null, sv int not null,
  time timestamptz not null, type text not null,
  actor jsonb not null, data jsonb not null,      -- authority / causedBy / audience / idemKey 都在 data
  prev bytea not null, hash bytea not null,
  primary key (tenant_id, seq)
) partition by list (tenant_id);
revoke update, delete, truncate on ledger_event from app_writer;   -- 只追加由权限保证
```

- 规模：一千人的企业，每天约五万次动作，每行约 1 KB，一年二三十 GB。字节不值钱。
- **刻意不选**：区块链（信任模型是组织加中立托管方，哈希链加外部存证就够）；图数据库（递归 CTE 足够）；专用事件库产品。

---

## 11. 防篡改、存证与清算所

- 哈希链（E0）：改动任何一行，它和它后面的每一行都对不上。
- 每日根存证（E3）：每天把链尾哈希交给外部。部分可见的读者用 Merkle 包含证明，验证自己看到的那部分没被改过。
- 跨组织承诺边（E5）：两本账里的同一个条目。流程是一方提出、对方账本签名，然后交付、验收、核销逐步双签。成对的事件由中立方保管，这就是清算所，按结算事件收费。

---

## 12. 与 `next/` 现状对照

| 能力 | 现状 | 缺口 |
|---|---|---|
| 只追加、折叠版本、墓碑 | `graph`（`GRAPH_FOLD_VERSION = 4`） | 哈希链与起点（E0） |
| 按观看者读取、读取域钩子 | `graph` | 无 |
| 承诺、受领三态、移交分叉 | `objects/commitment`（#58 / #59） | 投影要显示证据级别（E1） |
| 租约 | `objects/lease`；`covers()` 只返回布尔值 | 返回命中的那张租约（E0） |
| 守门人放行 | guard.ts:311 / :317 / :327 三处交给下游，ask 分支 :337；**都不留记录** | `action/*`（E0） |
| 不经守门人的出站写 | G1–G4（§3.1 路三），直接调 bridge | E0.5：在 bridge 收口 |
| 回合环境快照 | `env/snapshot.activeLeaseIds` **恒为空数组** | E0 填上 |
| 回合接纳消息的发送者 | `TurnBinding` 只有 `messageId`，没有发送者；`decider` 指的是能答卡的人（P1 = 操作者），**不是**发送者 | 加 `senderOpenId`（E0，`orchestrator.bindingOf` 里有 `trigger.fromOpenId`） |
| agent 出站发言 | `client.send` 只登记进 `channel-state.json`（非事实） | `outbound/posted`（E0） |
| 规范化 JSON | `objects/src/approval/family.ts` 私有的 `canonicalJson` | 挪进 graph（E0） |
| 押、裁决归档 | `pledger`（pgraph，私账） | 不动（#64） |
| 判断需求、检验点、结账 | 触发①已有（`approval`） | E1 |
| 钱、存证、多写者、跨组织 | 无 | E2–E5 |

---

## 13. E0 开发规格（可直接交开发 agent）

> 本节经过两轮冷读测试：每轮让一个没看过讨论的 agent 只凭本节和代码写实施计划，并列出所有需要猜的地方。第一轮提出 10 处歧义、5 处与代码不符、9 项风险；第二轮在修订稿上又找出 8 处歧义、2 处不符、2 项风险。都已逐条写进下文，关键的几条已对着代码核实过。

### 13.0 目标、范围、预算

- **目标**：被 E0 覆盖的出站写和发言（见下面的范围），每一次都在日志里留下一行，写明授权它的人；v2 行逐行成链，改动可被发现。
- **范围**：
  - ① `WRITE_SPECS` 里的工具，经 `tools/execute` 执行的每一次调用；
  - ② `channel` 的 `client.send(origin='agent')`。
- **已知不在范围内的出站写**（§12 的 G1–G4）：它们在 E0 里不改行为，留到 E0.5 统一收口（§14）。
- **不做**：判断族、钱、`effectiveAt`、`utterance/cited`、外部摄入、Postgres、跨实例、任何新 UI、自动重试。
- **预算**：新增和修改的 src ≤ 500 行，**不含注释和测试**。超了先回来改规格。
- **规矩**：照旧。一个改动单元一个 commit，直接落 main；实测 3090 前先 `pnpm --filter "@yzj-next/*" build`。
- **不可回滚**：旧构建只认 v1 行。部署 E0 之后再回退，E0 以来写下的所有行都会变成损坏行。**3090 部署前先备份每个分区的 `graph.jsonl`**；真要回退，就恢复备份，并接受 E0 期间的行全部丢失。

### 13.1 T1 哈希链与起点（`next/graph`）

1. 把 `canonicalJson` 从 `objects/src/approval/family.ts:128` 原样挪到 `graph/src/json.ts` 并导出；approval 改为 import。**`digestArgs` 的输出必须逐字不变**：先在测试里钉住一个改动前算出的值，再挪。
2. `types.ts`：
   - `GRAPH_ENVELOPE_VERSION = 2`（新写入用）；
   - `GraphEvent.v` 的类型改为 `1 | 2`；
   - 加 `prev?: string` 和 `hash?: string`。
3. `log.ts` 的 `decodeEvent`：
   - 接受 v1 和 v2，**保留行里原来的 `v`**。现在的代码在 `v` 不等于常量时直接拒绝这一行（log.ts:43）；只把常量改成 2，所有 v1 行都会被拒，整份旧日志等于消失。
   - 只有 v2 行才要求有 `prev` 和 `hash`；缺任何一个就算损坏行。
   - pledger 有自己的信封常量（`PLEDGER_ENVELOPE_VERSION`），**不动**：pgraph 不成链，E0 不涉及私账。如果 pledger 引用了 `GraphEvent` 的 `v` 类型，只做类型适配。
4. hash 的算法见 §4：对**写进文件的那个对象**计算，也就是 schema 解析、默认值填充之后的 `data`。
5. 新增内核族 `ledger`，加进 `vocabulary.ts` 的 `KERNEL_FAMILIES`：
   - `ledger/genesis`：`data { v1Through: int ≥ 0, v1Digest: string(64 位 hex) }`，`actor { kind: 'system' }`，没有 `objectIdOf`；
   - 照常过 schema；**不发出 `yzj-graph/appended`**，免得反应器多收一类事件。
6. **起点规则**：分区里还没有任何 v2 行时，在第一次 append 之前，**在同一个串行写链里**先写 genesis。
   - `v1Through` = 内存里当前的最后一个 seq；空分区为 0。
   - `v1Digest` = 此刻 `graph.jsonl` **整个文件**原始字节的 sha256；文件不存在就是空串的 sha256。
   - `prev` = 64 个 `'0'`。genesis 自己占一个 seq。
   - genesis 写失败时，本次 append 一并失败。
7. **成链规则**：
   - 每行 v2 的 `prev` = **按 seq 升序**的前一行 v2 里**存着的** `hash`。`load()` 本来就按 seq 排序并剔除损坏行（log.ts:87），校验就在它的输出上做。
   - **seq 不连续不算断链**：`service.ts:157` 先递增 `nextSeq` 再写盘，写盘失败时 seq 会被消耗掉。
   - **genesis 之后出现的任何非 v2 行都算断链**，`breakAt` = 该行的 seq。否则在 genesis 之后插一行伪造的 v1 行，它会被折叠成事实，链却不报。
   - `lastHash` **紧接 `await log.append(event)`（service.ts:158）之后**推进，不放在闭包末尾。
   - 顺带修一处现有行为：同一个闭包里每 200 次追加写一次快照（:161-164），快照写失败现在会让整个 `append` reject，可那一行其实已经落盘、已经折叠。**改为快照写失败只 `console.error`，不 reject**。否则一行已落盘的 `action/released` 会被当成失败，写入不执行，却永远等不到 settled。
   - hydrate 时 `lastHash` 取最后一行 v2 存着的 hash。
8. **加载校验**：从 genesis 起逐行校验，v1 段不校验。
   - 遇到第一处不符：`breakAt` = 该行的 seq，`verifiedThrough` 停在前一行，**之后不再前进**。
   - 新行照样按第 7 条接在最后一行存着的 hash 上，断点因此永久可见。
   - 校验函数**绝不向外抛错**：包上 try/catch，失败就当作 `breakAt` 处理。否则 `readyResolve` 永远不触发（`service.ts:89-98`），整个实例写不了。
   - 断链不阻止加载，也不阻止继续写，只 `console.error`。
9. 新方法 `ctx.yzjGraph.integrity()`：

   ```ts
   interface GraphIntegrity {
     readonly genesisSeq?: number      // 没有 v2 行时缺省
     readonly verifiedThrough: number  // 校验通过的最后一个 seq。实时值：没断时随每次成功追加推进，断了就冻结；没有 v2 行时为 0
     readonly breakAt?: number         // 第一个对不上的 seq
     readonly orphanActions: number    // 有 released、既无 settled 也无 outcome-unknown 的数量（§13.4）
   }
   ```

10. 分区打开、hydrate 和校验都完成后，发出新事件 `yzj-graph/opened`，载荷 `{ accountKey, lastSeqAtOpen }`。§13.4 的孤儿扫描挂在它上面，不挂在 `ready()` 上：`ready()` 有 15 秒超时，而分区要等 CLI 拿到身份才会打开。
11. `GRAPH_FOLD_VERSION` 改为 5（新增族；规矩是 +1）。代价已知：首次启动所有快照作废，要全量重折，并全量校验一遍 sha256。

### 13.2 T2 `atomOf`（`next/graph`）

```ts
export type Atom = 'said' | 'did' | 'seen' | 'ruled'
export function atomOf(event: GraphEvent): Atom
// person | operator → 'said'；agent → 'did'；system → 'ruled'
// 'seen' 在 E0 不会出现：现有外部观测（event/observed）的 actor 都是 agent。E1 摄入外部数据时再扩展
```

纯函数，不存储。

### 13.3 T3 授权来源与 `action/*`（`next/objects`、`next/tools`、`next/channel`）

**统一的键**：一次调用由 `(sessionId, callId)` 唯一确定，其中 `sessionId = String(agent.session.id)`。callId 只在单个会话内唯一，审批的身份就是 `approvalIdFor(sessionId, callId)`（`approval/family.ts:142`）。下文所有 Map 的键、所有行的配对，都用这一对，写作 `${sessionId}:${callId}`。

1. **租约**：`objects/src/leases.ts` 的 `YzjLeases` 加：

   ```ts
   coveringLease(query: LeaseQuery): { readonly leaseId: string; readonly grantedBy: string } | undefined
   ```

   `covers(q)` 改为 `coveringLease(q) !== undefined`。`objects/src/lease/index.ts` 实现时，多张同时命中就取 `period.from` 最早的，相同再按 `leaseId` 字典序。
2. **发送者**：`TurnBinding` 加 `senderOpenId?: string`。`orchestrator.ts` 的 `bindingOf`（:302）在 `trigger.fromOpenId` 非空时填它。synthetic 回合（:918）要把 `senderOpenId` 和 `messageId` 一起剔掉，因为它的 fromOpenId 就是操作者本人。**空串一律视为缺失**。
3. **新族 `action`**，放在 `tools/src/action.ts`，由 tools 插件注册。三个事件都没有 `objectIdOf`：

   ```ts
   type Authority =
     | { kind: 'lease'; leaseId: string; grantedBy: string }
     | { kind: 'message'; messageId: string; senderOpenId: string }
     | { kind: 'approval'; approvalId: string; decidedBy: string }
     | { kind: 'operator'; openId: string; via: 'exempt' | 'host-approval' }
       // exempt：spec.when 为假，且本回合没有可用的接纳消息
       // host-approval：确认由宿主自己的审批界面完成，图上没有 approval 对象（answerer.ts:93/98/102 交给宿主的三种情形）。
       //   宿主的审批界面只在操作者桌面上，所以批准者就是操作者

   'action/released': { sessionId, callId, toolName, level: 'standard'|'strong', argsDigest,  // argsDigest 用 digestArgs
                        authority: Authority, topicKey?, placeKey? }                       // actor { kind: 'agent' }
   'action/settled':  { sessionId, callId, outcome: 'ok'|'failed'|'aborted-after-body'|'not-dispatched',
                        errorCode?: string, durationMs: number }                         // actor { kind: 'agent' }
   'action/outcome-unknown': { sessionId, callId, releasedSeq: number,
                               rule: { id: 'ledger.orphan-action', version: 1 }, causedBy: [releasedSeq] } // actor { kind: 'system' }
   ```

   **`action/settled` 不用布尔值，用 `outcome` 记效果有没有发生**。依据是 `tools/execute` 里 `next()` 返回的结果（dsh-tools `lib/index.js:3168-3186`）。post-execute 之后还可能再改写结果，但账要记的是效果。

   | `next()` 的结果 | `outcome` | 含义 |
   |---|---|---|
   | `isError` 为假 | `ok` | 执行了 |
   | `error.info.code` = `TOOL_ABORTED_BEFORE_DISPATCH` | `not-dispatched` | 工具体没被调用，确定没执行 |
   | `error.info.code` = `TOOL_ABORTED` | `aborted-after-body` | 工具体已经跑完，但调用已被取消：**效果可能已经发生**。例如 orchestrator 的超时路径（:576-577） |
   | 其他错误 | `failed` | 工具体报错，`errorCode` = `error.info.code`（有就填） |


4. **守门人记下放行路径**。`tools/src/guard.ts` 往模块内的 `Map<key, PendingAuthority>` 写入：

   | 分支 | 记下 |
   |---|---|
   | `spec.when` 为假（:311） | 有 `messageId` 且有 `senderOpenId` → `message`；否则 → `operator { via: 'exempt' }`，openId 取 `binding.accountOpenId`。例如 `memory_note` 的场所轴：它虽是 strong，但从这里放行 |
   | 租约分支（:317） | `lease`，带 `coveringLease` 的结果 |
   | 消息分支（:327） | 放行条件**加上「有 `senderOpenId`」**，满足时记 `message`；不满足就落到 ask（宁可多问一次，也不放出无主的写） |
   | ask 分支（:337） | 标记为 `approval`，具体是哪一种留到执行时判定 |

   这里只是**挂起**，不写日志：之后 dsh-tools 的单调守卫（`ctx.tools.guard`）还可能拒绝。

   **Map 放在 `applyApprovalGuard` 的闭包里**，`tools/execute` 也在 `applyApprovalGuard` 里注册，这样现有的测试 harness 能直接驱动。不用模块级变量：它会跨 Context 共享，插件卸载后条目还在。上限 5,000 条，**先检查是否超限、超了先清空，再写入**（注意 `snapshotted` 是先写后清，照抄会把刚写入的授权也清掉）。
5. **先记后做**：在 tools 插件里注册 `tools/execute`（waterfall，`prepend: true`），**只处理 `WRITE_SPECS` 里的工具**：
   0. 两种 `operator` 的 openId，都取执行时的 `bindingFor(ctx, agent)?.accountOpenId`。guard.ts:158 的 `bindingFor` 已经带默认 binding 的兜底；仍取不到就 fail closed。
   1. 按 key 取 PendingAuthority。如果是 `approval`：
      - 用 `approvalIdFor(sessionId, callId)` 读审批对象；
      - 状态为 `approved` → `approval { approvalId, decidedBy }`；
      - 对象不存在 → `operator { via: 'host-approval' }`；
      - 其他状态 → 按理不会走到这里，fail closed。
   2. 取不到 PendingAuthority → fail closed。
   3. `await ctx.yzjGraph.append('action/released', …)`。抛错 → fail closed。
   4. `const result = await next()`。
   5. 在 `finally` 里写 `action/settled`。这一步写失败只 `console.error`，不改 result，下次启动由 §13.4 兜底。
   6. 删除 Map 条目。

   **fail closed 的返回值**：与 dsh-tools 自己的错误结果同形，即 `{ isError: true, error: { message }, content: [{ type: 'text', text: 'Error: …' }] }`。文案分两种：
   - 「账没记上，这次写入没有执行（{原因}）」；
   - 「找不到这次写入的授权，没有执行」。

   **已知的波及面**（都是 fail closed 的预期效果，不放出没记账的写）：
   - 分区没打开或磁盘满时，所有 `WRITE_SPECS` 写入都会被拒，包括 `memory_note` 和 `commitment_*`；
   - 如果有监听排在守门人前面，并且不调 `next()` 就直接放行，守门人就没机会挂起授权，这次写会因为找不到授权被拒。仓库内没有这样的监听，宿主层未知。
6. `env/snapshot.activeLeaseIds`（guard.ts:261）：`YzjLeases` 再加一个 `activeLeaseIds(): readonly string[]`，用与 `coveringLease` 同一套判据，即 `objects/src/lease/index.ts` 的 `activeLeases(ctx)`，它带 period 过滤。快照里填它的返回值。

### 13.4 T4 孤儿动作（`next/tools`）

- 收到 `yzj-graph/opened` 后扫一遍，**只扫 `seq ≤ lastSeqAtOpen` 的行**，免得把刚开跑的在途调用误标。
- 凡有 `action/released`、却没有同 key 的 `settled` 或 `outcome-unknown` 的，各写一行 `action/outcome-unknown`。同一 key 只写一次。
- `outcome: 'aborted-after-body'` 的 settled 不算孤儿：它已经如实记下了「效果可能已发生」，审计报告里单独计数。
- **不重试，不查对方系统**：云之家接口没有幂等键。

### 13.5 T5 出站发言（`next/channel`）

- 新族 `outbound`，没有 `objectIdOf`，放在 `channel/src/outbound.ts`：

  ```ts
  'outbound/posted': { msgId, groupId, replyMsgId?, contentDigest,   // contentDigest = 已签名正文的 sha256 hex；不存正文
                       authority: { kind: 'message'; messageId; senderOpenId }
                                | { kind: 'operator'; openId; via: 'proactive' } }   // actor { kind: 'agent' }
  ```

- `groupId` 取 `send()` 回包里的 groupId；回包没有时，取发送目标（私聊时是 `dm:<openId>` 的形式）。
- `operator.openId` 取通道钉住的账号身份。
- **不变式**：每一次 `client.send(…, origin='agent')` 拿到 `msgId`，恰好写一行；`origin='desk'` 是人自己说话，**不写**。
- **实现**：
  - `client.send` 加第 5 个可选参数 `admission?: { messageId: string; senderOpenId: string }`；
  - 构造器接受可选的 `onSent` 回调，拿到 msgId 且 origin 为 agent 时调用，回调里的异常吞掉；
  - channel 插件注入 `onSent`，在里面写行。
- **传 `admission` 的调用点**只有 orchestrator 的三处：回复投递（:864）和两处让位通知（:419、:519）。
  - :864 在 `deliver()` 里。ack、超时或失败通知、重放、`reply()` 都走它，所以都记成 `message`。这是对的：它们都是对那条接纳消息的回应。
  - `trigger.fromOpenId` 为空串时**不传** `admission`。
  - 其余调用点（在岗声明、登记回执等）不传，记 `operator { via: 'proactive' }`。
- 写失败只 `console.error`，不撤回消息。

### 13.6 T6 审计（`next/graph`，只读）

```ts
export function auditLedger(events: readonly GraphEvent[]): {
  readonly byAtom: Record<Atom, number>
  readonly byType: Record<string, number>
  readonly saidWithoutOpenId: number   // I5（先量后禁）
  readonly orphanActions: number       // 同 integrity().orphanActions 的定义
  readonly abortedAfterBody: number    // outcome = 'aborted-after-body' 的 settled 数：效果可能已发生，要人看
  readonly chain: GraphIntegrity       // 与 integrity() 对同一份文件给出相同结果（同一个校验函数）
}
```

开发脚本放在 `graph/scripts/audit.ts`，在 `package.json` 里登记为 `audit`，要求一条命令就能跑起来。仓库里没有 TS 运行器，Node 的类型剥离也不支持参数属性（log.ts:63、service.ts:58 用了），所以先 build，再跑构建产物。**不进模型工具面，不进 UI。**

### 13.7 测试

**会变红、需要改的旧断言**（预期之内，改断言，不改实现）：
- `graph/tests/graph.spec.ts` 里断言行数或 seq 的几处（:93-94、:103、:326）：genesis 多占一行、一个 seq；
- `graph/tests/graph.spec.ts:330-347`「较新的构建写了一个本构建不认识的族」：它的夹具在 :335 手写了一行 v1、`seq: 2`，E0 之后会和 note 的 seq 撞号，而且 genesis 之后的 v1 行会被判断链。**把夹具改写成一行合法的 v2 行**：`seq: 3`，`prev` 和 `hash` 用导出的 `eventHash` 计算；:347 的期望改为 4。这条测试的原意（未知类型被保留、下一个 seq 越过它）保持不变；
- `tools/tests/guard.spec.ts:19` 的 `GATEWAY_BINDING`：补上 `senderOpenId`，否则消息分支会变成 ask。

**新增验收测试**（全部要有）：

| # | 测试 |
|---|---|
| 1 | `canonicalJson` 挪动后，`digestArgs` 对一个固定输入的输出与改动前逐字相同 |
| 2 | 固定事件 → 固定 hash（开发算出后钉进测试） |
| 3 | 只有 v1 行的分区：v1 行照常解码，`v` 仍是 1；第一次 append 先写 genesis，`v1Through` 等于原最后 seq，`v1Digest` 等于原文件的 sha256，`prev` 为 64 个 0 |
| 4 | 空分区连续写 3 行（genesis 是 seq 1，然后是 seq 2、3、4）。把 seq 3 那一行 `data` 里某个字符串字段的一个字符改掉，**保持 JSON 合法**，重新加载：`breakAt = 3`，`verifiedThrough = 2`；加载不抛错；之后还能继续写，新行接在 seq 4 存着的 hash 上 |
| 5 | 写盘失败消耗了一个 seq，之后的行照常成链，`breakAt` 为空（seq 空洞不算断链） |
| 6 | 租约路径：有覆盖 `yzj_doc_create` 的 active 租约 → `action/released` 的 `authority.kind = 'lease'`，`leaseId` 正确，随后 `settled { outcome: 'ok' }` |
| 7 | 消息路径：标准写，`messageId` 与 `senderOpenId` 齐全 → `message`；缺 `senderOpenId` → 走 ask |
| 8 | 确认路径：批准 → `approval`，`approvalId = approvalIdFor(sessionId, callId)`，`decidedBy` 正确；拒绝 → 没有 released，工具体没执行；宿主审批（图上没有审批对象）→ `operator { via: 'host-approval' }` |
| 9 | **`when` 为真或没有 `when` 的 strong 写**，authority 永远是 `approval` 或 `operator/host-approval`，从不是 `lease`；`memory_note` 的场所轴记 `message` 或 `operator/exempt` |
| 10 | fail closed：让 `append('action/released')` 抛错 → 工具体没被调用，返回值是 dsh-tools 同形的错误结果 |
| 11 | 两个会话用同一个 callId 并发执行 → 授权不串号，两对 released/settled 各自配对 |
| 12 | 读工具不产生任何 `action/*` 行 |
| 13 | 孤儿：存在 released 而没有 settled，打开分区两次 → 恰好一行 `outcome-unknown`；打开之后才开始的调用不被扫到 |
| 14 | 出站：`origin='agent'` 发送成功 → 恰好一行 `outbound/posted`，日志里没有正文；`origin='desk'` → 零行；传了 `admission` 记 `message`，没传记 `operator/proactive` |
| 15 | 删掉快照全量重放，对象与带快照加载逐字一致 |
| 16 | `env/snapshot.activeLeaseIds` 等于当时 active 的租约 id |
| 17 | `auditLedger` 与 `integrity()` 对同一份被篡改的文件给出相同的 `breakAt` |
| 18 | 取消：在工具体被调用之前取消 → `outcome: 'not-dispatched'`；工具体跑完之后取消 → `outcome: 'aborted-after-body'` |
| 19 | genesis 之后插入一行 v1 行 → `breakAt` = 该行的 seq |
| 20 | 快照写失败时，`append` 仍然 resolve，那一行在盘上，`lastHash` 已推进 |
| 21 | 没有任何 binding 时（无默认 binding），需要 `operator` 授权的写被拒，返回「找不到这次写入的授权」 |

### 13.8 完成定义

- 全部测试绿；
- 在 3090 实测（先备份）：租约、消息、确认三条路径各走一次写，再发一次 agent 回复。审计脚本对**部署之后产生的行**报告：每条 released 都有 settled，`chain.breakAt` 为空；
- 在本册 §12 把 E0 各行改成「已有」，并在末尾加「实施记录」一节（实现者增记），写明 G1–G4 仍未覆盖。

---

## 14. E1–E5（设计级）与开放问题

**开发 agent 不得开工**，要先由人拍板以下问题。每条附我的建议默认值，供拍板时推翻。

| 期 | 内容 | 证据门 |
|---|---|---|
| E0.5 | 在 bridge 收口：写类 CLI 命令必须带授权来源，否则拒绝；G1–G4 纳入；G1 的描述与行为对齐（要么进 `WRITE_SPECS`，要么改描述，由人定，见 Q9） | 代码里不存在不带授权来源的写类 bridge 调用（用测试锁住） |
| E1 | `utterance/cited`；判断需求出生（三种触发）、排期、撤销；裁决的 `checkpoint` 与当时所见；结账与申诉；`ruled` 全面执行 I4 | 「现在有什么在等人拍板」1 秒内答出，且和人的自报一致 |
| E2 | 钱：先接模型 usage → 承诺的归属；「未归属」投影与月结闸门 | 每张单、每一注的 agent 成本不再需要手工分摊 |
| E3 | `effectiveAt`、每日根存证、Merkle 包含证明、加密粉碎 | 任意一天能复算出同一个根 |
| E4 | 服务端组织实例、Postgres、序列器、投影工作者 | 寄生期结束，或性能阈值触发 |
| E5 | 跨组织承诺边、清算服务 | 第一对真实的双签「交付—验收—核销」 |

**开放问题**：

| # | 问题 | 建议默认 |
|---|---|---|
| Q1 | 「职责」用什么对象表示？谁签发？分类用的领域表谁维护？ | 职责 = 一条 `parentGoalRef` 指向组织目标的长期承诺，由上级签发；领域表先手工维护，每个领域一个持有人；分类不中时归触发者本人 |
| Q2 | 触发②（事实与承诺矛盾）需要承诺有可机读的数量和日期吗？ | E1 只做日期（`due` 已有）；数量留到外部摄入（E2）之后 |
| Q3 | 排期要不要订进日历？ | E1 只排队列、只发卡，不订日历 |
| Q4 | 派生行的听众怎么定？ | 起因听众的交集，并上被路由到的人 |
| Q5 | 公开的 `checkpoint` 写在哪？ | 写在裁决卡上，是可选字段；只有裁决人能填；可见范围 = 裁决的听众 |
| Q6 | 模型价格表从哪来？ | settings 里按 provider 和模型配置单价；没配置就只记 token 数，不折算成钱 |
| Q7 | 规则版本由谁签发？法账还不存在 | 规则 = 代码常量 `id@version`；升级部署时由操作者写一行 `said: rule/adopted`，算作签发 |
| Q8 | 加密粉碎的「主体」怎么划？一行可能提到多个人 | 按「发言者」划，只加密正文类字段；结构字段（谁、何时、哪一类）不加密 |
| Q9 | `event_post_materials` 该不该经确认？ | 进 `WRITE_SPECS`，定为 standard：它改的是所有参会人都会看到的日程，在接纳消息的回合内免确认，其余情况要问 |

---

## 15. 断言

**E0（合并门槛，对应 §13.7）**：

1. 没有任何代码路径能在不写 `action/released` 的情况下执行 `WRITE_SPECS` 里的工具（E0.5 起扩展为：任何写类 bridge 命令）。
2. `action/released` 的 authority 必能解析到一个 openId；解析不了就不执行。
3. 每次 `origin='agent'` 的成功发送恰好对应一行 `outbound/posted`，日志里没有正文。
4. 改动任意一行 v2，校验在该行报告断链。
5. 删掉快照全量重放，投影逐字节一致。
6. 模型可调用的工具面上，没有写 `said` 的接口（现状如此，加测试锁住）。

**E1 以后**：

7. 任何组织侧投影的返回类型都不含「人名 × 分数」。
8. 派生状态字段（§2.2 的定义）不出现在任何行里。新族评审时逐个检查。
9. 拍板行带当时所见的摘要，且该摘要指向的快照可以取回。
10. 每一笔钱的引用，要么有归属，要么出现在「未归属」里。

---

## 16. 不做什么

- 不做第二个总账：GL 留在原系统，新账只引用和归属。
- 不存状态：状态是投影。
- 不让模型写事实：模型只能起草（`did`），事实由人签（`said`）。
- 不在写入路径上调用模型：约束校验是确定性代码。
- 不给人打分：判断档案归本人（#64）。
- 不催受领（#58）。
- 不自动重试没有幂等键的外部写。
- 不上区块链，不提前上图数据库，不为假想的规模提前分布式化。
