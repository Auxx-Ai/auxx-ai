# Realtime Architecture Guide

How Auxx pushes live updates to the browser: field values, records, mail
threads/messages, agent/procedure/eval admin state, presence, and the customer
chat widget. Everything speaks the **Pusher protocol**, but the live transport is
**self-hosted [Sockudo](https://sockudo.io)** (a Rust, Pusher-protocol-compatible
WebSocket server in `apps/echtzeit`), not Pusher cloud. Because Sockudo is
wire-compatible, the same `pusher`/`pusher-js` libraries connect to it unchanged —
we only repoint host/port. The hosted Pusher cloud remains a **config-toggled
fallback**: leave `PUSHER_HOST` empty and the SDKs reconnect to the cluster. The
code is also wrapped behind provider-agnostic seams so a non-Pusher-protocol
backend (Ably, raw WebSocket, etc.) could drop in without touching consumers.

> **Transport selection.** `PUSHER_HOST` set → self-hosted Sockudo over
> `wss://echtzeit.<env>.auxx.ai` (`PUSHER_PORT`/`PUSHER_USE_TLS` tune the edge;
> locally `127.0.0.1:6001` over plain ws). `PUSHER_HOST` empty → hosted Pusher
> cloud via `PUSHER_CLUSTER`. The 10KB payload ceiling is now ours to raise — both
> caps are bumped to 100KB on the Sockudo side — but the §5 chunking/batch code is
> kept as headroom (simplifying it is a later follow-up). See `apps/echtzeit/README.md`.

> TL;DR — Servers publish domain events to opaque **room keys** through a
> `RealtimeService`. Room keys map to Pusher channels (`private-` / `presence-` /
> raw public) via a shared key-helper module. The admin app (`apps/web`) runs one
> refcounted `PusherRealtimeAdapter` that fans channel events out to React hooks,
> which patch Zustand stores or invalidate React Query. The customer chat widget
> (`packages/chat`) runs a **separate, dependency-free** Pusher client. Every
> mutation carries the publisher's `socket_id` so the originator is excluded from
> its own echo.

> **Companion — what publishes the mail events.** The `orgInbox` room and its
> `thread:*` / `message:*` / `inbox:syncCompleted` / `mail:batch` events are produced
> by the channels/mail pipeline (including the sync-batch suppression that collapses a
> backfill into one event per inbox). See **`channels-mail-architecture-guide.md`**.

---

## 1. Why an abstraction at all

Pusher is never imported directly by feature code. Two thin interfaces sit in
front of it:

| Interface | Side | File | Implemented by |
| --- | --- | --- | --- |
| `RealtimeProvider` | server | `packages/lib/src/realtime/types.ts` | `PusherRealtimeProvider` |
| `RealtimeAdapter` | client | `packages/lib/src/realtime/client/types.ts` | `PusherRealtimeAdapter` |

`RealtimeProvider` is two methods — `publish(channel, event, data, opts)` and
`authenticate(socketId, channel, userData)`. `RealtimeAdapter` is the browser
counterpart: `connect` / `subscribe` / `subscribePresence` / `updateSelf` plus
`useSyncExternalStore` plumbing. Swapping providers means writing one new class on
each side; the ~40 publish call-sites and ~20 consumer hooks never change.

The seam exists for portability, but pragmatically it also keeps the Pusher SDK
(and its 10KB-per-message limit, channel-name prefix rules, auth handshake) out of
business logic. The 10KB limit in particular leaks into helper design — see
chunking (§5) and lazy attachment URLs (§9).

---

## 2. Rooms — the addressing scheme

Consumers and publishers never type a Pusher channel name. They build an **opaque
room key** with a typed helper, and the transport layer maps it to a channel.

```
rooms.orgPresence(orgId)          → org-{orgId}                         (presence)
rooms.orgEvents(orgId)            → org-{orgId}-events                  (plain)
rooms.orgInbox(orgId, inboxSlug)  → org-{orgId}-inbox-{inboxSlug}       (plain)
rooms.user(userId)               → user-{userId}                       (plain)
rooms.chatThread(threadId)       → thread-{threadId}                   (plain)
rooms.chatSession(sessionId)     → chat-{sessionId}                    (public)
rooms.visitor(participantId)     → visitor-{participantId}             (plain)
```

A room has one of three **kinds** (`RoomKind`), which decides the Pusher prefix:

