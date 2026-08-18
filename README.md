# dsh-yzj — 云之家 × DeepSeek Harness 插件

将云之家（Yunzhijia）的全部 CLI 能力搬进 DeepSeek Harness：`yzj-cli` 桥接、六域模型面工具（含写入确认流）、云之家 `@agent` 消息任务网关，以及一套为云之家设计的浏览器 UI（工具结果富卡片 + 云之家工作台面板）。

独立仓库的 bundle 包，通过 `dsh plugin --profile <name> add <package>` 安装。云之家能力本身不改 harness Host；原生 Session 分层导航当前需要仓库内一个对 `@deepseek-ai/dsh-client-ui-workspace@0.1.0-rc.6` 的版本/哈希双校验补丁，待该通用扩展点进入 DSH 上游后可删除。

## 包结构

| 包 | 角色 | 说明 |
|---|---|---|
| [`packages/bridge`](packages/bridge/README.md) | `@dsh-yzj/bridge` → `ctx.yzjBridge` | 有界子进程通道：argv 数组直启 `yzj-cli`，无 shell 插值；复用机器上 `yzj-cli auth login` 的登录态与 keychain 凭据，harness 全程不接触 appSecret/accessToken |
| [`packages/tool-yzj`](packages/tool-yzj/README.md) | `@dsh-yzj/tool-yzj`（注册到 `ctx.tools`） | 41 个模型面工具：doc（16）/ sheet（10）/ calendar（7）/ contact（3）/ im（3）/ file（2）；每个工具输出有界 digest，并把裁剪后的结构化载荷经 `output.presentationMeta` 投影给 UI |
| [`packages/agent-gateway`](packages/agent-gateway/README.md) | `@dsh-yzj/agent-gateway`（host plane） | 轮询云之家新消息，识别显式文本 `@agent`，群聊按话题、私聊按联系人创建/恢复持久 Agent Session，按组织与登录账号隔离，回传关键进度与最终状态；复用当前登录账号权限执行标准读写 |
| [`packages/ui-yzj`](packages/ui-yzj/README.md) | `@dsh-yzj/ui-yzj`（`dsh.client` 双面包） | node half：`/yzj` Connection RPC 通道；browser half：`tool.call.toolview` keyed 富卡片 + 右下角「云之家」悬浮球 + 工作台 overlay 面板（三应用：知识库/日程/会话，桌面顶部导航 + 左右水平调宽 + 窄屏底部导航，响应式窄窗单列钻取） |
| [`packages/bundle`](packages/bundle/README.md) | `@dsh-yzj/bundle` | 可安装的 profile patch 层（`cordis.patch.yml`），挂载上面四行 |

## 安装

```sh
# 在 harness checkout 下（本机 GUI 为源码启动）；本地 workspace 包需全部
# 直接链接到 profile 根，bundle 负责 composition，其他包负责行名解析：
pnpm dsh plugin --profile web add -w \
  link:/Users/guoxinshan/dev/dsh-yzj/packages/bundle \
  link:/Users/guoxinshan/dev/dsh-yzj/packages/bridge \
  link:/Users/guoxinshan/dev/dsh-yzj/packages/tool-yzj \
  link:/Users/guoxinshan/dev/dsh-yzj/packages/agent-gateway \
  link:/Users/guoxinshan/dev/dsh-yzj/packages/ui-yzj

# 或从仓库内（有 dsh 可执行文件时）：
dsh plugin --profile web add <npm 包名或路径>

# DSH rc.6 尚未内置 Session 子树 provider；从本仓库执行一次，重复执行幂等：
pnpm patch:dsh-workspace
```

`patch:dsh-workspace` 只接受精确的 rc.6 包版本和原始 SHA-256，应用后再次核对结果 SHA-256。DSH 升级或文件漂移时命令会拒绝执行，不会把补丁强套到未知代码。补丁只扩展 Workspace Browser 的通用数据边界；无 provider、普通 Workspace 和 `flat` 模式保持原行为。

