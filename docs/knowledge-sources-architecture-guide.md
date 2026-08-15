# Knowledge Sources Architecture Guide

**Last Updated:** 2026-06-17
**Scope:** The `KnowledgeSource` system — how external content (websites, manual entries, future connectors) is ingested, materialized as articles, embedded for retrieval, and surfaced into user-facing knowledge bases. Covers backend (schema, service, sync pipeline, queues) and frontend (tRPC, UI).

> Sources are managed by `packages/lib/src/knowledge-sources`. This is the controlling module —
> everything a "source" does flows through it. Knowledge bases, articles, datasets, and embeddings are
> downstream consumers documented here only where they touch sources.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [The Mental Model](#2-the-mental-model)
3. [Backend: Data Model](#3-backend-data-model)
4. [Backend: Source Service (CRUD + lifecycle)](#4-backend-source-service-crud--lifecycle)
5. [Backend: The Sync Pipeline](#5-backend-the-sync-pipeline)
6. [Backend: Queues, Scheduling & Workers](#6-backend-queues-scheduling--workers)
7. [Backend: Linking & Downstream Embedding](#7-backend-linking--downstream-embedding)
8. [tRPC Surface](#8-trpc-surface)
9. [Frontend: Pages, Components & Flows](#9-frontend-pages-components--flows)
10. [Consumption: Agents & Workflows](#10-consumption-agents--workflows)
11. [End-to-End Flows](#11-end-to-end-flows)
12. [Invariants & Gotchas](#12-invariants--gotchas)

---

## 1. Executive Overview

A **KnowledgeSource** is an org-owned definition of *where content comes from and how to keep it in sync* —
a website to crawl, a set of manually pasted entries, and (on the roadmap) Shopify/file/Notion/Zendesk
connectors. A sync run pulls content from a **connector**, files it through a **sink** as managed
**Articles**, embeds those articles into a **Dataset** for vector retrieval, and reconciles anything that
disappeared at the source.

The defining design decision: **every source owns a hidden knowledge base** (`kind='source'`). Synced
articles "home" in that hidden KB and embed there exactly once. They are then **linked** (not copied) into
user-facing KBs via `ArticlePlacement.linkedFromSourceId`. This keeps one canonical, embed-once copy while
letting the same article appear in many places.

The pipeline is deliberately **connector/sink-agnostic**: `runSourceSync` never branches on source type or
surface — `connectorFor(type)` decides how to fetch and `sinkForSurface(source)` decides where content
lands.

---

## 2. The Mental Model

```
KnowledgeSource ──owns──▶ hidden KnowledgeBase (kind='source', INTERNAL, DRAFT)
      │                          │
      │ sync run                 ├─ managed Dataset (isManaged=true) ── embeddings
      ▼                          │
  connector (fetch)         Articles home here (Article.sourceId = source.id, managed=true)
      │                          │
      ▼                          └─ linked into user KBs via
   sink (file as Articles)          ArticlePlacement.linkedFromSourceId = source.id
      │
      ▼
  enqueue kb-sync → embed article content into the owned KB's dataset
```

Key distinctions:

- **Source ≠ Knowledge Base ≠ Document.** A *source* says how to fetch. A *knowledge base* is a container of
  articles (user-facing or source-owned/hidden). A *document/segment* is the dataset/embedding unit used for
  vector retrieval.
- **Two provenance pointers, different meanings:**
  - `Article.sourceId` = **content** provenance (this article's text came from source X; drives managed vs
    detached / locked vs editable).
  - `ArticlePlacement.linkedFromSourceId` = **placement** provenance (this *position in a KB tree* is a live
    source link). Unlinking clears the placement pointer; the article's `sourceId` is untouched.
- **`KnowledgeSource` ≠ `ExternalKnowledgeSource`.** The latter is a separate, not-yet-wired table for
  Phase-4 third-party KB integrations that feed a Dataset directly (no visible articles). See §3.

---

## 3. Backend: Data Model

Schema: `packages/database/src/db/schema/`. Enums: `_shared.ts` (pgEnums) and `enums.ts` (value arrays).

### KnowledgeSource — `knowledge-source.ts`

The source definition. Notable columns:

- `id` (PK), `organizationId` (FK, cascade), `createdById`, `createdAt`, `updatedAt`
- `type` — **`text`, not a pgEnum** (so new connectors ship without an enum migration), typed in code as the
  union `KnowledgeSourceType`: `manual | website | shopify | file | notion | confluence | zendesk`
  (`KNOWLEDGE_SOURCE_TYPES`, line 27). Only `manual` and `website` are implemented today.
- `name`
- `surface` (pgEnum `knowledgeSourceSurface`) — `'publishable'` (default; produces locked Articles) |
  `'ai-only'` (Phase 4; dataset docs only, **sink not implemented yet**)
- `config` (jsonb, default `{}`) — per-type connector config (website: `{ url, selectedPaths[],
  includeUrls[], excludeUrls[], mainContentOnly, maxPages }`; manual: `{ items: [{title, markdown,
  externalId?, path?}] }`)
- `ownedKnowledgeBaseId` (FK → KnowledgeBase, cascade) — **the hidden KB this source owns** (see §2). Set at
  creation; deleting the source deletes this KB.
- `rootFolderArticleId` (FK → Article, set null) — the source's root category Article; synced children nest
  beneath it in the owned KB's tree.
- `syncBehavior` (pgEnum `knowledgeSourceSyncBehavior`) — `'manual' | 'scheduled' | 'webhook'`
- `scheduleConfig` (jsonb) — `ScheduledTriggerConfig` when scheduled; null otherwise
- `status` (pgEnum `knowledgeSourceStatus`) — `'pending' | 'syncing' | 'live' | 'error' | 'paused'`
- `lastSyncedAt`, `lastJobId`, `itemCount`, `error`

Indexes: `organizationId`, `ownedKnowledgeBaseId`.

### KnowledgeBase — `knowledge-base.ts`

Article container. Source-relevant columns:

- `kind` (pgEnum `kbKind`) — `'standard'` (user-facing) | `'source'` (hidden, owned by a KnowledgeSource;
  filtered out of all user-facing lists)
- `visibility` (`PUBLIC | INTERNAL`) — source KBs are `INTERNAL`
- `publishStatus` (`DRAFT | PUBLISHED | UNLISTED`) — source KBs start `DRAFT`
- `slug` — unique per org; source KBs use a `__source-<id>` slug to avoid collisions
- `datasetId` (FK → Dataset, set null) — the managed dataset holding this KB's embeddings

### Article / ArticlePlacement (the link layer)

- **Article** — `sourceId` (FK → KnowledgeSource, set null) = content provenance; `sourceExternalId` =
  stable id at the source (normalized URL / key); `sourceContentHash` = skip re-sync when unchanged;
  `managed` (bool) = locked while owned by a source, becomes editable on detach. Indexed on
  `(sourceId, sourceExternalId)`.
- **ArticlePlacement** — `articleId` + `knowledgeBaseId` (one article can have many placements);
  `linkedFromSourceId` (FK → KnowledgeSource, set null) = placement provenance (live source link vs native
  placement). Tree fields: `parentId`, `sortOrder`, `slug`.

### Dataset / Document / DocumentSegment (the retrieval layer)

- **Dataset** — vector index container; `isManaged=true` for source/KB-owned datasets (hidden from
  `/app/datasets`); `embeddingModel` (`"provider:model"`), `vectorDimension`, `chunkSettings`,
  `vectorDbType` (default `POSTGRESQL`).
- **Document** — ingestion unit; `status` (`UPLOADED|PROCESSING|INDEXED|FAILED|ARCHIVED|WAITING`), `type`
  (`PDF|DOCX|TXT|HTML|MARKDOWN|CSV|JSON|XML`), `checksum` (unique per `(datasetId, checksum)`), `metadata`
  carrying KB/source provenance (expression index on `metadata->'kb'->>'articleId'`).
- **DocumentSegment** — the actual vector unit. Multi-dimension pgvector columns (`embedding_512/768/1024/
  1536/3072`), `embeddingModel`, `indexStatus` (`PENDING|INDEXED|ERROR`), plus a `searchVector` tsvector for
  full-text. HNSW (cosine) indexes per dimension except 3072 (exceeds pgvector's index limit).

### ExternalKnowledgeSource — `external-knowledge-source.ts` (Phase 4, not wired)

Separate table for third-party help-center integrations (Zendesk/Intercom/Gorgias, …): `sourceType`,
`endpoint`, `configuration` (jsonb), `syncEnabled`/`syncInterval`/`nextSyncAt`, `datasetId` (FK → Dataset,
**not** KnowledgeBase). Intent: surface external content as dataset docs for AI retrieval, no visible
articles. No router or UI exists yet — don't confuse it with `KnowledgeSource`.

---

## 4. Backend: Source Service (CRUD + lifecycle)

`packages/lib/src/knowledge-sources/source-service.ts` — functional CRUD; owns the hidden-KB lifecycle.

- **`createSource(db, orgId, input)`** — creates the hidden owned KB (`kind='source'`, `INTERNAL`, `DRAFT`,
  slug `__source-<id>`), **awaits** `ensureManagedDataset` so embeddings are ready for the first sync,
  inserts the `KnowledgeSource` (status `pending`), and registers the scheduler.
- **`listSources` / `getSource`** — org-scoped reads (`getSource` throws `NotFoundError`).
- **`updateSource(db, orgId, id, patch)`** — patches `name | config | syncBehavior | status |
  scheduleConfig`; re-registers the scheduler to match the new cadence.
- **`pauseSource` / `resumeSource`** — flip status `paused`/`live`, remove/re-register the scheduler
  (schedule config is preserved on pause).
- **`deleteSource`** — full teardown: drop scheduler → break circular FKs (placement/draft revision
  pointers) → delete all source-owned articles (managed *and* detached) + placements → delete the source
  row → delete the owned KB and its managed dataset (cascades Documents/segments).

Public surface is re-exported from `knowledge-sources/index.ts` (service fns, sync fns, connectors, crawl
helpers, sinks, and the shared types `KnowledgeSourceRow`, `SourceItem`, `SourceSink`, `SyncCtx`,
`CreateSourceInput`, `SourceSyncJobData`).

---

## 5. Backend: The Sync Pipeline

### Orchestrator — `run-source-sync.ts`

`runSourceSync(db, orgId, sourceId)` is the heart of the system:

1. **Load source** (return early if missing).
2. **Concurrency guard** — atomic DB update flips status → `syncing` only if not already syncing; a
   concurrent run (e.g. manual click colliding with a scheduled fire) sees the lock and skips.
3. **Build context** — load the owned KB, resolve `connectorFor(source.type)` and `sinkForSurface(source)`.
4. **Snapshot existing** — `sink.listExisting(ctx)` returns `{ externalId, contentHash }[]` for orphan
   reconciliation.
5. **Fetch + stream** — two connector modes:
   - **list** (`manual`): `fetchItems()` returns all `SourceItem`s up front.
   - **crawl** (`website`): `crawl(source, onItem)` streams items as discovered (never buffers the whole
     site). Each item is immediately `sink.upsertItem(ctx, item)`'d; a `seen` set tracks externalIds.
6. **Orphan reconciliation** — anything in `existing` not in `seen` is `sink.archiveItem`'d (archived, not
   hard-deleted; structural folder nodes are exempt).
7. **Finalize** — success → status `live`, update `lastSyncedAt`/`itemCount`, clear `error`; failure →
   status `error` with the message.

### Connectors — `connectors/`

The contract (`connectors/types.ts`): a `SourceConnector` is either a `ListConnector` (`mode:'list'`,
`fetchItems`) or a `CrawlConnector` (`mode:'crawl'`, `crawl(source, onItem)`). The content unit is
`SourceItem { externalId, title, markdown, path? }`. `connectorFor(type)` (`connectors/index.ts`) maps type
→ connector and throws on unknown types.

- **`manual.ts`** — list mode; returns `source.config.items ?? []`. The proof-of-concept connector that
  exercises the whole spine with no external dependency.
- **`website.ts`** — crawl mode; reads `WebsiteConfig` from `source.config`, gets the crawl provider,
  streams each page as a `SourceItem` (pathname → `path`, `normalizeUrl` → `externalId`), and returns all
  discovered URLs for reconciliation.

### Crawl subsystem — `crawl/`

`CrawlProvider` (`crawl/types.ts`) is a swappable interface: `checkUrl`, optional `findSubdomains`,
`getSitemapTree`, and `crawl(url, opts, onPage)`. `getCrawlProvider()` (`crawl/index.ts`) picks the
implementation via the `CRAWL_PROVIDER` config (default `firecrawl`; `native` is a deferred stub on the same
contract).

- **`providers/firecrawl.ts`** — talks Firecrawl REST v2 directly (no SDK), key from `FIRECRAWL_API_KEY`:
  `checkUrl` → `/v2/scrape`; `getSitemapTree` → `/v2/map` then `buildTreeFromPaths`; `crawl` → `/v2/crawl`
  then polls (`POLL_INTERVAL_MS=3000`, `POLL_TIMEOUT_MS=600000`), yielding pages to `onPage`. Maps
  `selectedPaths`→`includePaths`, `excludeUrls`→`excludePaths`, `maxPages`→`limit`, `formats:['markdown']`.
- **`sitemap-tree.ts`** — pure flat-links → nested `SitemapNode` tree (for the section picker).
- **`url.ts`** — `normalizeUrl` (strip fragment/trailing slash → stable externalId) and `toPathRegex`.

### Sinks — `sinks/`

A `SourceSink` (`sinks/types.ts`) has `upsertItem`, `archiveItem`, `listExisting`, all receiving a `SyncCtx
{ db, orgId, source, kb }` (kb = the owned hidden KB). `sinkForSurface(source)` returns `articleSink` for
`publishable`; `ai-only` throws (Phase 4, not implemented).

- **`article-sink.ts`** — materializes items as managed Articles:
  - ensure root folder + path folders (`ensureRootFolder` / `ensurePathFolders` from `article-filing.ts`),
  - find existing managed article by `externalId`, compute content hash, parse markdown to blocks,
  - **new** → create + mark placement `linkedFromSourceId`; **existing managed + changed** → update draft +
    bump hash; **existing managed + unchanged** → still enqueue `sync-managed` to self-heal missing
    Documents; **detached (user-owned)** → skip (never overwrite),
  - enqueue `kb-sync` (`sync-managed`) to embed downstream.
  - `archiveItem` archives managed articles (skips detached); `listExisting` lists source-owned articles,
    excluding structural folder nodes (`__root:` / `__folder:` keys via `isStructuralExternalId`).

---

## 6. Backend: Queues, Scheduling & Workers

Two BullMQ queues (`packages/lib/src/jobs/queues/types.ts`):

- **`knowledgeSourceQueue` (`'knowledge-source'`)** — crawl/ingest. `enqueueSourceSync({ sourceId, orgId })`
  adds a `source-sync` job with jobId `source-sync-manual-<sourceId>` (coalesces duplicate "Sync now"
  clicks). Consumed by `apps/worker/.../knowledge-source-worker.ts` → `handleSourceSync` → `runSourceSync`
  (concurrency 2, cancellable).
- **`kbSyncQueue` (`'kb-sync'`)** — article → dataset embedding. `enqueueKBSync` (in `packages/lib/src/kb/
  kb-sync-queue.ts`) adds jobs typed `sync | sync-managed | unpublish | delete | metadata`, jobId
  `kb-sync:<type>:<articleId>` (coalesces rapid edits). Consumed by `apps/worker/.../kb-sync-worker.ts` →
  `KBSyncService` (concurrency 4, cancellable).

**Scheduling** (`source-scheduler.ts`): uses BullMQ `upsertJobScheduler` (scheduler id
`source-sync-<sourceId>`). A scheduler is active iff `syncBehavior='scheduled'`, status ≠ `paused`, and
`scheduleConfig` is present; the config is converted to a cron pattern. `syncSourceScheduler(source)`
registers/updates, `removeSourceScheduler(id)` removes, and `reconcileSourceSchedulers(db)` re-registers all
active schedulers on worker boot (hardening). Scheduled fires rely on the in-handler `status='syncing'`
guard for dedup.

---

## 7. Backend: Linking & Downstream Embedding

`source-links.ts` manages how a source's articles appear in user-facing KBs (only `page` articles are
linkable — never structural categories):

- `listSourceLinks(db, orgId, sourceId)` — derives the user-facing KBs a source is linked into (from
  placements with `linkedFromSourceId=sourceId`), excluding the source's own owned KB.
- `unlinkSourceArticleFromKb(...)` — remove one linked article's placement from one KB.
- `unlinkSourceFromKb(...)` — remove all of a source's placements from one KB (cascades children).

Embedding happens downstream of the article sink: each upsert enqueues a `kb-sync` job, and `KBSyncService`
in the worker embeds the article's content into the owned KB's managed Dataset (Documents + DocumentSegments
with pgvector embeddings). Retrieval then runs across the datasets of all KBs an article is linked into.

---

## 8. tRPC Surface

Registered in `apps/web/src/server/api/root.ts`: `knowledgeSource` → `routers/knowledge-sources.ts`,
`kb` → `routers/kb.ts`. All procedures are `protectedProcedure` (org-gated).

**`knowledgeSource` router** (`routers/knowledge-sources.ts`):

- Reads: `list`, `getById`, `getStatus` (lightweight `{status, lastSyncedAt, itemCount, error}` for
  polling), `listLinks`.
- Source mgmt: `create` (discriminated union `manual | website`; `surface` defaults `publishable`;
  `scheduleConfig.triggerInterval` ∈ `hours|days|weeks|custom` — minutes rejected to prevent credit burn),
  `update`, `pause`, `resume`, `delete`, `syncNow` (enqueues immediate sync), `detachArticle` (clears a
  managed article's lock so users can edit).
- Linking: `unlinkArticle`, `unlinkFromKnowledgeBase`.
- Website wizard support: `checkUrl`, `findSubdomains`, `getSitemapTree`.

**`kb` router** (`routers/kb.ts`) — source-relevant: `linkArticles` (link chosen `page` articles from any KB
— including sources' hidden KBs — into a target KB under a parent; idempotent), `getArticles`, `list`
(excludes hidden source KBs), `byId`.

---

## 9. Frontend: Pages, Components & Flows

UI lives under `apps/web/src/components/kb/ui/sources/` and `.../editor/`, routed from
`apps/web/src/app/(protected)/app/kb/`.

**Landing** — `/app/kb` renders `KBLandingShell` with two tabs **Articles | Sources** (tab persisted in the
`t` query param); the header action swaps to "Connect Source" on the Sources tab.

**Sources list** — `sources-tab.tsx` (filter bar + card grid), `sources-provider.tsx` (context: search +
status filter, **auto-polls every 4s while any source is `syncing`**), `source-card.tsx` (icon by type,
status dot, last-synced, itemCount, surface badge; menu: Open / Sync now / Pause·Resume / Delete).

**Creating a source** — `connect-source-button.tsx` dropdown:

- **Crawl a website** → `crawl-website-wizard.tsx`, a 4-step flow: **Connect** (URL → `checkUrl` +
  `getSitemapTree`), **Pages** (`crawl-section-picker`/tree, toggle sections), **Target** (exclude URLs,
  `mainContentOnly`, `sync-frequency-picker`), **Review**. On finish: `knowledgeSource.create` (`type:
  'website'`) then `syncNow`, then invalidate `list`.
- **Manual paste** → `create-knowledge-source-dialog.tsx` (name + rows of title/markdown/optional
  externalId; validates unique externalIds) → `create` (`type: 'manual'`) then `syncNow`.

**Source workspace** — `/app/kb/sources/[sourceId]` → `source-workspace.tsx` (two-pane: settings left,
article view right; header status pill + Sync now + Delete; refetches `getById` every 4s while `syncing`).
`source-settings-panel.tsx` has three tabs: **General** (name, URL, mainContentOnly, exclude URLs, re-map
site, schedule, linked-KBs list with remove, read-only about, dirty-checked Save), **Articles**
(`source-article-tree.tsx`), **Runs** (last-sync summary; full per-run history pending a dedicated table).

**Linking into KBs** — `link-article-picker.tsx` (KB editor "Add → Link an article") shows standard KBs
*and* each source's hidden owned KB, lets the user pick `page` articles, and calls `kb.linkArticles`. Linked
source articles render but stay locked (managed) until detached.

**Sync status** — state machine `pending → syncing → live|error` (or `paused`). Status is surfaced by
**4-second polling** (`getStatus`/`getById` with conditional `refetchInterval`); there is no realtime
socket channel for source sync yet. Errors live in `source.error` and show in the Runs tab / status tooltip.

---

## 10. Consumption: Agents & Workflows

Sources don't expose themselves directly to AI — they flow through knowledge bases and datasets:

- **Agents** — `apps/web/src/components/agents/ui/detail/knowledge/` lets an agent scope to knowledge bases
  (and other resources). When a KB is in scope, the agent retrieves across all its articles — native *and*
  source-linked. Source articles are just articles in a KB the agent can see.
- **Workflows** — the Knowledge Retrieval node
  (`apps/web/src/components/workflow/nodes/core/knowledge-retrieval/`, catalog manifest in
  `packages/lib/src/workflow-engine/catalog/nodes/knowledge-retrieval.ts`) takes a query plus a
  `sources[]` list and runs hybrid/vector/text search across them. Each row is either
  `{ kind: 'kb', knowledgeBaseId }` or `{ kind: 'dataset', datasetId }`, and either can be bound to a
  variable. There is no implicit "all knowledge bases" — selection is always explicit.
  Source content is reachable the documented way: link the source's articles into a standard KB and
  pick that KB, at which point federation pulls in the source's hidden dataset. The picker cannot
  offer `kind: 'source'` KBs directly (`RecordPickerService`'s `neverPickable`), which is why that
  indirection is the only route.

  The node resolves on the **workflow author's** authority (`sys.userId`, the workflow's
  `createdById`) through the shared `resolveKnowledgeDatasetIds`, and fails closed: no user in
  context refuses to run rather than resolving unrestricted, an unresolvable row contributes nothing
  while its siblings still search, and an empty resolved set errors instead of falling through to an
  unscoped search. *Before 2026-08-14 (#1642) the node took `datasets[]` only — it could not reach a
  knowledge base at all, because managed KB datasets are hidden from every dataset picker.*

---

## 11. End-to-End Flows

**Create a website source:**
Wizard → `knowledgeSource.create` → `createSource` builds hidden KB + managed dataset + source row
(`pending`) and registers the scheduler → wizard calls `syncNow` → `enqueueSourceSync` → worker runs
`runSourceSync`.

**A sync run:**
`runSourceSync` locks status `syncing` → website connector crawls via Firecrawl, streaming pages → article
sink files each page as a managed Article under the source root, computes content hash, enqueues `kb-sync` →
orphan reconciliation archives vanished pages → status `live`, `lastSyncedAt`/`itemCount` updated. Meanwhile
the `kb-sync` worker embeds each article into the owned dataset.

**Surface to users / AI:**
User links source articles into a standard KB (`kb.linkArticles`, placement gets `linkedFromSourceId`) →
the KB (and its dataset) is scoped to an agent or a workflow retrieval node → answers cite the content.

**Delete a source:**
`knowledgeSource.delete` → `deleteSource` drops the scheduler, deletes all owned articles + placements + the
hidden KB + its dataset (embeddings cascade away).

---

## 12. Invariants & Gotchas

- **Every source owns exactly one hidden KB** (`kind='source'`, `__source-<id>` slug, INTERNAL/DRAFT). It is
  filtered from all user-facing KB lists and deleted with the source. Don't surface it.
- **Articles embed once, link many.** Content lives once in the owned KB/dataset; appearances in user KBs are
  `ArticlePlacement`s, not copies.
- **Two provenance pointers — don't conflate them.** `Article.sourceId` = content origin / lock state;
  `ArticlePlacement.linkedFromSourceId` = a live source link at a tree position. Unlinking touches only the
  placement; detaching (`detachArticle`) clears the managed lock so users can edit.
- **Managed articles are read-only; the sink never overwrites detached ones.** Re-sync skips user-owned
  articles entirely.
- **`type` is a free-text union, not a pgEnum** — new connectors don't need an enum migration, but only
  `manual` and `website` are wired; `ai-only` surface and all other connector types throw today.
- **Sync is idempotent via content hash + stable externalId.** `normalizeUrl` keeps externalIds stable
  across crawl-provider swaps; unchanged content is skipped (but still self-heals missing Documents).
- **Orphan items are archived, not deleted**, and structural folder nodes (`__root:`/`__folder:`) are exempt
  from reconciliation.
- **Concurrency is guarded in-handler** (`status='syncing'` atomic flip), and manual syncs coalesce via a
  fixed jobId — so duplicate triggers are safe.
- **Status is polled, not pushed** (4s interval while syncing). No realtime channel for source sync yet.
- **`ExternalKnowledgeSource` is a different, dormant table** (Phase 4 third-party KBs → dataset). It has no
  router/UI; don't wire new work against it without checking it's been activated.
- **Schedule floor is coarse** (`hours/days/weeks/custom`, no minutes) to avoid crawl-credit burn.
</content>
