# @dsh-yzj/ui-yzj

Yunzhijia browser surface, dual-face package (`dsh.client`, `platform: web`).

## Node half

Registers the `/yzj` Connection RPC channel over `ctx.yzjBridge` (authority `loopback`): `workspaces`, `docs`, `events`, `groups`, `messages`, `whoami`, `search`. Only lossless CLI-parsed JSON crosses the channel.

## Browser half

Registers into existing slots (`tool.call.toolview`, `sidebar.footer.action`, `shell.overlay`):

- **Tool cards** — one keyed view per yzj tool name: pending calls render the family title from args; settled calls render the structured `meta` payload (doc details/lists, sheet schema/records, calendar timeline, message/group rows, contact cards) with the digest text as fallback, and an error summary on failure.
- **Workspace panel** — sidebar-foot 云之家 toggle plus a frame overlay with four tabs: 知识库 (workspace → doc tree drill-down), 日程 (today), 会话 (recent groups → messages), 我的 (identity card + directory search). All data flows through the `/yzj` RPC channel; components receive facts and verbs through the four props shares only.

Styling uses the GUI's `--dsw-*` semantic tokens with local fallbacks; product copy is Chinese.

## Model Experience

No direct effect: the node half contributes no prompt text, and the browser half renders only already-logged tool results plus panel data fetched through RPC.

## Known Limitations and Deferred Work

- **Panel is read-only browsing** — writes stay in the conversation via tools (with the approval panel); the panel deliberately has no mutation verbs.
- **`file download` card is text-only** — the CLI returns no structured path metadata for downloads.
- **Locale namespace not registered** — cards use Chinese literals; a `locale` namespace can be added when i18n is needed.
