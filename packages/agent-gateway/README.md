# @dsh-yzj/agent-gateway

Host-plane inbound gateway for Yunzhijia `@agent` tasks. It uses the existing
`yzj-cli` login state, polls recent conversations, binds each group topic or
direct chat to a persistent DSH Session, captures isolated context, and replies
with progress plus a final status.

## Trigger Contract

A message is admitted when all of these hold:

- only direct chats (`groupType === 1`) and multi-person groups
  (`groupType === 2`) are eligible; application/system/unknown conversations
  fail closed;
- messages from other senders use the normal alias or structured-mention rules;
  messages from the current `yzj-cli` login account are admitted only when they
  begin with a configured text alias, such as `@agent`;
- the conversation and sender pass optional allowlists;
- the message contains a configured text alias such as `@agent`; when
  `acceptAccountMentions` is explicitly enabled, a Yunzhijia structured account
  mention (`param.notifyType === 1` as a number or numeric string) also triggers,
  except notifications marked `notifyToAll`;
- the message id has not already been processed.

On first startup, existing history is cursor-seeded and ignored. A newly seen
conversation is admitted only when its last message is fresh, preventing replay
of old mentions after installation.

The CLI currently exposes polling only (`im group recent` plus
`im message list`), not a webhook or event stream. Default latency is therefore
up to five seconds and requires the DSH process to remain running.

## Execution

- Session ids are stable versioned hashes of `orgId`, login `openId`,
  conversation kind, `groupId`, and topic root. Switching organization or
  account cannot resume another account's model history.
- A group topic is keyed by its canonical `replyRootMsgId`; missing roots are
  recovered through a durable message-to-topic index and bounded parent-chain
  lookup. Direct chats keep one Session per peer conversation.
- Existing live Agents are reused; persisted topic Sessions are resumed.
- The configured Agent preset defaults to `standard`, so the task receives the
  complete DSH tool surface, including every `yzj_*` data source.
- Group prompts contain only the bounded topic root/reply chain through the
  trigger; direct prompts contain the bounded recent private conversation.
- `yzj_agent_progress` sends up to five important milestones as replies to the
  trigger. Acknowledgement, progress, final, and failure message ids are indexed
  back to the topic so replies to Agent output retain the same Session.
- Tasks in one topic execute serially. Different topics, including topics in
  the same group, may execute concurrently under `maxConcurrentTasks`.

## Workspace Navigation

In the Workspace-grouped sidebar, Yunzhijia topic Sessions are projected as
native branches instead of repeated title prefixes:

```text
云之家 Agent
  Group name
    Topic summary
  私聊
    Peer name
  历史会话
    Unclassified legacy Session
```

`yzj/session-identity` is a whole-value durable event containing account,
conversation, channel, and topic IDs plus mutable labels. The
`yzjSessionIdentity` Session projection supplies cold list metadata to the
browser; startup performs a bounded idempotent cold-cache backfill for existing
topic logs. Older source metadata is accepted only as a structural fallback,
and ambiguous old group-level Sessions remain visibly isolated.

The hierarchy is a navigation projection, not a history or routing boundary.
Flat-list mode stays flat, ordinary Workspaces are unchanged, native Session
open/rename/fork/archive/status behavior remains owned by DSH, and manual Web
renames override the managed compact leaf label.

## Write Authority

A gateway turn carries `source.kind = "yzj-agent"` and
`writeMode = "standard"`. `@dsh-yzj/tool-yzj` uses that durable turn-local
source to auto-authorize standard reversible writes only for the current turn.
Ordinary Web turns still use confirmation cards. Strong operations such as
record, table, document-block, or document deletion remain confirmation-gated.

The effective cloud permission is always the pinned `yzj-cli` login account.
The gateway does not read or store its token. Every Gateway-origin `yzj_*` tool
call and every outbound reply revalidates `orgId` and `openId`; a login switch
fails closed. The host pre-execute gate denies shell, delegated execution,
workflow, Ralph, and persisted-goal tools in Gateway turns so they cannot invoke
`yzj-cli` outside this checked path. An unrestricted sender allowlist therefore
delegates that account's accessible Yunzhijia data to every member who can
mention it. Use a dedicated Yunzhijia account or configure
`allowedSenderOpenIds` and `allowedGroupIds` for narrower trust boundaries.

## Configuration

```yaml
- id: yzj-agent-gateway
  name: '@dsh-yzj/agent-gateway'
  config:
    enabled: true
    pollIntervalMs: 5000
    groupPages: 3
    contextMessages: 20
    discoveryPages: 10
    aliases: ['@agent', '@智能体']
    acceptAccountMentions: false
    allowedGroupIds: []
    allowedSenderOpenIds: []
    preset: standard
    cwd: /absolute/agent/workspace
    workspaceTitle: 云之家 Agent
    stateFile: /absolute/path/to/yzj-agent-state.json
    cliTimeoutMs: 60000
    taskTimeoutMs: 1800000
    maxProgressReplies: 5
    maxConcurrentTasks: 2
    maxReplyChars: 3500
    agentIdleMs: 600000
```

Empty allowlists mean all conversations or senders visible to the logged-in
account. State defaults to `$DSH_HOME/yzj-agent/state.json`. Agent cwd defaults
to `$DSH_HOME/yzj-agent/workspace`; the directory is registered as the
`Yunzhijia Agent` DSH Workspace and every topic Session is explicitly attached.
The gateway pins topic-derived Session titles while preserving a later manual
Web rename.

## Failure and Loop Controls

- state v2 partitions cursors, processed ids, pending work, topic mappings, and
  managed titles by organization/login account; the first safe v1 migration
  writes a `.v1.bak`, while account-less v1 pending work and unknown versions
  fail instead of being rebound or silently reset; every v2 pending message id is
  unique and must appear exactly once in the processed-message journal;
- persistent conversation cursors, seven-day processed-message ids, a bounded
  message-topic index, and a durable pending queue prevent history replay while
  recovering admitted tasks after restart;
- pending work is cleared only after terminal delivery; recovery checks the
  persisted Session for the same source message id and redelivers its prior
  terminal result without rerunning tools. An interrupted recorded turn is not
  auto-retried, avoiding duplicate writes. A crash before the user turn itself
  reaches Session persistence remains a distributed-commit boundary. If a reply
  crosses its deadline, the delivery outcome is treated as unknown: no second
  `【Agent失败】` reply is sent and pending recovery is retained;
- self-sent messages without a leading alias are ignored, including gateway
  acknowledgement, progress, and final replies;
- one poll cannot overlap another;
- incremental history pages are bounded, and large bursts continue on later
  polls instead of advancing past unread messages; first-seen discovery uses
  `discoveryPages` independently of the smaller prompt context window and keeps
  a continuation anchor plus the initial high-water message across polls; the
  cursor advances only after that high-water message is present in fetched
  history or inspected from the full group preview;
- the task deadline covers Agent create/resume, idle waits, execution, and
  replies; timeout first writes a durable authority revocation, then cancellation
  escalates to bounded owned-handle disposal. A non-settling Agent is quarantined
  and cannot issue later tools or accept another topic turn;
- task runtime, progress count, context size, CLI output, and reply size are
  bounded;
- topic Agents are released after `agentIdleMs` of inactivity and later resumed
  from their persisted Session, bounding long-running host memory;
- ordinary task errors are replied to the originating message with
  `【Agent失败】`; unknown delivery and revoked shutdown leases intentionally
  suppress another cloud send.
