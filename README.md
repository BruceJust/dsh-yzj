# dsh-yzj — 云之家 × DeepSeek Harness 插件

将云之家（Yunzhijia）的全部 CLI 能力搬进 DeepSeek Harness：`yzj-cli` 桥接、六域模型面工具（含写入确认流）、以及一套为云之家设计的浏览器 UI（工具结果富卡片 + 云之家工作台面板）。

独立仓库的 bundle 包，通过 `dsh plugin --profile <name> add <package>` 安装，不修改 harness 本体。

## 包结构

| 包 | 角色 | 说明 |
|---|---|---|
| [`packages/bridge`](packages/bridge/README.md) | `@dsh-yzj/bridge` → `ctx.yzjBridge` | 有界子进程通道：argv 数组直启 `yzj-cli`，无 shell 插值；复用机器上 `yzj-cli auth login` 的登录态与 keychain 凭据，harness 全程不接触 appSecret/accessToken |
| [`packages/tool-yzj`](packages/tool-yzj/README.md) | `@dsh-yzj/tool-yzj`（注册到 `ctx.tools`） | 41 个模型面工具：doc（16）/ sheet（10）/ calendar（7）/ contact（3）/ im（3）/ file（2）；每个工具输出有界 digest，并把裁剪后的结构化载荷经 `output.presentationMeta` 投影给 UI |
| [`packages/ui-yzj`](packages/ui-yzj/README.md) | `@dsh-yzj/ui-yzj`（`dsh.client` 双面包） | node half：`/yzj` Connection RPC 通道；browser half：`tool.call.toolview` keyed 富卡片 + 侧边栏「云之家」按钮 + 工作台 overlay 面板 |
| [`packages/bundle`](packages/bundle/README.md) | `@dsh-yzj/bundle` | 可安装的 profile patch 层（`cordis.patch.yml`），挂载上面三行 |

## 安装

```sh
# 在 harness checkout 下（本机 GUI 为源码启动）：
pnpm dsh plugin --profile web add -w link:/Users/guoxinshan/dev/dsh-yzj/packages/bundle

# 或从仓库内（有 dsh 可执行文件时）：
dsh plugin --profile web add <npm 包名或路径>
```

安装后重启 GUI（源码启动时重启 `node --import tsx/esm apps/cli/src/bin.ts web`），侧边栏底部出现「云之家」按钮。

> 本地开发用 `link:` 依赖指向 harness checkout；对外发布时把各包的 `link:` 依赖换成已发布的 `@deepseek-ai/dsh-*` 版本范围。

## 功能面

- **doc**：知识库列表/详情/新建、文档树浏览、文档详情、最近文档、创建/重命名/移动/删除、导入（md inline / 文件 reference）、下载链接、块级 list/insert/update/delete
- **sheet**：多维表格创建、schema 读取、数据表 get/create/rename/delete、记录 list（筛选/搜索/分页）/create/update/delete
- **calendar**：日程 list/get/create/update/delete（软取消或硬删）、参会人、空闲会议室
- **contact**：whoami、通讯录搜索、用户详情
- **im**：发消息（text/file/richText、@、回复、多图）、聊天记录、最近会话
- **file**：上传（≤30MB、最多 5 并发）、下载（自动重命名 / 覆盖）

### 确认流（确认卡）

全部 22 个写工具按风险分级在 `tools/pre-execute` 返回 `ask`（标准确认 / 强确认），由 host 侧 `write-gate` 应答 `approval/request` waterfall 后，在浏览器渲染**按 domain 分发的确认卡**：参数全文（消息目标/文档落位/记录内容/日程时间等，不折叠截断）、风险徽标（删除类强确认红色卡片）、四动词（确认 / 取消 / 查看上下文 / 编辑）。`查看上下文` 打开悬浮窗并锚定对应 tab/消息；终态由官方工具事件承载（回放安全）。覆盖：`doc`（含 workspace/rename/move/import/block）、`sheet`（含 table/record）、`calendar`、`im message send`、`file upload/download` 全部写操作。

## 与 yzj-cli skill 的关系

bundle 交付**改造版 skill**（`packages/bundle/skills/yzj-cli/SKILL.md`），安装到 `~/.agents/skills/yzj-cli/`（覆盖官方原版前请先备份；本机已备份为 `SKILL.md.orig`，`references/` 保留官方细节）：

- **红线**：写操作必须走 `yzj_*` 工具（确认卡门控）；**禁止 bash 直调 `yzj-cli` 执行写命令**——官方原版 skill 会引导模型绕过确认卡直发消息（已真实复现并封堵，见 gap 文档验证证据）；
- 仅当工具不可用（未登录、CLI 缺失、权限错误）时，bash 兜底只允许只读命令；
- 保留官方红线：禁止编造 ID、写前先查、删除类复述目标。

### UI 设计

- **工具结果富卡片**：`tool.call.toolview` keyed 注册全部 41 个工具名。pending 态从参数渲染标题；settled 态优先渲染结构化 `meta`（文档详情/列表、数据表 schema、记录表、日程时间线、消息气泡、联系人卡片），无结构时回退到 digest 文本。失败态显示错误摘要。
- **云之家工作台**：侧边栏底部按钮 + 浮层面板，四个 tab——知识库（工作区 → 文档树钻取）、日程（今日）、会话（最近群 → 消息气泡）、我的（身份卡片 + 通讯录搜索）。数据经 `/yzj` RPC 通道实时拉取，与工具调用互不依赖。全条目可拖拽进 composer（chip + 上下文回源 + 拖入即处理快捷动作）。

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