| Kind | Pusher channel | Auth signing | Used for |
| --- | --- | --- | --- |
| `plain` | `private-{key}` | yes (`/api/pusher/auth`) | most admin rooms, widget visitor/thread channels |
| `presence` | `presence-{key}` | yes + member roster | org presence (who's online) |
| `public` | `{key}` (raw) | none | visitor chat session — widget has no session cookie at bootstrap |

The mapping is split across two files **on purpose**:

- **`room-keys.ts`** — client-safe. Key builders (`rooms`), `roomKindFor`,
  `toPusherChannel`, `fromPusherChannel`. No DB imports, so the browser bundle can
  pull it in.
- **`rooms.ts`** — server-only. Re-exports the key helpers and adds the
  **authorization registry**: one `RoomDef` per room family with a `match(key)`
  predicate and an `authorize(key, ctx)` ACL function.

> ⚠️ **Registry order matters.** `findRoom` is greedy first-match. The specific
> `-inbox-` and `-events` patterns must precede the catch-all `org-` presence
> entry, and `roomKindFor` in `room-keys.ts` must stay in lockstep with the
> registry ordering in `rooms.ts`. They are two hand-synced copies of the same
> precedence.

### Authorization (`AuthorizeCtx`)

```ts
interface AuthorizeCtx {
  session?: { userId; organizationId } | null   // admin app
  visitor?: { participantId; threadId? }         // widget passport
}
```

Each `RoomDef.authorize` enforces its own rule:

- **inbox** — caller is an org member **and** has access to that inbox (via
  `InboxService.hasUserAccess`); the `none` triage slug is open to all members.
- **events / presence** — caller is an org member.
- **user** — `ctx.session.userId === userId`.
- **thread** (admin) — member of the thread's owning org **and**
  `effectiveLens ≥ metadata` on the thread (`getThreadLens` + `satisfiesRung`);
  fails closed. The tRPC history door (`thread.listEvents`) asks the same lens
  question, returning empty rather than a 403 so an invisible thread id fails
  exactly like a nonexistent one.
- **chat session** (`chat-*`) — public, always allowed; channel name is an
  unguessable random session id, the `authorize` hook is unreachable because Pusher
  never asks the server to sign public channels.
- **visitor** — `ctx.visitor.participantId === participantId`.

There is a dev-mode bypass (`NODE_ENV === 'development'`) that lets membership/inbox
checks pass on DB errors, so local work isn't blocked by seed gaps.

---

## 3. Server side — publishing

### The service

`RealtimeService` (`realtime-service.ts`) is the single server entry point,
constructed once as a singleton via `getRealtimeService()` wrapping
`PusherRealtimeProvider`. Key methods:

- `publish(roomKey, event, data, { excludeSocketId })` — maps key → channel and
  forwards to the provider. Returns `false` (never throws) if the room is unknown
  or Pusher isn't configured.
- `publishMemberUpdate(roomKey, member)` — presence-only; emits a `member-update`
  event (used by `updateSelf`).
- `authorize(socketId, channelName, ctx, userData)` — the auth-route path: resolve
  key, run the registry ACL, then sign.
- `authenticateChannel(...)` — raw signing with **no** registry ACL, used by the
  widget auth route which does its own passport check upstream.

`PusherRealtimeProvider` lazily reads `PUSHER_APP_ID/KEY/SECRET/CLUSTER` from
`configService`. If any are missing it logs a warning and every `publish` becomes a
silent no-op — **realtime degrades to "off," it never errors**.

### Publish helpers

`publish-helpers.ts` is the typed catalogue of "what the server can announce."
Every helper:

1. Looks up the org **feature flag** (`realtimeSync` or `realtimeMail`) from the
   per-org cache and bails early if disabled.
2. Builds the room key.
3. Fires-and-forgets the publish (errors swallowed — a Pusher hiccup must never
   block the underlying DB mutation).

| Helper | Room | Event | Flag |
| --- | --- | --- | --- |
| `publishFieldValueUpdates` | orgPresence | `fieldValues:updated` | `realtimeSync` |
| `publishRecordsInvalidated` | orgPresence | `records:invalidated` | `realtimeSync` |
| `publishThreadCreated/Updated/Deleted` | orgInbox | `thread:*` | `realtimeMail` |
| `publishMessageCreated/Updated/Deleted` | orgInbox | `message:*` | `realtimeMail` |
| `publishParticipantUpdated` | orgPresence | `participant:updated` | `realtimeMail` |
| `publishInboxSyncCompleted` | orgInbox | `inbox:syncCompleted` | `realtimeMail` |
| `flushMailBatch` | orgInbox | `mail:batch` | `realtimeMail` |
| `publishAgentUpdated` | orgPresence | `agent:updated` | `realtimeSync` |
| `publishProcedureUpdated` | orgPresence | `procedure:updated` | `realtimeSync` |
| `publishEvalCaseChanged` | orgPresence | `eval:case-changed` | `realtimeSync` |

Record lifecycle events (`record:created/updated/deleted/archived`) are published
inline from the entity CRUD layer
(`packages/lib/src/resources/crud/unified-handler-mutations.ts`) and from
`maybeUpdateDisplayValue` in `field-value-helpers.ts`, all on the **orgPresence**
room with `excludeSocketId`.

### Event payload contract

All event shapes live in `events.ts` (server) and are re-exported from
`client/index.ts` so both sides share one type. The pervasive convention is
**partial-by-design patches**:

- Missing key = "don't touch this field."
- Explicit `null` = "clear this field."
- Present value = "set this field."

This is what lets, e.g., `record:updated` carry just the one denormalized column
that changed, or a `fieldValues:updated` entry carry an AI-status transition with
no value (`{ key, aiStatus: 'generating' }`).

---

## 4. Server side — authorization & socket-id echo suppression

### Auth endpoints

Two HTTP endpoints sign Pusher channel subscriptions (Pusher's JS client needs an
`authEndpoint`; routing it through tRPC would be friction with no benefit):

1. **`apps/web/src/app/api/pusher/auth/route.ts`** — admin app. Reads
   `socket_id` + `channel_name`, loads the Better-auth session, builds an
   `AuthorizeCtx` from it, and delegates to `RealtimeService.authorize`, which runs
   the registry ACL before signing.
2. **`apps/api/src/routes/chat/pusher-auth.ts`** — chat widget (Hono, on
   `apps/api`). Verifies the channel belongs to the **passport's** visitor
   (`private-visitor-{id}` exact match, or `private-thread-{id}` gated by
   `buildVisitorThreadOwnership`), then signs via `authenticateChannel` (no
   registry — passport already vouched). Public `chat-*` channels skip this
   entirely.

### Client-mediated publish (`realtimeRouter`)

Clients can publish a **narrow allow-list** of ephemeral events through the
`realtime.publish` tRPC mutation — only `typing:` and `presence:` prefixes. The
guard rationale is explicit in the router: authoritative server events
(`thread:*`, `record:*`, `fieldValues:*`, …) must **never** be client-publishable,
or a logged-in peer could forge deletions/updates into any room they pass ACL on.
`realtime.updateSelf` is the only path for presence meta and emits a
server-mediated `member-update` (no Pusher client-events anywhere in the system).

### Record-room visibility model (D-18, decided 2026-08-21)

**Definition-level view implies realtime field-value visibility.** Record rooms
are per-definition (`org-{orgId}-records-{defId}`); the ACL checks org
membership + `canViewEntity(defId)` and nothing finer, the publish path never
re-authorizes, and `fieldValues:updated` frames carry raw stored values. So a
member who can view a definition receives live values for **every** record of
that definition — including records that record-level `ResourceAccess`
restrictions or private-instance scoping would block on the read path. This is
the **stated model, not an oversight** (plan `events/03`, D-18): the mail lane
needs and has per-lens shaping; the record lane accepts def-level broadcast.
Revisit (ids-only tier-1, or mail-style shaping) if record-level restrictions
become a marketed feature. Tier-2 `records:changed` frames carry ids + fieldIds
only, so nothing new leaks through the batch lane.

Related accepted cosmetic: bulk archives emit tier-2 delta frames (#1812),
whose entries do not distinguish archived from updated records — so the
per-record participant-store clearing that `record:archived` frames performed
does not happen for bulk archives. Clearing on every delta entry would wrongly
drop cached names for merely-updated records; the participant store is
read-time patched, so the staleness self-heals on next contact.

### Echo suppression (the socket-id loop)

The originator of a mutation should not receive its own realtime echo — it already
applied the change optimistically. The mechanism:

1. The browser's live Pusher `socket_id` is read non-reactively via
   `getRealtimeSocketId()` and attached as the **`x-realtime-socket-id`** header on
   every tRPC request (`apps/web/src/trpc/react.tsx`, `trpc/vanilla.ts`).
2. The server threads it into the mutation context (`ctx.socketId`).
3. Every publish passes `{ excludeSocketId: ctx.socketId }`, which becomes Pusher's
   `socket_id` exclusion param → the originating socket is skipped.

A second, finer-grained echo guard exists in the client stores: `setValues`
**skips keys with pending optimistic updates**, so even a racing inbound event
can't clobber an in-flight local write before the mutation confirms.

---

## 5. Server side — scale controls

Realtime at sync/backfill scale would trivially blow Pusher's per-message size and
rate limits. Three patterns guard against it:

- **Chunking.** `publishFieldValueUpdates` and `flushMailBatch` split entries at
  `CHUNK_SIZE = 50` per frame to stay under the 10KB limit; field-value chunks
  carry `{ index, total }` metadata.
- **Coarse invalidation over per-record firehose.** Bulk writes (data-connector
  slice sync) suppress the thousands of per-record `record:created` /
  `fieldValues:updated` events and instead emit a **single `records:invalidated`
  per touched entity def per slice**. The client responds with one refetch of the
  def's visible list. Same idea for mail: `inbox:syncCompleted` replaces
  per-message events during a sync cycle, and the client invalidates
  `thread.listIds` once.
- **Batch frames.** `mail:batch` bundles many `MailSyncEvent`s into one Pusher
  publish for initial-/polling-sync; the client unpacks and re-dispatches each
  inner event through the same handlers.

---

## 6. Client side — the admin adapter (`apps/web`)

### One adapter, lives outside React

`apps/web/src/realtime/adapter.ts` instantiates a single module-level
`PusherRealtimeAdapter`. Its lifecycle is driven by `useRealtimeLifecycle()`
(mounted once in the app layout):

- On auth ready → `connect({ key, cluster, authEndpoint: '/api/pusher/auth',
  wsHost, wsPort, forceTLS })`. These reach the browser via the dehydrated env
  payload (`dehydration/service.ts` exposes `pusher: { key, cluster, wsHost,
  wsPort, forceTLS }`; consumed through `useEnv()`). When `wsHost` is set the
  adapter points `pusher-js` at Sockudo (`wsHost`/`wsPort`/`wssPort` +
  TLS-gated `enabledTransports`); when absent it uses the hosted-cloud `cluster`.
- On **org switch** → `unsubscribeMatching` tears down every room scoped to the old
  org (`org-{old}`, `org-{old}-*`, and `thread-*`). The `user-{userId}` channel is
  intentionally **kept** across org switches since the same user spans orgs.
- On logout/unmount → `disconnect()`.

### Refcounting & fan-out

The adapter is the heart of the client design. Properties worth knowing:

- **Refcounted rooms.** Many components can subscribe to the same room; the
  adapter keeps one Pusher channel with a `refCount` and only tears it down on the
  last `unsubscribe`.
- **Single global listener per channel.** It binds one `bind_global` handler that
  fans out to every registered consumer's `onEvent`, filtering Pusher-internal
  `pusher:*` events. Presence built-ins (`member_added/removed`) are bound
  explicitly and routed to presence handlers.
- **Pending-subscription buffer.** Subscriptions requested before `connect()` ran
  (React fires child effects before the parent lifecycle) are queued and replayed
  on connect.
- **`onSubscribed` catch-up.** Fired on `pusher:subscription_succeeded` and again on
  every reconnect — Pusher does **not** replay events sent during the
  subscribe/reconnect window, so consumers use this hook to refetch and catch up.
  Late-joining handlers get an async `onSubscribed` / roster replay via
  `queueMicrotask`.
- **`useSyncExternalStore` plumbing.** All `subscribeToX`/`getXSnapshot` are
  arrow-field class members returning identity-stable snapshots, so React doesn't
  thrash.

### React hooks (`apps/web/src/realtime/hooks.ts`)

| Hook | Subscribes to | Notes |
| --- | --- | --- |
| `useRealtimeRoom(key, handlers)` | any plain room | base primitive; returns "bound?" |
| `usePresence(key, self, handlers)` | presence room | + member tracking |
| `useOrgChannel(handlers)` | `orgPresence(orgId)` | the org firehose |
| `useInboxChannel(slug, handlers)` | one `orgInbox` | |
| `useInboxChannels(slugs, handlers)` | many `orgInbox` | returns stable subscribed-key set |
| `useRealtimeConnected()` | connection state | |

Handlers are held in a ref so re-renders don't re-bind the channel; the effect
re-subscribes only when the room key itself changes.

---

## 7. Consumer domains (admin app)

### A. Field values & records

- **`useResourceSync`** subscribes to `useOrgChannel` and handles
  `fieldValues:updated`, `record:created/updated/deleted/archived`, and
  `records:invalidated`.
- Patches **Zustand** stores (`useFieldValueStore`, `useRecordStore`) for value /
  AI-state / denormalized-column changes, and **invalidates React Query**
  (`record.listFiltered`) for list membership.
- **AI generation lifecycle** rides on `fieldValues:updated` entries:
  `aiStatus: 'generating'` (stage-1 enqueue) → `'result'` (commit, with value) →
  `'error'`. `useSaveFieldValue` sets the marker optimistically; the realtime commit
  resolves it. Markers are a parallel store slice (`aiStates`) so a status change
  needn't carry a value.
- Supporting machinery: `field-value-fetch-queue` debounces/​chunks on-demand value
  fetches (50ms, 100 recordIds/batch); `field-value-store` recomputes dependent
  CALC fields on every write and skips keys with pending optimistic updates.

### B. Mail — threads & messages

- **`useMailSync`** is the mail brain. It subscribes to `useInboxChannels` (all
  accessible inboxes + `none` triage) for `thread:*` / `message:*` / `mail:batch` /
  `inbox:syncCompleted`, and to `useOrgChannel` for `participant:updated`.
- It patches a thread/message Zustand store and invalidates `thread.listIds` on
  membership changes. `mail:batch` is recursively unpacked into the same handlers.
- **Batch drain** (`thread-data-provider` + `use-batch-drain`): realtime events that
  reference not-yet-loaded entities enqueue ids into a per-resource pending set; a
  150ms-coalesced **serial** drainer calls `*.getByIds`, preventing a burst of
  events from fanning into concurrent mutations that trip the tRPC rate limiter.
  Five drainers run in parallel (thread/message/participant/task/draft).
- `useMessageArrivalCue` coalesces inbound `message:created` over a 1s window into a
  single toast/chime/favicon cue, suppressing outbound sends and the
  actively-viewed thread.
- **`useChatThreadEvents`** (`chat-panel/use-thread-events.ts`, but rendered on
  **every** channel's thread view, not just chat) subscribes to
  `chatThread(threadId)` for lifecycle events (`thread:taken_over`, `archived`,
  `assignee:changed`, `tagged`, `merged`, …), merging persisted history with live
  events, deduped by event id. Persisted history is `thread.listEvents` — keyset-
  cursor pages off the dedicated `ThreadEvent` table (newest-first, reversed
  client-side, older pages drained in the background until exhausted). See
  `channels-mail-architecture-guide.md` §3 for the table and its boundary rule.

### C. Agent / procedure / eval admin state

`agent:updated`, `procedure:updated`, `eval:case-changed` are pure **refresh
signals** on the org channel — the payload carries only ids. `useAgentRealtime` and
`useEvalCasesRealtime` just invalidate the relevant React Query keys. These fire
from server-origin writes (notably Kopilot authoring tools) that happen outside an
editor's own save path. The editor's own autosave passes `excludeSocketId` (or
simply omits the publish) so it never invalidates the author's in-flight editing.

> An open seed-once TipTap editor needs a remount on top of the invalidation; that
> lives in `useProcedureRealtime`/`usePersonaRealtime`, keyed by a reload key.

### D. Presence

`useOrgPresence` + `usePresenceHeartbeat` share one refcounted presence
subscription via a module-level store keyed by org. The heartbeat flips a
`meta.idle` flag through `realtimeAdapter.updateSelf` → `realtime.updateSelf` tRPC →
server `member-update` publish. Going fully offline needs no message — Pusher's
`member_removed` fires when the socket drops.

### E. Notifications & user channel

The `user-{userId}` private channel carries personal events
(`notification-center.tsx`, server side `notification-service.ts`) and survives org
switches.

---

## 8. The chat widget — a separate stack by design

The customer-facing widget in **`packages/chat`** runs its **own** Pusher client
with **zero `@auxx/*` dependencies**, so the embeddable bundle stays standalone and
small. It does **not** use `PusherRealtimeAdapter` or `@auxx/lib/realtime/client`.

| Aspect | Admin (`apps/web`) | Widget (`packages/chat`) |
| --- | --- | --- |
| Client | `PusherRealtimeAdapter` (`@auxx/lib`) | bespoke `realtime-client.ts` |
| Auth endpoint | `/api/pusher/auth` (session) | `/api/chat/pusher/auth` (passport bearer) |
| Message stream | `message:created` on inbox channel | `new-message` on public `chat-{sessionId}` |
| Cross-thread | `thread:updated` on inbox | `thread-updated` on `private-visitor-{id}` |
| Lifecycle | all `thread:*` types on `thread-{id}` | the six visitor-facing types only, on `thread-{id}` **plus** redundant `visitor-{id}` |
| Dependencies | full `@auxx/lib` | none |

Widget specifics:

- One shared, refcounted Pusher socket per widget instance; launcher badge and
  conversation view share channels.
- Auth reads the **live passport** at call time (token refresh) and posts to the
  `apps/api` chat auth route.
- The visitor channel (`private-visitor-{participantId}`) connects **eagerly**
  (before the widget is opened) so the unread badge updates while closed; it
  survives identity rotation via an epoch bump.
- Event type definitions are **duplicated locally** (`transport/thread-events.ts`)
  rather than imported (`packages/chat` has no `@auxx/lib` dependency), pinned by
  a set-equality test (`packages/lib/src/thread-events/__tests__/visitor-parity.test.ts`)
  to the **frozen** `VISITOR_FACING_THREAD_EVENT_TYPES` — the original six — and
  deliberately NOT to the growing admin-side `THREAD_EVENT_TYPES` vocabulary.

This is a deliberate "two clients" decision (bundle isolation) — don't try to DRY
the widget client and the admin adapter into one.

---

## 9. Dual-publish — how an agent and a visitor see the same chat live

A single chat message must reach **three** audiences. `publishChatMessageCreated`
(`packages/lib/src/chat/realtime.ts`) does the fan-out:

1. **`message:created` on the inbox channel** → the admin agent's mail view (via
   `publishMessageCreated`; `excludeSocketId` on the outbound path).
2. **`new-message` on `chat-{sessionId}`** → the visitor's open conversation.
3. **`thread-updated` on `visitor-{participantId}`** → the visitor's other
   (backgrounded) threads + unread badge.

Inbound (visitor → agent) flows through `ChatProvider.receiveMessage`; outbound
(agent → visitor) through `ChatProvider.sendMessage` with
`skipInboxMessagePublish: true` (the `MessageSenderService` already published the
inbox event). Agent replies are composed in `process-chat-turn.ts`.

**Thread lifecycle** events (takeover, archive, reopen, assignee change, tag,
merge, …) are persisted to the dedicated `ThreadEvent` table then fanned out by
`events/handlers/publish-thread-event-to-realtime.ts`. Every type goes to
`thread-{id}` (admin + open widget); the `visitor-{id}` publish is
**allowlist-gated** on the frozen six `VISITOR_FACING_THREAD_EVENT_TYPES` and
shaped down to `{threadId, id, createdAt}` — a visitor must never learn a thread
was tagged or merged. Dedupe by event id client-side.

> Pusher frames never carry attachment URLs (10KB limit). The widget resolves them
> lazily via `/api/chat/attachments/{id}/url` with a short TTL.

---

## 10. Failure modes & guarantees

- **Realtime is best-effort, never authoritative.** Every publish is fire-and-forget
  with swallowed errors; React Query stale-time / focus-refetch is the fallback for
  orgs with the flag off or during a transport outage.
- **No missed-event replay.** Events sent during a subscribe/reconnect gap are lost
  by the transport — the `onSubscribed` catch-up refetch closes that gap on the
  consumer side. (Sockudo can retain Protocol-V2 history/recovery, but our V1
  clients don't use it; the refetch stays the recovery mechanism.)
- **Feature-flag gated.** `realtimeSync` (records/fields/agents) and `realtimeMail`
  (threads/messages) gate publishing per org.
- **Misconfiguration degrades silently.** Missing creds (or `SOCKUDO_DEFAULT_APP_*`
  not matching `PUSHER_APP_ID/KEY/SECRET`, which breaks HMAC channel-auth) → provider
  logs a warning and every publish no-ops; the app stays functional, just not live.
- **Single Sockudo instance is a SPOF** (acceptable pre-launch). HA path —
  `ADAPTER_DRIVER=redis` + `REDIS_URL` + replicas — is documented in
  `apps/echtzeit/README.md`, not wired yet.

---

## 11. Extending the system

**Add a new event on an existing room:** add the type to `events.ts`, re-export from
`client/index.ts`, add a `publishX` helper (with its flag gate), and handle it in
the relevant consumer hook's `onEvent` switch.

**Add a new room family:** one helper on `rooms` (`room-keys.ts`), one
`roomKindFor` branch (same file), and one `RoomDef` with its `authorize` ACL in the
`rooms.ts` registry — minding the greedy match ordering.

**Switch Pusher-protocol backends (Sockudo ↔ Pusher cloud):** no code change —
set or unset `PUSHER_HOST` (+ `PUSHER_PORT`/`PUSHER_USE_TLS`). Both run through the
existing `PusherRealtimeProvider`/`PusherRealtimeAdapter` and the bespoke widget
client; the seam classes already branch on host.

**Add a non-Pusher-protocol transport (e.g. Ably):** implement `RealtimeProvider`
(server) and `RealtimeAdapter` (client). Swap the singleton construction in
`realtime/index.ts` and the adapter instance in `apps/web/src/realtime/adapter.ts`.
Consumers, helpers, room registry, and event types are all transport-agnostic and
stay untouched.

---

## Appendix — file map

**Core (`packages/lib/src/realtime/`)**
- `index.ts` — `getRealtimeService()` singleton + barrel exports
- `types.ts` — `RealtimeProvider` server interface
- `realtime-service.ts` — `RealtimeService` (publish / authorize)
- `providers/pusher.ts` — `PusherRealtimeProvider`
- `events.ts` — all event payload types
- `publish-helpers.ts` — typed publish catalogue (flag-gated)
- `room-keys.ts` — client-safe key/kind/prefix helpers
- `rooms.ts` — server auth registry (`RoomDef`, `findRoom`, ACLs)
- `client/types.ts` — `RealtimeAdapter` client interface
- `client/adapters/pusher.ts` — `PusherRealtimeAdapter` (refcount, fan-out, presence)
- `client/index.ts` — client barrel

**Admin app (`apps/web/src/`)**
- `realtime/adapter.ts` — singleton adapter instance
- `realtime/use-realtime-lifecycle.ts` — connect/disconnect, org-switch teardown
- `realtime/hooks.ts` — `useRealtimeRoom`, `useOrgChannel`, `useInboxChannels`, …
- `app/api/pusher/auth/route.ts` — admin channel auth
- `server/api/routers/realtime.ts` — client-mediated publish / updateSelf
- `hooks/use-org-presence.ts`, `hooks/use-presence-heartbeat.ts` — presence
- `trpc/react.tsx`, `trpc/vanilla.ts` — socket-id header injection
- `components/resources/**` — field-value / record consumers
- `components/threads/**`, `components/mail/**` — mail consumers + batch drain
- `components/agents/hooks/use-agent-realtime.ts`, `components/evals/hooks/use-eval-cases-realtime.ts`

**Chat widget (`packages/chat/src/`)**
- `transport/realtime-client.ts` — bespoke shared Pusher socket
- `transport/visitor-channel.ts`, `transport/thread-events.ts`, `transport/config.ts`, `transport/chat-api.ts`
- `views/conversation/**`, `widget.tsx`

**Transport (self-hosted)**
- `apps/echtzeit/` — Sockudo service (Dockerfile, railway.json, README); the
  pinned `ghcr.io/sockudo/sockudo` image + env config. Local: the `echtzeit`
  docker-compose service. Config/cutover env: `PUSHER_HOST/PORT/USE_TLS` +
  `SOCKUDO_DEFAULT_APP_*` (must mirror `PUSHER_APP_ID/KEY/SECRET`).

**Server chat publishing**
- `packages/lib/src/chat/realtime.ts` — `publishChatMessageCreated`, `publishVisitorThreadCreated`
- `packages/lib/src/events/handlers/publish-thread-event-to-realtime.ts` — lifecycle persist (`ThreadEvent`) + gated dual fan-out
- `packages/lib/src/chat/agent/process-chat-turn.ts` — agent reply composition
- `apps/api/src/routes/chat/pusher-auth.ts` — widget channel auth
- `apps/api/src/routes/chat/{threads,initialize}.ts` — message POST / bootstrap
