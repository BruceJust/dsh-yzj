# @dsh-yzj/bundle

Installable dsh profile bundle for 云之家. Declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, making it a patch layer for `dsh --profile` compositions ([profile contract](../../deepseek-harness/packages/boot/app-boot/README.md#profiles)).

The patch inserts four rows over the base + web-app layers:

| Row | Package | Role |
| --- | ------- | ---- |
| `yzj-bridge` | `@dsh-yzj/bridge` | `ctx.yzjBridge` subprocess channel to `yzj-cli` |
| `tool-yzj` | `@dsh-yzj/tool-yzj` | 41 model-facing tools + the approval guard |
| `yzj-agent-gateway` | `@dsh-yzj/agent-gateway` | inbound `@agent` polling, group-topic/direct-chat Sessions, isolated context, progress/final replies |
| `ui-yzj` | `@dsh-yzj/ui-yzj` | `/yzj` RPC channel (node half) + tool cards and workspace panel (browser half, discovered by the modules registry through its `dsh.client` declaration) |

## Install

```sh
dsh plugin --profile web add <bundle 包名或路径>
```

发布包会正常安装其传递依赖。本地以 `link:` 开发时，Cordis 从 profile 根解析行名，需同时把 `bridge`、`tool-yzj`、`agent-gateway`、`ui-yzj` 四个 workspace 包作为 plain dependencies 直接链接到该 profile。

The bundle mounts the hierarchy producer but does not mutate another installed
package during `postinstall`. Until DSH ships the generic Session-tree provider,
source deployments must run `pnpm patch:dsh-workspace` once from the repository.
The command is idempotent and requires exact rc.6 base/result SHA-256 hashes.

The profile reconcile appends `@dsh-yzj/bundle` to `dsh.profile.bundles` automatically. Restart the GUI afterwards; the sidebar shows the 云之家 toggle.

## Model Experience

Indirect only: the bundle itself mounts the rows that own all model-visible behavior.
