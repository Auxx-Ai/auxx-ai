<!-- docs/channels-mail-architecture-guide.md -->

# Channels & Mail Architecture Guide

**Last Updated:** 2026-08-17
**Scope:** The conversation layer — how an external mailbox or messaging account becomes a
**channel**, how its mail lands in **threads/messages** through the inbound doors (webhook push,
two-phase polling, SES forwarding), how a reply goes back out, and who is allowed to see any of
it (**the mail lens**).

> This is the living reference for the channels/mail subsystem. It consolidates the fragmented
> design and fix docs under `plans/channels/`, `plans/email-sync/`, `plans/imap/`, `plans/gmail/`,
> `plans/mail-permissions/`, `plans/mail/`, `plans/threads/`, `plans/inbox/` and `plans/mailviews/`,
> which are decision/implementation history.
> Companions: `connections-architecture-guide.md` (the credential layer under every channel),
> `entity-architecture-guide.md` (inboxes and contacts are EntityInstances),
> `realtime-architecture-guide.md` (the `orgInbox` room and its mail events),
> `entity-events-architecture-guide.md` (what reacts to a linked record changing).

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Core Concepts & Vocabulary](#2-core-concepts--vocabulary)
3. [The Data Model](#3-the-data-model)
4. [Providers](#4-providers)
5. [Connecting a Channel](#5-connecting-a-channel)
6. [Inboxes — Shared vs Personal](#6-inboxes--shared-vs-personal)
7. [Inbound Door 1 — Webhook Push](#7-inbound-door-1--webhook-push)
8. [Inbound Door 2 — Two-Phase Polling](#8-inbound-door-2--two-phase-polling)
9. [Inbound Door 3 — Forwarding (SES/Mailgun)](#9-inbound-door-3--forwarding-sesmailgun)
10. [Ingest — one message becomes a row](#10-ingest--one-message-becomes-a-row)
11. [Outbound — composer → sender → provider](#11-outbound--composer--sender--provider)
12. [Labels & Folders](#12-labels--folders)
13. [The Mail Lens (permissions)](#13-the-mail-lens-permissions)
14. [Reading — queries, views, counts, search](#14-reading--queries-views-counts-search)
15. [tRPC & UI Surface](#15-trpc--ui-surface)
16. [Gotchas & Invariants](#16-gotchas--invariants)
17. [Key Files](#17-key-files)

---

## 1. Executive Overview

A **channel** is one connected external account (a Gmail mailbox, an Outlook mailbox, an IMAP
account, a forwarding address, a Facebook/Instagram page, an OpenPhone number, a chat widget).
It is a row in the `Integration` table. Every channel is linked to exactly one **inbox**, and an
inbox is an `EntityInstance` — so mailbox membership, sharing and naming ride the entity/permission
machinery rather than a bespoke ACL.

```
   EXTERNAL ACCOUNT            DOOR                         PIPELINE
 ──────────────────────  ────────────────────   ────────────────────────────────
  Gmail (Pub/Sub push) → /api/google/webhook   ┐
  Outlook (Graph sub)  → /api/outlook/webhook  │
  Gmail/Outlook/IMAP   → polling scanner       ┼─▶ provider.importMessages
   (fallback + initial    → list-fetch → import│      → MessageData[]
    backfill)                                  │
  forward@mail.auxx.ai → SES → SQS → worker    │            │
  FB / IG / OpenPhone  → /api/<provider>/…     ┘            ▼
                                                 batchStoreMessages → storeMessage
                                                   filter → resolve thread → participants
                                                   → contacts/companies → Message row
                                                   → realtime + events
```

Outbound is the mirror image and always goes through one path:
`MessageComposerService` (commit the row first) → `MessageSenderService` (guards, tracking,
unsubscribe/RFC-3834 headers) → `ChannelProvider.sendMessage` → `MessageReconcilerService`
(match the provider's Sent copy back to the row we already wrote).

Two things make this subsystem harder than "sync some email":

1. **Provider conversation keys are not stable.** Microsoft Graph mints a fresh `conversationId`
   for a reply to something we sent, which forks the conversation. §10 documents the resolution
   ladder (`ThreadExternalKey` alias → RFC 5322 `In-Reply-To`/`References` chain) that stitches it
   back together, and the send-time `X-AuxxAi-Message-Id` echo that correlates the Sent copy.
2. **Mail visibility is a four-rung lens, not a boolean.** A thread can be invisible, visible as
   metadata, visible with its subject, or fully readable — derived per viewer from the inbox floor,
   per-thread shares, the thread's primary record, and participant contacts. §13.

---

## 2. Core Concepts & Vocabulary

- **Channel** — one connected account. Physically an `Integration` row. The UI, the tRPC router
  (`channel.ts`) and `packages/lib/src/channels/` all say "channel"; the table, the columns and
  every FK say `integration`. **They are the same thing** — there is no separate `Channel` table.
- **Provider** — the code that talks to the upstream API (`google`, `outlook`, `imap`, `email`,
  `mailgun`, `facebook`, `instagram`, `openphone`, `chat`, plus declared-but-thin `sms`,
  `whatsapp`, `shopify`). Implements `ChannelProvider`.
- **Inbox** — an `EntityInstance` on either the `inbox` (org-shared) or `personal_inbox`
  definition. Threads denormalize theirs onto `Thread.inboxId`. Sharing, floors and access live on
  the inbox, not the channel.
- **Thread** — one conversation. **Message** — one email/DM inside it. **Participant** — an
  org-scoped identity (email address / phone / chat-visitor id), optionally linked to a contact
  `EntityInstance`.
- **Lens** — how much of a thread a viewer may see: `none < metadata < identity < read`. A
  domain alias of the permission `Rung` (§13).
- **Door** — an inbound dispatch site: webhook push, the polling pipeline, forwarding, or a manual
  sync. All four converge on `batchStoreMessages`.
- **Sync stage vs sync status** — `syncStage` is *where in the polling pipeline* a channel is
  (`IDLE`, `MESSAGE_LIST_FETCH_PENDING`, `MESSAGE_LIST_FETCH`, `MESSAGES_IMPORT_PENDING`,
  `MESSAGES_IMPORT`, `FAILED`); `syncStatus` is the coarse outcome (`NOT_SYNCED`, `SYNCING`,
  `ACTIVE`, `FAILED`).
- **Machine mail** — inbound classified as automated. `hard` (bounces/NDRs/daemons — loop-forming,
  never answer, never grow the contact graph from it) vs `soft` (OOO, list mail — excluded from
  automations by default, opt-in per trigger).

---

## 3. The Data Model

### `Integration` — the channel
`packages/database/src/db/schema/integration.ts`

| Column | Notes |
| --- | --- |
| `id`, `organizationId` (cascade) | |
| `credentialId` (FK → `Credential`, **set null**) | the OAuth token / API key — see the connections guide |
| `provider` (`IntegrationProviderType`) | 12 values; drives the provider registry |
| `name`, `email` | `email` is the account address (nullable for chat/social) |
| `enabled` | user toggle — polling and sends skip disabled rows |
| `lastSyncedAt`, `lastSuccessfulSync`, `lastHistoryId` | `lastHistoryId` is Gmail's incremental cursor |
| `syncStatus`, `syncStage`, `syncStageStartedAt` | see §8 — `syncStageStartedAt` is what the stale-check sweeps on |
| `throttleFailureCount`, `throttleRetryAfter` | exponential backoff, 30s base → 1h cap |
| `syncMode` (`webhook \| polling \| auto`), `pollingIntervalMs` (default 5 min) | `auto` is resolved per-provider from env (§7) |
| `isExample`, `metadata` (jsonb), `deletedAt` | `metadata.settings` holds `ChannelSettings`; `metadata.systemManaged` excludes from billing |

Unique on `(organizationId, provider, email) WHERE deletedAt IS NULL` — **soft delete**, so a
disconnect frees the address for reconnect.

### `InboxIntegration` — channel ↔ inbox
Unique on `integrationId` **alone**: a channel belongs to at most one inbox, so
`InboxService.addIntegration` *moves* a link rather than adding one. Also unique on
`(inboxId, integrationId)`, `isDefault` flag, cascade on both sides.

### `Thread`
`externalId` (provider conversation key, unique per `integrationId`), `subject`, `integrationId`,
`assigneeId`, `status` (`OPEN`/`ARCHIVED`/`RESOLVED`/`CLOSED`/`SPAM`/`TRASH`/`IGNORED`/…),
`handoffState` (`ai \| human` — chat threads start `ai` and flip on "Take over"), denormalized
`messageCount`/`participantCount`/`firstMessageAt`/`lastMessageAt`/`latestMessageId`/
`latestCommentId`, `inboxId`, `primaryEntityInstanceId` + `primaryEntityDefinitionId` (the linked
ticket/deal — replaced the legacy ticket-only column), `mergedIntoThreadId` + `mergeData`
(soft merge), `learnedExtractedAt`, and `searchText`.

`searchText` is a **bounded** HTML-stripped body corpus maintained by
`mail-query/thread-search-text.ts`. Subject is deliberately **not** blended into it — the lens
grants subject (`identity`) and body (`read`) separately, and one column would let a subject-only
viewer match on body text. It is bounded because `to_tsvector` *errors* past 1 MB.

### `Message`
`externalId` (unique per integration), `externalThreadId`, `threadId`, `integrationId`,
`isInbound`, `subject`, `textHtml`/`textPlain`/`snippet`, `internetMessageId` (unique per org
where non-null — the RFC 5322 Message-ID, the reconciliation key), `fromId`/`replyToId`
(→ `Participant`), `historyId`, `sentAt`/`receivedAt`, `signatureId`,
`htmlBodyStorageLocationId` (large HTML bodies live in object storage, not the row),
`hasAttachments`, `sendStatus` (`PENDING`/`SENT`/`FAILED`/`BOUNCED`) + `attempts`/`lastAttemptAt`/
`providerError`, `sendToken` (unique — the send idempotency capability, **never** put on the
wire), and `machineMailTier`.

### Side tables
`ThreadParticipant` / `MessageParticipant` (with `entityInstanceId` → contact — the join the
contact-derived lens rule needs), `ThreadExternalKey` (conversation-key aliases; what makes a
merge stick), `ThreadEntityLink` (secondary record links; the primary lives on `Thread`),
`ThreadReadStatus`, `MessageReceipt`, `LabelsOnThread`, `Label`, `IntegrationTagLabel`,
`ScheduledMessage`, `MailView`, `MailDomain`, `EmailAddress`, `EmailTemplate`,
`EmailEmbedding`.

`Participant` is org-scoped and unique on `(organizationId, identifier, identifierType)`, carries
`isInternal` (own-domain), `isSpammer`, and `entityInstanceId` for the contact link.

### `ThreadEvent` — the inline lifecycle timeline

Append-only system-line events rendered between message bubbles on **every** channel ("Markus
took over", "Archived by workflow *Auto-close*", "tagged with x, y, z"): `threadId` (real FK,
cascade-on-delete), `type`, `actorId`, `data` jsonb, `createdAt` — no `updatedAt`, nothing
updates these rows. **Single writer**: `events/handlers/publish-thread-event-to-realtime.ts`
persists the row, then fans it out over realtime (visitor fan-out allowlist-gated — see gotcha
28). Read via `@auxx/lib/thread-events` (`listThreadEvents`, keyset-cursor on
`(createdAt, id) DESC`).

The `type` vocabulary is plain `text`, defined **once** in `@auxx/lib/thread-events/client`
(`THREAD_EVENT_TYPES` — grows over time; `VISITOR_FACING_THREAD_EVENT_TYPES` — frozen at the
original six). The strings double as Pusher event names and public webhook event names
(`thread:archived`/`thread:reopened`), so they are never renamed. `actorId` is a branded
`ActorId` (`user:…`/`agent:…`) rendered as an avatar badge; automation writes `actorId = null`
plus `data.source` provenance (`{kind: 'workflow' | 'mail_filter' | …, id, runId?, name?}`)
rendered as copy — emitters pass a `ThreadActor` descriptor and `threadActorToEventFields`
does the mapping.

**Boundary rule (do not re-litigate):** `ThreadEvent` = **conversation-surface** history,
rendered inline in the thread view; `TimelineEvent` = **record-surface** history, rendered in
the record drawer's timeline tab. Merge is deliberately both: the `TimelineEvent` merge
markers are the *mechanism* (unmerge reads them back) and the `thread:merged` `ThreadEvent`
on the surviving thread is the *surface* (deleted on unmerge). Design record:
`plans/threads/thread-events.md`.

---

## 4. Providers

### The interface
`providers/channel-provider.interface.ts` — `ChannelProvider` is a wide, email-shaped interface:
`initialize`, `sendMessage`, `setupWebhook`/`removeWebhook`, `syncMessages`, archive/spam/trash/
restore, draft CRUD, label CRUD, thread ops, plus the **optional two-phase sync** trio
(`fetchMessageIds`, `importMessages`, `supportsTwoPhaseSync`) and `discoverLabels`. Providers that
don't implement two-phase fall back to a single-shot `syncMessages()`.

`ProviderRegistryService` (per org) instantiates and caches provider instances by integration id
and maps the `provider` string onto the concrete class.

### Two capability maps — do not confuse them
| Map | File | Who reads it |
| --- | --- | --- |
| `PROVIDER_CAPABILITIES` | `providers/provider-capabilities.ts` | **the runtime matrix** — `canSend`, `canDraft`, `canApplyLabel`, `labelScope`, `maxAttachmentSize`, rate limits, `supportsPersonalConnection`, `supportsBidirectionalStatusSync`, `requiresSendReconciliation`, `triggersPostSendSync`, `countsAgainstOutboundEmailsQuota` |
| `PLATFORM_CAPABILITIES` | `channels/capabilities.ts` | **the coarse LLM-facing map** — `channel: email\|messaging`, `channelGroup`, `newOutbound`, `threadReply`, `subject`, `ccBcc`, `recipientModel`, `identifierType` |

The second exists so the agent tool catalog can describe a channel in one stanza; it is
deliberately *not* the gate for runtime behavior. Gate on `PROVIDER_CAPABILITIES`.

Two per-provider values on it are **declared, not derived**, and both exist because a derivation
was tried and lost information:

- **`identifierType`** — the `IdentifierType` a channel's `Participant` rows are keyed by.
  `facebook` and `instagram` are both `thread_only` yet key on different id spaces.
- **`channelGroup`** — the coarse channel a person names in a rule (`email` / `sms` / `whatsapp` /
  `facebook` / `instagram` / `chat`). It is what the `channelType` condition compiles through
  (§14). `undefined` means "not a conversation channel" and keeps `shopify` out of every channel
  option list.

### Sync mode resolution
`providers/sync-mode-resolver.ts`. `polling`/`webhook` pass through; `auto` resolves per provider:
Google needs `GOOGLE_PROJECT_ID` + `GOOGLE_PUBSUB_TOPIC` + `GOOGLE_PRIVATE_KEY` +
`GOOGLE_CLIENT_EMAIL` or it falls back to polling; Outlook resolves to `webhook` (no extra env);
IMAP is always `polling`.

### Auth failure
`providers/auth-error-handler.ts` normalizes every provider's auth error into `AuthErrorType`
(`INVALID_GRANT`, `REVOKED_ACCESS`, `INSUFFICIENT_SCOPE`, `RATE_LIMITED`, …) and, when
`requiresReauth`, stamps the **Credential** (`markCredentialReauth`) — not the Integration. Every
scanner and relaunch job left-joins `Credential` and skips rows with `requiresReauth`, so a
revoked token stops the pipeline instead of burning retries.

---

## 5. Connecting a Channel

Channels connect through the **generic connections/OAuth machinery** (see
`connections-architecture-guide.md`), not a bespoke flow. The callback commits the `Credential`,
then runs a **post-connect hook**:

`channels/provisioning-hook.ts` (Gmail/Outlook) — resolve a fresh access token, fetch the account
email, discover Outlook aliases, create-or-relink the `Integration`, link it to an inbox, seed sync
state, and arm the push door: Gmail watch, or the Outlook Graph subscription via
`armOutlookSubscription` (which first seeds `metadata.graphDeltaLink` with a `since = now` delta
walk so push only ever sees future mail, then arms; on failure the row is stamped
`syncMode: 'polling'` — **not** `'auto'`, which would resolve straight back to webhook and the
polling scanner would skip it). A new channel then still kicks the polling pipeline once for its
initial history backfill (§8). Reconnects re-arm without re-backfilling; the *silent* token-refresh
reconnect path never reaches this hook, so `recoverChannel` re-arms too.
`channels/social-provisioning-hook.ts` (Facebook/Instagram) and
`channels/openphone-provisioning-hook.ts` do the equivalent for their platforms;
`channels/register-hooks.ts` wires them up.

`CHANNEL_PROVIDER_TO_KEY` / `resolveChannelDefinitionId` (`channels/channel-connection-def.ts`)
map between the connection `providerKey` (`gmail`, `outlookMail`) and the Integration `provider`
(`google`, `outlook`).

**Personal vs shared is decided at connect time.** `supportsPersonalChannelConnection(providerKey)`
gates it on `PROVIDER_CAPABILITIES[provider].supportsPersonalConnection` and the OAuth authorize
route enforces it server-side — the wizard step is ergonomics only. A shared connect asserts its
target inbox (`assertSharedConnectInbox`); a personal connect calls `provisionPersonalInbox`.

**IMAP** does not go through OAuth — `channel.connectImap` / `channel.testImapConnection` take
host/port/credentials directly.

**Billing.** `countBillableChannels` excludes soft-deleted rows, `isExample` seeds, and
`metadata.systemManaged` (the auto-provisioned `*@mail.auxx.ai` forwarding address). The create
guard and the overage detector both call it, so they cannot drift.

---

## 6. Inboxes — Shared vs Personal

An inbox is an `EntityInstance` on one of **two definitions**:

- `inbox` — org-shared. Carries a `role:org_member` `ResourceAccess` baseline row (the **floor**).
- `personal_inbox` — one member's connected account. `baselineAtCreate: true` instance-access, so
  "no row ⇒ no access" holds for **every** member including the org owner. It never gets a
  `role:org_member` floor row.

The def split is the privacy mechanism: personal-ness is unforgeable def membership rather than an
`inbox_is_personal` field defended by a write-wall hook. `InboxService` carries a mandatory
**def-scoped query audit** comment at the top of the file classifying every query as
unions-both-defs / resolves-the-actual-def / deliberately-shared-only / def-agnostic. Read it
before adding a query there — listing one def in `getInboxes()` (which backs the `org:inboxes`
cache and ~20 consumers) is the single highest-leverage silent bug in the area.

**The floor is a row, not a field.** `Inbox.defaultLens` is derived from the `role:org_member`
baseline row via `readInboxFloors`; the old `inbox_default_lens` FieldValue is neither read nor
written.

**Channel manage-authority is per-channel, not a coarse capability**
(`channels/manage-access.ts`): `canManageChannel` = holds `channelsManage`, **or** owns the
personal inbox this channel routes to. Use `requireChannelManageAccess(ctx, integrationId)`.
Note the deliberate divergence from `channels/list.ts`: an **unlinked** channel (`inboxId === null`)
is *visible* to everyone but *manageable* only by `channelsManage` holders — a test pins it, so
don't "consistency-fix" one against the other.

---

## 7. Inbound Door 1 — Webhook Push

| Provider | Endpoint | Verification |
| --- | --- | --- |
| Gmail | `apps/web/src/app/api/google/webhook/route.ts` | Pub/Sub push JWT — JWKS from `googleapis.com/oauth2/v3/certs`, RS256, audience = `WEBAPP_URL` \| the Pub/Sub subscriber audience \| the configured service-account email |
| Outlook | `apps/web/src/app/api/outlook/webhook/route.ts` + `…/webhook/lifecycle/route.ts` | Graph `?validationToken=` handshake (answered **before** anything else, on both GET and POST, on both routes) + `clientState` timing-safe check against the per-integration secret in `metadata.outlookSubscription`; unverifiable notifications are **dropped, never thrown** (a 500 makes Graph retry a notification we will never accept) |
| Facebook / Instagram | `api/{facebook,instagram}/webhook/route.ts` | `hub.challenge` subscribe handshake + `X-Hub-Signature-256` |
| OpenPhone | `api/openphone/webhook/route.ts` | `x-openphone-signature` verified against the integration's credential secret (`@auxx/lib/webhooks`) |

Gmail push carries a `historyId`, not the mail — the handler resolves the channel and runs an
incremental history sync from `Integration.lastHistoryId`.

**Outlook push is the live inbound door** (plans/outlook/webhook-push-migration.md, shipped
2026-08-13 as #1585/#1586/#1587) and is shaped by Graph's **3-second ack rule**: a slow endpoint
gets marked slow/drop and mail is silently lost. So the route only validates → resolves the
channel by the **indexed `Integration.webhookRouteKey` column** (the Graph subscription id;
never the old jsonb scan) → enqueues `outlookPushSyncJob` → `202`. The job debounces bursts into
one delta walk per 15s window (jobId coalescing) and takes a **per-integration Redis lock** — the
only thing serializing `metadata.graphDeltaLink`, whose hold-on-retriable-failure safety two
concurrent walks would silently defeat. The lifecycle route handles `reauthorizationRequired`
(PATCH renews *and* reauthorizes — never pair with `/reauthorize`), `subscriptionRemoved`
(clear state → re-arm → catch-up sync) and `missed` (delta resync).

**Webhook lifetime.** Gmail watches and Outlook subscriptions (max just under 7 days; armed for
6d20h) are renewed by `webhookRenewalScannerJob` (15 min, 24h buffer, reads
`metadata.outlookSubscription.expiresAt`). The hourly `outlookSubscriptionHealthJob` is the
backstop that replaces running polling in parallel: it re-arms dead/expired subscriptions, and
for a stored-but-silent one (stale `lastSyncedAt`) it first `GET`s the subscription — a quiet
mailbox is not a dead one, never re-arm on staleness alone. Repeated arm failures flip
`syncStatus` to `FAILED`; the first successful arm is the only thing that un-fails it.

**Dev:** Graph rejects `http://` notification URLs, so callbacks are built via
`providers/webhook-callback-base.ts` (`NGROK_URL || WEBAPP_URL` — the same convention as the
OAuth redirect bases). Arming in dev requires the tunnel.

---

## 8. Inbound Door 2 — Two-Phase Polling

The polling pipeline is the fallback for Gmail (missing Pub/Sub env) and for Outlook when
subscription arming fails (the provisioning hook stamps `syncMode: 'polling'`), the default for
IMAP, and the **one-shot initial backfill** for every new channel — a webhook-mode Outlook
channel runs this pipeline exactly once at connect to import its history, then never again
(push is the ongoing door; the health job is the recovery path). All jobs run on the
`polling-sync` queue (`apps/worker/.../polling-sync-worker.ts`, concurrency 10, 5 min lock).

**The pipeline is scanner-driven, and the scanner has two selection arms** (#1587): any row with
an in-flight pipeline (`MESSAGE_LIST_FETCH_PENDING` / `MESSAGES_IMPORT_PENDING`) is driven to
completion **regardless of sync mode** — only the scanner advances those stages, so excluding
webhook rows stranded their initial backfill forever — while *new* cycles (from `IDLE`) start
only for effective polling mode.

```
  pollingSyncScannerJob        every ~5 min — drive in-flight pipelines (any mode) +
        │                       start IDLE cycles (polling mode only; enabled, not
        │                       requiresReauth, past pollingIntervalMs,
        │                        30s CLAIM_COOLDOWN_MS against double-enqueue)
        ├─▶ messageListFetchJob      PHASE 1 — discover ids
        │     provider.fetchMessageIds() → ids into the Redis import cache
        │     stage: MESSAGE_LIST_FETCH → MESSAGES_IMPORT_PENDING (or back to IDLE)
        │     also: discoverAndUpsertFolders (label/folder sync)
        └─▶ messagesImportJob        PHASE 2 — fetch content
              claim a batch (two-phase claim/ack) → provider.importMessages(ids)
              batch size: google 50, outlook 20, imap 50
              stage: MESSAGES_IMPORT → …
```

**The backfill trigger cutoff.** Historical mail must not fire `message:received` subscribers
(workflows, billed classification, bounce ingest, timeline), and "which code path ingested it"
was never a safe gate — the polling backfill routes through `importMessages`, which is also the
live import path. So suppression is **received-time based**: the provisioning hook stamps
`metadata.backfillCutoffAt` at connect (the *same* epoch the Outlook delta cursor is seeded
from), the provider sets it on the ingest ctx, and `storeMessage` suppresses the publish for
inbound mail received before it — regardless of walker — until `messagesImportJob`'s first
drain-to-IDLE stamps `metadata.initialBackfillCompletedAt`. Overlap mail (received ≥ cutoff)
fires exactly once via the fresh-insert-only gate, whichever walker wins. Built as a shared
ingest mechanism (`ctx.backfillCutoffAt`); only Outlook wires it so far — Gmail's polling path
still has the walker-based hole (separate ticket).

**Self-healing.** `pollingStaleCheckJob` (~15 min) resets channels stuck in an active stage past
15 min — preserving the Redis import cache so recovery resumes importing rather than re-listing
against an already-advanced cursor; it has no sync-mode filter, so it covers a webhook channel's
backfill too. `pollingRelaunchFailedJob` (~30 min) resets `FAILED` channels, skipping
`requiresReauth` and rows still inside `throttleRetryAfter`; it relaunches effective-polling rows
plus webhook-mode rows **only while their initial backfill is incomplete** (`backfillCutoffAt`
stamped, `initialBackfillCompletedAt` not) — an arm-failure `FAILED` from the health job is
deliberately not "fixed" by re-running list-fetch.

**IMAP is special**: full sync uses windowed UID scanning with durable per-folder checkpoints
(`Label.syncCheckpoint`) and enqueues *self-contained* `imapImportBatchJob`s instead of using the
Redis cache.

**Manual sync** (`channel.syncMessages` / `syncAllMessages` → `messageSync` queue) uses the History
API when `lastHistoryId` is set and only falls back to a date-windowed list on a first import.
Chat channels reject sync outright.

**`sync-core/`** (`contracts.ts`, `slice-runner.ts`) is the newer channel-agnostic slice engine
shared with data-connectors: bounded slices (`maxPages`/`maxRecords`/`maxMs`), an opaque
`SyncCursor` the core never interprets, and a three-state `SliceCommit`
(`all` / `partial-retriable` → hold the cursor / `partial-permanent` → advance past poison
records). The channel side is being migrated onto it; the polling jobs above are still the live
path for mail.

---

## 9. Inbound Door 3 — Forwarding (SES/Mailgun)

The `email` provider type is a **forwarding address** — the org forwards mail to
`<something>@mail.auxx.ai` instead of connecting an account.

```
  SES receipt rule → S3 (raw MIME) + SNS → SQS
        │
  apps/worker/src/inbound-email/sqs-poller.ts → process-sqs-message.ts
        │   (zod-validated handoff: sesMessageId, s3Bucket, s3Key, recipients, receivedAt)
        ▼
  InboundEmailProcessor
    s3-raw-email → raw-email-parser → InboundChannelResolver (recipient → channel)
    → sender-allowlist-guard (metadata.allowedSenders)
    → body-ingest (HTML → object storage) + attachment-ingest
    → the normal ingest path (§10)
```

`DomainService` (`mail-domains/`) provisions the org's subdomain on the Mailgun base domain,
mints a verification token, and defaults a `ticket` routing prefix.

---

## 10. Ingest — one message becomes a row

Every door converges here. `batchStoreMessages(ctx, messages, opts)` →
`storeMessage(ctx, messageData)` per message.

**`IngestContext`** (`ingest/context.ts`) is per-batch shared state: db, system user id, the CRUD
handler, reconciler, thread manager, the selective-mode cache, `integrationSettings`, `ownEmails`
(union of `Integration.email` + `metadata.userEmails` — "us" even when `Organization.domains` is
unset), an optional `socketId` for self-echo suppression, and the per-batch dedupe caches
(`companyIdByDomain`, `ownDomainsByOrg`, `providerByIntegrationId`).

**Ordering matters.** Batches are sorted **chronologically** before storing, because selective
record-creation mode relies on an earlier outbound message having "opened" a recipient before a
later inbound one arrives.

**Realtime batching.** `ctx.inSyncBatch` suppresses per-message/per-thread publishes and collects
touched inbox ids, emitting one `inbox:syncCompleted` per inbox at the end — a 5000-message
backfill must not fan out 5000 socket events.

Per message, in order:

1. **Filter** — `shouldIgnoreMessage`: `onlyProcessRecipients` allowlist (if set and no TO matches
   → ignore), then `excludeSenders`, then `excludeRecipients` (skipped when the allowlist was
   used). Ignored mail is recorded by `store-ignored.ts`, not silently dropped.
2. **Machine-mail detection** — `detectMachineMail` on headers + From: `hard` for
   mailer-daemon/postmaster/bounce localparts, VERP `bounce+`, `Auto-Submitted: auto-generated`;
   `soft` for no-reply localparts and bulk `Precedence`. Stamped on `Message.machineMailTier`
   (partial index); the reason stays in `metadata.machineMail`. Hard-tier participants skip
   contact creation.
3. **Resolve the thread** — `resolveThreadId`, a three-rung ladder:
   1. `ThreadExternalKey(integrationId, externalId)` — every conversation key ever seen, any
      provider. A hit is authoritative.
   2. `In-Reply-To`, then `References` newest→oldest, matched against `Message.internetMessageId`
      in the same org. **Gated to Outlook + IMAP** — Gmail threads correctly on its own
      `threadId` and *intentionally* splits long conversations while re-using `References`, so
      header matching there would merge threads Gmail meant to keep apart.
   3. Miss → `null`, caller upserts on the provider conversation key.

   It walks `mergedIntoThreadId` (max 3 hops) so a merged-away source is never returned, and it
   **never throws** — this is the hottest write path in the system.
4. **Record the alias** — `recordThreadExternalKey` runs **after** the write transaction commits
   and swallows its own failures. This is not defensive noise: Postgres aborts the whole
   transaction on any statement error, so an in-transaction `try/catch` would not save it. Keeping
   it inside once took ingest down for every provider when the table didn't exist yet.
5. **Participants** — normalize the identifier, find-or-create the `Participant`, mark
   `isInternal` against `ownEmails`/org domains.
6. **Contacts & companies** — `findOrCreateContactForParticipant` honors
   `ChannelSettings.recordCreation.mode` (default `selective`): `all` creates for everyone,
   `selective` only for addresses the org has already sent to (tracked in `SelectiveModeCache`
   across batches), `none` creates nothing. Internal participants are never auto-created unless
   `force` (the explicit "create ticket from thread" click). Contacts auto-link to a company by
   registrable email domain, with personal-domain and excluded-TLD filters; link failures are
   swallowed so contact creation still succeeds.
7. **Reconcile** — `reconcileMessage` matches an inbound Sent-copy against a row we already wrote
   (by `internetMessageId`, the echoed `X-AuxxAi-Message-Id`, or a similar-subject heuristic) and
   merges provider data instead of duplicating.
8. **Write + fan out** — the `Message` row, `updateThreadMetadataEfficient`,
   `applyMailCountDeltas`, `touchActivityForThreadLinks`, the `MessageReceivedEvent` on the event
   bus, and realtime publishes (unless batched).

### Attachments are ingested *after* the message row, per channel

`storeMessage` never fetches bytes. Attachment ingest is a separate post-store step each
channel wires itself, because only the provider knows how to get the bytes: Gmail fetches
them from its API (`GmailInboundContentIngestor`), SES parses them out of the raw MIME
(`InboundEmailProcessor`), and Meta downloads a signed CDN link
(`providers/social/attachments.ts`). All three converge on
`InboundAttachmentIngestService.ingestAll`, which writes StorageLocation → MediaAsset →
`Attachment(entityType: 'MESSAGE')`, and all three are idempotent through
`deriveAttachmentId(contentScopeId, order, filename)` — so a re-delivered webhook or a
re-synced conversation lands on the same rows.

`Message.hasAttachments` therefore means **"the payload declared a file"**, not "the bytes
are stored". It is set at conversion time, before ingest, and deliberately: it is the
`message:received` workflow trigger's filter, which is evaluated at store time — a flag
flipped after ingest could never fire an attachment rule. A provider with no ingestor at
all (Quo/SMS today) must keep it `false`, or it fires rules against files that will never
exist.

Ingest runs after `message:created` has already gone out with an empty attachment list, so
a live-inbound path should publish `message:updated` with the stored attachments once it
finishes — otherwise the file only appears on the next refetch. Sync paths do not: a
backfill publishes nothing per message by design.

**Thread status on personal channels** derives from Gmail labels (`INBOX` → `OPEN`, sent-only /
archived / label-only → `ARCHIVED`, `TRASH`/`SPAM` straight through). Shared inboxes never call
this — they keep everything-open helpdesk semantics.

---

## 11. Outbound — composer → sender → provider

### One composer send is not always one message

`MessageSenderService.sendMessage` first asks `splitSendForProvider` whether the
provider can carry this send in **one** message. Two capabilities decide it —
`maxAttachmentsPerMessage` and `canSendTextWithAttachment` (`providers/types.ts`).
Email answers yes to everything and is never split. Meta answers no to both: its
Send API's `message` object takes `text` **or** one `attachment`, so a caption
with two photos becomes three messages, sent in order, each with its own row.

**The split is here rather than inside the provider because of ingest, not
aesthetics.** Each Meta message returns its own `mid`, and a `Message` row holds
one `externalId` — the key `(integrationId, externalId)` dedupes on. A provider
that sent three and reported one would leave two ids belonging to no row of ours,
and the next scheduled sync (FB/IG are in `sync-all-messages-job`) would re-import
them as duplicate outbound messages. It also matches what the customer sees:
Messenger renders three bubbles whatever we do.

Parts 2..N carry `splitContinuation`, which skips the auto-reply alternation
guard — they are one send, not a workflow replying to itself. Send-level fields
(`messageId`, `draftMessageId`, `signatureId`, `includePreviousMessage`) belong to
the first part only. A part that fails throws with the earlier parts already sent,
which is the honest outcome: they really did arrive.

`SentMessage.splitMessages` reports the whole shape back to the composer, which
needs it because the originating tab is excluded from its own `message:created`
echo (`excludeSocketId`) — its optimistic row is the only thing it sees until a
refetch.



`MessageComposerService` commits the `Message` row **before** the provider is called, mints the
`sendToken`, and resolves attachments. `MessageSenderService` then:

- checks the outbound-email usage guard and `automated-send-guard` limits (with an admin
  notification when the breaker trips), and the sequence suppression list;
- instruments HTML for open/click tracking per `ChannelSettings.tracking` — opens default `true`
  everywhere, clicks default `true` only for the `email` forwarding provider (link-wrapping 1:1
  personal mail from `google`/`outlook` is a deliverability risk, so it's opt-in there);
- adds `List-Unsubscribe`/`List-Unsubscribe-Post` (RFC 8058) for outbound to a known contact;
- for automated sends (Answer node, Kopilot tools, sequences) stamps `Auto-Submitted: auto-replied`
  + `X-Auto-Response-Suppress: All` so compliant remote systems don't re-reply;
- passes `internalMessageId` — the **`Message.id`**, echoed by Outlook as `X-AuxxAi-Message-Id`.
  Graph returns nothing useful from `/me/sendMail` and mints its own `Message-ID`, so without this
  the Sent-Items copy shares no identifier with our row and forks the thread. Deliberately the row
  id and **not** `sendToken` — the token is an idempotency capability and must never travel on a
  header every recipient can read.

After send: `MessageReconcilerService` and, for providers with `triggersPostSendSync`, a post-send
sync job. Failures set `sendStatus = FAILED` with `providerError`/`attempts`; the retry queue index
is `(organizationId, sendStatus, lastAttemptAt)`.

**Drafts** (`drafts/draft-service.ts`) are our own table with jsonb content for fast autosave —
independent of provider drafts. Creating or holding a draft **on a thread** requires the `read`
lens (`assertCanDraftOnThread`); standalone drafts don't.

**Scheduled send** (`mail-schedule/`) writes a `ScheduledMessage` and enqueues a delayed job that
runs the same sender path at fire time.

---

## 12. Labels & Folders

`Label` rows mirror provider labels/folders per `(organizationId, integrationId)`, carrying
`providerCursor` (Outlook deltaLink / IMAP UID+modSeq — null for Gmail, which uses the
channel-level `historyId`), `isSentBox` (direction detection), `parentLabelId` (IMAP hierarchy),
`syncCheckpoint`, and `pendingAction` (`PENDING_REMOVAL` defers folder deletion until messages are
cleaned up).

`email/labels/` holds a `LabelProvider` interface with Gmail and Outlook implementations behind a
factory, plus `diffProviderLabels` — extracted as a **pure** function precisely because it's the
part most likely to break in a port. Its `|| null` / `?? true` normalizations are load-bearing:
the DB stores absent colors as `NULL` while providers report `undefined`, and comparing them raw
makes every uncolored label look changed and rewrites every row on every sync.

`LabelsOnThread` is the thread↔label join; `IntegrationTagLabel` maps our tags onto provider
labels for push-back.

**No permission checks live in `labels/`** — the router asserts `requireChannelManageAccess`
(per-integration) or `channelsManage` (fan-out) first.

---

## 13. The Mail Lens (permissions)

The correctness-critical surface. Read this before touching any mail read path.

### The ladder
`Lens = none < metadata < identity < read` (`permissions/visibility/lens.ts`) — a **narrowing of
`Rung`**, same names, same order, same comparators.

- `none` — invisible: dropped from lists, 404 by id.
- `metadata` — participants, timestamps, counts, status, assignee, tags.
- `identity` — the above + subject + message envelopes, no body.
- `read` — everything, and **may act** (reply/assign).

`edit`/`admin` rungs mean managing the *inbox*, so `rungAsLens` clamps them to `read`. Because
`Lens` is a narrowing of `Rung`, forgetting the clamp is a compile error, not a silently widened
lens. `normalizeLens` exists because SINGLE_SELECT field values surface as one-element arrays and
`['read'] !== 'read'` silently redacts full viewers.

### The viewer
`MailViewer` is one of three principals (`permissions/visibility/context.ts`):
- `UserInstanceGrants` — a real member's cached context (`user:instance-grants`): `inboxLens` (a
  precomputed **fold**, not a projection), `personalInboxIds`, `grants` keyed **by def then
  instance**, `defEntityTypes`, `isMailAdmin`.
- `SYSTEM_VISIBILITY` — workers/ingest, unscoped.
- `AutomationVisibility` — full on org inboxes, **zero** on personal ones.

**Rank is not an authority here.** Every `isAdmin` short-circuit was deleted; admins read mail
through `ResourceAccess` rows plus the `Area.inboxes` fallback like everyone else. `isMailAdmin`
(`Area.inboxes === Full`) confers exactly two things: a `metadata` floor on *others'* personal
mailboxes, and the residual null-`inboxId` triage threads.

### Derivation
`effectiveLens(viewer, thread)` is pure and synchronous (0 queries in the common case):
assignment ⇒ `read` (ungated core collaboration — never gate it), otherwise fold
`DERIVATION_RULES` with `maxRung` starting at `none`:

| Rule | Source |
| --- | --- |
| `inbox-floor` | `vis.inboxLens[thread.inboxId]` |
| `thread-grant` | explicit per-thread share |
| `entity-grant` | grant on the thread's primary record, **capped per def** |
| `contact-grant` | grant on any participant contact |

**The cascade cap** (`primaryEntityThreadRung`) is the subtle one: a ticket-like def derives thread
`read` (the conversation *is* the ticket), a generic record def derives **nothing** — sharing a
deal shares the row, not its email history. The cap is applied **per def before the fold**
(`max(min(rung, cap))`, not `min(max(rung), cap)`), otherwise a generic def's `admin` grant
out-ranks a ticket's capped `read` in the same fold. A def missing from `defEntityTypes`, or
carrying `null` (every custom def), derives nothing — the fail-closed default.

### Two evaluators that must agree
- **Point reads** — `getThreadLens` / `getThreadLensBatch` (`thread-lens.ts`). One thread query,
  plus a `ThreadParticipant` query **only** when the viewer holds contact grants.
- **List reads** — `buildMailVisibilityPredicate` (`mail-query/visibility-scope.ts`), the same
  logic in SQL. `undefined` means unrestricted — **SYSTEM only**.

They must produce the same answer. The precomputed `inboxLens` exists specifically so they can't
disagree, and `primaryEntityThreadIdsAtOrAbove` applies the same cap as its point-read twin —
without that, a member could list a row whose every field then redacts.

---

## 14. Reading — queries, views, counts, search

- **`mail-query/`** — `condition-query-builder.ts` (the shared condition→SQL compiler, also used by
  mail views), `context-to-conditions.ts` (route context → conditions),
  `draft-condition-builder.ts`, `search-query-parser.ts` + `thread-search-sql.ts`, and
  `visibility-scope.ts`. **Every list path must apply the visibility predicate.**
- **Search** is org-scoped composite GIN: `Thread_org_searchText_gin_idx` and
  `Thread_org_subject_gin_idx` on `to_tsvector('english'::regconfig, COALESCE(x, ''))`, plus a
  `gin_trgm_ops` subject index for typo tolerance. ⚠ The `to_tsvector` expression in
  `search/text-search-sql.ts` must stay **byte-identical** to the index expression — a differing
  regconfig or a dropped `COALESCE` silently drops to a sequential scan.
- **Mail views** (`mail-views/`) are saved `ConditionGroup[]` filters over threads, compiled by the
  same builder and evaluated against the viewer.
- **The field catalog is channel-aware, and it is ONE catalog.** `MAIL_VIEW_FIELD_DEFINITIONS`
  serves the searchbar, mail views *and* mail filters, because all three compile through the one
  builder. Three rules follow:
  - `from` / `to` / `sender` are **address** fields, not email fields. They compile to
    `ilike(Participant.identifier, …)` with **no `identifierType` predicate**, so
    `from is +15102055536` is as valid as `from is ada@acme.com`. Never split them per channel and
    never re-introduce an `@`-shaped test — the participant row already answers the question.
  - `channelType` is how a rule says "SMS" on a **mixed** inbox (an inbox is a union of channel
    types, not one type). It compiles to `Thread.integrationId IN (SELECT id FROM Integration
    WHERE provider IN …)` over a `channelGroup`'s providers, and **deliberately does not filter
    `Integration.deletedAt`** — disconnect is a soft delete, and the threads that channel
    delivered are still in the inbox. It is the one channel query in the codebase that must not
    carry `isNull(Integration.deletedAt)`.
  - Scoping the catalog to an inbox's channels (`getMailFilterFields(identifierTypes, keep)`) is a
    **soft, recomputed hide** — never persisted on the row, never applied to a field an existing
    filter already uses, and it fails open when the channel list is unavailable.
- **Filter values are normalised at authoring, not at compile** (`mail-filters/normalize-conditions.ts`).
  A phone number typed `(510) 205-5536` compiles, saves and previews cleanly and then never fires:
  never-matching is not dropping, so neither `assertFilterConditionsCompile` nor the fail-closed
  `AND false` sees it. Exact operators on address fields go through the shared `formatPhoneNumber`
  (the same E.164 normaliser as `fieldValueSchemas.phone`); `contains` / `starts with` /
  `ends with` are left verbatim, because `starts with +1510` is an area-code rule.
- **Counts** (`threads/mail-counts.ts`) are delta-maintained, not queried: one Redis hash per
  `(org, user)` with fields `inbox` / `drafts` / `si:{inboxId}` / `view:{viewId}`; mutations apply
  atomic `HINCRBY` deltas; a lazily-enqueued reconcile recounts from Postgres every ~5 min and
  overwrites. Read path is a single roundtrip. **Accuracy contract: drift is bounded by the
  reconcile interval, never permanent.**
- **Realtime** — room `org-{orgId}-inbox-{inboxSlug}`, events `thread:*`, `message:*`,
  `inbox:syncCompleted`, `mail:batch`. Subscribe auth is `InboxService.hasUserAccess` (the `none`
  triage slug is open to all members). See `realtime-architecture-guide.md`.

---

## 15. tRPC & UI Surface

| Router | Covers |
| --- | --- |
| `channel.ts` (1095 ln) | connect/prepare, list, disconnect, toggle, sync, settings, allowed/excluded senders, chat-widget CRUD, IMAP connect/test, `resetSyncState` |
| `channel-reauth.ts` | reconnect + sync-breaker reset |
| `inbox.ts` | inbox CRUD, members, floors, channel routing, `myLenses` |
| `thread.ts` (1250 ln) | list/get/status/assign/merge/link/handoff, `listEvents` (lifecycle timeline, cursor-paginated, lens-gated) |
| `message.ts`, `draft.ts`, `label.ts`, `mailView.ts`, `mailDomain.ts`, `participant.ts`, `emailTemplate.ts` | |

The area is unusually well test-covered at the router layer — `mail-router-front-door.test.ts`,
`mail-instance-access.test.ts`, `inbox-channel-routing-access.test.ts`,
`label-channel-authority.test.ts`, `resource-access-mail-canonicalization.test.ts` and friends pin
the permission behavior. Extend them rather than reasoning about the lens by hand.

**UI:** routes under `apps/web/src/app/(protected)/app/mail/` (`shared/`, `personal/[inboxId]`,
`inboxes/[inboxId]`, `views/[viewId]`, `tags/[tagId]`, `drafts/`, `sent/`, `[type]/[status]`);
components in `~/components/mail` (thread list/display/composer, chat panel, searchbar, stores),
`~/components/threads`, `~/components/inbox`, `~/components/channels`,
`~/components/mail-permissions`, `~/components/mail-views`.

---

## 16. Gotchas & Invariants

1. **"Channel" and `Integration` are the same row.** Searching for a `Channel` table finds nothing.
2. **One channel ↔ one inbox** — `InboxIntegration` is unique on `integrationId`, so
   `addIntegration` *moves* the link. Re-routing a shared channel's mail into a hidden personal
   inbox must fail closed, and does.
3. **Never gate mail on rank.** `isAdmin` is descriptive metadata. Use the inbox floor, or
   `isMailAdmin` if you mean "runs the mail operation".
4. **`permission: 'none'` is a restriction, never a grant** — any `x === 'view' ? … : 'full'`
   ternary over a permission column reads the restriction marker as a full grant.
5. **Every list path applies `buildMailVisibilityPredicate`.** A new query that forgets it leaks
   across inboxes, and the point-read gate won't catch it.
6. **Point and list evaluators must agree.** Changing a derivation rule means changing both
   `DERIVATION_RULES` and its SQL twin in `visibility-scope.ts`.
7. **Cap record→thread derivation per def, before the fold.** See §13.
8. **`normalizeLens` every lens read from a field value** — SINGLE_SELECT reads are arrays.
9. **Contact grants canonicalize into the mail keyspace** and fan a lens across that contact's
   entire conversation history — a record-level contact grant is much wider than it looks.
10. **Header-chain thread resolution is Outlook/IMAP only.** Enabling it for Gmail merges threads
    Gmail intentionally split.
11. **Never move `recordThreadExternalKey` back inside the write transaction.** A failed INSERT
    aborts the whole transaction; a missing alias is cheap, a lost message is not.
12. **Ingest must never throw.** Thread resolution, alias recording, company linking and contact
    creation all degrade instead of failing the message.
13. **Sort batches chronologically** — selective record-creation depends on it.
14. **Keep `inSyncBatch` set for bulk ingest**, or a backfill fans out one realtime event per
    message.
15. **`sendToken` never goes on the wire.** Echo `Message.id` (`X-AuxxAi-Message-Id`) instead.
16. **Reauth is stamped on the `Credential`, not the `Integration`** — scanners left-join it.
17. **Disconnect is a soft delete.** Every channel query needs `isNull(Integration.deletedAt)`;
    the uniqueness index is partial on it.
18. **Don't blend subject into `searchText`**, and keep it bounded — `to_tsvector` errors past 1 MB.
19. **Keep the `to_tsvector` expression byte-identical** to the index or search silently seq-scans.
20. **Mail counts are eventually consistent by design.** Don't "fix" drift with a synchronous
    recount on the read path.
21. **`PROVIDER_CAPABILITIES` gates runtime; `PLATFORM_CAPABILITIES` only describes a channel to
    the LLM.** Never gate behavior on the second.
22. **Two-phase sync is optional.** Check `supportsTwoPhaseSync()` before assuming
    `fetchMessageIds`/`importMessages` exist.
23. **Bulk/system writes bypass the per-write fan-out.** If an automation needs to react to synced
    mail-adjacent records, that's the sync-change manifest — see
    `entity-events-architecture-guide.md` §8.
24. **The Outlook delta cursor is serialized only by `outlookPushSyncJob`'s Redis lock.** The 15s
    jobId debounce is not a concurrency guard; a second walk from the same `graphDeltaLink`
    silently defeats the hold-cursor-on-retriable-failure safety. Never call
    `syncMessages('outlook', …)` from a new concurrent path without going through the job.
25. **Never gate historical-mail suppression on the ingest walker.** Use the received-time cutoff
    (`metadata.backfillCutoffAt` / `initialBackfillCompletedAt`, `ctx.backfillCutoffAt`) — the
    `isInitialSync` flag is a property of which code path ran, and the polling backfill shares its
    import path with live sync.
26. **`Integration.webhookRouteKey` is the inbound routing key** (unique per provider among live
    rows). It is a column, so `metadata: null` does NOT clear it — every teardown path
    (`removeWebhook`, `revokeAccess`, lifecycle `subscriptionRemoved`) must null it explicitly.
27. **Outlook webhook callbacks must be HTTPS.** Build them via
    `providers/webhook-callback-base.ts` (`NGROK_URL || WEBAPP_URL`), never from `WEBAPP_URL`
    directly — Graph rejects `http://` and dev arming silently falls back to polling.
28. **Thread lifecycle events gate at the `metadata` rung on BOTH doors.** The `thread-{id}`
    realtime room and `thread.listEvents` must ask the same lens question, and `listEvents`
    returns empty — never 403/404 — so an invisible thread id fails exactly like a
    nonexistent one. The visitor fan-out is an **allowlist frozen at the original six**
    (`VISITOR_FACING_THREAD_EVENT_TYPES`): new event types are admin-surface only unless
    deliberately added, and a type whose payload narrates an identity/read-tier fact
    (subject, body snippet) must not join the vocabulary at all — it would leak through the
    events sidecar what `redactThreadMeta` blanks on the thread itself.

---

## 17. Key Files

**Channels** — `packages/lib/src/channels/`: `lifecycle.ts` (create/link), `list.ts` (+
`countBillableChannels`), `manage-access.ts` (per-channel authority), `personal-connection.ts`,
`provisioning-hook.ts` / `social-provisioning-hook.ts` / `openphone-provisioning-hook.ts`,
`settings.ts`, `sync.ts`, `disconnect.ts`, `capabilities.ts`, `types.ts`.

**Providers** — `packages/lib/src/providers/`: `channel-provider.interface.ts`,
`provider-registry-service.ts`, `provider-capabilities.ts`, `sync-mode-resolver.ts`,
`auth-error-handler.ts`, `webhook-manager-service.ts`, `webhook-callback-base.ts`, and the
per-provider dirs (`google/`, `outlook/` (incl. `outlook-subscription.ts` — arm/seed), `imap/`,
`email/`, `mailgun/`, `facebook/`, `instagram/`, `openphone/`, `chat/`).

**Inbound** — `packages/lib/src/ingest/` (`batch-store-messages.ts`, `store-message.ts`,
`context.ts`, `threads/resolve-thread.ts`, `filtering/`, `reconciliation/`, `contacts/`,
`companies/`), `packages/lib/src/email/inbound/`, `apps/worker/src/inbound-email/`,
`apps/web/src/app/api/{google,outlook,facebook,instagram,openphone}/webhook/route.ts` (+
`outlook/webhook/lifecycle/route.ts`, `outlook/webhook/shared.ts`).

**Sync jobs** — `packages/lib/src/jobs/polling/`, `packages/lib/src/jobs/messages/`
(incl. `outlook-push-sync-job.ts`), `packages/lib/src/jobs/maintenance/`
(`webhook-renewal-scanner-job.ts`, `webhook-renewal-job.ts`,
`outlook-subscription-health-job.ts`), `packages/lib/src/sync-core/`,
`apps/worker/src/workers/worker-definitions/{polling-sync,
message-sync,message-processing,email}-worker.ts`.

**Outbound** — `packages/lib/src/messages/` (`message-composer.service.ts`,
`message-sender.service.ts`, `message-reconciler.service.ts`, `thread-manager.service.ts`,
`automated-send-guard.ts`), `packages/lib/src/drafts/`, `packages/lib/src/mail-schedule/`.

**Permissions** — `packages/lib/src/permissions/visibility/` (`lens.ts`, `context.ts`,
`derivation-rules.ts`, `effective-lens.ts`, `thread-lens.ts`, `redact.ts`),
`packages/lib/src/mail-query/visibility-scope.ts`, `packages/lib/src/inboxes/` (`inbox-service.ts`,
`inbox-floor.ts`, `inbox-def-move.ts`).

**Read paths** — `packages/lib/src/mail-query/`, `packages/lib/src/mail-views/`,
`packages/lib/src/threads/` (`thread-query.service.ts`, `mail-counts.ts`, `unread-service.ts`,
`links.service.ts`, `thread-merge.service.ts`, `handoff.service.ts`),
`packages/lib/src/email/labels/`.

**Lifecycle timeline** — `packages/lib/src/thread-events/` (`client.ts` vocabulary + `ThreadActor`,
queries/mutations), `packages/lib/src/events/handlers/publish-thread-event-to-realtime.ts` (the
single writer), `apps/web/src/components/mail/chat-timeline.ts` (interleave + event-run grouping),
`apps/web/src/components/mail/chat-panel/{use-thread-events.ts,system-line.tsx}`.

**Schema** — `packages/database/src/db/schema/`: `integration.ts`, `inbox-integration.ts`,
`thread.ts`, `thread-event.ts`, `message.ts`, `participant.ts`, `thread-participant.ts`, `message-participant.ts`,
`thread-external-key.ts`, `thread-entity-link.ts`, `thread-read-status.ts`, `message-receipt.ts`,
`label.ts`, `labels-on-thread.ts`, `integration-tag-label.ts`, `scheduled-message.ts`,
`mail-view.ts`, `mail-domain.ts`, `email-address.ts`, `email-template.ts`, `email-embedding.ts`.
