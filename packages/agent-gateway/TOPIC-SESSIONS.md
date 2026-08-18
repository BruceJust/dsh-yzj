# Yunzhijia Topic Sessions

## Decision

The gateway uses a topic as the durable DSH Session boundary for group chats.
Direct chats use the conversation as the boundary. One explicit `@agent` message
is one finite Task Run (one Agent turn) inside that Session.

This avoids both bad extremes: one global/group history that mixes unrelated
work, and one sidebar Session for every Agent invocation.

## Identity hierarchy

```text
Yunzhijia login account
  -> conversation/channel
    -> topic (group) or peer conversation (direct)
      -> active DSH Session generation
        -> Task Run per trigger message
```

Stable routing keys include the current login `orgId` and `openId`, so switching
Yunzhijia organizations or accounts cannot resume another identity's model
history.

```text
accountKey = hash("yzj-account-v1", orgId, openId)
channelKey = hash("yzj-channel-v1", orgId, openId, kind, groupId)

group topicRootId = explicit root ?? indexed parent root ?? resolved parent chain ?? triggerMsgId
direct topicRootId = "direct"

topicKey = hash("yzj-topic-session-v1", orgId, openId, kind, groupId, topicRootId, generation)
sessionId = "session-yzj-topic-" + topicKey
```

`groupType === 1` is a direct conversation and `groupType === 2` is a group.
System/public-account, missing, and unknown conversation types fail closed.

## Trigger and context rules

Only explicit configured aliases (`@agent`, `@智能体`) trigger by default.
Structured mentions of the logged-in account remain an opt-in compatibility
mode and never admit `@all` notifications.

For a group topic, context contains the root message and replies resolved to that
root. Resolution prefers explicit root metadata, then the bounded durable
message-to-topic index, then a parent-chain walk. The gateway pages backward
within a fixed bound when the root is older than the newest window. Unrelated
messages in the same group do not enter the topic context. First-seen command
discovery pages backward with an independent bound; when one poll exhausts that
bound, the next poll resumes from its backward anchor and the durable group
cursor advances only after the freshness cutoff is reached and the high-water
message itself was fetched or inspected from the full group preview. The initial
high-water message is retained so chat arriving during discovery is handled by
normal incremental polling afterward.

For a direct chat, the bounded recent conversation through the trigger is the
context. A message-level Agent shortcut replies to its target and therefore
retains the target topic. A composer-level Agent shortcut creates a new group
topic because its trigger message becomes the root.

When the CLI does not expose the root payload, `replySummary` is retained as the
fallback root context. Topic identity still uses the stable root message id.

## Execution and concurrency

Every accepted trigger is durably admitted before it is queued. The Session user
message records the source message id before tool execution. Recovery redelivers
an existing terminal result without adding another turn; a recorded turn with no
terminal event fails conservatively instead of rerunning possible writes.

Tasks in the same topic execute serially. Different topics, including different
topics in one group, may run concurrently under the global concurrency limit.
Every progress/final reply remains anchored to the triggering message.

A cross-group read uses live `yzj_*` tools. It does not merge the target group's
Session history into the current topic. Completed topic Agents stay warm for a
bounded idle interval, then their owned handles are disposed; a later command
resumes the persisted Session with the same history.

Gateway turns can use checked `yzj_*` operations but the host tool gate denies
shell, delegated execution, workflows, Ralph, and persisted goals that could
escape account checks. Every checked operation and outbound reply revalidates
the pinned `orgId`/`openId`; acknowledgement, progress, and final delivery also
recheck the active Task lease immediately before spawning the send. A total task
deadline revokes the source Task's authority in the durable Session before
cancellation. A reply crossing that deadline has an unknown delivery outcome, so
no contradictory failure reply is attempted and its pending journal remains for
conservative recovery. If cooperative AgentHandle disposal does not settle within
its budget, the Session is quarantined: the queue can drain, but no later tool
call or new topic turn can reuse that live Agent.

## DSH workspace and native hierarchy

Gateway Sessions use a dedicated default cwd:

```text
$DSH_HOME/yzj-agent/workspace
```

