<!-- docs/files-upload-architecture-guide.md -->

# Files & Upload Architecture Guide

**Last Updated:** 2026-08-21
**Scope:** *"A user picked a file. What happens?"* The complete path from a browser file picker
through presigned S3, into `StorageLocation` / `MediaAsset` / `FolderFile` / `Attachment` rows, and
back out through the download and thumbnail read paths. Plus the parallel doors that bypass this
path, the cleanup jobs that are supposed to reap it, and an honest inventory of what is
overbuilt, dead, or wrong.

> Code under review: `apps/web/src/app/api/files/**`, `packages/lib/src/files/**`,
> `apps/web/src/components/file-upload/**`.
> **Remediation plan:** `plans/attachments/` (not tracked in git) — 11 phase docs covering the
> Tier-1 fixes and the functional refactor. §13 below is its executive summary.
> Companions: `lib-module-guide.md` (module shape this subsystem predates and violates),
> `channels-mail-architecture-guide.md` (inbound mail attachments — a different door into the same
> tables), `ui-design-guide.md`.
> **Where this guide and the code disagree, the code is the truth.** Sections 10–12 are findings,
> not descriptions: they say what is broken, not what exists.
>
> **Refactor in progress.** The storage layer (§5) has been rewritten across #1823, #1825, #1827 and
> #1829, and PR 3d is in flight — presigning and multipart move out of `StorageManager` next, so §5
> will shift again. The `core/` services, the processor hierarchy (§3) and the front end (§6) are
> **not** started and are described as-built. Struck-through findings carry the PR that closed them.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [The Data Model](#2-the-data-model)
3. [Entity Types & the Processor Registry](#3-entity-types--the-processor-registry)
4. [Door 1 — the browser presigned flow (the main path)](#4-door-1--the-browser-presigned-flow-the-main-path)
5. [The Storage Layer](#5-the-storage-layer)
6. [The Front End](#6-the-front-end)
7. [Door 2 & 3 — the parallel upload paths](#7-door-2--3--the-parallel-upload-paths)
8. [The Read Path](#8-the-read-path)
9. [Lifecycle, Quota & Cleanup](#9-lifecycle-quota--cleanup)
10. [Transactions — what is actually happening](#10-transactions--what-is-actually-happening)
11. [Correctness Findings](#11-correctness-findings)
12. [Overcomplication & Dead Code](#12-overcomplication--dead-code)
13. [A Target Design](#13-a-target-design)
14. [Key Files](#14-key-files)

---

## 1. Executive Overview

There is one intended upload path and two that grew alongside it.

The intended path is **three HTTP round-trips against our server plus a direct PUT/POST to S3**:

```
BROWSER                         apps/web (Node)                    S3            POSTGRES
   │
   │ 1. POST /api/files/upload/sessions
   │──────────────────────────────────▶ auth + files.manage gate
   │                                    storage quota gate  ────────────────────────▶ real bytes (§11.1, fixed)
   │                                    ProcessorRegistry.getForEntityType(entityType)
   │                                    processor.processConfig(init)
   │                                      → storageKey, policy, uploadPlan,
   │                                        visibility, bucket, ttl
   │                                    SessionManager.createSessionFromConfig
   │                                      → nanoid in Redis, TTL 10m
   │                                    storageManager.generatePresignedUploadUrl
   │                                      → presigned POST (or multipart init)
   │◀───────────────────────────────────  { sessionId, presignedUrl, fields, … }
   │
   │ 2. POST/PUT the bytes straight to S3
   │─────────────────────────────────────────────────────────────▶ object lands
   │   (multipart: N × POST /upload/{id}/parts for a per-part URL,
   │    then N × PUT — serial, one round-trip to us per part)
   │
   │ 3. POST /api/files/upload/{sessionId}/complete
   │──────────────────────────────────▶ authorizeUploadSession (§11.4, fixed)
   │                                    completeMultipartUpload (if multipart)
   │                                    headByKey  ──────────────▶ verify size/mime
   │                                    processor.validateCompletedUpload
   │                                    ┌── db.transaction ──────────────────────┐
   │                                    │  buildExternalUrl (I/O — §10.2, OPEN)  │
   │                                    │  createStorageLocation                 │
   │                                    │  processor.process → savepoints (§10.1,│
   │                                    │                             still OPEN) │
   │                                    │    → MediaAsset + MediaAssetVersion    │
   │                                    │      and/or FolderFile + FileVersion   │
   │                                    │      and/or Attachment                 │
   │                                    │    (BullMQ enqueue moved out — §10.3)  │
   │                                    └────────────────────────────────────────┘
   │                                    post-commit: cache busts, thumbnail
   │                                                 enqueue, download URL
   │◀───────────────────────────────────  { assetId | fileId, attachmentId, url }
```

There is also an SSE channel (`GET /upload/{sessionId}/events`) and a Redis pub/sub progress
publisher feeding it. **Nothing connects to it.** The client reads its result from the `complete`
response body. See §12.1.

The two other doors:

- **Public workflow share uploads** — `/api/workflows/shared/[shareToken]/files/**`. A complete,
  independent re-implementation: its own Redis keyspace, its own presign, no processor, no policy,
  no transaction. It works.
- **Server-side ingest** — inbound mail attachments, thumbnails, PDF renders, exports, recordings.
  These call `StorageManager.uploadContent()` directly and then the services. They never touch
  sessions or processors.

---

## 2. The Data Model

Five tables carry a file. Understanding which combination a given upload produces is the single
most important thing about this subsystem.

| Table | What it is | Written by |
| --- | --- | --- |
| `StorageLocation` | The bytes. Provider + bucket + key + etag + size + mime. **Org-scoped, never soft-deleted by the upload path.** | `createStorageLocation(tx, ctx, input)` in `storage/locations.ts` |
| `MediaAsset` | A logical, versioned media object: `kind` (`USER_AVATAR`, `EMAIL_ATTACHMENT`, `INLINE_IMAGE`, `THUMBNAIL`, `DOCUMENT`, `TEMP_UPLOAD`), `purpose`, `isPrivate`, `currentVersionId`, `expiresAt`. | `MediaAssetService.createWithVersion` / `updateContent` |
| `MediaAssetVersion` | One version of an asset → one `StorageLocation`. Thumbnails are **separate `MediaAsset`s** whose versions carry `derivedFromVersionId` + `preset`. | same |
| `FolderFile` + `FileVersion` | The user-facing *file library* (folder tree, rename, move, versions). `FileVersion.fileId` FKs to **`FolderFile`**. | `FileService.createWithVersion` |
| `Attachment` | The join from an asset to a host entity: `(entityType, entityId, assetId, role, title, caption)`. | `AttachmentService.create` |

There is also a legacy **`File`** table (`packages/database/src/db/schema/file.ts`) that is
**empty and unused** except by the workflow-file route and one broken query (§11.1). It is not
`FolderFile`. The name collision is a live hazard.

**Buckets.** Two: `S3_PUBLIC_BUCKET` and `S3_PRIVATE_BUCKET`, chosen by
`getBucketForVisibility(visibility)` in `upload/util.ts`. Public objects get a durable CDN URL
(`CDN_URL/{key}`) written into `StorageLocation.externalUrl`; private objects are only reachable
through a presigned GET or our download route.

**Storage key.** `deriveStorageKey`:
`{orgId}/{entity-type-kebab}/{entityId ?? 'temp'}/{Date.now()}_{seed?}{sanitizedFileName}`.
Org id first so `aws s3 rm s3://bucket/{orgId}/ --recursive` is a valid org delete.

---

## 3. Entity Types & the Processor Registry

`ENTITY_TYPES` (`files/types/entities.ts`) is the dispatch key for the whole flow. The client sends
an entity type; the registry maps it to exactly one processor; the processor decides everything
else.

| Entity type | Processor | Visibility | Max | Mime allow-list | Produces |
| --- | --- | --- | --- | --- | --- |
| `FILE` | `FileProcessor` | PRIVATE | — (`*/*`) | `*/*` | `FolderFile` + `FileVersion` |
| `USER_PROFILE` | `UserProfileProcessor` | **PUBLIC** | 5 MB | jpeg/png/webp/gif | `MediaAsset` (versioned in place) + `User.avatarAssetId`/`image` |
| `ARTICLE` | `ArticleProcessor` | PRIVATE (PUBLIC when `role=COVER`) | 10 MB | images (no SVG), pdf, text | `MediaAsset` + `Attachment` |
| `KNOWLEDGE_BASE` | `KnowledgeBaseProcessor` | **PUBLIC** | 10 MB | jpeg/png/webp | `MediaAsset` + `Attachment` + `KnowledgeBase.logoLight/Dark` |
| `CHAT_WIDGET` | `ChatWidgetProcessor` | **PUBLIC** | 10 MB | jpeg/png/webp | `MediaAsset` + `Attachment` + `ChatWidget.logoLight/Dark` |
| `MESSAGE` | `MessageProcessor` | PRIVATE | 25 MB | `*/*` | `MediaAsset` + `Attachment` |
| `COMMENT` | `CommentProcessor` | PRIVATE | 25 MB | image/text/pdf/doc | `MediaAsset` + `Attachment` |
| `CUSTOM_FIELD` | `CustomFieldProcessor` | PRIVATE | 25 MB | `*/*`, narrowed by the field's `options.file` | `MediaAsset` + `Attachment` |
| `WORKFLOW_RUN` | `WorkflowRunProcessor` | PRIVATE | 50 MB | `*/*` | `MediaAsset` + `Attachment` |
| `DATASET` | `DatasetAssetProcessor` | `'private'` (lowercase — §11.6) | 50 MB | long explicit list | `MediaAsset` + `Document` + parse/embed queue |
| `visit_qc_item` | **none — falls back to `FileProcessor`** | PRIVATE | `*/*` | `*/*` | `FolderFile` — **wrong, §11.3** |

The class hierarchy is three deep:

```
BaseProcessor              processConfig(), validateCompletedUpload(), process()
  └─ BaseAssetProcessor    + createAsset(), entity policy clamping, validateEntityAccess()
       └─ BaseAttachmentProcessor  + createAttachment(), entityId required
```

`processConfig` is a **super-call chain**: each level widens or clamps `policy`,
`uploadPlan`, `visibility`, `bucket`, and re-`Object.freeze`s the config. Tracing what a given
entity type actually ends up with requires reading up to four `processConfig` overrides.

**Registration** is imperative and lazy: `ensureProcessorsInitialized()` must be called by hand at
the top of both routes before touching the registry. Miss it and you get a `logger.warn` and a
still-working default processor — a silent, wrong `FolderFile` instead of a hard error.

---

## 4. Door 1 — the browser presigned flow (the main path)

### 4.1 `POST /api/files/upload/sessions`

`apps/web/src/app/api/files/upload/sessions/route.ts`

1. `auth.api.getSession` → requires `defaultOrganizationId`.
2. Zod-parse the body (`fileName`, `mimeType`, `expectedSize`, `entityType`, `entityId?`,
   `provider?`, `metadata?`).
3. **Layer-2 permission gate — only for `entityType === 'FILE'`** (`PermissionKey.filesManage`).
   Every other entity type is deliberately left to its host surface's own gate plus the
   processor's `validateEntityAccess`.
4. **Storage quota gate** — `FeaturePermissionService.getLimit(org, 'storageGbHard')` vs
   `calculateStorageUsage(org)`. Wrapped in a try/catch that **fails open**. It also always
   measures zero (§11.1).
5. `ensureProcessorsInitialized()` → `ProcessorRegistry.getForEntityType()` →
   `processor.processConfig(init)` → frozen `UploadPreparedConfig`.
6. `SessionManager.createSessionFromConfig(config)` — writes the whole config as JSON to
   `upload:session:{nanoid}` in Redis with `SETEX config.ttlSec`. **Redis is mandatory**; there is
   no fallback.
7. Single vs multipart, decided by `config.uploadPlan.strategy`:
   - **single** → `generatePresignedUploadUrl` → S3 **presigned POST** with
     `content-length-range 0..expectedSize` and an exact `Content-Type` condition. Response carries
     `presignedUrl` + `presignedFields`.
   - **multipart** → `startMultipartUploadFromConfig` → `uploadId` +
     `partPresignEndpoint: /api/files/upload/{sessionId}/parts`.
8. `SessionManager.updateSession` writes the presign back onto the session (read-modify-write, no
   CAS).

### 4.2 `POST /api/files/upload/{sessionId}/parts`

Looks up the session, `touchSession`es it (TTL → 600 s), and mints one presigned `UploadPart` URL.
**No authentication.** No `ttlSec` forwarding (parts always get the adapter's 3600 s default). No
bucket forwarding (§11.5).

### 4.3 `POST /api/files/upload/{sessionId}/complete`

`apps/web/src/app/api/files/upload/[sessionId]/complete/route.ts` — 324 lines, explicitly
structured as three phases. **No authentication.**

**Phase 1 — S3, outside the transaction**
- `completeMultipartUploadOnly` if multipart. On failure: mark session `failed`, publish, 500.
- `headByKey` — the real size/mime verification. This is the *only* enforcement that survives a
  lying client on the multipart path.
- `processor.validateCompletedUpload(session, head)` — exact size match, exact mime-family match,
  entity max size, entity allow-list.
- `updateSession` with the canonical size/mime.

**Phase 2 — one `db.transaction`** (see §10 for why this is the problem area)
- `buildExternalUrl` when `visibility === 'PUBLIC'` (I/O inside the tx).
- `createStorageLocation(..., { tx })`.
- `processor.process(session, storageLocationId, { tx })`.
- On any throw: try `deleteByKey` immediately; if that throws, `cleanupService.scheduleCleanup`
  (**a no-op stub**, §11.2); mark session failed; 500.

**Phase 3 — post-commit**
- `updateSession({status:'completed', storageLocationId})`.
- `USER_PROFILE`: `DehydrationService().invalidateUser`, plus `onCacheEvent('agent.updated')`
  when the target is an agent's synthetic user.
- Compute a `downloadUrl` — with a hard-coded `USER_PROFILE` branch that enqueues/awaits an
  `avatar-32` thumbnail before falling back to the original.
- `ProgressPublisher.publishCompleted` → Redis pub/sub → nobody.
- Return `{ assetId, fileId, attachmentId, documentId, url }`.

### 4.4 `GET /api/files/upload/{sessionId}/events`

SSE. Subscribes a dedicated Redis client to `upload:status:{sessionId}`, heartbeats every 30 s,
closes 1 s after a terminal frame. **No authentication** — knowing a session id reveals its status.
No client connects to it (§12.1).

---

## 5. The Storage Layer

> **Being refactored.** Phase 3 of `plans/attachments/` has landed #1823, #1825, #1827 and #1829.
> `StorageManager` is now a shrinking facade over `db`-first functions; the shape below is current
> as of #1829. PR 3d (`storage/presign.ts` + `storage/objects.ts`) is still in flight, so the
> facade's remaining method list will shrink again.

```
storage/  (functions — collaborators arrive as parameters, never constructed)
  ├── buckets.ts          bucketForVisibility / publicCdnUrl / buildExternalUrl / assertBucket   (pure, sync)
  ├── auth.ts             resolveProviderAuth                                    → @auxx/credentials
  ├── providers.ts        the adapter registry + isProviderAvailable / getStorageAdapter
  ├── ports.ts            StoragePort (the side-effecting seam) + createS3StoragePort
  ├── locations.ts        createStorageLocation(tx, ctx, …) / deleteStorageLocation(tx, ctx, …)
  ├── location-queries.ts getStorageLocation(ctx, …) / findStorageLocationByExternalId(ctx, …)
  └── adapters/           S3Adapter + the StorageAdapter interface  (classes, sanctioned by the lib guide)

StorageManager (1,479 lines and falling, org-scoped) — @deprecated facade, deleted in the phase-10 sweep
  ├── presign / multipart / head / delete-by-key      → adapter        (moves to presign.ts / objects.ts in 3d)
  ├── uploadContent / getContent / stream             → adapter
  ├── StorageLocation CRUD                            → delegates to locations.ts / location-queries.ts
  └── enforcePolicy(config)                                            (becomes pure enforceUploadPolicy in 3d)
```

Gone since this section was written: the 29 zero-caller methods (#1825), the folder / search /
webhook surface that existed only for the Drive / Dropbox / OneDrive / Box stubs (#1825), and six
of the nine `StorageCapabilities` flags, which were declared and set but read nowhere (#1827).

`enforcePolicy` (storage-manager.ts:1338) checks four things against the **client-declared**
`expectedSize` and `mimeType` before presigning: key prefix, TTL ceiling, content-length range,
mime allow-list. For single uploads the size and content-type also become S3 POST-policy
conditions, so S3 enforces them for real. For **multipart** they are advisory only — the actual
enforcement is `headByKey` + `validateCompletedUpload` after the bytes are already paid for and
stored.

~~`StorageLocationService` is a **module-level singleton with no organization scope**.~~ **FIXED
(#1829).** The 1,086-line class is deleted. Only four of its methods had a caller; nine had none.
Scope is no longer by convention — `getStorageLocation`, `findStorageLocationByExternalId` and
`deleteStorageLocation` all filter on `ctx.organizationId` in SQL.

One consequence to know: `StorageLocation.organizationId` is **nullable** (declared "for backfill
compatibility"), and the new reads use `eq(...)`, so a row carrying a NULL organization is invisible
to `getStorageLocation` and immune to `deleteStorageLocation`. Every construction site that reaches
these paths supplies a real organization, and `StorageManager` now throws rather than running an
unscoped query when it has none.

---

## 6. The Front End

`apps/web/src/components/file-upload/` — 5,832 lines, a Zustand store split into five slices.

```
useFileUpload(options)                        hooks/use-file-upload.ts   (594)
   └── useUploadStore                         stores/upload-store.ts
         ├── session-slice     client-side session containers + SSE (unused)   (442)
         ├── file-slice        per-file state machine                          (306)
         ├── orchestration-slice  the actual upload driver                   (1,035)
         ├── ui-slice                                                          (240)
         └── entity-slice      deprecated global config                        (117)
```

The real work is `orchestration-slice.startUpload()`: build a pool of `maxConcurrentUploads`
(default 3) workers, and per file do session-create → `directUpload` → complete, updating store
state at each step.

`utils/direct-upload.ts` does the browser-side transfer with `XMLHttpRequest` (for upload progress
events). Multipart is **strictly serial**: 10 MB chunks, and each chunk costs a round-trip to our
server for a presigned URL before the PUT.

Consumers: avatar upload (settings, onboarding, agent hero, resources), record identity header,
dataset documents, file library, custom-field FILE inputs, QC photo strip, file-select.

Two structural smells on this side:

- `startUploadForSession(sessionId)` works by **temporarily reassigning the global
  `activeSessionId`**, calling `startUpload()`, then restoring it. Two concurrent uploaders in the
  same tab race on that global.
- `use-field-file-upload.ts` maintains a **module-level `Map` of completion handlers and a global
  `useUploadStore.subscribe`**, with a 30-minute staleness sweep, because the store has no
  per-uploader completion callback that survives a React unmount.

---

## 7. Door 2 & 3 — the parallel upload paths

### 7.1 Public workflow share uploads

`apps/web/src/app/api/workflows/shared/[shareToken]/files/{sessions,[sessionId]/complete}`

A passport-token-authenticated re-implementation of the same flow for anonymous end users:
Redis key `public-upload:{id}` (different keyspace, different shape), `headByKey`,
`createStorageLocation`, `MediaAssetService.createWithVersion` with `purpose:
'PUBLIC_WORKFLOW_INPUT'` and a 24 h `expiresAt`, then a download ref.

**It does all of this with no transaction and no processor, and it is correct.** That is the most
useful single data point about the main path's `db.transaction`.

### 7.2 Server-side ingest

Inbound mail (`email/inbound/attachment-ingest.service.ts`, `body-ingest.service.ts`), thumbnails
(`thumbnail-service.ts`), PDF render/preview (`documents/`), exports and prints
(`jobs/export/**`), recordings (`recording/`), remote image fetch (`fetch-remote-image.ts`), chat
attachments (`apps/api/src/routes/chat/attachments.ts`). All bypass sessions/processors and call
`StorageManager.uploadContent()` + the services directly.

This is fine and should stay — but it means **the processor system is not the choke point for file
creation**, only for browser uploads. Any invariant expressed only in a processor (`kind`,
`expiresAt`, allow-lists, cache busts) is not enforced for these.

---

## 8. The Read Path

Three different answers to "give me the bytes", with three different designs:

| Route | Design | Auth |
| --- | --- | --- |
| `GET /api/files/download/[fileId]` | **Buffers the entire object into Node memory**, then slices for `Range`. Handles `asset:`/`file:` FileRefs. | session + `PermissionKey.filesView` |
| `GET /api/attachments/[id]/content` | **302 to a presigned URL.** Inline only for png/jpeg/gif/webp. | session + `canViewAttachment` (mail-lens aware) |
| `GET /api/attachments/[id]/{download,thumbnail}` | same redirect shape | same |

The download route's `shouldRenderInline` carefully excludes `image/svg+xml` (stored XSS), which is
right. What is not right is that it is the only content route that streams through us: a 2 GB video
in the file library becomes a 2 GB `Buffer` in the web process before a single byte reaches the
client, and `Range` requests do the full read every time. The attachment routes already show the
correct pattern.

Thumbnails are generated asynchronously (`Queues.thumbnailQueue` → `thumbnail-worker`) into
**separate `MediaAsset` rows** linked by `MediaAssetVersion.derivedFromVersionId` + `preset`.
Presets live in `thumbnail-types.ts` (`avatar-32/64/128/256`, `kb-logo-sm/lg`, …).

---

## 9. Lifecycle, Quota & Cleanup

There are **two unrelated modules both named "cleanup service"**:

- `files/cleanup/cleanup-service.ts` (256 lines) — the S3 compensation queue for the complete
  route. Every persistence method is a `// TODO` that logs and returns. **It does nothing.**
- `files/lifecycle/cleanup-service.ts` (496 lines) — the real reaper functions
  (`deleteExpiredFiles`, `deleteOrphanedFiles`, `deleteEntityFiles`, `cleanupFailedUpload`, …).

Scheduled in `apps/worker/src/workers/index.ts`: `orphanedFileCleanupJob`,
`deletedFileCleanupJob`, `storageQuotaCheckJob`. **Not** scheduled: `quotaEnforcementCleanupJob`.

`TEMP_UPLOAD` assets get an `expiresAt` stamped by the `MESSAGE` / `COMMENT` / `CUSTOM_FIELD` /
`WORKFLOW_RUN` processors, and each of those then calls a private `scheduleCleanup()` that only
logs. The reaping actually depends on `orphanedFileCleanupJob` → `deleteExpiredFiles`, which walks
`FolderFile` — so **`MediaAsset` temp uploads are stamped with an expiry that nothing enforces.**

---

## 10. Transactions — what is actually happening

This is the part worth rewriting.

### 10.1 The transaction is three savepoints deep

`BaseService.getTx()` claims to detect an existing transaction:

```ts
const client = this.db
if (typeof client.transaction !== 'function') return callback(client)   // "already in a tx"
return client.transaction((tx) => callback(tx))
```

In drizzle-orm 0.44, `NodePgTransaction.transaction()` **exists** and issues
`SAVEPOINT sp{n}` (`node-postgres/session.js:206`). So the first branch is **unreachable dead
code** and `getTx` always opens a nested savepoint.

For an avatar upload, the actual statement sequence is:

```
BEGIN                                    ← route: db.transaction
  INSERT StorageLocation                 ← createStorageLocation({tx})
  SAVEPOINT sp1                          ← UserProfileProcessor: mediaAssetService.getTx()
    SELECT MediaAsset …                    findExistingAsset
    SAVEPOINT sp2                        ← createWithVersion → getTx()
      INSERT MediaAsset
      INSERT MediaAssetVersion
    RELEASE sp2
    UPDATE "User" SET avatarAssetId …
  RELEASE sp1
COMMIT
```

Nothing needs partial rollback anywhere in that tree. All three levels either succeed together or
must fail together. Every savepoint is pure overhead and pure confusion.

Compounding it, `BaseProcessor.process()` **mutates the instance** to bind the transaction:

```ts
this.mediaAssetService = this.mediaAssetService.withTx(opts.tx)   // permanent for this instance
```

…and then `createAsset` defensively wraps again (`tx ? this.mediaAssetService.withTx(tx) : …`).
Double-binding is currently harmless because processors are constructed per-request by the
registry factory — but it is a landmine the moment anyone caches a processor.

### 10.2 Network I/O inside the transaction

`buildExternalUrl` runs **inside** `db.transaction`. It resolves the adapter and, when
`session.credentialId` is set, calls `getProviderAuth` → credential decryption. Whatever latency
that has is latency the Postgres connection is held open for, on the hottest write path in the
subsystem. Its result is only a string built from config; it has no reason to be there.

**There is a second credential fetch in the same transaction, and it is worse.** Found during the
Phase-2 write pilot, not the original survey: `createStorageLocation` →
`prepareLocationMetadata` (storage-manager.ts:~999) → `resolveS3BucketForLocation` →
`getProviderAuth` → **`revealSecrets(credentialId, orgId)`** — a database read *plus* a decrypt,
wrapped in a `try/catch` that swallows failure into a `logger.warn`. It exists solely to **guess a
bucket** when the caller did not supply one.

So the completion transaction holds its connection open across two independent credential
resolutions, one of which is a fallback for information the caller already had. Requiring `bucket`
on the input **deletes** that path rather than moving it — which is what
`files/storage/locations.ts` does. The pure remainder is: merge caller metadata, write `bucket`
last (so an inherited `metadata.bucket` cannot beat the bucket actually uploaded to), default `key`
from `externalId`.

### 10.3 ~~BullMQ jobs enqueued inside the transaction — and they read stale data~~ — FIXED (#1818)

`UserProfileProcessor.executeProcess` has this comment:

```ts
// Generate thumbnails AFTER transaction commits
await this.generateAvatarThumbnails(session, result.assetId)
```

That is **false**. It runs after `RELEASE sp1`, not after `COMMIT` — the route's transaction is
still open. `generateAvatarThumbnails` → `ensureThumbnailPresets` → `new ThumbnailService(org,
user)` with the **global `db`**, i.e. a different connection.

Consequences, both real:

- **First avatar upload:** `resolveVersion` cannot see the uncommitted `MediaAsset` and throws
  `Asset not found: …`. Swallowed by the processor's try/catch and logged. Every one of the four
  avatar presets is wasted work that always fails. The route's Phase-3 `avatar-32` enqueue is what
  actually produces a thumbnail.
- **Re-uploading an avatar:** the asset row exists but its `currentVersionId` still points at the
  *previous* version outside the tx, so `findByVersionAndPreset` finds the old thumbnail and
  returns `status: 'ready'`. **`avatar-64/128/256` silently keep showing the old image.**

`KnowledgeBaseProcessor` has the identical structure and the identical staleness window.

Beyond staleness: enqueueing a job inside an open transaction means a worker can pick it up before
`COMMIT`, and the job survives a `ROLLBACK`. Jobs must be enqueued post-commit, from the route.

### 10.4 ~~The compensation path does not compensate~~ — FIXED (#1816, #1818)

On `db.transaction` failure the route tries `deleteByKey` and, if that throws,
`cleanupService.scheduleCleanup` — which logs `"Would store cleanup task"` and returns.

Worse, `deleteByKey` takes **no `bucket`**. `S3Adapter.deleteFile` resolves the target through the
shared `parseS3Location` helper (s3-adapter.ts:867), whose fallback chain when the location carries
no `metadata.bucket` and the `externalId` is a bare key is `auth.bucket → S3_PRIVATE_BUCKET` — and
`auth.bucket` is itself `S3_PRIVATE_BUCKET`, because it comes from `resolvePlatformAuth()`. So for a
**PUBLIC** upload (avatar, KB logo, chat-widget logo, article cover) the compensation deletes a
nonexistent key in the *private* bucket, S3 answers 204, and the real object leaks with **no error
and no log**.

> `parseS3Location` is shared with `getMeta` / `fileExists` / `getDownloadRef`, so the fallback
> cannot simply be removed — the read paths depend on it. `deleteFile` needs its own strict
> resolver.

### 10.5 What the transaction is actually protecting

`StorageLocation` + `MediaAssetVersion` + `MediaAsset` (+ `Attachment`) + one host-row update.
That is a genuine unit — but the *cost* of getting it wrong is one orphan row referencing a real
S3 object, which the cleanup jobs already exist to sweep. Door 2 (§7.1) writes the same rows with
no transaction at all and has never been reported as a problem.

**Recommendation:** keep exactly one `BEGIN…COMMIT`, open it in one place, pass `tx` explicitly
down as a parameter, and delete `getTx` entirely. Nothing below the route should be able to start
a transaction.

---

## 11. Correctness Findings

> **Status as of 2026-08-21 — Tier 1 is complete.** 11.1–11.6 are FIXED on `main`
> (#1816, #1817, #1818), each with a regression test that was confirmed red first.
> 11.7–11.10 remain open and are folded into the refactor phases rather than
> patched — see `plans/attachments/`. Findings are kept here rather than deleted
> because the *reasoning* is the durable part; this section is rewritten to
> as-built when the refactor lands.

Ordered by impact. Each was verified against the code and, where noted, the dev database.

### 11.1 ~~The storage quota is always zero~~ — FIXED (#1816, #1818)

`files/lifecycle/quota-cleanup.ts:23`:

```ts
.from(schema.FileVersion)
.leftJoin(schema.File, eq(schema.FileVersion.fileId, schema.File.id))
.where(and(eq(schema.File.organizationId, organizationId), isNull(schema.File.deletedAt)))
```

`FileVersion.fileId` FKs to **`FolderFile`**, not `File` (`schema/file-version.ts:29`). They are
different tables with disjoint id spaces. The `LEFT JOIN` never matches, the `WHERE` on the right
side then discards every row, `sum()` returns `NULL`, and `totalUsed` is `0`.

Verified on the dev database:

```
File rows: 0     FolderFile rows: 1     FileVersion rows: 1
FileVersion ⋈ File: 0        FileVersion ⋈ FolderFile: 1
MediaAsset rows: 3,737       Σ MediaAssetVersion.size: 1,640,968,278 bytes (1.6 GB)
```

Two bugs stacked: the wrong table, **and** the query only ever considered `FolderFile` in the first
place — every avatar, mail attachment, comment attachment, custom-field file, KB logo and dataset
document is a `MediaAsset` and would be invisible even after fixing the join. The gate in
`sessions/route.ts` is decorative, and `storageQuotaCheckJob` never warns anyone.

This is a billing-surface bug, not a cosmetic one.

### 11.2 ~~Orphaned S3 objects leak silently on transaction failure~~ — FIXED (#1816, #1817, #1818)

§10.4. `scheduleCleanup` persists nothing, and `deleteByKey` targets the wrong bucket for every
PUBLIC upload. Both halves of the compensation are non-functional for the public bucket.

### 11.3 ~~`visit_qc_item` uploads produce the wrong record~~ — FIXED (#1816, #1818)

`ENTITY_TYPES.VISIT_QC_ITEM = 'visit_qc_item'` (note: the only lowercase value in the enum) has
**no processor registered** in `processors/index.ts`, so `ProcessorRegistry.getForEntityType` falls
through to `setDefaultProcessor(FileProcessor)`. That creates a `FolderFile`, not a
`MediaAsset` + `Attachment`.

The client then does:

```ts
// orchestration-slice.ts — set at session create
f.serverFileId = presignedConfig.sessionId
// …and only overwritten if the server returned an assetId
if (completionData?.assetId) f.serverFileId = completionData.assetId
```

`FileProcessor` returns `{ fileId }`, no `assetId`. So `serverFileId` stays the **upload-session
nanoid**, and `use-file-upload.ts:388` reports it as `metadata: { assetId: f.serverFileId }`.
`qc-photo-strip.tsx` passes that to `addVisitQcItemPhoto` → `AttachmentService.create({ assetId })`
with an id that is not a `MediaAsset`.

Dev database corroborates: `Attachment` has rows for `MESSAGE`, `CUSTOM_FIELD`, `COMMENT`,
`FIELD_VALUE`, `ARTICLE`, `KNOWLEDGE_BASE`, `CHAT_WIDGET` — and **zero for `visit_qc_item`**.

(Separately: `FIELD_VALUE` appears in `Attachment.entityType` but is not in `ENTITY_TYPES` — a
fourth writer outside the processor registry.)

### 11.4 ~~`complete`, `parts` and `events` have no authentication~~ — FIXED (#1818)

None of the three call `auth.api.getSession`. The session nanoid is the only credential. The
`complete` route then performs DB writes attributed to `session.userId` and `session.organizationId`
read out of Redis.

This is a bearer-capability model, which is defensible — but it is nowhere documented, the token is
never bound to the caller, and it means:

- authorization is evaluated **only** at session-create time; a permission revoked mid-upload is
  not re-checked at completion;
- `parts` will mint presigned `UploadPart` URLs for arbitrary part numbers to anyone holding the id;
- `events` discloses upload status for any known id;
- there is no origin/CSRF consideration on a state-changing `POST`.

Fix: re-authenticate on all three and assert `session.userId === caller.id` (and org match).

### 11.5 ~~Multipart parts and completion always target the private bucket~~ — FIXED (#1816, #1818)

`StorageManager.generatePartUploadUrl`, `completeMultipartUploadOnly` and `deleteByKey` do not
accept or forward a `bucket`. `S3Adapter.presignPart` / `completeMultipart` fall back to
`S3_PRIVATE_BUCKET`.

`startMultipartUploadFromConfig` *does* pass `config.bucket`. So a multipart upload into the
**public** bucket initiates in the public bucket and then presigns its parts against the private
one — `NoSuchUpload`. Latent today only because every PUBLIC entity type caps below its multipart
threshold (avatar 5 MB, KB/widget/article-cover 10 MB vs a 25–50 MB threshold). Raise any of those
caps and it breaks.

### 11.6 ~~`SETEX` with a zero TTL on long multipart uploads~~ — FIXED (#1816)

`SessionManager.touchSession` resets the Redis TTL to `DEFAULT_TTL` (600 s) but **does not update
`session.expiresAt`**. `SessionManager.updateSession` computes:

```ts
const remainingTtl = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000))
await redis.setex(key, remainingTtl, …)
```

A multipart upload longer than `ttlSec` keeps the key alive via `touchSession` while `expiresAt`
goes into the past. The next `updateSession` — which `complete` calls in Phase 1 — passes
`remainingTtl = 0`, and ioredis surfaces `ERR invalid expire time in 'setex' command`. The upload
completes to a 500 after the bytes are already in S3.

### 11.7 ~~Type-safety leaks in `DatasetAssetProcessor`~~ — FIXED (#1827)

`entityType = 'dataset'`, `fileVisibility = 'private'`, `preferredProvider = 'local'` — all
lowercase, while `BaseAssetProcessor.processConfig` did `this.fileVisibility as 'PUBLIC' |
'PRIVATE'` and `getBucketForVisibility` compared against `'PUBLIC'`.

**This survey under-called it.** The original note says it "lands in the private bucket by accident,
not by intent" — it did not. `bucketForVisibility` matched *neither* branch, so the upload was
presigned into the **PUBLIC** bucket. Worse, the same field feeds
`BaseAssetProcessor.isAssetPrivate()`, a `=== 'PRIVATE'` comparison whose result is written to
`isPrivate` on the created asset — so every dataset document was **recorded as non-private as well
as stored publicly**. It was a data bug, not just a routing one.

Fixed by typing the field as the named `StorageVisibility` union (`storage/buckets.ts`) instead of
`string`, which turns both into compile errors; the enabling `as 'PUBLIC' | 'PRIVATE'` cast is gone.
`dataset.ts` was the only wrong declaration — the other nine were already uppercase.

**Not fixed:** `preferredProvider = 'local'` is still not a `ProviderId`, and is still read nowhere
(§12.3). Existing dataset rows written before #1827 keep whatever `isPrivate` and bucket they were
given — the fix stops new ones and says nothing about a backfill.

### 11.8 Empty and commented-out `validateEntityAccess` — OPEN (refactor phase 4)

- `WorkflowRunProcessor.validateEntityAccess` — entire body commented out. Combined with `*/*` and
  50 MB, any authenticated org member can upload anything against any `entityId`.
- `CustomFieldProcessor.validateEntityAccess` — returns early for `field-`-prefixed ids and then
  **falls off the end**, so every other id also passes.
- `ArticleProcessor` / `CommentProcessor` check org membership of the entity only, with a
  `// Add user access validation based on your business rules` TODO.

Note these are *entity* checks, not the L2 permission gate — the host surfaces carry that. But the
processor is the layer that claims to do it.

### 11.9 Errors are classified by substring matching — PARTLY FIXED (#1818 maps AuxxError at the routes; the substring classifier survives until phase 4)

`packages/lib/src/files/**` throws bare `new Error(...)` everywhere — including in
`processConfig`, where a mime rejection is a 400/415, not a 500. `UploadErrorHandler.categorizeError`
then greps the message (`includes('storage')`, `includes('s3')`, `includes('bucket')`, …) to pick an
HTTP status.

This violates the repo rule (`CLAUDE.md` → *Error Handling*): lib throws `AuxxError` subclasses and
the mapping is mechanical. It also forces `sessions/route.ts` to invent a fake session id
(`temp-${Date.now()}`) just to satisfy the handler's signature, and to special-case the permission
error by hand so the 403 survives.

### 11.10 Smaller items — OPEN

- `deriveStorageKey` uses `Date.now()` with no random suffix. Two files with the same name for the
  same entity in the same millisecond collide, and the second silently overwrites the first.
- `SessionManager.updateSession` is read-modify-write with no CAS. The `parts` route touches the
  same key concurrently with `complete`.
- `SessionManager.completeUpload` stores a **storage key** in the `storageLocationId` field
  ("Temporary, will be replaced"). Nothing calls it.
- `presignUpload` passes upload metadata as raw S3 POST `Fields` rather than `x-amz-meta-*`, so the
  `sessionId`/`orgId`/`uploader` tags do not land on the object as user metadata. Nothing reads
  them back, so this is currently invisible — worth confirming before relying on object metadata.
- The `complete` route hard-codes a `USER_PROFILE` branch (dehydration, agent cache bust, avatar-32
  thumbnail) that belongs behind a processor hook.

---

### 11.11 Found while fixing the above (not in the original survey)

Each was invisible to the survey because it sat behind another bug, and each is
fixed on `main`:

- **`sum()`/`count()` over `bigint` return strings** from node-postgres, so even a
  corrected quota query yielded a string `totalUsed` and the gate would have
  string-concatenated rather than added.
- **`touchSession` extended by a 600s constant, not the session's own `ttlSec`**, so
  a `FileProcessor` session with a 1-hour TTL touched five minutes in was cut from
  55 minutes of remaining life to 10.
- **`StorageManager.deleteFile` called `buildLocationRef` before `getAdapter`**, so on
  a cold adapter cache legacy rows resolved no bucket at all — harmless while the
  adapter silently defaulted, fatal once it throws.
- **The over-quota branch compared rounded `percentUsed >= 100`**, so 99.6% of the cap
  read as 100 and would have enforced against an org that is under.
- **`use-file-select.ts` fell through to the client temp id** once `assetId` became
  correctly undefined for `FILE` uploads.
- **`file-download-permission.test.ts` had never run its happy paths** — the `request()`
  stub lacked `nextUrl`, so all four 500'd, and the mocked response builder returned
  only `Content-Type`, so its header assertions tested the literal.

Still open, found here but out of Tier-1 scope:

- **`users/user-avatar-service.ts` calls `putObject` with neither `bucket` nor
  `visibility`**, so it falls back to `S3_PRIVATE_BUCKET` — and `USER_PROFILE` is a
  PUBLIC entity type. It also inserts `StorageLocation` directly, bypassing
  `StorageManager`, so its rows carry no `metadata.bucket` and cannot be deleted by
  key. Needs its own investigation.
- ~~**`StorageLocationService.create()`/`bulkCreate()`** are a second write door that
  bypasses bucket normalisation.~~ **CLOSED (#1829)** — the class is deleted and
  `createStorageLocation` in `storage/locations.ts` is now the only write door.
  `user-avatar-service.ts` (above) remains a genuine third door: it inserts
  `StorageLocation` directly.
- **There is still no storage warning tier.** `storageGbSoft` is now read as a warn
  threshold, but the branch only increments a counter behind a `TODO` — no email,
  notification or banner, and no dedup marker for a daily job.

---

## 12. Overcomplication & Dead Code

Roughly **3,660 lines** of the subsystem are unreachable or stubbed.

### 12.1 The entire progress/SSE stack is dead (~2,900 lines)

| File | Lines | Status |
| --- | --- | --- |
| `upload/progress/enhanced-progress-tracker.ts` | 480 | no importer |
| `upload/progress/sse-publisher.ts` | 425 | imported only by dead code |
| `upload/progress/progress-tracker.ts` | 374 | " |
| `upload/progress/event-types.ts` | 322 | " |
| `upload/progress/event-schemas.ts` | 278 | " |
| `upload/upload-session-service.ts` (`FileUploadSession`) | 453 | exported from `server.ts`, zero callers |
| `upload/enhanced-types.ts` | 393 | barrel re-export only |
| `upload/progress-publisher.ts` | 120 | writes to a channel nobody reads |
| `apps/web/.../upload/[sessionId]/events/route.ts` | 109 | no client connects |
| `components/file-upload/utils/sse-connection.ts` | 341 | `connectSSE` only called by `coordinateSSEEvents`, which nothing calls |

`session-slice.ts:112` documents the reason in a comment: the client-side session id is not the
server session id, so connecting SSE would 404 — *"If/when SSE is required, connect using the
server-provided sessionId."* Nobody ever did. The `complete` response already returns everything
the SSE frame would have carried.

**Two competing session abstractions exist**: `SessionManager` (static, Redis, used) and
`FileUploadSession` (instance, in-memory, with its own status machine, progress tracker and event
publisher — dead). Both are exported side-by-side from `files/server.ts`.

### 12.2 Two "cleanup services", one of which does nothing

§9. `files/cleanup/` (all stubs, referenced by the hot path) vs `files/lifecycle/` (real,
referenced by the worker). Same name, opposite reality.

### 12.3 Ceremony that produces nothing

- `preferredProvider` — an abstract field every processor must declare. Read nowhere; the provider
  comes from `init.provider ?? 'S3'`.
- `ProcessorMetadata` (`getMetadata()`, `supportsAssets/Files/Attachments`) — implemented by every
  processor, called by nothing.
- `processors/types.ts` declares `SessionMetadata`, `PreprocessResult`, `UploadPreferences`,
  `CreateSessionRequest`, `ProcessorMetadata` — a whole parallel type vocabulary next to
  `init-types.ts`'s `UploadInitConfig` / `UploadPreparedConfig`, which is what the code actually uses.
- `ProcessorRegistry` has `unregisterProcessor`, `clear`, `getRegisteredTypes`,
  `getProcessorCount`, `hasProcessor`, `isInitialized`, plus a separate module-level
  `processorsInitialized` boolean shadowing the class's own `initialized` flag — for a map of ten
  hard-coded entries built by one function.
- `BaseService` (582 lines) defines ~15 CRUD methods whose implementation is
  `throw new Error('… must be implemented by subclass')`, plus `bulkCreate`/`bulkUpdate`/`bulkDelete`
  that loop over those throwing methods. It is an abstract class that provides `withTx`, `getTx`,
  `buildBaseWhereClause`, `requireRow` — four useful things wrapped in 500 lines of scaffolding.

### 12.4 God objects

Line counts as of #1829. Only `storage/` has been through the refactor so far; the `core/` services
are phase 5 and are untouched.

| File | Lines | |
| --- | --- | --- |
| `core/file-service.ts` | 1,982 | phase 5 |
| `core/folder-service.ts` | 1,945 | phase 5 |
| `core/media-asset-service.ts` | 1,591 | phase 5 |
| `storage/storage-manager.ts` | **1,479** | was 2,512 — facade, falling; 3d in flight |
| `core/filesystem-service.ts` | 1,427 | phase 5 |
| `core/attachment-service.ts` | 1,386 | phase 5 |
| `components/file-upload/stores/slices/orchestration-slice.ts` | 1,054 | phase 8 |
| ~~`storage/storage-location-service.ts`~~ | ~~1,016~~ | **deleted (#1829)** |

What replaced the deleted surface is small and testable without mocks: `storage/buckets.ts` (140),
`storage/locations.ts` (259), `storage/location-queries.ts` (120), `storage/providers.ts` (114),
`storage/auth.ts` (97), on top of `storage/ports.ts` (329) from #1820.

`StorageManager` used to own presigning, multipart, adapter loading, credential resolution, bucket
routing, `StorageLocation` persistence, folder listing, provider search, webhook processing, health
checks and usage statistics. The last five are **gone** (#1825) — folders, search and webhooks
existed only for the Drive/Dropbox/OneDrive/Box stubs. Adapter loading moved to `storage/providers.ts`,
credential resolution to `storage/auth.ts`, bucket routing to `storage/buckets.ts` and persistence to
`storage/locations.ts` + `location-queries.ts`. Presigning and multipart are what 3d takes.

### 12.5 Module-shape violations vs `docs/lib-module-guide.md`

The guide says: exported `async function`s with `db` first, no service classes,
`Promise<Result<T, Error>>`, `AuxxError` subclasses, reads and writes in separate files, explicit
named exports.

`packages/lib/src/files/**` was the opposite on every axis: deep class hierarchies with constructor
state, bare `Error`, `throw`-based control flow, `export *` in `processors/index.ts`, and
`any`-typed `tx` parameters throughout. It predates the guide, but it is also the largest module in
`lib`, so it is what people copy.

**Partly addressed.** `files/ctx.ts` (#1820) defines the contract, and everything under
`files/storage/**` plus `assets/download.ts` now follows it: `db` arrives on a `ctx: FilesCtx`,
transaction-only functions take `tx: Transaction` positionally first so a pool cannot typecheck into
the slot, and results are `neverthrow` `Result` with `AuxxError` subclasses. **New code in `files/`
copies those files, not the `core/` services**, which are still class-shaped until phase 5.

The test-shape payoff is the thing to notice: the doubles in `files/__tests__/support/` mean the
storage tests use **zero `vi.mock`** — see `storage/__tests__/locations.test.ts` and
`location-queries.test.ts`. Compare `core/__tests__/thumbnail-service.test.ts`, which still hand-rolls
~120 lines of Drizzle builder chains before its first assertion.

### 12.6 `files/types` is a second, undeclared client entry point

`CLAUDE.md` says client code imports from `@auxx/lib/<module>/client`. `files/client.ts` exports
only file-type constants. Meanwhile the whole front end imports `@auxx/lib/files/types`, which is
its own `exports` subpath and ships **runtime values** — `ENTITY_CONFIGS`, `getEntityConfig`,
`FileUploadEventType`, `FileUploadEventValidator`, `DataTransforms`, `TypeGuards` — into the
browser bundle. It happens to be server-dependency-free today; nothing enforces that.

---

## 13. A Target Design

Not a rewrite — a sequence of independent, shippable changes, most valuable first.

**Tier 1 — correctness (do these regardless of any refactor)**

1. Fix `calculateStorageUsage`: join `FileVersion → FolderFile`, and `UNION` in
   `MediaAssetVersion → MediaAsset`. Decide whether thumbnails count. (§11.1)
2. Authenticate `complete`, `parts`, `events`; assert caller identity matches `session.userId`
   and org. (§11.4)
3. Move `ensureThumbnailPresets` out of every processor and into the route's Phase 3, after
   `COMMIT`. Delete the misleading "AFTER transaction commits" comments. (§10.3)
4. Thread `bucket` through `generatePartUploadUrl`, `completeMultipartUploadOnly` and
   `deleteByKey`. (§11.5, §11.2)
5. Have `touchSession` update `expiresAt` too, and floor `remainingTtl` at 1. (§11.6)
6. Either register a `VisitQcItemProcessor` (attachment-producing) or remove the entity type and
   the uploader. Meanwhile, make `getForEntityType` **throw** on an unregistered type instead of
   silently defaulting to `FileProcessor`. (§11.3)
7. Fill in `WorkflowRunProcessor.validateEntityAccess` and `CustomFieldProcessor`'s fall-through.
   (§11.8)

**Tier 2 — the transaction**

8. Delete `BaseService.getTx()`. Every service method that writes takes `tx: Transaction` as an
   explicit parameter. One `BEGIN…COMMIT`, opened by the route.
9. Move `buildExternalUrl` out of the transaction — compute it in Phase 1 alongside `headByKey`.
10. Change `BaseProcessor.process` to build tx-bound services into **locals**, never onto `this`.
11. Make the compensation real: either implement `scheduleCleanup` on Redis/BullMQ, or delete it
    and rely on a `deleteOrphanedStorageObjects` sweep job. Do not keep a stub on the hot path.

**Tier 3 — deletion**

12. Delete `upload/progress/**`, `upload/progress-publisher.ts`, `upload/upload-session-service.ts`,
    `upload/enhanced-types.ts`, the `events` route, and `components/file-upload/utils/sse-connection.ts`
    with its `session-slice` wiring. (~2,900 lines)
13. Delete `files/cleanup/` once §11.2 is resolved; rename `files/lifecycle/cleanup-service.ts` to
    something that says what it reaps.
14. Delete `preferredProvider`, `getMetadata`/`ProcessorMetadata`, and the unused half of
    `processors/types.ts`.

**Tier 4 — shape**

15. Errors: `AuxxError` subclasses from lib; delete `categorizeError`'s substring ladder and the
    `temp-${Date.now()}` fake session id.
16. Split `StorageManager`: `storage/presign.ts`, `storage/objects.ts`, `storage/locations.ts`,
    `storage/providers.ts`. Drop folder/search/webhook until a non-stub adapter needs them.
17. Move the `USER_PROFILE` branches out of `complete/route.ts` into a processor
    `afterCommit(session, result)` hook, so the route stops knowing about avatars.
18. Make `/api/files/download/[fileId]` redirect to a presigned URL like the attachment routes do,
    instead of buffering. (§8)
19. Promote what the front end needs from `files/types` into `files/client.ts` and make
    `files/types` server-only.

---

## 14. Key Files

**Routes**
```
apps/web/src/app/api/files/upload/sessions/route.ts               session create + gates
apps/web/src/app/api/files/upload/[sessionId]/parts/route.ts      per-part presign
apps/web/src/app/api/files/upload/[sessionId]/complete/route.ts   the 3-phase completion
apps/web/src/app/api/files/upload/[sessionId]/events/route.ts     SSE (dead)
apps/web/src/app/api/files/download/[fileId]/route.ts             buffered download
apps/web/src/app/api/attachments/[attachmentId]/{content,download,thumbnail}/route.ts
apps/web/src/app/api/workflows/shared/[shareToken]/files/**       parallel public flow
```

**Upload pipeline** (`packages/lib/src/files/upload/`)
```
session-manager.ts          Redis session CRUD (the live one)
init-types.ts               UploadInitConfig / UploadPreparedConfig / UploadPolicy / UploadPlan
util.ts                     deriveStorageKey, getBucketForVisibility, getPublicCdnUrl
error-handling.ts           UploadErrorHandler (substring classification)
processors/
  processor-registry.ts     EntityType → factory
  index.ts                  initializeProcessors() — the registration table
  base-processor.ts         processConfig / validateCompletedUpload / process
  base-asset-processor.ts   + createAsset, policy clamping
  base-attachment-processor.ts + createAttachment
  entity-processors.ts      the eight concrete entity processors
  file-processor.ts         FolderFile fallback
  dataset.ts                DATASET → MediaAsset + Document + parse queue
```

**Storage** (`packages/lib/src/files/storage/`, `adapters/`)
```
storage-manager.ts          god object; enforcePolicy at :1338
storage-location-service.ts unscoped singleton, StorageLocation CRUD
adapters/s3-adapter.ts      presignUpload / presignPart / completeMultipart / head / delete
adapters/base-adapter.ts    StorageAdapter contract + ProviderId
```

**Core services** (`packages/lib/src/files/core/`)
```
base-service.ts             withTx / getTx / buildBaseWhereClause (+ 500 lines of throw-stubs)
media-asset-service.ts      createWithVersion, updateContent, getDownloadRef/Url
file-service.ts             FolderFile + FileVersion
attachment-service.ts       Attachment
folder-service.ts / filesystem-service.ts   the file-library tree
thumbnail-service.ts / thumbnail-batch.ts / thumbnail-enqueue.ts
```

**Lifecycle**
```
packages/lib/src/files/cleanup/cleanup-service.ts     S3 compensation (all stubs)
packages/lib/src/files/lifecycle/cleanup-service.ts   the real reapers
packages/lib/src/files/lifecycle/orphaned-cleanup.ts  orphanedFileCleanupJob, deletedFileCleanupJob
packages/lib/src/files/lifecycle/quota-cleanup.ts     calculateStorageUsage (broken), quota jobs
apps/worker/src/workers/index.ts                      job scheduling
```

**Front end** (`apps/web/src/components/file-upload/`)
```
hooks/use-file-upload.ts               the public hook
stores/slices/orchestration-slice.ts   startUpload — the real driver
utils/direct-upload.ts                 XHR to S3, single + serial multipart
stores/slices/session-slice.ts         client session containers + dead SSE wiring
ui/{avatar-upload,file-queue-manager,file-item}.tsx
```
