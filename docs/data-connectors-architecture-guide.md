# Data Connectors Architecture Guide

**Last Updated:** 2026-06-25
**Scope:** The `DataConnector` system — how external structured records (Shopify, generic REST/JSON endpoints, apps) are pulled on a schedule and materialized as **EntityInstances + FieldValues**, idempotently and reconcilably, into either a connector-owned definition or an existing one (including system `contact`/`ticket`). Covers the **sliced, resumable sync engine** (paginated backfill → steady incremental, cursor-safe checkpoints), the shared **sync-core** orchestration shell, connectors, the mapping layer, the entity sink, webhooks, queues, the tRPC surface, and the frontend (detail view + live status).

> The engine lives in `packages/lib/src/data-connectors` (server-only barrel `@auxx/lib/data-connectors`). The provider-agnostic orchestration shell it runs on lives in `packages/lib/src/sync-core` (`@auxx/lib/sync-core`) — a shared spine intended for both data-connectors and channel (Gmail/Outlook) sync. Entity definitions, instances, and field values are downstream and documented here only where connectors touch them.
>
> **History & rationale** (locked design decisions, phasing, alternatives considered) live in the planning docs under `plans/data-connectors/` — the master index is `plans/data-connectors/claude-data-connectors-plan.md`; the large-dataset/sliced-sync design is `plans/data-connectors/v3/` (incl. `shared-sync-core-plan.md`), and `plans/data-connectors/claude/HANDOFF.md` records what landed. This guide is the durable as-built overview; the plans are the deeper "why".

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [The Mental Model](#2-the-mental-model)
3. [Backend: Data Model](#3-backend-data-model)
4. [Backend: Connectors (the fetch contract)](#4-backend-connectors-the-fetch-contract)
5. [Backend: Pagination](#5-backend-pagination)
6. [Backend: The Mapping Layer](#6-backend-the-mapping-layer)
7. [Backend: The Entity Sink](#7-backend-the-entity-sink)
8. [Backend: Sync-Core (the shared orchestration shell)](#8-backend-sync-core-the-shared-orchestration-shell)
9. [Backend: Sliced Sync Orchestration](#9-backend-sliced-sync-orchestration)
10. [Backend: Webhooks](#10-backend-webhooks)
11. [Backend: Async Bulk Export](#11-backend-async-bulk-export)
12. [Backend: Queues, Scheduling & Workers](#12-backend-queues-scheduling--workers)
13. [Write Semantics: Modes, Identity, Merge](#13-write-semantics-modes-identity-merge)
14. [tRPC Surface](#14-trpc-surface)
15. [Frontend: Pages, Components, Flows & Live Status](#15-frontend-pages-components-flows--live-status)
16. [Cross-Cutting: Flags, Tiers, App Wiring](#16-cross-cutting-flags-tiers-app-wiring)
17. [End-to-End Flows](#17-end-to-end-flows)
18. [Invariants & Gotchas](#18-invariants--gotchas)
19. [Known Gaps](#19-known-gaps)

---

## 1. Executive Overview

A **DataConnector** is an org-owned definition of *where structured records come from and how to keep them in sync as entity records*. It runs on a schedule/trigger, pulls records from an external provider, and writes them as **EntityInstances + FieldValues** — create-or-update, idempotent, reconcilable.

It is the structured-data sibling of **Knowledge Sources**: where a `KnowledgeSource` files external *content* as Articles in a hidden KB, a `DataConnector` files external *records* as entities in a normal, sidebar-visible definition. The two share a deliberately connector/sink-agnostic spine — the orchestrator never branches on provider.

**Positioning — sync-to-store, not fetch-live.** This feature deliberately *replicates* external records into the entity tables on a schedule, so they can be filtered, segmented, related, reported on, and retrieved by agents with low latency. It is complementary to, not a replacement for, the live app-tool path (an agent calling `get_order` mid-conversation). Rule of thumb: **sync** when data is browsed/filtered/related/reported on; **live tool** when it's a one-off real-time lookup.

Four defining decisions:
- **Target is a choice, not forced.** A mapping either provisions and owns a definition ("Shopify Orders") or contributes into an existing one (including system `contact`/`ticket`).
- **One fetch fans out to N mappings.** A connector yields one source schema per stream; the org configures N `DataConnectorMapping` rows that each extract a subtree onto a target def, with relationships derived from the schema tree.
- **The entity sink is the only writer.** Whether a connector runs as built-in lib code or in an app sandbox, all entity writes happen platform-side through `UnifiedCrudHandler`, firing entity events so workflows/agents react.
- **Sync is sliced and resumable.** A connector doesn't fetch everything in one worker tick. A sync runs as a **chain of bounded slices** over a shared orchestration shell (`@auxx/lib/sync-core`): each slice fetches a few pages, sinks them, checkpoints an opaque cursor, and re-enqueues the next slice. Large datasets (5000+ records) sync without holding a lock for minutes, and a crashed worker resumes from the last checkpoint, never page 1.

---

## 2. The Mental Model

```
DataConnector ──references──▶ Credential (the same connection an app's OAuth flow minted)
      │ sync run (scheduled / manual / webhook)  →  DataConnectorRun (health ledger, one per run)
      ▼
 startConnectorSync — claim, provision schema, pin mapping snapshot, enqueue first slice per stream
      │
      ▼  (per stream, a CHAIN of bounded slice jobs)
 runBackfillSlice ─▶ runSyncSlice (sync-core) ─▶ ConnectorStreamSyncSource.fetchSlice
      │   connectorFor(type) ──┬─ built-in lib connector (generic-rest, fixture) ──▶ fetch pages directly
      │                        └─ app connector (defineDataConnector — Shopify) ──▶ sandbox fetch, page-per-execute
      │   yields ConnectorYield = ConnectorRecord { streamKey, fields (RAW), externalId?, deleted? }
      │                        | ConnectorCheckpoint { cursor?, watermark }  (resume point, per page)
      ▼
 mapping layer (mapRecord, via sinkSourceRecord) — one record fans out to N DataConnectorMapping rows
      │  per mapping: extract rootPath subtree → eval CALC field mappings → upsert | reference
      ▼
 entitySink (platform-side — the ONLY entity writer)
      │  resolve identity:  DataConnectorItem exact bind (per mapping)  →  else identityStrategy bootstrap  →  create + bind
      │  per-field merge strategy; content-hash skip; fire entity events
      ▼
 EntityInstance + FieldValue              DataConnectorItem (durable upstream↔instance binding, per mapping)
      │  owned        → connector-provisioned def, row provenance set, orphan-archive OK
      │  contributing → existing def (contact/ticket/custom), per-field ownership, never archive
      │
      ▼  after each slice: checkpoint cursor + watermark onto DataConnectorStream.state (resume here on crash)
      ▼  when backfill exhausts (last stream): finalizeBackfill → reconciliation + relationship pass, then flip to steady
```

Key distinctions:
- A **connector** says only how to *fetch + normalize to a source schema*, **one page at a time**.
- A **`DataConnectorMapping`** is org config mapping a subtree of that schema onto a target def (the fan-out).
- An **EntityDefinition** is the target — owned, or merely contributed-to.
- An **EntityInstance** is one synced record (in contributing mode, co-owned field-by-field by several connectors + the helpdesk).
- A **`DataConnectorItem`** binds one upstream record (per mapping) to one instance and is the authoritative match key in steady state.
- A **slice** is one bounded unit of work (a few pages) in a continuation chain; a **phase** is `backfill` (initial full crawl) or `steady` (incremental deltas).

---

## 3. Backend: Data Model

**Location:** `packages/database/src/db/schema/data-connector*.ts`. Canonical TS types for the jsonb columns live in `packages/lib/src/data-connectors/types.ts`; the DB package carries structural mirrors in `data-connector-types.ts` (tier 1 can't import `@auxx/lib`) — kept in sync by hand.

Five control tables:

| Table | File | Role |
|-------|------|------|
| `DataConnector` | `data-connector.ts` | The connector definition: `type`, `config` (jsonb — generic-rest `endpoint` + filters + `backfillWindowSpan` + `webhookTrigger` SIGNAL), bound `credentialId`, `syncBehavior` + `scheduleConfig`, `status`, `itemCount`, `lastSyncedAt`, `error`. One per type per org (v1). |
| `DataConnectorStream` | `data-connector-stream.ts` | One fetch = one source schema. Holds `streamKey` (nullable — a draft is created blank and named inline), `requestConfig` (jsonb), `sourceSchema` + `schemaSource` (`catalog`/`inferred`/`manual`), `syncMode` (`snapshot`/`incremental`/`webhook`), and **`state`** (jsonb `ConnectorStreamState` — the durable per-stream sync state: phase, backfill cursor, watermark, recordsSeen). |
| `DataConnectorMapping` | `data-connector-mapping.ts` | The fan-out. Self-FK `parentMappingId` for nested subtrees; `rootPath`, `targetMode` (owned/contributing), `linkMode` (upsert/reference), `entityDefinitionId`, `fieldMappings` (jsonb array of entries), identity config. |
| `DataConnectorItem` | `data-connector-item.ts` | Durable upstream↔instance binding, **per mapping**. Unique `(dataConnectorId, mappingId, externalId)`. Carries content hash + cursor state + `lastSeenRunId` (drives orphan reconciliation) off the entity row. |
| `DataConnectorRun` | `data-connector-run.ts` | Health/run ledger, **one per sync** (the whole slice chain folds into it). Carries `trigger`, `mode`, `status` (`running`/`completed`/`partial`/`failed`), engine-managed `phase` (`backfill`/`steady`), per-category counts (`created`/`updated`/`skipped`/`archived`/`deleted`/`failed`/`relationshipWarnings`), `pagesProcessed`, `rateLimitWaitMs`, a `progress` jsonb snapshot for the live status line, `startedAt`/`heartbeatAt`/`finishedAt`. |

Plus: `dataConnectorStatus` + `dataConnectorSyncBehavior` pgEnums in `_shared.ts`; a nullable `dataConnectorId` FK on `custom-field.ts` and `entity-definition.ts` (marks connector-provisioned schema).

**`ConnectorStreamState` (per stream, jsonb `DataConnectorStream.state`)** — the durable sync state the slice chain checkpoints into:
- `phase`: `'backfill' | 'steady'` — engine-managed lifecycle.
- `backfillCursor`: a structured `SyncCursor` (opaque, never lossy) — checkpointed after **every committed slice**.
- `backfillStartedAt` / `backfillFloor`: when the current backfill chain began, and the already-formatted window-floor value injected on every page of a snapshot crawl (pinned once when backfill resets).
- `watermark`: steady-phase delta floor; the source returns a monotonic max each slice.
- `recordsSeen`: running total for the progress UI.
- `cursor` / `backfillComplete`: legacy single-shot incremental cursor + terminal marker.

**`DataConnectorRun.heartbeatAt`** keys stale-run detection (`sweepStaleConnectorRuns`), **not** `startedAt` — a long, healthy slice chain bumps the heartbeat each slice so it isn't swept.

**Provenance.** Owned mode sets `integrationSource = connectorId` on created instances; contributing mode leaves `integrationSource` untouched (so it never collides with another integration or breaks `findByIntegrationId`). The authoritative match key is always the `DataConnectorItem` row, not `integrationSource`.

**`requestConfig` (per stream, generic-rest):** `{ path?, method?, params?, body?, headers?, pagination?, incremental?, backfillWindow?, webhookTrigger? }` (the last is the per-stream webhook STEERING — §10). **`config.endpoint` (per connector, generic-rest):** `{ baseUrl, auth?, pagination?, headers?, rateLimit? }`. At fetch time headers merge low→high: `Accept` < `endpoint.headers` (shared) < `requestConfig.headers` (per-stream) < credential auth (applied by the HTTP transport).

---

## 4. Backend: Connectors (the fetch contract)

**Location:** `packages/lib/src/data-connectors/connectors/`.

A connector's only job is to fetch and yield records normalized to a source schema, **one page at a time, with a resume cursor between pages**. The contract (`types.ts`):

```ts
interface ConnectorRecord {
  streamKey: string
  fields: unknown          // the RAW payload (array OR object) — the source schema mirrors this
  externalId?: string      // optional hint, used only for a whole-record root the subtree can't self-identify
  displayName?: string
  deleted?: boolean         // tombstone — sink archives every projected binding
  contentHash?: string      // optional; sink computes a sorted-key hash if absent
}

interface ConnectorCheckpoint {
  __checkpoint: true        // discriminant
  cursor?: SyncCursor       // resume the NEXT page from here; absent ⇒ this was the last page
  watermark?: string        // max watermark observed through this page
}

type ConnectorYield = ConnectorRecord | ConnectorCheckpoint   // isConnectorCheckpoint() narrows

interface FetchResult {
  records: AsyncIterable<ConnectorYield>   // lazy — records interleaved with per-page checkpoints
  nextState: ConnectorStreamState          // the state to persist after this fetch
}

interface DataConnectorDefinition {
  type: string
  schemaVersion?: string
  requestModel?: 'builder' | 'fixed'       // how the request is authored (default 'builder')
  streams: ConnectorStreamDecl[]
  fetch(args: ConnectorFetchArgs): Promise<FetchResult>
  asyncExport?: AsyncExportCapability       // optional bulk-export (rate-limit-exempt big reads)
  resolveDelete?(event): ...                // map a delete signal to externalIds to archive
}
```

`fetch` receives `ConnectorFetchArgs`: `{ streamKey, mode: 'snapshot' | 'incremental', state: ConnectorStreamState, credential, config, requestConfig?, triggerContext?, rateLimitOverride?, onPageMeta? }`. The sliced `SyncSource` sets `rateLimitOverride: { maxRetries: 0 }` so the throttle returns immediately (slicing owns the backoff, not the transport). `onPageMeta` lets the UI test-fetch surface `link-header` pagination from response headers. `triggerContext` is the resolved `{path}` → value map a **webhook-steered** fetch injects into path/params/headers/body (§10).

`connectorFor(type, context?)` (`connectors/registry.ts`) is the single resolution point. Connector flavors:

- **Built-in lib connectors** read the resolved credential directly, no sandbox:
  - `generic-rest.ts` — no-code HTTP/JSON connector. Reads `config.endpoint` + per-stream `requestConfig`, paginates over six strategies (§5), injects steady-mode watermark filters and backfill-window floors, and **yields the raw response body per page** (`fields: body`) interleaved with a `ConnectorCheckpoint` after each page. Supports both timestamp-filter and event-feed incremental modes.
  - `fixture.ts` — dependency-free fixture used to prove the spine in tests.
- **App connectors** (`app-connector-adapter.ts`) — declared in an app's SDK via `defineDataConnector` (`@auxx/sdk/data-connectors`). The adapter resolves the installed app's catalog connector and, inside `fetch()`, **lazy-imports** the app-runtime cluster (`@auxx/lib/apps`), resolves the borrowed connection (with lazy-refresh), and **drives a page-per-`execute` loop** against the sandbox via the lambda executor (`apps/lambda/src/executors/data-connector-executor.ts`). See §5 for the loop. Cursor translation between the engine's opaque `SyncCursor` and the app's flat cursor lives in `app-connector-state.ts`.
  - `ConnectorRateLimitError` (extends the shared `RateLimitError`, carries `retryAfterMs?`) is thrown by either flavor; the slice loop maps it to a held-cursor / retriable slice outcome.
- **Templates** (`templates/`) — `connector-template-registry.ts` + `defs/` seed a generic-rest connector pre-wired with an endpoint, streams, and recommended field mappings (target entity def + field refs). Contributing-only in v1.

**Source schema invariant:** `sourceSchema` describes `ConnectorRecord.fields` (the raw payload). For a collection response (`[ {…} ]`) the root is an `array`; the root mapping's `rootPath` (`[]`, `data.orders[]`, or `''` for a single record) selects record subtrees. Child mappings extract relative to their parent subtree.

---

## 5. Backend: Pagination

Pagination is first-class on both connector flavors. The engine never interprets a cursor — it stores the opaque `SyncCursor` (`{ kind, value }`, where `kind` is advisory only) and hands it back on the next slice. Each page emits a `ConnectorCheckpoint`, so the slice runner can checkpoint **after every page** and resume mid-stream.

**Generic-REST — six strategies** (`PaginationSpec.kind`, in `types.ts`; the tRPC `paginationSchema` mirrors it field-for-field):

| `kind` | Resume token | Detection / config | Example |
|--------|--------------|--------------------|---------|
| `cursor` | body field or last-record field | `cursorPath` (in body) or `cursorFrom: 'lastRecord'` + `cursorRecordField` | Stripe (cursor in body), Shopify (cursor on last record) |
| `page` | page number (0-indexed) | `pageParam` increments | simple sequential pages |
| `offset` | computed offset | `pageParam` + `pageSize`, `offsetBase: 0 | 1` | QuickBooks (1-based offset) |
| `link-header` | absolute URL | HTTP `Link: <url>; rel="next"` | standard REST hypermedia |
| `next-url` | relative/absolute URL | `nextUrlPath` in body | Salesforce `nextRecordsUrl` |
| `none` | — | — | single-page endpoint |

`recordsPath` is the dotted path to the record array; `hasMorePath` is a body boolean that short-circuits the loop. The generic-rest fetch loop seeds from the persisted `backfillCursor` (backfill) or starts fresh (incremental), injects the watermark filter (`incremental.sinceParam`) on steady runs and the pinned backfill-window floor on every page of a snapshot crawl, yields the raw body, extracts the next token per kind, and emits a checkpoint. It stops on `hasMore: false`, no next token, or an empty page.

**Incremental (`StreamIncrementalConfig`)** has two shapes: `timestamp` (default — filter on `updated_at >= watermark` via `sinceParam`, track max via `watermarkField`) and `event-feed` (poll a provider event log like Stripe `/v1/events`; classify deletes via `deleteEventTypes`, dereference the object via `objectPath`). Watermark helpers (`isNumericWatermark`, `maxWatermark`) live in `watermark.ts`.

**App connectors — platform-driven page loop.** The app author returns **one page per `execute`**, not the whole dataset. The adapter loops:
1. Decode the engine's `SyncCursor` to the app's flat cursor (`decodeCursor`, in `app-connector-state.ts` — tolerant of malformed/legacy values, never fails a live sync).
2. Invoke the sandbox `execute({ streamKey, mode, state: { cursor, updatedSince }, connection, config })` via the lambda executor (records materialized, capped defensively at 5000/page).
3. The app returns `{ records, nextState: { cursor?, updatedSince?, backfillComplete? } }`.
4. Yield the records, then emit a `ConnectorCheckpoint`: a non-terminal page carries `{ cursor: encodeCursor(nextState.cursor), watermark }`; a terminal page (`backfillComplete: true` **or** a null/missing cursor) carries `{ watermark }` with no cursor.
5. Repeat until terminal.

`encodeCursor`/`decodeCursor` keep the app's token opaque to the engine — always `kind: 'token'`, `value` a JSON string. The SDK contract (`define-data-connector.ts` JSDoc, `ConnectorStreamState`/`ConnectorFetchResult` in `packages/sdk/src/root/data-connectors/types.ts`) tells authors: *"the platform loops `execute`, not the app — return ONE page plus `nextState.cursor`."* App-author and engine-side cursor translation is unit-tested in `app-connector-state.test.ts`; the loop + resume-across-slices in `app-connector-adapter.test.ts`.

---

## 6. Backend: The Mapping Layer

**Location:** `packages/lib/src/data-connectors/map-record.ts` (`mapRecord`); the per-record fan-out driver is `sink-source-record.ts` (`sinkSourceRecord`).

`mapRecord` is a recursive tree walk over the connector record + the mapping tree:
- The **root mapping** extracts its `rootPath` subtree(s) from the raw payload.
- Each **child mapping** extracts relative to its parent subtree (`parentMappingId` drives nesting).
- For each subtree it evaluates the mapping's `fieldMappings` — each entry is `{ id, targetFieldRef, expression, sourceFields, match?, mergeStrategy?, provision? }`. `targetFieldRef` is a canonical `ResourceFieldId` (`${entityDefinitionId}:${fieldId}`) or a `@app:`-prefixed connection-late-bound ref, nullable for an unassigned draft formula the runtime skips. CALC expressions evaluate against the subtree-relative `sourceFields`.
- Identity candidates are resolved **from the source subtree** (`connectorFieldKey` is subtree-relative) and stamped on the projected record, so the sink matches on real source values.
- `linkMode` decides upsert (write the instance) vs reference (id-only — wired later as a relationship). Cross-record references produce `pendingRelations { targetMappingId, externalId }`.

`sinkSourceRecord(ctx, mappings, source)` is what the slice loop calls per raw record: it runs `mapRecord`, handles tombstones (a `deleted` record archives every projected binding), indexes projected writes by `(mappingId, externalId)` so fan-out children attach their edges to the right parent instance, and writes **parents before children** so the parent exists when an edge resolves.

Path contract (enforced): `rootPath` is record-absolute; `sourceFields` paths and identity `connectorFieldKey` are subtree-relative to the mapping's `rootPath`; `externalId`/`displayName` are connector-derived sync-time lineage, never surfaced in the editor.

---

## 7. Backend: The Entity Sink

**Location:** `packages/lib/src/data-connectors/sinks/entity-sink.ts`. This is the **only** code path that writes entities for connectors.

Per projected record, the sink:
1. **Resolves identity.** First an exact `DataConnectorItem` bind (per mapping) → else runs the mapping's `identityStrategy` to bootstrap (`crud.lookupByField`, column-aware + normalizing) → else creates and binds a new `DataConnectorItem`.
2. **Content-hash skips.** Computes a sorted-key `stableHash` (`@auxx/utils/hash`) of the mapped values; if unchanged vs the bound item, it skips the write (idempotent re-sync). jsonb reorders keys, so naive `JSON.stringify` would false-stale — always the sorted-key hash.
3. **Applies per-field merge strategy** and writes through `UnifiedCrudHandler.create/update` (which coerces every value through the typed FieldValueService converters). Writes fire `entity.created/updated` events — connectors deliberately do **not** `skipEvents` (unlike the CSV importer) so workflows/agents react.
4. **Stamps `lastSeenRunId`** on the bound item, which drives orphan reconciliation (an item not seen this run is a candidate for archive in owned+snapshot mode).

Owned vs contributing behavior is enforced here (see §13).

---

## 8. Backend: Sync-Core (the shared orchestration shell)

**Location:** `packages/lib/src/sync-core/` (`@auxx/lib/sync-core`).

Sync-core is a **provider-agnostic, sink-agnostic orchestration shell** — the durable spine both data-connector sync and (eventually) channel (Gmail/Outlook) sync run on. It owns cursor-safety, checkpoint-after-slice, the backfill→steady transition, and run-ledger folding; it knows nothing about HTTP, entities, or any provider. Data-connectors is the first consumer; the channel side is planned but **not yet migrated** (`plans/data-connectors/v3/shared-sync-core-plan.md`).

Files:
- `contracts.ts` — pure interfaces (no runtime imports). The seam.
- `slice-runner.ts` — `runSyncSlice(args): Promise<SliceOutcome>`, the core orchestrator.
- `throttle.ts` — `createThrottleHandle(throttler, key)`, wrapping `UniversalThrottler` as a `ThrottleHandle`.
- `index.ts` — the public barrel.

Key contract types (`contracts.ts`):
- **`SyncPhase`** — `'backfill' | 'steady'`.
- **`SyncCursor`** — opaque pagination cursor `{ kind, value }`; `kind` (`'token' | 'nextUrl' | 'headerLocator' | 'offset' | 'pageNumber' | 'historyId' | 'deltaLink'`) is advisory for debugging/UX only — the core never interprets `value`.
- **`SliceBudget`** — `{ maxPages, maxRecords, maxMs }`. `maxMs` is wall-clock for **active** work (fetch + sink), not counting throttle waits; set well under the BullMQ `lockDuration`.
- **`SliceCommit`** — the cursor-safety verdict: `'all'` (clean — advance cursor), `'partial-retriable'` (transient 429/5xx/timeout — **hold** the cursor and re-fetch next slice), `'partial-permanent'` (poison records that will never parse — **advance** past them).
- **`SyncSliceCtx`** — what a slice receives: `{ phase, cursor?, watermark?, budget, throttle, signal }`.
- **`SliceResult`** — what a slice reports: `{ recordsProcessed, pagesProcessed?, rateLimitWaitMs?, nextCursor?, hasMore, watermark?, commit, counters? }` (`nextCursor` is ignored when `commit === 'partial-retriable'`; `watermark` must be ≥ the inbound one).
- **`SyncState`** — durable per-stream state `{ phase, cursor?, watermark?, recordsSeen?, backfillStartedAt?, throttle? }` (opaque to the core; persisted via the store).
- **`SyncSource`** — *the one interface each consumer implements*: `{ id, throttleKey, fetchSlice(ctx), finalizeBackfill?() }`. `finalizeBackfill` fires **once** when backfill exhausts (before the phase flip) — the data-connector side runs reconciliation + the relationship pass there.
- **`SyncStateStore`** — `{ load(), save(state) }` persistence seam.
- **`RunLedger`** — `{ recordSlice(entry), finalize(), fail(error) }`. `SliceLedgerEntry.checkpointKey` is an idempotency key (serialized post-slice cursor) so a BullMQ replay re-folds counts idempotently.
- **`ThrottleHandle`** — `{ run<T>(fn) }`, keyed by `connection:operation` for cross-source bucket sharing.

`runSyncSlice` loads durable state, builds the slice ctx, calls `source.fetchSlice`, enforces cursor-safety (advance unless `partial-retriable`), checkpoints **after** the slice, folds counters into the ledger, fires `finalizeBackfill` when backfill exhausts (before flipping to steady), and returns a directive: `reenqueue` | `complete` | `failed`.

---

## 9. Backend: Sliced Sync Orchestration

The data-connector orchestration entry points (`run-data-connector-sync.ts` is **gone** — replaced by this sliced model):

**`startConnectorSync(db, orgId, connectorId, { trigger })`** (`slice-orchestrator.ts`) — kicks off a sync:
1. Claim the connector (`claimForSync`), provision the target schema (`provisionConnectorMappings`).
2. Decide the phase (backfill on first run / after a reset; steady otherwise).
3. Open **one** `DataConnectorRun` (`openRun`); pin the mapping snapshot into `run.chainSnapshot` so mid-backfill edits can't skew later slices.
4. Seed the per-connector completion latch (`initConnectorBackfillLatch`) so the last stream to finish releases connector-level finalize atomically.
5. Enqueue the first slice job per enabled stream (`enqueueBackfillSlice`).

**`runBackfillSlice(db, { connectorId, organizationId, streamId, runId }, signal)`** (`slice-orchestrator.ts`) — the per-slice worker handler:
1. Load the run + pinned snapshot.
2. Build the data-connector `SyncSource` (`createConnectorStreamSyncSource`, in `connector-sync-source.ts`) plus the sync-core adapters (`sync-core-adapters.ts`): `createStreamSyncStateStore` (maps `DataConnectorStream.state` ↔ core `SyncState` via `syncStateFromStream`/`applySyncStateToStream`) and `createConnectorRunLedger` (folds counters into `DataConnectorRun`, dedupes by per-stream checkpoint key under `progress.checkpoints.<streamId>`).
3. Call **`runSyncSlice`** from sync-core.
4. Act on the directive: **`reenqueue`** → re-enqueue the next slice with a throttle-paced delay; **`complete`** → stream exhausted (on steady completion, `decrementConnectorBackfillLatch` gates connector-level `finalizeConnector`); **`failed`** → mark the run failed and release the claim.

**`ConnectorStreamSyncSource.fetchSlice`** (`connector-sync-source.ts`) orchestrates `definition.fetch → runConnectorSlice → sinkSourceRecord` for one bounded slice, returning a `SliceResult` (rate-limit → `partial-retriable` to hold the cursor; budget hit → `hasMore: true`). Its `finalizeBackfill`/finalize path runs **on the last stream only** (via the latch): `reconcileOrphans` (`reconciliation.ts` — archives owned+snapshot+upsert items absent from this run; incremental never archives on absence unless it's a reconciliation `sweep`) then `resolveRelationships` (`relationship-pass.ts` — resolves `pendingRelations` against `DataConnectorItem` binds into real `RELATIONSHIP` field values; unresolved bumps `relationshipWarnings`).

**`runConnectorSlice`** (`connector-slice-loop.ts`) is the pure inner loop: drain one page iterable, sink each mapped record, stop at **page (checkpoint) boundaries** — never mid-page, never sleeping on throttle. On `ConnectorRateLimitError`: if it made progress (>0 pages) it commits `all` (advance — the next slice re-hits the limit after backoff); if zero progress (throttled on the first page) it commits `partial-retriable` (hold the cursor). It injects a `now()` clock for budget tracking.

The `sampleConnectorFetch` helper (`connector-runtime.ts`, with `prepareConnectorFetch`/`resolveConnectorCredential`) reuses the exact fetch path for the UI test-fetch, stopping at the first raw page — so test-fetch and scheduled sync can't diverge on auth or shape.

---

## 10. Backend: Webhooks (v7 — signal + steering)

**Location:** `packages/lib/src/data-connectors/connector-webhook.ts` (`runWebhookEventSlice`) + `webhook-steer.ts` (pure steer resolution) + the dispatch jobs in `packages/lib/src/jobs/data-connector/` (`app-trigger-sync-dispatch-job.ts`, `webhook-endpoint-sync-dispatch-job.ts`, `app-trigger-sync-stream-job.ts`). The generic inbound endpoint table is `packages/database/src/db/schema/webhook-endpoint.ts`. Webhooks are **live**.

> **This whole subsystem was rebuilt.** The old per-provider `WebhookCapability` model — `webhooks/{shopify,stripe,fixture,registry}.ts`, `resolveWebhookCapability`, `DataConnectorDefinition.webhook`, `registerConnectorWebhooks`/`unregisterConnectorWebhooks`, `ConnectorWebhookState`, `WebhookAction`s, the `CONNECTOR_WEBHOOK_JOB` + `runConnectorWebhook`/`applyWebhookActions` action-sink — **is all gone** (retired in #962, redesigned in v6/v7). Connectors no longer register topics with a provider or carry a capability driver; they **bind a pre-existing webhook signal** and **steer the regular fetch** off the delivery. Plans: `plans/data-connectors/v6/` (generic webhooks + unified trigger picker) and `plans/data-connectors/v7/webhook-connections-redesign.md`.

The v7 model splits webhook mechanics into two layers:

**1. Signal (connector-level, one per connector) — which inbound event drives this connector.** Stored on `DataConnector.config.webhookTrigger` (`{ triggerId?, webhookEndpointId? }`, exactly one set). A connector binds a single credential/baseUrl = one provider, so every stream shares the same signal; only the steering differs per stream. Two sources:
- `triggerId` — an **installed-app** webhook trigger (Shopify, Stripe, …), matched off the connector's app connection (`credentialId`).
- `webhookEndpointId` — a generic, app-less **`WebhookEndpoint`** (the platform's provider-agnostic inbound URL — `POST /webhooks/endpoint/{id}`, built-in `none`/`token`/`hmac` verification, optional topic extraction). Matched by endpoint id alone — generic endpoints aren't connection-bound. Fetch auth still comes from the connector's own `credentialId`; the endpoint only carries the signal.

**2. Steering (per-stream) — how a matched delivery guides this stream's fetch.** Stored on `DataConnectorStream.requestConfig.webhookTrigger` (`StreamWebhookTrigger`, generic-REST only): `filter` (topic discrimination via the same `matchesFilter` the agent/workflow app-trigger path uses — flagship apps multiplex many topics through one `triggerId`, e.g. Shopify's 22 topics on `triggerData.topic`), `paths` (payload paths exposed as `{path}` placeholders), `deleteWhen` + `deleteExternalIdPath` (delete predicate + id to archive), `resultShape` (`single`/`collection`). The principle: **the webhook is the signal; the fetch is the truth** — a delivery never gets sunk raw; it steers the canonical fetch.

**Ingress → dispatch → stream (three thin layers):**
1. A verified delivery (`apps/api` webhook route) fans out on `appTriggerQueue` to three sibling consumers — workflows, agents, and **connectors**. The connector leg is `dispatchAppTriggerToConnectors` (app triggers, matched by `credentialId` + `config.webhookTrigger.triggerId`) or `dispatchWebhookEndpointToConnectors` (generic endpoints, matched by `config.webhookTrigger.webhookEndpointId`).
2. The dispatch job is **thin**: dedup (event-id), find matching connectors, filter each connector's webhook-bound streams by `matchesFilter(webhookTrigger.filter, triggerData)`, and enqueue **one `app-trigger-sync-stream` child job per matched (connector, stream)** — the shared child for both signal sources. (Splitting dispatch from execution keeps dedup-under-retry from self-suppressing the fetch.)
3. The child runs **`runWebhookEventSlice`** (`connector-webhook.ts`): `resolveWebhookSteer(webhookTrigger, triggerData)` decides delete-vs-fetch. A **delete** archives by `deleteExternalIdPath` (`archiveExternalId`). Otherwise it runs the **normal `definition.fetch`** seeded with `triggerContext` (the resolved `{path}` values) — identical auth/baseUrl/pagination/mappings to a bulk sync — and sinks the fetch result through the **same `sinkSourceRecord` → entity-sink path**.

**A webhook is a POINT WRITE, not a run.** `runWebhookEventSlice` opens **no `DataConnectorRun`** (synthetic `runId = app-webhook:<eventId>`), never stamps `lastSeenRunId` or advances the watermark/cursor (that would skew orphan reconciliation and the steady delta floor), and stamps `lastWebhookEventAt` (`stampWebhookEvent`) for liveness — the only "synced" signal a pure-webhook connector has. Idempotent via the receiver's event-id dedup + the sink's content-hash skip. A throttle surfaces as `ConnectorRateLimitError` (fetch sets `maxRetries: 0`); the child job re-enqueues with the provider `Retry-After` and dead-letters after exhausting retries. Steer resolution is unit-tested in `webhook-steer.test.ts`; dispatch in `{app-trigger,webhook-endpoint}-sync-dispatch-job.test.ts`.

`dataConnectorSyncBehavior = 'webhook'` still selects webhook-driven sync (it gates which connectors a dispatch even considers). UI: `webhook-signal-section.tsx` (connector-level signal picker — app trigger vs endpoint) + `webhook-steering-section.tsx` (per-stream topic/path/delete steering) — the old signing-secret/URL gap is closed.

---

## 11. Backend: Async Bulk Export

**Location:** `packages/lib/src/data-connectors/async-export/`.

Some providers (Shopify Bulk Operations, Salesforce Bulk API 2.0) don't paginate large reads — you submit a query, they run it **async** server-side, and hand back a single result file. This is modeled as an optional connector capability (`DataConnectorDefinition.asyncExport: AsyncExportCapability`) whose "slice" is a **phase of the job** (`init → poll → download`), not a page — so polling re-enqueues a continuation slice instead of blocking a worker lock for minutes.

- `AsyncExportDriver` (the one provider-specific piece): `initiate() → { handle }`, `poll(handle) → AsyncExportStatus`, `download(url) → AsyncIterable<ConnectorRecord>` (lazy, already restitched).
- The state machine (`slice-loop.ts`, `runAsyncExportSlice`), the `__parentId` restitch helper (`restitch.ts`, `restitchByParentId` — re-nests flat JSONL into record subtrees), and the cursor codec (`encodeAsyncCursor`/`decodeAsyncCursor`, riding the core's opaque `SyncCursor`) are all provider-neutral.
- Tuning: capped exponential poll backoff (`POLL_BASE_MS` 5s → `POLL_MAX_MS` 60s), `MAX_REINITIATE` 3 for a FAILED/EXPIRED job (result URLs expire on a 7-day deadline).

---

## 12. Backend: Queues, Scheduling & Workers

- **Queue (sync):** `data-connector-queue.ts` — `dataConnectorQueue` carries the **sync** jobs: `data-connector-sync` (`enqueueConnectorSync` — kicks off `startConnectorSync`), `data-connector-sweep` (the nightly reconciling re-crawl), and `data-connector-backfill-slice` (`enqueueBackfillSlice` — one continuation slice → `runBackfillSlice`). **Webhook ingestion does NOT run here** — it rides `appTriggerQueue` (below), since v7 made it a leg of the unified app-trigger / WebhookEndpoint fan-out (§10).
- **Queue (webhook):** `appTriggerQueue` carries the connector webhook jobs alongside the workflow/agent legs: the dispatch jobs `dispatchAppTriggerToConnectors` / `dispatchWebhookEndpointToConnectors` (thin match + fan-out) and the shared child `app-trigger-sync-stream` (`runConnectorAppTriggerStream` → `runWebhookEventSlice`). Registered in `apps/worker/src/workers/worker-definitions/app-trigger-worker.ts`; ingress fans out from `apps/api/src/routes/webhooks.ts`.
- **Scheduler:** `data-connector-scheduler.ts` — `reconcileConnectorSchedulers` / `syncConnectorScheduler` / `removeConnectorScheduler`, driven by the connector's `ScheduledTriggerConfig` (shared agent/workflow frequency model). Plus `syncConnectorSweepScheduler` — a periodic full reconciliation re-crawl (`trigger: 'sweep'`) that *does* archive incremental orphans (the only time incremental reconciles on absence).
- **Worker:** `apps/worker/src/workers/worker-definitions/data-connector-worker.ts`, bound to the sync queue (cancellable). It dispatches `data-connector-sync` / `data-connector-sweep` / `data-connector-backfill-slice` to `startConnectorSync` / `runBackfillSlice`. `reconcileConnectorSchedulers` runs on worker boot. (Webhook child jobs are handled by the app-trigger worker above.)
- **Stale-run sweep:** `sweepStaleConnectorRuns` (gated by `STALE_RUN_MS`) fails runs whose `heartbeatAt` has gone cold (a slice chain that died without re-enqueuing), releasing the connector claim. `SLICE_BUDGET` + `SLICE_LOCK_DURATION_MS` bound one slice's work vs the BullMQ lock.

---

## 13. Write Semantics: Modes, Identity, Merge

**Two write modes, per mapping:**
- **Owned** — provision and own a definition (custom fields default to `FieldType.TEXT`, `isUpdatable:false` so users can't hand-edit synced fields). Row provenance set; orphan archive allowed (via reconciliation, owned+snapshot+upsert only).
- **Contributing** — write into an existing def (system `contact`/`company`/`ticket` or any custom def). Per-**field** ownership; never archives the instance (other owners share it). Editable shared fields are protected per-record by the `fill_blank` merge strategy. "Detach" is an explicit settings action — there's no separate freeze mechanism; it's all field capabilities.

**Identity strategies** (first-class union, bootstrap-only — `DataConnectorItem` is steady state): `connectorExternalId` | `matchField` | `composite` | `manualReview`. `matchField`/`composite` carry `connectorFieldKey` (subtree-relative source path) → `targetFieldId`.

**Merge strategies** (`FieldMergeStrategy`, first-class per-field): `overwrite` | `fill_blank` | `connector_owned_only` | `manual_review` | `ignore`. Conservative defaults on shared CRM data; these govern only how the *connector* writes — user read-only is the `isUpdatable` field capability.

**Orphan behavior** (`OrphanBehavior`): reconciliation stamps `archivedAt` on owned+snapshot+upsert items absent from the run. Real deletes come only from explicit delete signals (`handleConnectorDelete` / a `deleted` tombstone record / a webhook delete action); `archiveExternalId` is the single-item archive primitive.

**Schema provisioning:** `provisioning.ts` provisions owned defs/fields and lazily provisions contributing targets (`provisionConnectorMappings`, `provisionTarget`, `backfillProvisionedFieldRefs`). Field mappings are stored as a jsonb **array of entries** (stable `id` per entry) — not a Record keyed by target — because jsonb reorders keys.

---

## 14. tRPC Surface

**Router:** `apps/web/src/server/api/routers/data-connectors.ts`, registered as `dataConnector` in `root.ts`. Reads are `protectedProcedure`; all management/provisioning/setup is `adminProcedure`. Procedures:

- **Reads (`protectedProcedure`):** `list`, `catalog` (app/template discovery), `connectorSchema` (app/template config JSON-schema), `getById`, **`getStatus`** (the live status feed — connector status, `lastSyncedAt`, `itemCount`, `nextSyncAt`/`cadenceLabel`, the latest run with `phase`/counts/`rateLimitedUntil`/`primaryStreamLabel`, and **per-stream** `recordsSeen`/`phase`/`done`), `listRuns`, `listStreams` (streams carry their mapping rows nested).
- **Connector CRUD (`adminProcedure`):** `create` (incl. `createConnectorFromAppCatalog` / `createConnectorFromTemplate`), `update`, `delete` (with keep/archive/delete-synced-records behavior), **`syncNow`** (enqueue a manual sync), **`provision`** (provision target schema on demand).
- **Setup (`adminProcedure`):** `sampleFetch` (real fetch path, one page — the test-fetch; returns `{ response, recordCount }`), **`suggestMappings`** (auto-suggest field mappings from a sample), `addStream` / `setStreamSchema` / `setStreamRequestConfig` / `updateStream` / `removeStream`, `addMapping` / `updateMapping` / `removeMapping`.

The tRPC `paginationSchema` is a faithful mirror of the engine `PaginationSpec` — keep it in sync field-for-field or a detected (Stripe/Salesforce-shaped) spec silently loses its enriched cursor/next-url fields.

Write helpers live in `packages/lib/src/data-connectors/mutations.ts`; reads/CRUD in `service.ts` (functional Drizzle + neverthrow, no model classes).

---

## 15. Frontend: Pages, Components, Flows & Live Status

**Routes:** `apps/web/src/app/(protected)/app/connectors/page.tsx` (list) + `[connectorId]/page.tsx` (detail). Menu entry: Connectors in the Resources group (`adminOnly`, `featureKey: 'dataConnectors'`, `Cable` icon).

**Components:** `apps/web/src/components/data-connectors/{ui,hooks,lib}`. Single setup-and-edit detail view (no wizard), modeled on the agent detail page — NavStack scroll-spy sections + a connector-wide save bar, with a docked right **Runs panel** (desktop) / tab (mobile).

**Live status (Step 9 — the headline frontend addition):**
- `lib/resolve-sync-status.ts` — a **pure, client-safe** resolver. `resolveSyncStatus(input, now?)` maps raw connector lifecycle status + the latest run onto a freshness-first vocabulary: `SyncStatusState` = `synced | syncing | rate-limited | paused | action-needed | error | idle`, plus a `label`, a relative-time-free `detail` line, an optional `countdownUntil` (rate-limit self-heal countdown), and a `primaryAction` (`sync | pause | resume | reconnect | retry`). It classifies an `error` status into auth-class `action-needed`/`reconnect` vs generic `error`/`retry` (`classifyConnectorError`), and reads `latestRun.rateLimitedUntil` to surface `rate-limited` (a no-CTA state — it self-heals).
- `ui/connector-status.tsx` — the status enums + metadata: `ConnectorStatus` (`pending | provisioning | syncing | live | error | paused`) and `RunStatus` (`running | completed | partial | failed`), their `CONNECTOR_STATUS_META` / `RUN_STATUS_META` (label/icon/color, `active` flag driving the 4s poll), normalizers `asConnectorStatus`/`asRunStatus`, and the `ConnectorStatusDot` / `ConnectorStatusPill` (spinning icon while syncing) presenters.
- `ui/connector-runs-panel.tsx` — the docked Runs panel: polls `getStatus` + `listRuns` every 4s **while syncing** (Knowledge-Sources cadence). Shows a **live backfill card** (per-stream `recordsSeen`, only while `latestRun.phase === 'backfill'`), a **steady freshness panel** once synced and not mid-backfill, and a run history (up to ~50) with per-run `CountChip`s (created/updated/skipped/archived/deleted/failed), relationship warnings, durations, trigger/mode, and an expandable error sample.
- `ui/connector-detail-view.tsx` — the detail shell. Renders the `ConnectorStatusPill` (calls `resolveSyncStatus` with the live run), header actions (Sync now, Reconnect when `action-needed`, Pause/Resume, Delete-with-options), polls `getStatus` every 4s while syncing (shared query key with the Runs panel), and normalizes `latestRun.status` via `asRunStatus()` once for both the resolver and the status line.

**Other key UI files (`ui/`):**
- `connector-list.tsx`, `connector-card.tsx` (the grid row: status dot, last-synced, record/stream counts, and an Open / Sync now / Pause·Resume / Delete-with-options menu — the same keep·archive·delete submenu as the detail view), `connector-detail-tabs.tsx` (NavStack + `useScrollSpy`).
- `connection-section.tsx` — the bound `Credential` (a `ConnectionRow` + connection picker); resolves the connection's brand icon + name.
- `source-config-panel.tsx` — connector-level config: generic-rest endpoint (base URL + shared headers, via the reveal-chip pattern) or an app/template schema-driven form.
- `streams-section.tsx`, `stream-detail-bar.tsx`, `stream-config-panel.tsx` — the per-stream drill: Layer A (source schema) + Layer B (fan-out mappings). Request sub-editors (headers/query params/JSON body) are in `request-editors.tsx`; pagination + incremental config surface here too.
- `mapping-tree.tsx`, `mapping-node.tsx`, `branch-row.tsx`, `mapping-field-picker.tsx`, `source-leaf-row.tsx`, `source-path-badge.tsx` — the fan-out tree + humanized field picker.
- `field-calc-dialog.tsx` — the `ƒ` calc drill (focused editor over `@auxx/utils/calc-expression`).
- `merge-strategy-toggle.tsx`, `field-type-compat.ts`, `mapping-columns.ts`.
- `schedule-section.tsx`, `connector-save-bar.tsx`, `stream-sample.tsx`.

**Hooks (`hooks/`):** `use-connector-mutations.ts`, `use-stream-mutations.ts` (optimistic stream/mapping mutations), `use-buffered-config.ts` (manual/auto-commit draft buffer), `use-connector-edits.tsx` (the save-bar registry), `use-source-paths.ts` (`flattenSourceSchema` + subtree-relative `leafPathsUnder`).

**Shared extractions** (used by workflow/MCP/connectors): the HTTP request builder (`components/global/http-request/`), the schedule editors (`components/global/schedule/`), the schema form (`components/global/schema-form/`), the shared schema editor (`components/schema-editor/`), and `useScrollSpy`.

---

## 16. Cross-Cutting: Flags, Tiers, App Wiring

- **Feature flag:** `dataConnectors` in `FeatureKey` + `FEATURE_REGISTRY` (`packages/lib/src/permissions/types.ts`), seeded as a boolean gate (all tiers).
- **Package tiers:** the engine + sync-core are entirely in `@auxx/lib` (tier 3). `@auxx/lib/sync-core` is pure contracts + the slice runner (no provider deps). The app-connector adapter invokes the lambda via the app-runtime cluster (`@auxx/lib/apps`) — **lazy-imported** to keep billing/dist out of vitest. The `@auxx/lib/data-connectors` barrel is server-only — never import it from client code (the frontend status types in `connector-status.tsx`/`resolve-sync-status.ts` are deliberately self-contained, no lib import).
- **SDK:** `packages/sdk/src/root/data-connectors/` (`defineDataConnector`), exported at `@auxx/sdk/data-connectors`. App catalogs serialize `app.dataConnectors` → `AppDeployment.catalog.dataConnectors`, projected onto the `installedApps` org-cache key for bundle-free discovery. The SDK page-per-`execute` pagination contract lives in its JSDoc + `ConnectorStreamState`/`ConnectorFetchResult`/`ConnectorExecuteArgs` types.
- **App-token refresh:** a connector borrowing an app's OAuth credential relies on lazy-refresh on the shared `Credential` (resolve → refresh if expired → 401-retry).

---

## 17. End-to-End Flows

**Generic-REST, owned mode (the spine):**
1. Create a generic-rest connector; set `endpoint.baseUrl` (+ optional shared headers, pagination) in `source-config-panel`.
2. Add a stream; in the stream drill set `requestConfig` (path/params/headers/pagination/incremental), run **test-fetch** (`sampleFetch`) → infer the source schema from the raw response.
3. Add a root mapping with `rootPath` selecting the records; one-click map source leaves onto an owned def (or `ƒ` calc). Set identity (default `connectorExternalId`).
4. Sync now → `startConnectorSync` opens a run + enqueues a slice chain → each `runBackfillSlice` paginates a few pages, sinks them, checkpoints the cursor, re-enqueues → on the last slice, reconciliation + relationship pass run, then the stream flips to `steady`. The live Runs panel shows per-stream `recordsSeen` climbing during backfill, then a freshness line. Re-sync is idempotent (content-hash skip) and incremental (watermark filter).

**Contributing into `contact`:** point a mapping at the system `contact` def, `targetMode: contributing`, identity `matchField` (`customer.email` → `email`, normalized). The sink upserts onto existing contacts per-field, never archiving them.

**App connector (Shopify):** the Shopify app (in the separate `auxxai-apps` repo) declares streams/targets via `defineDataConnector` and returns **one page per `execute`**; the adapter drives the page loop in the sandbox and emits checkpoints, riding the exact same slice → mapping → sink path. Orders/line-items as owned defs, customers contributing into `contact`. Large catalogs can use the async bulk-export capability (Shopify Bulk Ops) instead of pagination.

**Webhook-driven:** with `syncBehavior: 'webhook'`, the connector binds a **signal** (`config.webhookTrigger` — an app trigger or a generic `WebhookEndpoint`) and each stream declares **steering** (`requestConfig.webhookTrigger` — topic filter + `{path}` tokens + delete rule). A verified delivery → `dispatch*ToConnectors` (match by signal + per-stream `filter`) → `app-trigger-sync-stream` child → `runWebhookEventSlice`: the delivery steers the **normal fetch** (`triggerContext` tokens), and the fetch result rides the same mapping → sink path (near-real-time, no poll, no run — a point write). A delete event archives by externalId instead of fetching.

---

## 18. Invariants & Gotchas

- **The sink is the only entity writer.** Connectors fetch; the platform writes. Never write entities from a connector/sandbox.
- **The orchestrator never branches on provider.** Provider-specific logic belongs in the connector's `fetch` (or its webhook/async-export capability), nowhere downstream. Sync-core knows nothing about HTTP/entities.
- **Sync is sliced — checkpoint after every page, resume from the cursor.** Never assume a run fetches everything in one tick. The durable cursor lives on `DataConnectorStream.state.backfillCursor`; a crash resumes there, never page 1.
- **Cursor-safety is three-state.** `partial-retriable` HOLDS the cursor (transient 429/5xx); `partial-permanent` ADVANCES past poison records; `all` advances cleanly. `nextCursor` is ignored on `partial-retriable`.
- **Reconciliation gates on backfill completion** (`finalizeBackfill`, last stream only via the latch) — a partial backfill must never archive unreached records. Incremental never archives on absence except a `sweep`.
- **Heartbeat, not startedAt, detects stale runs.** A long healthy slice chain bumps `heartbeatAt` each slice; `sweepStaleConnectorRuns` keys off that.
- **Source schema mirrors the raw payload**, and `rootPath` selects records within it. `sourceFields`/`connectorFieldKey` are subtree-relative; `rootPath` is record-absolute.
- **Content hash uses sorted-key `stableHash`.** Never `JSON.stringify` for hashing — jsonb reorders keys and you'll false-stale (compare-and-set churn).
- **Field mappings are a jsonb array of entries with stable ids**, not a Record keyed by target (same jsonb-reordering reason).
- **`SyncCursor` is opaque to the core and the engine.** App cursors round-trip via `encode/decodeCursor` (`kind: 'token'`); decode tolerates malformed/legacy values without failing a live sync. The `kind` tag is advisory only.
- **`integrationSource` namespace:** owned sets it to `connectorId`; contributing leaves it alone. Don't overload it with compound strings.
- **`targetFieldRef` is a canonical `ResourceFieldId`** (`entityDefinitionId:fieldId`) or a `@app:` late-bound ref, nullable for an unassigned draft (skipped at runtime).
- **The tRPC `paginationSchema` mirrors the engine `PaginationSpec` field-for-field.** A narrower schema silently strips enriched cursor/next-url fields.
- **DB mirror types vs canonical lib types** (`data-connector-types.ts` ↔ `types.ts`) are hand-synced — update both on any column/type change.
- **Frontend status types are self-contained** (`connector-status.tsx`, `resolve-sync-status.ts`) — no `@auxx/lib/data-connectors` import from client code.
- **PII at rest:** synced records are stored and agent-retrievable; default-drop + PII flags are a governance requirement.
- **Don't revive the deprecated `shopify_products`/`shopify_customers`/`shopify_addresses` tables** — superseded by the generic entity model. **`ExternalKnowledgeSource` is unrelated** — a dormant table; don't wire connectors against it.

---

## 19. Known Gaps

Tracked in `plans/data-connectors/claude/HANDOFF.md` §3 and `plans/data-connectors/v3/` (none block the spine):
- **Channel sync hasn't migrated to sync-core yet.** Data-connectors is the first and only consumer; Gmail/Outlook still run their own sync stack. The shared shell exists for them to adopt (`shared-sync-core-plan.md`).
- **App `sampleFetch`** remains gated — app connectors declare schema in the catalog and yield per-record, so the model handles them, but they don't exercise the test-fetch/inference path. Generic-rest is fully live.
- **Per-mapping dry-run** (create/update/skip/archive + identity/relationship preview) isn't a procedure yet — the UI shows the raw test-fetch sample only.
- **Multi-connector-per-type / multi-connection** is v1-deferred (one connector per type per org; unique index on the connector, not the target def).