The host creates or reuses that directory as the `Yunzhijia Agent` DSH
Workspace and explicitly attaches every topic Session after create/resume. This
prevents channel Sessions from appearing as `Ungrouped / Apple`, where `Apple`
was merely the basename of the host process cwd.

The Workspace browser renders a stable resource tree in grouped mode:

```text
云之家 Agent
  <group name>
    <topic root summary>
    <topic root summary>
  私聊
    <peer name>
  历史会话
    <unclassified legacy Session title>
```

This tree is navigation only. It never changes the durable Session boundary or
merges model history: every group topic remains one Session, and one direct
conversation remains one Session. `flat` browser mode deliberately ignores the
hierarchy.

The generic DSH extension owns rendering, accessibility, disclosure state,
search, Session actions, and status aggregation. A Fiber-scoped
`workspace/session-hierarchy` data contribution only returns a bounded stable
path, compact leaf label, and search aliases. No provider means the exact stock
rc.6 top-level rows; malformed claims, provider failures, or unclaimed Sessions
also fall back to native rows. Hierarchical leaves cannot be dragged across
parents because a navigation projection is not a durable reparent command.

The Gateway appends a whole-value `yzj/session-identity` event before a topic
turn and registers the `yzjSessionIdentity` projection. Its value carries stable
account/channel/topic IDs separately from mutable labels. On startup, a bounded
cold projection sweep rebuilds cache rows for existing
`session-yzj-topic-*` logs. Older logs without the explicit identity event fold
their existing `source.kind = "yzj-agent"` metadata; missing display labels use
the prior managed-title form conservatively, while unprovable old group-level
logs remain under `历史会话`.

The gateway still pins compatible full Session titles for surfaces that do not
consume hierarchy metadata:

```text
Group:  群 · <group name> · <topic root summary>
Direct: 私聊 · <peer/group name>
```

Group renames and improved root summaries update both the Gateway-managed title
and the identity projection when the topic is used again. A later manual Web
rename is preserved and becomes the hierarchy leaf label. Old group-level
Sessions are never silently deleted or text-merged. New triggers use topic
identities immediately.

## Persistence compatibility

State v2 uses account partitions and migrates v1 without destructive replay:

- the first observed `orgId`/`openId` adopts v1 cursors and processed ids only
  when v1 has no pending work, and the original file is preserved as `.v1.bak`;
- account-less v1 pending work fails closed because no stored fact can prove which
  login is authorized to replay it;
- cursors, dedupe, pending tasks, bounded message-topic mappings, and managed
  titles are account-scoped;
- every new pending task persists an exact route validated against its enclosing
  account partition, has a unique message id, and has exactly one corresponding
  processed-message journal row;
- an in-process login change fails closed, and unknown state versions throw
  instead of resetting;
- old `session-yzj-<group hash>` logs remain historical;
- new logs use `session-yzj-topic-<topic hash>`.

No cloud write is replayed solely because the Session routing model changes.

## Lifecycle and edge cases

- Same topic, multiple senders: shared topic history, explicit sender per Task.
- Same group, different topics: separate Session histories and queues.
- Direct chat: one rolling Session per login account and peer conversation.
- Group rename: stable identity, refreshed title.
- Login account switch: current process fails closed; restart selects a distinct account partition and Session identity.
- Missing reply metadata: the trigger message starts a new topic.
- Withdrawn root: stable topic id remains; available reply summary is used.
- Gateway replies: never trigger because they lack a leading explicit alias.
- Process crash: admitted pending Task Runs replay into the same topic Session.
- Plugin unload: poll and topic queues get a bounded graceful drain before owned
  Agent handles dispose; after the deadline, not-yet-started tasks remain durable
  pending work and every active Task authority is revoked before handle teardown.

## Deferred controls

Generation rotation, `/new`, `/reset`, `/cancel`, waiting-confirmation chat
status, automatic archive, and per-sender/per-group tool scopes are compatible
with this model but are separate product increments. Rotation will add a
generation component to `sessionId` while retaining the same `topicKey`.