安装后重启 GUI（源码启动时重启 `node --import tsx/esm apps/cli/src/bin.ts web`），页面右下角出现「云之家」悬浮球。

> 本地开发用 `link:` 依赖指向 harness checkout；对外发布时把各包的 `link:` 依赖换成已发布的 `@deepseek-ai/dsh-*` 版本范围。

## 功能面

- **doc**：知识库列表/详情/新建、文档树浏览、文档详情、最近文档、创建/重命名/移动/删除、导入（md inline / 文件 reference）、下载链接、块级 list/insert/update/delete
- **sheet**：多维表格创建、schema 读取、数据表 get/create/rename/delete、记录 list（筛选/搜索/分页）/create/update/delete
- **calendar**：日程 list/get/create/update/delete（软取消或硬删）、参会人、空闲会议室
- **contact**：whoami、通讯录搜索、用户详情
- **im**：发消息（text/file/richText、@、回复、多图）、聊天记录、最近会话
- **file**：上传（≤30MB、最多 5 并发）、下载（自动重命名 / 覆盖）

### 云之家 `@agent`

群聊或单聊的新消息、回复消息出现文本 `@agent` 或 `@智能体` 时，host gateway 会在最多一个轮询周期内接收任务。普通的“@当前登录账号”默认不会触发；只有显式启用 `acceptAccountMentions` 后才会将非 `@all` 的结构化 mention 作为任务。群聊以云之家话题根为持久 DSH Session 边界，同一话题的多次 `@agent` 连续上下文、串行执行，不同话题（即使在同一群）使用独立 Session 并可并行；私聊按联系人会话复用 Session。Gateway 仅注入当前话题的有界回复链或私聊窗口，先回复已接收，长任务通过 `yzj_agent_progress` 回报少量关键节点，最后回复 `【Agent完成】` 或 `【Agent失败】`。Session 身份同时包含组织和登录账号，默认挂入独立的“云之家 Agent” DSH Workspace，并使用群名、话题摘要或联系人名作为标题。

任务使用当前 `yzj-cli` 登录账号的真实权限读取其他群聊、知识库、多维表格、日程和文件。由 `@agent` 明确触发的当前 turn 可自动执行标准、可逆写操作；删除等强风险操作仍需确认。默认允许任意可见群成员触发，生产使用建议采用专用云之家账号，或在 Gateway 配置 `allowedGroupIds` / `allowedSenderOpenIds`。CLI 暂无 webhook，当前实现为常驻有界轮询，DSH 进程必须在线。

### 确认流（确认卡）

普通 Web 对话中的全部 22 个写工具按风险分级在 `tools/pre-execute` 返回 `ask`（标准确认 / 强确认），由 host 侧 `write-gate` 应答 `approval/request` waterfall 后，在浏览器渲染**按 domain 分发的确认卡**：参数全文（消息目标/文档落位/记录内容/日程时间等，不折叠截断）、风险徽标（删除类强确认红色卡片）、四动词（确认 / 取消 / 查看上下文 / 编辑）。`查看上下文` 打开悬浮窗并锚定对应 tab/消息；终态由官方工具事件承载（回放安全）。`@agent` Gateway 当前 turn 的标准写操作由触发消息预授权，强风险操作仍进入同一确认流。覆盖：`doc`（含 workspace/rename/move/import/block）、`sheet`（含 table/record）、`calendar`、`im message send`、`file upload/download` 全部写操作。

## 与 yzj-cli skill 的关系

bundle 交付**改造版 skill**（`packages/bundle/skills/yzj-cli/SKILL.md`），安装到 `~/.agents/skills/yzj-cli/`（覆盖官方原版前请先备份；本机已备份为 `SKILL.md.orig`，`references/` 保留官方细节）：

