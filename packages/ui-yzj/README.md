# @dsh-yzj/ui-yzj

Yunzhijia browser surface, dual-face package (`dsh.client`, `platform: web`).

## Node half

Registers the `/yzj` Connection RPC channel over `ctx.yzjBridge` (authority `loopback`): `workspaces`, `docs`, `events`, `groups`, `messages`, `whoami`, `search`. Only lossless CLI-parsed JSON crosses the channel.

## Browser half

Registers into existing slots (`tool.call.toolview`, `shell.overlay`, `conversation.input.dock`):

- **Tool cards** — one keyed view per yzj tool name: pending calls render the family title from args; settled calls render the structured `meta` payload (doc details/lists, sheet schema/records, calendar timeline, message/group rows, contact cards) with the digest text as fallback, and an error summary on failure.
- **Floating-ball panel** — a permanent bottom-right 云之家 floating ball (hover quick-dock for tab shortcuts) opens a product command bar (`云之家工作台` + active module label) over a workbench shell with three applications: 知识库 (workspace → doc drill-down), 日程 (calendar month + day agenda), 会话 (recent groups → messages). On wide viewports a compact full-width top navigation (horizontal icon + label, 会话 shows an unread badge) sits beneath the command bar, and the panel is horizontally resizable from both left and right edges (desktop 480–1080px, default 760; keyboard or pointer; width persists across close/reopen and refresh). Below a 620px panel width the top navigation and resize grips remain, but the two-pane flows collapse to the single-pane drill-down (back controls revealed) and the calendar stacks vertically; wider panels keep the two-pane layout. Under a 720px viewport the same navigation becomes a fixed safe-area-aware bottom bar (icon-over-label) and the content remains a full-viewport single-column drill-down with mobile back controls; resize grips are hidden. All data flows through the `/yzj` RPC channel; components receive facts and verbs through the props shares only.

Styling keeps the GUI's `--dsw-*` tokens as the color authority under a Fluent/Webex enterprise layer (neutral surfaces, one blue action, 8px rhythm, restrained radii, three weights); product copy is Chinese.

## Model Experience

No direct effect: the node half contributes no prompt text, and the browser half renders only already-logged tool results plus panel data fetched through RPC.

## Known Limitations and Deferred Work

- **Panel is read-only browsing** — writes stay in the conversation via tools (with the approval panel); the panel deliberately has no mutation verbs.
- **`file download` card is text-only** — the CLI returns no structured path metadata for downloads.
- **Locale namespace not registered** — cards use Chinese literals; a `locale` namespace can be added when i18n is needed.
