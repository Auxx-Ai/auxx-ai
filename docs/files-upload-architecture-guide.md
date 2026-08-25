<!-- docs/files-upload-architecture-guide.md -->

# Files & Upload Architecture Guide

**Last Updated:** 2026-08-24 — describes `main` at `36e1f105f`
**Scope:** *"A user picked a file. What happens?"* The complete path from a browser file picker
through presigned S3, into `StorageLocation` / `MediaAsset` / `FolderFile` / `Attachment` rows, and
back out through the download and thumbnail read paths. Plus the parallel doors that bypass this
path, the cleanup jobs that reap it, and what is still open.

> Code described: `apps/web/src/app/api/files/**`, `apps/web/src/app/api/attachments/**`,
> `packages/lib/src/files/**`, `apps/web/src/components/file-upload/**`.
> Companions: `lib-module-guide.md` (the module shape this subsystem now follows),
> `channels-mail-architecture-guide.md` (inbound mail attachments — a different door into the same
> tables), `ui-design-guide.md`.
> **Where this guide and the code disagree, the code is the truth.**
>
> **This is an as-built description, not a plan.** `packages/lib/src/files/**` was rewritten across
> 27 PRs between 2026-08-21 and 2026-08-24 (#1816 … #1859). §11 is the short version of what
> changed and when; §12 is the honest list of what is still broken or unfinished. The remaining
> work — deleting the four `core/` facades and `BaseService`, phase 6's `getTx` removal, the front
> end's 8b/8c — is tracked in `plans/attachments/10-rollout-checklist.md` (untracked).

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [The Data Model](#2-the-data-model)
3. [Entity Types & the Handler Table](#3-entity-types--the-handler-table)
4. [Door 1 — the browser presigned flow (the main path)](#4-door-1--the-browser-presigned-flow-the-main-path)
5. [The Storage Layer](#5-the-storage-layer)
6. [The Module Contract — `files/ctx.ts`](#6-the-module-contract--filesctxts)
7. [The Front End](#7-the-front-end)
8. [Doors 2 & 3 — the parallel upload paths](#8-doors-2--3--the-parallel-upload-paths)
9. [The Read Path](#9-the-read-path)
10. [Lifecycle, Quota & Cleanup](#10-lifecycle-quota--cleanup)
11. [What we fixed, and when](#11-what-we-fixed-and-when)
12. [What is still open](#12-what-is-still-open)
13. [Key Files](#13-key-files)

---

## 1. Executive Overview

There is one intended upload path and two that grew alongside it.

The intended path is **three HTTP round-trips against our server plus a direct PUT/POST to S3**:

```
BROWSER                         apps/web (Node)                    S3            POSTGRES
   │
   │ 1. POST /api/files/upload/sessions
   │──────────────────────────────────▶ auth + files.manage gate (FILE only)
   │                                    agent-avatar admin gate (USER_PROFILE)
   │                                    storage quota gate (fails open)
   │                                    prepareUpload(ctx, deps, init)
   │                                      getUploadHandler(entityType)   ← throws on unknown
   │                                      handler.normalizeInit / validateEntity
   │                                      buildUploadConfig  (pure)
   │                                      handler.refineConfig           ← CUSTOM_FIELD only
   │                                      createUploadSession → Redis, SETEX ttlSec
   │                                      presignUpload | startMultipartUpload
   │◀───────────────────────────────────  { sessionId, uploadMethod, presignedUrl, … }
   │
   │ 2. POST/PUT the bytes straight to S3
   │─────────────────────────────────────────────────────────────▶ object lands
   │   (multipart: N × POST /upload/{id}/parts for a per-part URL,
   │    then N × PUT — serial, one round-trip to us per part)
   │
   │ 3. POST /api/files/upload/{sessionId}/complete
   │──────────────────────────────────▶ authorizeUploadSession (session must be the caller's)
   │                                    completeUpload(ctx, deps, session, body)
   │                                    ┌ PHASE 1 — storage only ──────────────┐
   │                                    │ completeMultipart (if multipart)     │
   │                                    │ headObject      ────────▶ verify     │
   │                                    │ validateCompletedUpload              │
   │                                    │ buildPublicUrl  (sync, no I/O)       │
   │                                    └──────────────────────────────────────┘
   │                                    ┌ PHASE 2 — one BEGIN…COMMIT ──────────┐
   │                                    │ createStorageLocation(tx, txCtx, …)  │
   │                                    │ persistUpload(tx, ctx, …)            │
   │                                    │   → MediaAsset + MediaAssetVersion   │
   │                                    │     or FolderFile + FileVersion      │
   │                                    │     (+ Attachment)                   │
   │                                    │   → handler.onPersist                │
   │                                    └──────────────────────────────────────┘
   │                                    ┌ PHASE 3 — after COMMIT ──────────────┐
   │                                    │ handler.afterCommit (cache busts)    │
   │                                    │ ensureThumbnailPresets → BullMQ      │
   │                                    │ getAssetDownloadRef → preview url    │
   │                                    └──────────────────────────────────────┘
   │◀───────────────────────────────────  { assetId | fileId, attachmentId, url, … }
```

The whole SSE/progress stack that used to sit beside this is **gone** (#1841): no
`GET /upload/{sessionId}/events` route, no Redis progress pub/sub, no client-side SSE. The client
reads its result from the `complete` response body, which is what it always did.

The two other doors:

- **Public workflow share uploads** — `/api/workflows/shared/[shareToken]/files/**`. A passport-token
  re-implementation for anonymous end users: its own Redis keyspace, its own storage key format, no
  handler, no quota gate. It writes the same rows and it works. §8.1.
- **Server-side ingest** — inbound mail attachments, thumbnails, PDF renders, exports, recordings,
  chat attachments. These call `StorageManager.uploadContent()` directly and then the lib write
  functions. They never touch sessions or handlers. §8.2.

---

## 2. The Data Model

Five tables carry a file. Understanding which combination a given upload produces is the single
most important thing about this subsystem.

| Table | What it is | Written by |
| --- | --- | --- |
| `StorageLocation` | The bytes. Provider + bucket (in `metadata.bucket`) + key + etag + size + mime. Org-scoped, soft-deletable. | `createStorageLocation(tx, ctx, input)` — `storage/locations.ts:173` |
| `MediaAsset` | A logical, versioned media object: `kind` (`USER_AVATAR`, `EMAIL_ATTACHMENT`, `INLINE_IMAGE`, `THUMBNAIL`, `DOCUMENT`, `TEMP_UPLOAD`, …), `purpose`, `isPrivate`, `currentVersionId`, `expiresAt`. | `createAssetWithVersion(tx, ctx, deps, input)` — `assets/asset-mutations.ts` |
| `MediaAssetVersion` | One version of an asset → one `StorageLocation`. Thumbnails are **separate `MediaAsset`s** whose versions carry `derivedFromVersionId` + `preset`. | same, plus `updateAssetContent` — `assets/version-mutations.ts` |
| `FolderFile` + `FileVersion` | The user-facing *file library* (folder tree, rename, move, versions). `FileVersion.fileId` FKs to **`FolderFile`** (`schema/file-version.ts:29`). | `createFolderFileWithVersion(tx, ctx, deps, input)` — `folder-files/file-mutations.ts` |
| `Attachment` | The join from an asset (or a file) to a host entity: `(entityType, entityId, assetId \| fileId, role, title, caption)`, optionally *pinned* to a specific `assetVersionId` / `fileVersionId`. | `createAttachment(ctx, input)` — `attachments/attachment-mutations.ts` |

**A file is `StorageLocation` + (`MediaAsset`+version **or** `FolderFile`+version) + optionally an
`Attachment`.** Which combination you get is decided by `handler.persist`
(`upload/handlers/types.ts`), and the wrong choice silently produces the wrong record type rather
than an error. That is not hypothetical: `visit_qc_item` shipped with no registration at all, fell
through to the default file-library processor, and produced a `FolderFile` with no `assetId` for a
surface that needed a `MediaAsset` + `Attachment` (fixed in #1816; made unrepresentable in #1859 by
`satisfies Record<EntityType, UploadHandler>` on `UPLOAD_HANDLERS`).

There is also a legacy **`File`** table (`packages/database/src/db/schema/file.ts`) that is
**empty and unused** except by `apps/web/src/app/api/workflows/[workflowId]/files/[fileId]/route.ts`,
which joins it to `WorkflowFile`. It is not `FolderFile`, and the name collision is a live hazard:
the org storage quota once read zero forever because `calculateStorageUsage` joined `FileVersion`
to `File` instead of `FolderFile`, matched nothing, and summed `NULL` (§11, #1816).
`lifecycle/__tests__/quota-cleanup.test.ts` now asserts the join does not touch `schema.File`, using
the `joins` recorder on the shared `makeDb` stub.

Measured on the development database, 2026-08-24: `File` **0** rows, `FolderFile` 2,
`FileVersion` 2, `MediaAsset` 3,750, `Attachment` 3,086, `StorageLocation` 33,297. Essentially all
file usage in this product is `MediaAsset`, not the file library.

**Buckets.** Two: `S3_PUBLIC_BUCKET` and `S3_PRIVATE_BUCKET`, chosen by
`bucketForVisibility(visibility)` (`storage/buckets.ts:75`). Public objects get a durable CDN URL
(`CDN_URL/{key}`) written into `StorageLocation.externalUrl`; private objects are only reachable
through a presigned GET or our download route. `externalUrl` is `NOT NULL`, so a PRIVATE upload
stores `''`.

**Storage key.** `deriveStorageKey` (`upload/util.ts:51`):
`{orgId}/{entity-type-kebab}/{entityId ?? 'temp'}/{Date.now()}_{keySeed?}{sanitizedFileName}`.
Org id first so `aws s3 rm s3://bucket/{orgId}/ --recursive` is a valid org delete. (The public
workflow door does **not** honour that shape — §8.1.)

---

## 3. Entity Types & the Handler Table

`ENTITY_TYPES` (`files/types/entities.ts:12`) is the dispatch key for the whole flow. The client
sends an entity type; `UPLOAD_HANDLERS` (`upload/handlers/index.ts:39`) maps it to exactly one
**declarative record**, and that record decides everything else.

The four-level `BaseProcessor` → `BaseAssetProcessor` → `BaseAttachmentProcessor` → concrete-class
`processConfig` super-chain is gone (#1859, 11 files deleted). Answering "which bucket does an
article cover land in?" is now one file.

| Entity type | Visibility | Max | MIME allow-list | `persist` | `assetKind` |
| --- | --- | --- | --- | --- | --- |
| `FILE` | PRIVATE | none (`MAX_SAFE_INTEGER`) | `*/*` | `folder-file` | — |
| `USER_PROFILE` | **PUBLIC** | 5 MB | jpeg/png/webp/gif | `versioned-asset` | `USER_AVATAR` |
| `ARTICLE` | PRIVATE, **PUBLIC when `role=COVER`** | 10 MB | images (no SVG), pdf, text/plain, markdown, html | `asset+attachment` | `THUMBNAIL` for COVER/THUMBNAIL, else `INLINE_IMAGE` |
| `KNOWLEDGE_BASE` | **PUBLIC** | 10 MB | jpeg/png/webp | `asset+attachment` | `THUMBNAIL` |
| `CHAT_WIDGET` | **PUBLIC** | 10 MB | jpeg/png/webp | `asset+attachment` | `THUMBNAIL` |
| `MESSAGE` | PRIVATE | 25 MB | `*/*` | `asset+attachment` | `TEMP_UPLOAD` / `INLINE_IMAGE` / `EMAIL_ATTACHMENT` by session |
| `COMMENT` | PRIVATE | 25 MB | image/\*, text/\*, pdf, doc, docx | `asset+attachment` | `TEMP_UPLOAD` |
| `CUSTOM_FIELD` | PRIVATE | 25 MB | `*/*`, narrowed by `refineConfig` from the field's `options.file` | `asset+attachment` | `TEMP_UPLOAD` |
| `WORKFLOW_RUN` | PRIVATE | 50 MB | `*/*` | `asset+attachment` | `TEMP_UPLOAD` |
| `DATASET` | PRIVATE | 50 MB | ~40 explicit types (`DATASET_MIME_TYPES`) | `asset` | `DOCUMENT` |
| `visit_qc_item` | PRIVATE | 25 MB | jpeg/png/webp/gif/heic/heif | `asset+attachment` | `INLINE_IMAGE` |

`maxTtlSec` is `ASSET_MAX_TTL_SEC` (600 s) everywhere except `FILE`, which is 3600 s. The multipart
threshold defaults to 50 MB (`DEFAULT_MULTIPART_THRESHOLD_BYTES`), overridden to 100 MB for `FILE`
and 25 MB for `WORKFLOW_RUN`.

### 3.1 The three halves of a handler

`UploadHandler` (`upload/handlers/types.ts:131`) is deliberately split by *when* each field runs:

1. **Declarative** — `visibility`, `maxFileSize`, `allowedMimeTypes`, `maxTtlSec`,
   `multipartThresholdBytes`, `assetKind`, `persist`. Read by the pure `buildUploadConfig`
   (`upload/config.ts:99`). No I/O, ever.
2. **Prepare-time hooks** — `normalizeInit` (pure; only `USER_PROFILE` and `DATASET` have one),
   `validateEntity` (identity only), `refineConfig` (only `CUSTOM_FIELD`). These run in
   `prepareUpload`, before a byte is written.
3. **Completion hooks** — `assetExpiresAt` (pure), `onPersist` (**inside** the one transaction),
   `afterCommit` (**strictly after** `COMMIT`), `thumbnails`.

The `onPersist`/`afterCommit` boundary is the load-bearing one. An enqueue issued before `COMMIT`
resolves its source on a *different* connection and cannot see the rows the open transaction has
written — that is the bug that made a re-uploaded avatar serve the previous image forever
(#1818, §11).

`validateEntity` answers **identity**, never permission: "does this entity exist in this
organization". `packages/lib` performs zero access checks (`docs/lib-module-guide.md` §6). Who is
*allowed* to upload is asked in `sessions/route.ts` — the `files.manage` gate for `FILE`, and the
org-admin gate for uploading an avatar onto someone else's user. `WORKFLOW_RUN` and `CUSTOM_FIELD`
declare **no** `validateEntity` at all (§12).

### 3.2 The client's copy is projected from the same source (#1866)

`UPLOAD_POLICIES` in `files/types/entities.ts` is the one server-free record of the five
declarative fields — `entityType`, `maxFileSize`, `allowedMimeTypes`, `maxTtlSec`,
`multipartThresholdBytes` — one entry per `EntityType`. The eleven handlers **spread** their entry
(`...UPLOAD_POLICIES.ARTICLE`) rather than restating limits, and `ENTITY_CONFIGS` — the
browser-side pre-flight table — projects the same values alongside a hand-maintained
`ENTITY_PRESENTATION` record (labels, progress stages, per-surface UI switches, none of which has a
server counterpart).

The pre-flight table is read by **`orchestration-slice.ts`'s `validateAndAddFiles`**
(`getEntityConfig` ~line 501, `validateFile` ~574) to reject files before upload. It is *not* read
by `file-slice.ts:75` — that line reads progress-bar stage labels only, which earlier revisions of
this guide and of `plans/attachments/10-rollout-checklist.md` both got wrong.

Until #1866 the two tables were maintained separately and had drifted: `WORKFLOW_RUN` 15 MB
client-side vs 50 MB server; `USER_PROFILE` `image/*` (which admits SVG) vs four explicit types;
`ARTICLE` admitting `video/*` and `audio/*` the handler refuses. Users were refused files the
server would have accepted. An 11-case test in `handlers/__tests__/handlers.test.ts` now asserts
`ENTITY_CONFIGS[t].validation` equals each handler's `maxFileSize`/`allowedMimeTypes`, so the two
cannot silently diverge again.

`ValidationConfig` no longer carries an extension allow-list. It had **no server counterpart** —
`enforceUploadPolicy` checks size and MIME only — so it could only ever refuse a file the server
would accept. `validateFile` in `apps/web/.../utils/upload-helpers.ts` is now a two-rule mirror of
`enforceUploadPolicy` with the same wildcard semantics.

Front-end code imports these from **`@auxx/lib/files/client`**, not `files/types` (#1866). See §12
for what still is not enforced about that boundary.

---

## 4. Door 1 — the browser presigned flow (the main path)

The three routes are thin (#1857, #1856). They authenticate, run the two gates that must not live
in lib, and translate `Result` → `Response`. Everything else is `upload/prepare.ts` and
`upload/complete.ts`.

### 4.1 `POST /api/files/upload/sessions` — 234 lines

`apps/web/src/app/api/files/upload/sessions/route.ts`

1. `auth.api.getSession` → requires `defaultOrganizationId`.
2. Zod-parse the body (`fileName`, `mimeType`, `expectedSize`, `entityType`, `entityId?`,
   `provider?`, `metadata?`). `provider` is constrained to the five `ProviderId` values — there is
   no `Local` adapter, and accepting one only turned a 400 into a 500.
3. **Layer-2 permission gate — only for `entityType === 'FILE'`** (`PermissionKey.filesManage`).
   Every other entity type is deliberately left to its host surface's own gate.
4. **Agent-avatar gate** — a `USER_PROFILE` upload whose `entityId` is not the caller requires
   `isAdminOrOwner`. This moved out of `UserProfileProcessor.validateEntityAccess` in #1859: it
   used to throw a bare `Error`, which the route reported as a 500 rather than a 403.
5. **Storage quota gate** — `FeaturePermissionService.getLimit(org, 'storageGbHard')` vs
   `calculateStorageUsage(org)`. Answers a `{ error: 'USAGE_LIMIT', message, details }` body the UI
   parses, which is why it is in the route and not in lib. Wrapped in a try/catch that **fails
   open**, logged at `error` so a silently failing billing gate is alertable.
6. `prepareUpload({ db, organizationId }, { storage, now, redis }, init)`.
7. Map the result onto the legacy wire names. `uploadMethod` on the wire means the *strategy*
   (`'single' | 'multipart'`); `uploadType` means the HTTP *verb*. Both names are load-bearing for
   the browser uploader, so the translation happens here rather than being carried inward.

**Error shapes.** This route has two, deliberately: an `isAuxxError` branch emitting
`{ error: <CODE>, message }` (pinned byte-for-byte by `session-error-mapping.test.ts` for the
`files.manage` 403), and `uploadErrorResponse` emitting
`{ error, errorType, retryable, code, details? }`.

### 4.2 `prepareUpload` — `packages/lib/src/files/upload/prepare.ts:130`

Four named steps, replacing what the super-chain interleaved:

1. `getUploadHandler(entityType)` — **an unknown entity type is a `BadRequestError`**, never a
   fallback to the file-library handler.
2. `requiresEntityId(handler)` — derived, not declared: `Attachment.entityId` is `NOT NULL`, so
   `asset+attachment` is exactly the set that cannot work without one. Refusing at the front door
   beats a 500 after the bytes are already in S3.
3. `handler.validateEntity(ctx, request)` — skipped when the request names no entity.
4. `buildUploadConfig(handler, request, now)` (pure, total) → `handler.refineConfig` (the one hook
   allowed to read). Then `createUploadSession`, then presign, then `patchUploadSession` with what
   the provider answered.

`buildUploadConfig` (`upload/config.ts:99`) is worth reading in full — it is the whole policy
decision as a straight-line function. Three bugs it closes structurally:

- the MIME type is normalized **once** and the normalized value is what is judged; the old chain
  checked the allow-list against the raw `init.mimeType` while emitting the normalized one, so
  `Image/PNG` was refused at the front door and accepted by the policy behind it;
- `ttlSec` is clamped to `handler.maxTtlSec`, so a prepared config can never fail its own policy;
- `enforceUploadPolicy` runs here with the same function the signer will use.

`PreparedUpload.warnings` is always empty. It stays on the wire because the uploader's
`transport/types.ts` still declares it; nothing renders it.

### 4.3 `POST /api/files/upload/{sessionId}/parts` — 115 lines

`authorizeUploadSession` → `touchUploadSession` → `presignPart` with `bucket: session.bucket`.

**Nothing on this route marks the session failed**, deliberately (#1857). It used to: the old error
handler wrote `status: 'failed'` for every error it saw, so one failed part presign killed the whole
upload — converting a retryable blip into a forced re-upload plus an orphaned S3 multipart upload.
A part presign mutates nothing, so there is no half-run state for a `failed` status to protect.

Known gap, flagged in the code: the part presign takes no `ttlSec`, so part URLs use
`S3Adapter.presignPart`'s 3600 s default rather than `session.ttlSec`.

### 4.4 `POST /api/files/upload/{sessionId}/complete` — 95 lines

`authorizeUploadSession` → Zod-parse → `completeUpload` → on `err`, `failUploadSession` then
`uploadErrorResponse`. A malformed body is an **early return**, not a throw: nothing was attempted,
so it must not mark the session failed and force the client to re-upload the bytes.

### 4.4b `POST /api/files/upload/{sessionId}/abort` (#1866)

The fourth route, and the shortest. Authenticated through the same
`authorizeUploadSession` door as `parts` and `complete` — the session nanoid is not a credential
(§11.4), so holding one must not let a caller destroy someone else's in-flight upload.

It calls `abortMultipartUpload`, then deletes the Redis session: the session's presigned URLs are
useless once the upload is abandoned, and leaving it alive lets a retry resume against an `uploadId`
S3 has already released.

It answers **200 on any authorized call, including when the abort itself failed.** The client
cancelled; surfacing a storage error it cannot act on would turn a successful cancel into a visible
failure. The `outcome` field carries what actually happened, for logs and tests.

### 4.5 `completeUpload` — `packages/lib/src/files/upload/complete.ts:132`

Three phases, and the boundaries are the point.

**Phase 1 — storage only, no database.**
`completeMultipart` (if multipart, against `session.bucket` — any other answers `NoSuchUpload`),
then `headObject`, then `validateCompletedUpload`. For a multipart upload this is not a second
opinion, it is the *only* one: `CreateMultipartUpload` takes no policy document, so nothing bounds
the total size or the real content type until this `HEAD`. The public `externalUrl` is built here
too, by the **synchronous** `StoragePort.buildExternalUrl`, precisely so nothing has to reach
storage from inside the transaction.

**Phase 2 — one `BEGIN…COMMIT`, database statements only.**
`createStorageLocation(tx, txCtx, …)` then `persistUpload(tx, ctx, deps, handler, session,
location)`. No S3 call, no credential fetch, no queue write, no cache bust.

Two rules hold this together:

- **`ctx.db` must be a pool.** Drizzle 0.44's `NodePgTransaction.transaction()` exists and issues
  `SAVEPOINT`, so handing this function a transaction would silently nest one and the "one
  `BEGIN…COMMIT` per request" property would become unobservable rather than false. Verified:
  `complete.ts:204` is the only `db.transaction(` on the completion path.
- **Style A — the body throws.** `db.transaction` rolls back on **throw**; returning `err()` does
  not, because an `err` is an ordinary resolved value, the body completes normally, and the caller
  commits rows it was just told failed to write. Every `Result`-returning collaborator inside the
  transaction goes through `unwrap` (`files/guard.ts:24`), and `guard` converts at the exported
  boundary, *outside* the transaction.

`persistUpload` (`upload/persist.ts:79`) is one function and one `switch` on `handler.persist`. Its
`isPrivate` comes from `session.visibility`, which `buildUploadConfig` already resolved — one source
for the answer, so the bucket and the `isPrivate` flag cannot disagree. (They did: a lowercase
`'private'` on the old dataset processor matched neither branch of `bucketForVisibility`, so every
dataset document went to the **public** bucket *and* was recorded non-private. #1827.)

On any throw, `compensateUploadObject()` (`upload/compensate.ts`) deletes the object with the
session's own bucket, and if that fails enqueues a durable `orphanedStorageObjectJob`. Both are
swallowed — losing the original error is strictly worse than leaking one object the orphan sweeper
will find — and the function returns `'deleted' | 'enqueued' | 'failed'` rather than `void`, so the
Phase-6 exit criterion ("the object is deleted **or** a cleanup job is enqueued") is one assertion
over two ports instead of a whole rigged completion.

**Phase 3 — after `COMMIT`.** `upload/post-commit.ts:80`, and nothing in it may fail the request.
`handler.afterCommit` (cache busts, dataset processing enqueue) → `ensureThumbnailPresets` (one
call for the whole preset fan-out, so the source asset is resolved once) → `getAssetDownloadRef`
for the preview URL, preferring `handler.thumbnails.preview` when the fan-out reports it already
generated.

---

## 5. The Storage Layer

```
storage/
  buckets.ts          bucketForVisibility / publicCdnUrl / buildExternalUrl /
                      assertBucket / requireLocationBucket          (pure, sync)
  auth.ts             resolveProviderAuth                           → @auxx/credentials
  providers.ts        the adapter registry, isProviderAvailable, getStorageAdapter
  ports.ts            StoragePort / QueuePort / CachePort + createS3StoragePort
  presign.ts          enforceUploadPolicy + presignUpload / startMultipartUpload /
                      presignPart / completeMultipart
  objects.ts          putObject / getObject / streamObject / headObject / deleteObject
  locations.ts        createStorageLocation(tx, ctx, …) / deleteStorageLocation(tx, ctx, …)
  location-queries.ts getStorageLocation(ctx, …) / findStorageLocationByExternalId(ctx, …)
  queue-port.ts       createProductionQueuePort  (BullMQ + the thumbnail Redis latch)
  cache-port.ts       createProductionCachePort  (onCacheEvent + DehydrationService)
  storage-manager.ts  @deprecated facade, 1,179 lines
adapters/             S3Adapter + the StorageAdapter interface
```

`StorageLocationService` (1,016 lines, a module-level singleton with no org scope) is **deleted**
(#1829). Every location read and delete now filters `ctx.organizationId` in SQL
(`location-queries.ts:54`, `:94`).

### 5.1 `bucket` is never optional

This is the most expensive lesson in the subsystem. **S3 answers `204 No Content` for a delete of a
key that is not in the bucket you named**, and `NoSuchUpload` for a part presigned against a bucket
the upload did not start in. So a wrong-bucket call reports success and the real object leaks with
no error and no log. That produced three separate production bugs (#1816/#1817/#1818), all with the
same shape: `bucket` was optional, the call site omitted it, and the resolver fell back to
`S3_PRIVATE_BUCKET` — which is wrong for every PUBLIC upload (avatar, KB logo, widget logo, article
cover).

Three things enforce it now:

- `ObjectRef` (`storage/ports.ts:48`) carries a **required** `bucket`, and every object-addressing
  parameter type extends it. An optional `bucket` on a port method is a regression.
- `assertBucket(bucket, op)` (`buckets.ts:131`) throws instead of resolving a configured default.
- `requireLocationBucket(location, ctx)` (`buckets.ts:164`) reads `metadata.bucket` off a persisted
  row and **throws rather than inventing one**. It is the single place every download path resolves
  a bucket from a row, so `assets/download.ts` and `folder-files/download.ts` cannot drift.

All 33,297 `StorageLocation` rows carry `metadata.bucket` (measured 2026-08-24).

### 5.2 There is exactly one adapter, and the port's params are sufficient

`files/adapters/` contains `base-adapter.ts` and `s3-adapter.ts`, and
`StorageManager.validateStorageParams` rejects every provider without an adapter — which is
everything except `'S3'`. The per-provider dispatch resolves to S3 in every call that can succeed.

The one real channel by which a `StorageLocation` could influence the client is `metadata`:
`S3Adapter.parseS3Location` spreads it into the `S3Config` that `createS3Client` reads, whose first
lines are `config?.region || auth?.region || S3_REGION`. So a row *could* carry `region` or
`endpoint` that the bucket+key-only `StoragePort` does not model. **Measured: zero rows carry
either**, across all 33,297, and `count(DISTINCT provider) = 1`. That is why `StoragePort` was left
alone (#1859). If a future S3-compatible provider needs a per-row endpoint it belongs on `ObjectRef`
as an explicit field, never as a re-widened `metadata` passthrough.

This measurement matters because "the port is S3-only while `getContent` dispatches per provider"
was recorded as the blocker in three consecutive PR retros and was false each time.

### 5.3 The policy, and where S3 re-enforces it

`enforceUploadPolicy(policy, candidate)` (`presign.ts:109`) is pure and throws on the first
violation: key prefix, TTL ceiling, content-length range, MIME allow-list (`type/subtype`,
`type/*`, `*/*`). The key check is a plain `startsWith`, **not** path containment —
`org123/../../../etc/passwd` passes it, which is fine because S3 treats a key as an opaque name, but
it means this must never be described as a traversal guard.

The asymmetry it exists inside:

- **Single** uploads are signed as a presigned POST whose policy document carries
  `content-length-range 0..size` and an exact `Content-Type` condition. S3 rejects anything wider,
  so whatever `enforceUploadPolicy` allows is what S3 will accept. (A zero-`size` request signs a
  plain PUT, which carries no content-length condition.)
- **Multipart** uploads carry no policy document at all. `presignPart` signs one part number and S3
  enforces only its 5 GiB per-part ceiling. Nothing constrains the total size or the real content
  type. For this path the policy is **advisory**, and `headObject` + `validateCompletedUpload` after
  the bytes land is the only real gate.

`StoragePort.presignUpload` and `.startMultipart` are raw adapter calls that sign whatever they are
handed. `storage/presign.ts`'s `presignUpload` / `startMultipartUpload` are the sanctioned doors,
because they enforce the policy first. Reaching for the port directly from a route skips it.

### 5.4 `StorageManager` — what is left

1,179 lines, `@deprecated`, scheduled for deletion. What remains is:

- **`uploadContent`** — a composite (object write + `StorageLocation` row) with 13 call sites, all
  server-side ingest. It resolves the bucket **once** and uses it for all three of the object write,
  the external URL and the persisted row; it used to resolve it three times independently, so the
  object could land in one bucket while the row claimed another.
- **`getDownloadRef` / `getContent` / `streamFileContent` / `deleteFile`** — the composites
  addressed by `storageLocationId`. Each reads a row *and* touches storage.
- Legacy adapters for presign/multipart/head/delete-by-key that forward to `storage/presign.ts` and
  `storage/objects.ts`.

Its `filesCtx()` accessor is the **only** place the class reaches the process-wide pool, and it
throws rather than running unscoped when it has no organization.

---

## 6. The Module Contract — `files/ctx.ts`

**Read `packages/lib/src/files/ctx.ts` before writing anything new under `files/`.** It is the
contract, it carries its own reasoning, and this section does not restate it. In short:

- **Three signature shapes.** Pure (`fn(data)`), database-touching (`fn(ctx: FilesCtx, …)`), and
  transaction-only (`fn(tx: Transaction, ctx: FilesCtx, …)`) — `tx` positional and **first**,
  because `FilesCtx.db` is `Database | Transaction` and therefore cannot express "must be inside a
  transaction": a pool typechecks into it and the multi-row invariant silently stops being atomic.
- **`FilesCtx` is `{ db, organizationId }` and there is deliberately no `userId`.** A function that
  records an actor takes it in its own `input`, where it is required and unmissable —
  `createAssetWithVersion(tx, ctx, deps, { createdById, … })`, never `ctx.userId`.
- **`FilesDeps` is a separate object** (`storage`, `queue`, `cache`, `now`), and functions take a
  **narrowed `Pick`** of it. `getAssetDownloadRef` declares `Pick<FilesDeps, 'storage'>`, so its
  signature says it cannot enqueue a job or bust a cache — and no caller of a pure read has to
  construct a `QueuePort` (i.e. bind a live Redis connection) just to presign a URL.
- **The nesting rule.** A caller already inside a transaction passes `{ ...ctx, db: tx }` to every
  nested `ctx`-taking read. Reusing the outer `ctx` reintroduces exactly the stale-read bug this
  refactor exists to kill.
- **`Result` at the boundary, throws inside.** Exported functions return
  `Promise<Result<T, AuxxError>>` via `files/guard.ts`; internal helpers throw. Only `AuxxError`
  subclasses — never bare `Error`, never `TRPCError`.

**The test payoff is the observable one.** The doubles in `packages/lib/src/files/__tests__/support/`
(`db.ts`, `storage.ts`, `queue.ts`, `cache.ts`, `redis.ts`, `clock.ts`, `ctx.ts`, `fixtures.ts`)
mean a new test in a converted module needs **zero `vi.mock`**. As of 7c there is **no
`vi.mock('@auxx/database', …)` anywhere under `files/`** — the last two were the lifecycle tests, and
they went when `lifecycle/` stopped binding the pool. Two files mention the pattern in prose only.

The converted modules and their sizes:

| Module | Files | Replaced |
| --- | --- | --- |
| `assets/` | 7 (~1,800 lines) | `MediaAssetService` 1,592 → 554 facade |
| `attachments/` | 5 (~1,030) | `AttachmentService` 1,386 → 304 facade |
| `folder-files/` | 7 (~2,000) | `FileService` 1,982 → 281 facade |
| `folders/` | 6 (~2,320) | `FolderService` 1,945 → 421 facade, zero construction sites left |
| `filesystem/` | 6 (~1,250) | `FilesystemService` 1,427 → **deleted** |
| `thumbnails/` | 7 (~1,870) | `ThumbnailService` 1,038 + `thumbnail-batch.ts` + `thumbnail-enqueue.ts` → **deleted** |
| `upload/handlers/` | 14 (~1,210) | the whole `upload/processors/` hierarchy, 11 files → **deleted** |
| `storage/` (new files) | 10 (~1,770) | `StorageLocationService` 1,016 → **deleted**; `StorageManager` 2,512 → 1,179 |

The line-count target that used to be an exit criterion is **retired** — the replacement modules are
larger than the classes they replace because they do more (real org scope on every statement, real
tree aggregates, ports) and because ~30–55% of each new file is JSDoc. The criteria that replaced it
are behavioural: no module-scope database access, no `vi.mock('@auxx/database')` in converted
modules, exactly one transaction on the upload completion path, org scope unconditional on every
statement including DELETEs, `BaseService`/`getTx`/`withTx` gone.

---

## 7. The Front End

`apps/web/src/components/file-upload/` — 39 files, 6,048 lines.

```
hooks/use-file-upload.ts               610   the public hook
stores/upload-store.ts                  47   create()(devtools(immer(…)))
stores/slices/orchestration-slice.ts   990   the upload driver
stores/slices/file-slice.ts            306   per-file state machine
stores/slices/session-slice.ts         157   client-side session containers
stores/slices/ui-slice.ts              148
stores/slices/entity-slice.ts          117   @deprecated global config
transport/http-upload-transport.ts      65   the only file that knows a URL
transport/direct-upload.ts             182   XHR to S3, single + serial multipart
transport/upload-error.ts              130   parseUploadErrorResponse
transport/types.ts                     126   the wire contract
transport/server-id.ts                  29   resolveServerId: asset → file → 'session'
ui/{avatar-upload,file-queue-manager,file-item}.tsx
```

### 7.1 `UploadTransport` — the network seam (#1858)

```ts
export interface UploadTransport {
  createSession(input: CreateSessionInput): Promise<PresignedConfig>
  uploadObject(params: {
    file: File
    config: PresignedConfig
    onProgress?: (progress: UploadProgressEvent) => void
  }): UploadHandle
  completeSession(sessionId: string, body: CompletionInput): Promise<CompletionResult>
}
```

`transport/types.ts:110`. The production implementation is `httpUploadTransport`
(`transport/http-upload-transport.ts:22`) and it is **store state, not a constructor argument** —
`orchestration-slice.ts:124` defaults it, `:126` swaps it. It lives on the store so it cannot leak
between test files and so it survives `reset()`.

`uploadObject` returns a handle **synchronously** so the caller can register the abort before
awaiting. That was one of three swallowed failures the extraction surfaced:

1. **The storage-limit 403's upgrade prompt never reached a user.** All three browser call sites did
   `if (!res.ok) throw new Error(\`… (${res.status})\`)` and never read the body, so
   *"You have reached your storage limit. Usage: 4.8GB/5GB…"* rendered as **"Session create failed
   (403)"**. `parseUploadErrorResponse` (`transport/upload-error.ts:100`) reads both envelopes.
2. **`FileState.error` was `undefined` for every failed upload** — `updateFileStatus('failed')`
   leaves `error` unset and no caller ever set it separately, so the real message died a second
   time. `orchestration-slice.ts:755` now calls `setFileError`.
3. **`abort()` did nothing between multipart parts** — the flag was set inside `currentAbort`, so an
   abort arriving while a part was being presigned (no XHR live) was silently dropped and the
   remaining parts uploaded anyway. `direct-upload.ts:172`.

A fourth method landed in #1866: **`abortSession(sessionId)`**, because stopping the browser from
sending is only half of a cancel. Aborting an `XMLHttpRequest` cannot touch the multipart upload S3
has already opened, and S3 holds and bills for every part already delivered — indefinitely, absent
an abort or a lifecycle rule. `cancelUpload` now calls it for each in-flight file, `keepalive: true`
so the request survives the tab or popover closing, and gated on `serverIdKind === 'session'` so a
**completed** upload is never abandoned after its rows are written (`serverFileId` is overwritten
with a real record id on completion — §11.3). It is best-effort by contract: a rejected promise must
never fail the cancel that called it, so the store fires it un-awaited with a swallowing `catch`.

The contract's return is deliberately not a bare boolean — `abortMultipartUpload` reports
`'aborted' | 'skipped' | 'failed'`, where `'skipped'` is the single-part case. An abandoned PUT
never becomes an object, so a single-part cancel must not call storage at all.

### 7.2 The transfer itself

`transport/direct-upload.ts` uses `XMLHttpRequest` (for upload progress events), single PUT or
POST-with-policy-fields depending on `config.uploadType`. Multipart is **still strictly serial**:
`CHUNK_SIZE = 10 MB` (`direct-upload.ts:12`), one `for` loop with an `await` per part, and each part
costs a round-trip to our server for a presigned URL before the PUT (`:107`). Cross-file concurrency
exists at the *file* level only — a pool of `maxConcurrentUploads ?? 3` (`orchestration-slice.ts:575`).

### 7.3 The wire format

Declared once, in `transport/types.ts`. Of `PresignedConfig`, the client reads `uploadMethod`
(single vs multipart), `uploadType` (PUT vs POST), `presignedUrl`, `presignedFields`, `uploadId`,
`partPresignEndpoint` and `sessionId`; `warnings` is **declared and never read**. Of
`CompletionResult`, it reads `assetId`/`fileId` (through `resolveServerId`) and `url`;
`storageLocationId`, `attachmentId`, `documentId`, `success` and `sessionId` are declared and unread.

Consumers: avatar upload (settings, onboarding), file-select, the file library, dataset documents,
the QC photo strip, and the record custom-field uploader.

---

## 8. Doors 2 & 3 — the parallel upload paths

### 8.1 Public workflow share uploads

`apps/web/src/app/api/workflows/shared/[shareToken]/files/{sessions,[sessionId]/complete}`

A passport-token-authenticated re-implementation for anonymous end users. Its own Redis keyspace
(`public-upload:{id}` via `setRedisData`), its own inline `DEFAULT_UPLOAD_POLICY`, no handler, no
quota gate, no `files.manage`. It presigns through `StorageManager.generatePresignedUploadUrl` — so
it *does* get `enforceUploadPolicy` — then `headByKey`, `createStorageLocation`, and
`createAssetWithVersion` inside its own single `database.transaction`, with
`purpose: 'PUBLIC_WORKFLOW_INPUT'` and a 24 h `expiresAt`.

Two things to know:

- It writes the same rows with roughly a quarter of the machinery, which remains the most useful
  single data point about how much of the main path is essential.
- **Its storage key does not start with the org id.** It is
  `public-workflow/{orgId}/{shareToken}/{sessionId}/{filename}`
  (`sessions/route.ts:158`), so `aws s3 rm s3://bucket/{orgId}/ --recursive` — the reason
  `deriveStorageKey` puts the org first — does not reach these objects.

### 8.2 Server-side ingest

Inbound mail (`email/inbound/attachment-ingest.service.ts`, `body-ingest.service.ts`), thumbnails
(`jobs/maintenance/generate-thumbnail-job.ts`), PDF render/preview (`documents/`), exports and
prints (`jobs/export/**`), recordings (`recording/`, `apps/worker/src/recording/`), visit reports
(`dispatch/visit-report/render.ts`), remote image fetch (`files/fetch-remote-image.ts`), chat
attachments (`apps/api/src/routes/chat/attachments.ts`). Fourteen call sites, all
`StorageManager.uploadContent()` plus a lib write function.

This is fine and should stay — but it means **the handler table is not the choke point for file
creation**, only for browser uploads. Any invariant expressed only in a handler (`kind`,
`expiresAt`, allow-lists, cache busts) is not enforced for these.

There is a third `StorageLocation` write door: `users/user-avatar-service.ts` inserts the row
directly, bypassing `createStorageLocation` and its bucket normalisation (§12).

---

## 9. The Read Path

Four routes serve file bytes, with three designs.

| Route | Design | Auth |
| --- | --- | --- |
| `GET/HEAD /api/files/download/[fileId]` | **Buffers the entire object into Node memory**, then slices for `Range`. Accepts a plain id or an `asset:` / `file:` FileRef. | session + `PermissionKey.filesView` |
| `GET /api/attachments/[id]/content` | 302 to a presigned URL. **Fail-closed inline gate**: only png/jpeg/gif/webp, read off the joined `MediaAssetVersion`; everything else redirects to `/download`. | session + `canViewAttachment` (mail-lens aware) |
| `GET /api/attachments/[id]/download` | 302 to a presigned URL; the `stream` arm buffers. | same |
| `GET /api/attachments/[id]/thumbnail` | `ensureThumbnail` → 302 when ready, **202 + `Retry-After: 2`** when queued, 302 to `/download` otherwise. | same, plus an in-memory 30/min per-user rate limit (a `Map`, with a `TODO` for Redis) |

The download route's `shouldRenderInline` (`route.ts:187`) allows `image/`, `video/` and `audio/`
prefixes, honours `?download=1`, and specifically excludes **`image/svg+xml`** — an SVG is XML that
can carry `<script>`, FILE custom fields accept any MIME by default, and `nosniff` is no help when
the declared type *is* svg. `HEAD` builds its headers through the same
`createFileDownloadResponse`, so the two methods agree per RFC 9110.

### 9.1 The three download-ref functions, and why they differ

- `getAssetDownloadRef(ctx, deps, assetId, opts)` — `assets/download.ts:98`. **Public shortcut:** a
  non-private asset whose location carries an `externalUrl` returns that durable URL with no expiry,
  because OG-image and link-preview crawlers cache what they fetch for days and every cached copy of
  a presigned URL 403s once the signature lapses. Anything else is presigned, with the bucket from
  `requireLocationBucket`.
- `getFolderFileDownloadRef(ctx, deps, fileId, opts)` — `folder-files/download.ts:107`. **No public
  shortcut** — `FolderFile` has no `isPrivate` column, so a file is always presigned. It also
  refuses an archived file with the same `NotFoundError` as a missing one, so a caller cannot probe.
- `getAttachmentDownloadRef(ctx, deps, attachmentId, opts)` — `attachments/download.ts:101`. A
  three-branch ladder: **pinned** (`assetVersionId`/`fileVersionId` set) resolves the pinned
  `StorageLocation` by id through `LocationDownloadPort`; **unpinned + `fileId`** delegates to
  `getFolderFileDownloadRef`; **unpinned + `assetId`** delegates to `getAssetDownloadRef`. The two
  unpinned branches delegate rather than restate precisely because the two libraries do not have the
  same URL policy, and a second copy drifts. There is deliberately **no version selector**: the row
  already carries the answer.

Both the asset and folder-file sides take the same `version: number | 'latest' | 'current'`
selector; `'current'` follows the `currentVersionId` pointer and falls back to the highest version
number, `'latest'` always takes the highest. The asset side additionally accepts a `versionId`
escape hatch.

Content reads are the twins: `getAssetContent` / `streamAssetContent` (`assets/content.ts`) and
`getFolderFileContent` / `streamFolderFileContent` (`folder-files/content.ts`), both landed in
#1859. They resolve the bucket the same way and share the version selector.

### 9.2 Thumbnails

Generated asynchronously into **separate `MediaAsset` rows** — `kind: 'THUMBNAIL'`,
`purpose: 'DERIVED'` — whose versions carry `derivedFromVersionId` + `preset`. Uniqueness is a
partial index `(derivedFromVersionId, preset) WHERE deletedAt IS NULL`. Deleting a source asset
therefore has to expand the closure, which is what `deleteThumbnailsForSource` and the
`ThumbnailCleanupPort` on `assets/ports.ts` exist for.

Thirteen presets in `thumbnails/presets.ts`: `avatar-32/64/128/256`, `article-thumb`,
`article-cover`, `article-inline`, `attachment-preview`, `attachment-thumb`, `comment-preview`,
`comment-preview-large`, `kb-logo-sm`, `kb-logo-lg`. `DEFAULT_PRESET = 'avatar-64'`.

`ensureThumbnail` / `ensureThumbnailPresets` (`thumbnails/thumbnail-mutations.ts`) either find a
live thumbnail **with a storage location** and answer `ready`, or enqueue and answer `queued`.
There is no synchronous generation branch any more. The `storageLocationId` guard is a named fix: a
`PROCESSING` placeholder left by a crashed worker used to answer `ready` with
`storageLocationId: undefined`, so the preset stayed broken until the 24-hour failed sweep removed
it, and the attachment route meanwhile presigned `undefined`.

`resolveThumbnailSource` can **write**: an attachment pointing at a `FolderFile` has no
`MediaAssetVersion`, so one is minted with `kind: 'FILE_CONVERSION'` over the same
`StorageLocation`. Its four-step ladder — pinned asset version, pinned file version (convert),
unpinned asset (current version), unpinned file (convert current) — is in the function's docstring.

The worker is `apps/worker/src/workers/worker-definitions/thumbnail-worker.ts` (concurrency 5,
limiter 100/min) over `packages/lib/src/jobs/maintenance/generate-thumbnail-job.ts`. Enqueue goes
through `createProductionQueuePort` (`storage/queue-port.ts`), which owns the deterministic
`jobId = thumb-${key}` plus a Redis latch — one derivation function, where there used to be three
copies of the convention and only two of them agreed.

---

## 10. Lifecycle, Quota & Cleanup

Both modules named "cleanup service" are gone as of 7c.

- `files/cleanup/` — **deleted.** It was a 48-line `@deprecated` forwarder to
  `enqueueOrphanedStorageObjectCleanup` whose docstring named a `complete/route.ts` call site that
  no longer existed; its only importers were the two barrels and one lib test.
- `files/lifecycle/cleanup-service.ts` — **replaced** by `files/lifecycle/file-reaper.ts`. Five of
  its ten exports (`deleteEntityFiles`, `deleteOrganizationFiles`, `deleteOrphanedFiles`,
  `cleanupFailedUpload`, `cleanupAssetThumbnails`) had zero callers outside the barrel and went
  with it; `deleteEntityFiles` had no organization predicate anywhere in it. The survivors are
  three sweeps taking `(db: Database, deps, options)` — the `thumbnails/cleanup.ts` shape, for the
  same reason: a cron job with no organization cannot honestly carry a `FilesCtx`.

`files/lifecycle/` now holds **no `@auxx/database` runtime import at all**. The three scheduled
handlers moved to `jobs/maintenance/file-cleanup-jobs.ts`, which is where every other cron handler
already binds the pool.

### 10.1 What actually runs

Scheduled in `apps/worker/src/workers/index.ts`:

| Scheduler | Cron | What it does |
| --- | --- | --- |
| `orphanedFileCleanupJob` | hourly | `reapExpiredFolderFiles` — unattached `FolderFile`s >24 h old, `LIMIT batchSize` |
| `deletedFileCleanupJob` | daily 02:00 | `reapSoftDeletedFolderFiles` (>30 d), then `reapMarkedStorageLocations` (>24 h), deleting the object with `metadata.bucket` |
| `storageQuotaCheckJob` | daily 04:00 | every org, hard + soft threshold |
| `cleanupExpiredMediaAssetsJob` | hourly | `MediaAsset.expiresAt <= now`, cross-org, **`dryRun: true`** — see below |
| `thumbnailCleanupJob` | daily ~03:00 (jittered) | orphaned / failed / expired sweeps |
| `thumbnailVersionCleanupJob` | weekly Sun ~04:00 | outdated versions, `keepVersions: 3` |

On-demand only: `orphanedStorageObjectJob` (`jobs/maintenance/orphaned-storage-object-job.ts`),
registered in the maintenance worker and enqueued by `QueuePort.enqueueStorageCleanup`. It
**refuses a payload with no explicit `bucket`** rather than normalising to a default, and it
deliberately rethrows so BullMQ's retry/backoff applies.

`quotaEnforcementCleanupJob` was **deleted** in 7c: exported, never scheduled, never registered, and
only ever measured the `FolderFile` lane, which is where essentially none of the usage lives.

### 10.2 The storage quota

`calculateStorageUsage(ctx: FilesCtx)` (`lifecycle/quota-cleanup.ts`) sums **both lanes** and
returns the org's real plan limit:

- `sumFolderFileUsage` — `FileVersion INNER JOIN FolderFile ON FileVersion.fileId = FolderFile.id`,
  live files only, grouped by `storageLocationId` so versions sharing a location count once.
- `sumMediaAssetUsage` — `MediaAssetVersion INNER JOIN MediaAsset`, live on both sides, grouped by
  `storageLocationId`. **Derived thumbnails are counted deliberately**: they are real objects in a
  bucket we really pay for.
- `toNumber()` on every aggregate, because `sum()`/`count()` over `bigint` come back from
  node-postgres as **strings**.
- `quotaLimit` from `FeaturePermissionService.getLimit(orgId, FeatureKey.storageGbHard)`;
  `UNLIMITED = -1` gives `percentUsed: 0`.

`storageGbSoft` — defined on every seeded plan (Free 0.8, Starter 8, Growth 40) and previously read
by nothing — is now the warn threshold, falling back to 80% of the hard limit. Both action branches
in `storageQuotaCheckJob` are still `TODO` counters (§12).

---

## 11. What we fixed, and when

The subsystem was surveyed on 2026-08-21 and rewritten over the following three days. This is the
short version; the per-PR retros in `plans/attachments/` carry the detail, including several places
where the plan was wrong and the PR found out.

**Tier 1 — correctness, 2026-08-21 (#1816, #1817, #1818).** Each fix shipped with a regression test
confirmed red first.

- **The storage quota was always zero.** `calculateStorageUsage` joined `FileVersion` to the empty
  legacy `File` table instead of `FolderFile`, so the `LEFT JOIN` never matched and `sum()` returned
  `NULL`. It also only ever considered `FolderFile`, which is where almost none of the usage lives.
  A billing-surface bug, not a cosmetic one. (#1816)
- **`complete`, `parts` and `events` had no authentication** — the session nanoid was the only
  credential. `authorizeUploadSession` now re-resolves the caller and asserts the session is theirs,
  checking authentication *before* touching Redis so the endpoints cannot be used to probe for live
  sessions. (#1818)
- **Orphaned S3 objects leaked silently.** The compensation `deleteByKey` took no `bucket` and fell
  back to `S3_PRIVATE_BUCKET`; S3 answers 204 for a delete in the wrong bucket, so every PUBLIC
  upload's object leaked with no error. The fallback `scheduleCleanup` persisted nothing. Both
  halves are real now. (#1816/#1817/#1818)
- **Multipart parts and completion always targeted the private bucket**, so a PUBLIC multipart
  upload would have initiated in one bucket and presigned its parts against another
  (`NoSuchUpload`). (#1816/#1818)
- **`SETEX` with a zero TTL.** `touchSession` reset the Redis TTL by a 600 s constant without
  updating `session.expiresAt`, so a long multipart upload eventually made `updateSession` pass
  `remainingTtl = 0` and 500 after the bytes were already in S3. (#1816)
- **Thumbnail enqueues ran inside the still-open transaction.** The avatar and KB processors both
  carried a comment claiming they ran "AFTER transaction commits"; they ran after
  `RELEASE SAVEPOINT`. The enqueue resolves its source on a different connection, so a first upload
  wasted four always-failing jobs and a **re-upload kept serving the previous image**. (#1818)
- **`visit_qc_item` produced the wrong record** — no processor registered, silent fallback to the
  file-library one, a `FolderFile` with no `assetId` where an `Attachment` was needed. The registry
  now throws on an unknown type. (#1816)

Found while fixing those, also on `main`: `sum()` returning strings; `touchSession` shortening a
1-hour session to 10 minutes; `deleteFile` resolving no bucket on a cold adapter cache; the
over-quota branch comparing a *rounded* `percentUsed >= 100`; and four never-executed happy-path
cases in `file-download-permission.test.ts`.

**Phase 2 — the contract, 2026-08-21 (#1820).** `files/ctx.ts`, `files/guard.ts`, `storage/ports.ts`
+ `createS3StoragePort`, the `__tests__/support/` kit, and two pilots proving the seam end to end:
one read (`getAssetDownloadRef`) and one write (`createStorageLocation`).

**Phase 3 — the storage layer, 2026-08-21/22 (#1823, #1825, #1827, #1829, #1832).** Injected `db`
into the location service; deleted 29 zero-caller `StorageManager` methods and the folder / search /
webhook surface that existed only for the Drive / Dropbox / OneDrive / Box stubs; extracted
`buckets.ts`, `auth.ts`, `providers.ts`; deleted `StorageLocationService` (1,016 lines) for
`locations.ts` + `location-queries.ts`; extracted `presign.ts` + `objects.ts` and repaired multipart.
**#1827 also fixed a data bug the survey under-called**: the lowercase `'private'` on the dataset
processor matched neither branch of the bucket function, so every dataset document was stored in the
**public** bucket *and* recorded `isPrivate: false`. Typing the field as a named union turned both
into compile errors. Rows written before #1827 keep whatever they were given.

**Phase 7 — deletion, 2026-08-22 (#1841, #1844).** The entire progress/SSE stack (−3,987 lines):
`upload/progress/**`, `progress-publisher.ts`, `enhanced-types.ts`, the `events` route, and the
client's `sse-connection.ts`. Nothing had ever connected to it. Also `FileUploadSession`, the second
session abstraction that sat beside `SessionManager` in the same barrel with zero callers.

**Phase 4 — the upload pipeline, 2026-08-22/24 (#1838, #1844, #1856, #1857, #1859).**
`buildUploadConfig` as one pure function; `SessionManager` → functions over an injected Redis with
compare-and-set patches; the substring error classifier deleted; `prepareUpload` / `completeUpload`
extracted and the routes thinned from 361 lines to 95; the processor hierarchy replaced by handler
records.

The error classifier is worth its own note. `UploadErrorHandler.categorizeError` was 124 lines of
`message.includes(...)` ladders picking an HTTP status. It was already bypassed on two of three
routes, so the bug was never "AuxxErrors get the wrong status" — it was "an unexpected error gets a
*confidently* wrong status": `includes('limit')` answered **413 "Storage quota exceeded"** for an S3
part-count ceiling, and `includes('token')` answered **401 "Please reconnect your storage account"**
for a malformed multipart token. Both are user-facing lies. `upload/errors.ts` is a table keyed by
`AuxxError.statusCode`, an unexpected error is always 500, every 5xx message is withheld, and a 4xx
surfaces its own — so `UnprocessableEntityError('Size mismatch: expected 100, got 200')` went from a
500 "An unexpected error occurred" to a 422 with the real message.

**Phase 5 — the services, 2026-08-22/24 (#1842, #1843, #1851, #1853, #1854, #1856).** `assets/`,
`attachments/`, `thumbnails/`, `folder-files/`, `folders/`, `filesystem/`. Bugs closed rather than
moved, in the ones with the largest blast radius:

- Three of the four thumbnail sweeps **accepted an `organizationId` that never reached the SQL**, so
  a per-org invocation swept every tenant. `deleteThumbnailsForSource` had no org filter and no
  `kind`/`purpose` guard at all — while a sibling method in the same class called that same guard a
  "CRITICAL SAFETY CHECK".
- Thumbnail objects were deleted **after** their rows, in a batch whose failures were logged and
  dropped. The row is the only record of the key, so that is an unrecoverable leak. Object first,
  rows second, per row.
- The thumbnail orphan sweep was **1 + N** — `batchSize: 500` meant 501 round-trips.
- `MediaAssetService` had three unscoped paths, including `getLatestVersion` with no org filter in
  any statement. `BaseService.buildBaseWhereClause` guarded its org filter with
  `if (this.organizationId)`, which produced real holes in three separate conversions.

**Phase 10 — the consumer sweeps, 2026-08-24 (#1857, #1859).** 58 files outside `files/`. Two real
bugs, both the same root cause the refactor exists to remove — **a `db` bound at construction rather
than passed in**:

- **A cross-tenant read** in `workflow-engine/services/file-context-service.ts`: a hand-rolled
  `select().from(FolderFile).where(eq(FolderFile.id, fileId))` with no organization filter, one line
  below a correctly-scoped `new FileService(this.organizationId)`.
- **A write escaping its own transaction** in `jobs/maintenance/generate-thumbnail-job.ts`: the
  service was constructed on the pool, the transaction opened afterwards, and the asset and version
  writes were never part of it — they survived a rollback, and the following
  `tx.update(MediaAssetVersion…)` targeted a row `tx` did not own.

The sweep was also **export-blocked, not call-site-blocked**: each conversion PR had added to
`files/server.ts` only the export lines its own router needed, so 12 of 13 live call sites could not
reach the replacement functions at all. The rule that came out of it: **when a module is converted,
export its whole `index.ts` from `server.ts` in the same PR.**

**Phase 8 — the uploader, 2026-08-24 (#1858).** `UploadTransport` extracted; three swallowed
failures fixed (§7.1).

**Cancelling a multipart upload leaked every part that had landed — 2026-08-24 (#1866).** Found by
hand, not by a test: `AbortMultipartUpload` existed **nowhere in the codebase**. `StoragePort`
declared `startMultipart` and `completeMultipart` and nothing else, so a cancel aborted the
browser's request and left S3 holding — and billing for — every part already delivered, forever. A
184 MB cancel during the phase-10 browser test left exactly that in `auxx-dev-private`, and nothing
in the system could ever have removed it.

Why it survived 33 PRs is worth recording: `startMultipart` returned `expiresAt` under the comment
`// 7 days (S3 default)`. **There is no such default.** That value is the presigned part-URL
lifetime; the upload itself has no expiry. One wrong comment made a missing feature look like a
handled one. It now says what the value is.

Fixed on both halves — `abortMultipart` through the port and adapter, `POST
/api/files/upload/{sessionId}/abort` behind `authorizeUploadSession`, `abortSession` on the
transport called from `cancelUpload` (§7.1), **and** `abortIncompleteMultipartUploadDays: 7` on both
buckets, which is the half that survives a browser that never runs any JS. See §12 for what remains
unverified.

Two lessons about reading S3 state came out of the same investigation, both instances of rules this
guide already states in other forms:

- **Check which bucket before believing a clean read.** A `list-multipart-uploads` against
  `auxxai-files` came back empty and proved nothing — `FILE` is `visibility: 'PRIVATE'`, so its
  objects live in `auxx-dev-private`. §5.1's never-invent-a-bucket rule applies to reads too.
- **The shell's AWS identity is not the app's.** A plain shell here resolves a different IAM user,
  in a different account, from `.env`'s `AWS_PROFILE=auxxai-dev`. An `AccessDenied` may be your
  credentials rather than a missing permission — and a success may be AdministratorAccess rather
  than the runtime role.

---

## 12. What is still open

Nothing in this list is scheduled work someone forgot; each is a decision, a measurement, or a
sweep that has not happened yet.

**Data and correctness**

- **`StorageLocation.organizationId` is nullable, and 5,393 of 33,297 rows (16.2%) are NULL** on the
  development database. Every location read is now org-scoped (`location-queries.ts:54`), so those
  rows are invisible to `getStorageLocation` and immune to `deleteStorageLocation`. **A backfill has
  to come first**, and until it does the affected rows are unreadable by id.
  - `attachments/ports.ts` and `attachments/download.ts` both justify keeping the pinned-attachment
    branch on `StorageManager` on the grounds that routing it through the org-scoped
    `location-queries.ts` would 404 every pre-backfill row. **That justification no longer holds**:
    `StorageManager.getDownloadRef` itself goes through `requireStorageLocation` →
    `getStorageLocation(ctx, id)`, the same org-scoped function, since #1829. The carve-out no longer
    protects anything, and 533 of the 2,995 pinned `Attachment` rows in the development database
    point at a NULL-org `StorageLocation`. Verify before relying on either statement.
- **`MediaAssetVersion.deletedAt` is not filtered on any read path.** `resolveAssetVersion`,
  `loadCurrentVersion`, `getAssetDownloadRef` and `getAssetContent` all filter the *asset*'s
  `deletedAt` and not the *version*'s, so **a soft-deleted current version is still presigned and
  served**. `folder-files/` does the same with `FileVersion.deletedAt`. Both are documented in the
  code as deliberate parity with the legacy path, and both are an open decision, not a settled one.
- **`deriveStorageKey` uses `Date.now()` with no random suffix.** Two files with the same name for
  the same entity in the same millisecond collide and the second silently overwrites the first. The
  `keySeed` parameter that would fix it exists and **no producer sets it** — the session route's
  Zod schema does not accept one.
- **`users/user-avatar-service.ts` is a third `StorageLocation` write door.** It inserts the row
  directly, bypassing `createStorageLocation` and its bucket normalisation, and calls `putObject`
  with neither `bucket` nor `visibility` — so it falls back to the private bucket, and
  `USER_PROFILE` is a PUBLIC entity type.
- **`WORKFLOW_RUN` and `CUSTOM_FIELD` declare no `validateEntity`.** Combined with `*/*` and 50 MB,
  a workflow-run upload can be aimed at any `entityId`. The old `WorkflowRunProcessor` had the same
  hole (an entirely commented-out body); the conversion preserved it rather than inventing a rule.
- ~~**The client's `ENTITY_CONFIGS` pre-flight table disagrees with the handlers**~~ — **CLOSED
  (#1866).** Both tables now project `UPLOAD_POLICIES`, and an 11-case test asserts they agree (§3.2).
- **`UploadPolicy.allowedExtensions` is recorded and never enforced.** `enforceUploadPolicy` has no
  extension rule, so the narrowing `CUSTOM_FIELD`'s `refineConfig` writes has never been read.
  Typed rather than deleted so the intent stays visible; enforcing it is a decision.

**Multipart, after #1866**

- **Production IAM is unverified.** The runtime role needs `s3:AbortMultipartUpload`. It was proved
  end-to-end against `auxx-dev-private` (create a probe multipart upload → abort → bucket returns to
  zero incomplete uploads), but dev resolves credentials through `AWS_PROFILE=auxxai-dev`, which is
  **SSO AdministratorAccess in a different AWS account** from the IAM user a plain shell here picks
  up. That proves nothing about production. If the permission is missing, `abortMultipartUpload`
  returns `'failed'` — silently and by design, because a failed abort must never fail the user's
  cancel — and every cancelled multipart leaks until the 7-day lifecycle rule reclaims it. Cost, not
  data loss, but check it.
- **The lifecycle rule is the half that actually survives.** `abortIncompleteMultipartUploadDays: 7`
  on both buckets is not belt-and-braces: a browser that is closed, crashes, or loses the network
  mid-upload never runs `cancelUpload`, so no application code can be relied on to abort. The
  `POST .../abort` route reclaims bytes in seconds for the common case; the rule catches everything
  else.
- **`DeleteTempFiles` was deleted, not repaired, and that is still an open decision.** It filtered on
  prefix `temp/` while every key begins with the org id (`{orgId}/file/temp/...`), and S3 matches
  lifecycle prefixes from the **start** of the key — verified against `auxx-dev-private`, zero
  objects matched. The rule had never done anything. Repairing the prefix would *newly* begin
  deleting real objects on a 7-day timer, which is a behaviour change, so #1866 removed it and left
  the decision open.
- **`sessions/route.ts` can persist `bucket: ''`.** It writes
  `bucket: configService.get('S3_PRIVATE_BUCKET') || ''`, so an unset config puts an empty-string
  bucket in the Redis session. #1866 guarded the **read** side in the workflow-share route (it 500s
  rather than let an empty bucket reach a HEAD or a compensating DELETE), but the write side is
  unchanged. Same class as the `user-avatar-service.ts` item above, and as §5.1.

**Jobs that do not do what they look like they do**

- ~~**`cleanupExpiredMediaAssetsJob` is scheduled hourly with `organizationId: 'global-cleanup'`**~~
  — **HALF-CLOSED (7c).** The fake org id and its `// Will be overridden per org` comment are gone;
  `organizationId` is optional and absent means every organization, so the job's query now matches
  the rows it was written for. It is scheduled **`dryRun: true`**, deliberately: turning this on is a
  first-ever deletion pass over `expiresAt` rows that have been accumulating since the column
  shipped, and the assets it targets are abandoned drafts whose `expiresAt` is cleared on commit by
  `convertTempAssetToPermanent` — a promotion path that is called from comments, messages and the
  `mediaAsset` router, but which nothing structurally guarantees runs. **Read the hourly
  "Would delete expired MediaAsset" logs, then flip `dryRun` to `false`.**
- Separately, `findExpiredAssets` filters on `createdAt < cutoff` and `kind = 'TEMP_UPLOAD'` and does
  **not** read `expiresAt` at all. Two notions of "expired" coexist. Its only caller was
  `deleteExpiredFiles`' organization branch, which nothing ever invoked with an organization; that
  branch went in 7c, so `findExpiredAssets` now has no production caller at all.
- ~~**`quotaEnforcementCleanupJob` is exported, never scheduled, never registered**~~ — **CLOSED
  (7c), by deletion.** It only considered `FolderFile` candidates, where essentially none of the
  usage lives. Enforcement, if built, should be written against `calculateStorageUsage`'s two lanes.
- **There is still no storage warning tier that reaches a user.** `storageGbSoft` is read as a
  threshold now, but both branches of `storageQuotaCheckJob` increment a counter behind a `TODO`. An
  org goes from no signal at all straight to a hard 403 at the upload gate. The job also iterates
  every `Organization` with no batching and two `FeaturePermissionService` round-trips each.

**Shape and dead code**

- ~~**`BaseService`, `getTx` and `withTx` still exist**~~ — **CLOSED (#1862).** All three, and the
  four `core/` facades over them, were deleted. There is not one non-comment reference to `getTx` or
  `withTx` left in the repository, so nothing anywhere decides at runtime whether it is already
  inside a transaction. (Nesting `transaction()` on a client that is already a transaction issues a
  `SAVEPOINT` in drizzle 0.44 — that is why it mattered.) The upload path has one `BEGIN…COMMIT` and
  zero savepoints, asserted in `upload/__tests__/complete.test.ts`.
- ~~**`FilesDeps.cache` has no production implementation.**~~ — **CLOSED (PR 6c).**
  `createProductionCachePort()` lives in `files/storage/cache-port.ts`, beside `queue-port.ts` and
  for the same reason. `CachePort` gained a second method: `bust(event, payload)` is declarative and
  goes to `onCacheEvent`, `invalidateUser(userId)` is imperative and goes to
  `DehydrationService` — two different caches through two doors that **no call site in the repo
  pairs**, so collapsing them into one event would have made the files path mean something different
  by `user.updated` than the six other producers of it. `USER_PROFILE` and `CHAT_WIDGET` bust through
  `deps.cache` now instead of `await import('../../../cache')`, which is what put those two calls
  inside the journal the "nothing but database statements between `BEGIN` and `COMMIT`" assertion
  reads. They were previously invisible to it — the assertion held, but not over the two calls that
  had actually broken the rule in production.
- ~~**The public workflow-share completion route does no compensation at all.**~~ — **CLOSED
  (#1866).** `compensateUploadObject` is wired into the two branches that leave a guaranteed orphan.
  Three of the route's five relevant `catch` blocks deliberately do **not** compensate: auth and
  lookup failures happen before any object is addressed, and a failed `headByKey` is the one case
  where the object's existence is unconfirmed — deleting there would destroy bytes a retry can still
  commit, and the Redis session is left intact for exactly that. `completeUpload` makes the same
  choice on its own failed HEAD. Earlier revisions of this section and of the rollout checklist both
  said "each failure branch", which would have produced the wrong fix if followed literally.
  - The same PR fixed an unrecorded bug alongside it: the route wrote `StorageLocation` **on the
    pool, outside** the transaction that wrote the `MediaAsset`, so an asset failure left a committed
    row pointing at bytes the route was about to delete. `createStorageLocation` already took
    `opts.tx` and this route was its only external caller, so it is now one transaction. Passing an
    explicit non-empty `bucket` makes `resolveS3BucketForLocation` short-circuit, so no credential
    fetch happens inside the open transaction.
- **`upload/validators.ts` (201 lines) has zero consumers** outside the `files/index.ts` barrel, and
  its `getMimeTypeFromExtension` duplicates `@auxx/utils/file`.
- **`files/types` is server-dependency-free by habit, not by enforcement.** The front end no longer
  imports it (#1866): `files/client.ts` now exports `EntityType`, `ServerIdKind`, `ENTITY_TYPES`,
  `ENTITY_CONFIGS`, `getEntityConfig` and `UPLOAD_POLICIES`, and 15 front-end files were repointed —
  the sole remaining importer of `files/types` is the server route `upload/sessions/route.ts`, which
  is correct. What is **not** fixed is the guarantee: every module under `files/types/` is pure
  today, and nothing stops the next server import from landing there and silently re-tainting a path
  the browser used to reach. A `knip`-style or lint guardrail is still absent.
- ~~**`files/cleanup/` still exists**~~ — **CLOSED (7c), by deletion.** Zero runtime callers; the
  only reference was one lib test, which now exercises `enqueueOrphanedStorageObjectCleanup`
  directly.
- **Two `EntityType` unions.** `files/types/entities.ts` (the upload keyspace: 11 values including
  `FILE` and `CUSTOM_FIELD`) and `files/core/types.ts:17` (the attachment keyspace: includes
  `FIELD_VALUE`, `TASK`, `ORDER`, `PRODUCT`, omits `FILE` and `CUSTOM_FIELD`). `persistUpload` casts
  between them. `Attachment.entityType` is a plain `text` column and the database holds
  `FIELD_VALUE` rows written by a writer outside the handler table.
- **`/api/files/download/[fileId]` still buffers the whole object into memory** before a single byte
  reaches the client, and a `Range` request does the full read every time. A 2 GB video in the file
  library is a 2 GB `Buffer` in the web process. The attachment routes already show the correct
  pattern. Its own comment explaining why it stays on `StorageManager` ("per-provider dispatch") is
  stale — §5.2 measured that away, and `getAssetContent` / `getFolderFileContent` now exist.
- **`api/attachments/[id]/download/route.ts` still constructs `new AttachmentService(...)`** with a
  comment saying `getAttachmentDownloadRef` does not exist yet. It landed in #1857.
- The uploader's `startUploadForSession(sessionId)` still works by **temporarily reassigning the
  global `activeSessionId`** (`orchestration-slice.ts:832`), and three module-level `Map`s survive
  alongside `use-field-file-upload.ts`'s module-level completion-handler `Map` + global
  `useUploadStore.subscribe` + 30-minute staleness sweep. That is phase 8b/8c, and it is the one
  part unit tests cannot sign off — every slice needs a real browser upload before merge.
- The `attachments/[id]/thumbnail` rate limiter is an in-process `Map`, which means it is per-instance.

---

## 13. Key Files

**Routes**
```
apps/web/src/app/api/files/upload/sessions/route.ts               session create + the two gates
apps/web/src/app/api/files/upload/[sessionId]/parts/route.ts      per-part presign
apps/web/src/app/api/files/upload/[sessionId]/complete/route.ts   completion
apps/web/src/app/api/files/upload/[sessionId]/abort/route.ts      cancel: release the multipart upload
apps/web/src/app/api/files/upload/[sessionId]/authorize-upload-session.ts
apps/web/src/app/api/files/download/[fileId]/route.ts             buffered download
apps/web/src/app/api/attachments/[attachmentId]/{content,download,thumbnail}/route.ts
apps/web/src/app/api/attachments/attachment-visibility.ts         canViewAttachment (mail lens)
apps/web/src/app/api/workflows/shared/[shareToken]/files/**       the parallel public flow
```

**The contract**
```
packages/lib/src/files/ctx.ts             FilesCtx / FilesDeps / the three signature shapes
packages/lib/src/files/guard.ts           guard / unwrap
packages/lib/src/files/__tests__/support/ db, storage, queue, cache, redis, clock doubles
```

**Upload pipeline** (`packages/lib/src/files/upload/`)
```
prepare.ts        prepareUpload — handler lookup, config, session, presign
complete.ts       completeUpload — verify / one transaction / after commit
persist.ts        persistUpload — the one switch on handler.persist
post-commit.ts    runUploadPostCommit — afterCommit, thumbnails, preview URL
compensate.ts     compensateUploadObject — delete the orphan, else enqueue cleanup
abort.ts          abortMultipartUpload — release an upload that will never complete
config.ts         buildUploadConfig (pure) + validateCompletedUpload
handlers/         types.ts (the UploadHandler record) + index.ts + 11 entity handlers
session.ts        Redis session functions over an injected client, CAS patches
errors.ts         classifyUploadError — a table keyed by AuxxError.statusCode
init-types.ts     UploadInitConfig / UploadPreparedConfig / UploadPolicy / UploadPlan
util.ts           deriveStorageKey, sanitizeFileName, normalizeMimeType
```

**Storage** (`packages/lib/src/files/storage/`, `adapters/`)
```
ports.ts            StoragePort / QueuePort / CachePort + createS3StoragePort
buckets.ts          bucketForVisibility, buildExternalUrl, assertBucket, requireLocationBucket
presign.ts          enforceUploadPolicy + the four signing functions
objects.ts          put / get / stream / head / delete
locations.ts        createStorageLocation / deleteStorageLocation   (tx-first)
location-queries.ts getStorageLocation / findStorageLocationByExternalId
queue-port.ts       createProductionQueuePort
cache-port.ts       createProductionCachePort
storage-manager.ts  @deprecated facade — uploadContent + the locationId-addressed composites
adapters/s3-adapter.ts
```

**Entity modules** (`packages/lib/src/files/`)
```
assets/         MediaAsset + versions + download + content
attachments/    Attachment + the pinned/unpinned download ladder
folder-files/   FolderFile + FileVersion + download + content
folders/        the folder tree (queries, mutations, pure tree.ts, maintenance)
filesystem/     the combined folder+file view, move planning
thumbnails/     presets, ensure/enqueue, the four sweeps, the job contract
core/           @deprecated facades + image-processing (sharp) + shared types
```

**Lifecycle**
```
packages/lib/src/files/lifecycle/file-reaper.ts           the three sweeps, (db, deps, options)
packages/lib/src/files/lifecycle/quota-cleanup.ts        calculateStorageUsage(ctx) + plan limits
packages/lib/src/files/lifecycle/attachment-maintenance.ts  whole-org Attachment sweeps
packages/lib/src/jobs/maintenance/file-cleanup-jobs.ts   the three cron handlers; binds the pool
packages/lib/src/jobs/maintenance/orphaned-storage-object-job.ts
packages/lib/src/jobs/maintenance/generate-thumbnail-job.ts
packages/lib/src/jobs/maintenance/media-asset-cleanup-job.ts
apps/worker/src/workers/index.ts                      job scheduling
```

**Front end** (`apps/web/src/components/file-upload/`)
```
hooks/use-file-upload.ts               the public hook
transport/types.ts                     UploadTransport + the wire contract
transport/http-upload-transport.ts     the only file that knows a URL
transport/direct-upload.ts             XHR to S3, single + serial multipart
transport/upload-error.ts              parseUploadErrorResponse
stores/slices/orchestration-slice.ts   startUpload — the driver
ui/{avatar-upload,file-queue-manager,file-item}.tsx
```