- **红线**：写操作必须走 `yzj_*` 工具（确认卡门控）；**禁止 bash 直调 `yzj-cli` 执行写命令**——官方原版 skill 会引导模型绕过确认卡直发消息（已真实复现并封堵，见 gap 文档验证证据）；
- 仅当工具不可用（未登录、CLI 缺失、权限错误）时，bash 兜底只允许只读命令；
- 保留官方红线：禁止编造 ID、写前先查、删除类复述目标。

### UI 设计

- **Agent Session 分层导航**：在“按 Workspace 分组”模式下，`云之家 Agent` 使用 `群 → 话题 Session` 的原生可折叠树，私聊集中在一个紧凑分支，无法可靠归属的旧日志进入“历史会话”。群节点汇总运行/待确认/完成提醒，展开状态持久化，每支先显示最近 5 项；搜索同时匹配群名、话题名、旧完整标题并显示 breadcrumb。Session 行的打开、重命名、fork、归档和状态仍由 DSH 原生组件负责；`flat` 模式保持扁平。
- **工具结果富卡片**：`tool.call.toolview` keyed 注册全部 41 个工具名。pending 态从参数渲染标题；settled 态优先渲染结构化 `meta`（文档详情/列表、数据表 schema、记录表、日程时间线、消息气泡、联系人卡片），无结构时回退到 digest 文本。失败态显示错误摘要。
- **云之家工作台**：右下角悬浮球（hover 快捷 dock）打开命令栏 + 工作台面板，三个应用——知识库（工作区 → 文档树钻取）、日程（月历 + 当日议程）、会话（最近群 → 消息，未读徽标）。桌面端命令栏下方为全宽顶部导航（图标 + 标签，蓝色选中态），面板可从左右两侧水平调整宽度（桌面 480–1080px、默认 760；指针或键盘，宽度跨关闭/重开与刷新持久化）；面板宽度低于 620px 时仍保留顶部导航与调宽手柄，内容自动切换为单列钻取（返回按钮），宽于 620px 恢复双栏；720px 以下同一导航切换为固定在面板底部的三栏底部导航（图标上标签、安全区适配），内容保持全视口单列钻取（移动端返回按钮）；悬浮窗拖拽与调宽手柄在窄窗/触屏下禁用。全条目可拖拽进 composer（chip + 上下文回源 + 拖入即处理快捷动作）。

## 开发

```sh
pnpm install          # link 依赖指向 ../deepseek-harness（相对路径，可移植）
pnpm -r --sort build  # 全仓构建（tsc + tsdown）
pnpm test             # vitest：bridge 单测 + 工具真实 CLI 冒烟 + 浏览器组件测试
pnpm --filter @dsh-yzj/ui-yzj bundle   # 仅重建客户端 bundle（改 UI 后）
```

改了客户端 UI 后需重建 bundle 并重启 GUI（web profile 的 `hmr` 在 web-app 层被禁用）。浏览器验收脚本见 `.acceptance/`（`verify-real-data.mjs` 需已登录的 yzj-cli，`verify-windows.mjs` 验证无 CLI 降级）。

## 已知限制

- **依赖解析**：各包以 `link:` 相对路径依赖 harness checkout（`../../../deepseek-harness/...`）；发布前需替换为已发布的版本范围并验证 `dsh plugin add` 从 registry 安装。
- **确认卡状态不落会话日志**：harness 对外部插件的自定义 session 事件类型无注册面，确认卡 pending/approved 瞬态由 host 内存表承载（SPA 刷新存活；host 重启降级为普通工具卡），终态由官方工具事件回放。
- **无群搜索/消息搜索**：沿用 CLI 能力面（最近会话翻页定位）。
- **`file download` 只回传摘要**：CLI 的 `downloaded N bytes to <path>` 文本输出不携带结构化路径，卡片回退文本模式。
- **工作台面板为只读浏览**：面板内不直接发起写入（写入走对话 + 工具确认流）。
- **无独立文件夹概念**：归类用父文档挂载，与云之家产品语义一致。
