// packages/lib/src/files/upload/__tests__/complete.test.ts

/**
 * The contract `apps/web/.../complete/post-commit-thumbnails.test.ts` used to
 * hold, moved down to where the behaviour now lives.
 *
 * That test needed **eleven** `vi.mock` factories — `@auxx/database`,
 * `@auxx/lib/files/server`, `@auxx/lib/cache`, `@auxx/lib/dehydration`,
 * `~/auth/server`, `next/headers`, … — to reach four assertions about which
 * thumbnail presets get enqueued, because the logic was inlined in a Next.js
 * route handler. It also modelled the "global connection" hazard with a
 * hand-rolled `versionStore` that only advanced when the mocked `db.transaction`
 * resolved.
 *
 * Here the same property is a structural one, and the support kit's shared
 * journal states it directly: **nothing but database statements may appear
 * between `begin` and `commit`**. A thumbnail enqueued before `COMMIT` resolves
 * its source asset on its own connection, reads the pre-transaction
 * `currentVersionId`, answers `ready` against the previous version, and a
 * re-uploaded avatar serves the old image forever (Tier-1 §1.3, guide §10.3).
 * `journal.between('begin', 'commit')` is that bug, in one assertion.
 *
 * `vi.mock` count in this file: **zero**.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  anAsset,
  aStorageLocation,
  makeClock,
  makeDb,
  makeJournal,
  makeQueuePort,
  makeRedis,
  makeStoragePort,
  TEST_BUCKETS,
  TEST_IDS,
} from '../../__tests__/support'
import type { FilesCtx } from '../../ctx'
import type { EntityType } from '../../types/entities'
import { type CompleteUploadDeps, completeUpload } from '../complete'
import { ensureProcessorsInitialized, ProcessorRegistry } from '../processors'
import type { BaseProcessor } from '../processors/base-processor'
import type { PresignedUploadSession } from '../session-types'

const SESSION_ID = 'sess_nanoid_000000000000'
const SESSION_KEY = `upload:session:${SESSION_ID}`
const ASSET_ID = 'ast_completed_upload'
const VERSION_ID = 'ver_completed_upload'

/** A finished, single-shot, PUBLIC upload of a 1 KB PNG. */
function aSession(overrides: Partial<PresignedUploadSession> = {}): PresignedUploadSession {
  const clock = makeClock()
  return {
    version: 2,
    id: SESSION_ID,
    organizationId: TEST_IDS.organizationId,
    userId: TEST_IDS.userId,
    entityType: 'KNOWLEDGE_BASE' as EntityType,
    entityId: 'kb_test',
    fileName: 'logo.png',
    mimeType: 'image/png',
    expectedSize: 1024,
    provider: 'S3',
    storageKey: `${TEST_IDS.organizationId}/knowledge-base/kb_test/logo.png`,
    isMultipart: false,
    uploadMethod: 'PUT',
    status: 'uploading',
    createdAt: clock.now(),
    expiresAt: new Date(clock.now().getTime() + 600_000),
    ttlSec: 600,
    metadata: {},
    policy: {
      keyPrefix: `${TEST_IDS.organizationId}/`,
      contentLengthRange: [0, 10 * 1024 * 1024],
      maxTtl: 600,
      allowedMimeTypes: ['image/png'],
    },
    uploadPlan: { strategy: 'single' },
    bucket: TEST_BUCKETS.public,
    visibility: 'PUBLIC',
    ...overrides,
  }
}

/**
 * A processor stub registered through the registry's own public API.
 *
 * `completeUpload` still dispatches persistence through `ProcessorRegistry` —
 * PR 4d is what replaces that with `persistUpload` + `handler.persist` — so the
 * registry is the seam a test has to use. `registerForEntity` overwrites, and
 * Vitest gives each file its own module graph, so this cannot leak.
 */
function registerStubProcessor(entityType: EntityType, assetId: string | undefined) {
  const calls: Array<{ storageLocationId: string; hasTx: boolean }> = []

  ensureProcessorsInitialized()
  ProcessorRegistry.registerForEntity(entityType, () => {
    return {
      async process(_session: unknown, storageLocationId: string, opts?: { tx?: unknown }) {
        calls.push({ storageLocationId, hasTx: !!opts?.tx })
        return { assetId, storageLocationId }
      },
    } as unknown as BaseProcessor
  })

  return calls
}

interface Harness {
  ctx: FilesCtx
  deps: CompleteUploadDeps
  journal: ReturnType<typeof makeJournal>
  queue: ReturnType<typeof makeQueuePort>
  storage: ReturnType<typeof makeStoragePort>
  db: ReturnType<typeof makeDb>
  redis: ReturnType<typeof makeRedis>
  /** Put a session where `patchUploadSession` can find it. */
  seed(session: PresignedUploadSession): void
}

function harness(): Harness {
  const journal = makeJournal()
  const clock = makeClock()

  const db = makeDb({
    journal,
    // The `StorageLocation` INSERT ... RETURNING, then the thumbnail fan-out's
    // asset lookup. `MediaAssetVersion` is left empty so every preset misses and
    // therefore enqueues.
    insert: [[aStorageLocation({ id: 'loc_completed_upload' })]],
    query: {
      MediaAsset: [anAsset({ id: ASSET_ID, currentVersionId: VERSION_ID, isPrivate: false })],
      MediaAssetVersion: [],
    },
  })

  const storage = makeStoragePort({
    journal,
    results: { head: { name: 'logo.png', size: 1024, mimeType: 'image/png', etagOrRev: 'etag-b' } },
  })
  const queue = makeQueuePort({ journal })
  const redis = makeRedis({ now: clock.now })

  return {
    journal,
    queue,
    storage,
    db,
    redis,
    ctx: { db: db.db, organizationId: TEST_IDS.organizationId },
    deps: { storage: storage.port, queue: queue.port, now: clock.now, redis: redis.redis },
    seed: (session) => redis.seed(SESSION_KEY, JSON.stringify(session), 600_000),
  }
}

describe('completeUpload — phase boundaries', () => {
  let h: Harness

  beforeEach(() => {
    h = harness()
  })

  const seed = (session: PresignedUploadSession) => h.seed(session)

  it('does no non-database work between BEGIN and COMMIT', async () => {
    const session = aSession()
    seed(session)
    registerStubProcessor(session.entityType, ASSET_ID)

    const result = await completeUpload(h.ctx, h.deps, session, {
      size: 1024,
      mimeType: 'image/png',
    })

    expect(result.isOk()).toBe(true)

    const inside = h.journal.between('begin', 'commit')
    expect(inside.length).toBeGreaterThan(0)
    expect(inside.map((entry) => entry.channel)).toEqual(inside.map(() => 'db'))
  })

  it('opens exactly one transaction', async () => {
    const session = aSession()
    seed(session)
    registerStubProcessor(session.entityType, ASSET_ID)

    await completeUpload(h.ctx, h.deps, session, { size: 1024, mimeType: 'image/png' })

    expect(h.db.transactions).toBe(1)
    expect(h.journal.ops('db').filter((op) => op === 'begin')).toHaveLength(1)
  })

  it('hands the persistence step the transaction, not the pool', async () => {
    const session = aSession()
    seed(session)
    const calls = registerStubProcessor(session.entityType, ASSET_ID)

    await completeUpload(h.ctx, h.deps, session, { size: 1024, mimeType: 'image/png' })

    expect(calls).toEqual([{ storageLocationId: 'loc_completed_upload', hasTx: true }])
  })

  it('reports the rows the persistence step created', async () => {
    const session = aSession()
    seed(session)
    registerStubProcessor(session.entityType, ASSET_ID)

    const result = await completeUpload(h.ctx, h.deps, session, {
      size: 1024,
      mimeType: 'image/png',
    })

    expect(result._unsafeUnwrap()).toMatchObject({
      sessionId: SESSION_ID,
      storageLocationId: 'loc_completed_upload',
      assetId: ASSET_ID,
    })
  })
})

describe('completeUpload — post-commit thumbnails', () => {
  let h: Harness

  beforeEach(() => {
    h = harness()
  })

  const seed = (session: PresignedUploadSession) => h.seed(session)

  it('enqueues both KB logo presets, after the commit', async () => {
    const session = aSession()
    seed(session)
    registerStubProcessor(session.entityType, ASSET_ID)

    await completeUpload(h.ctx, h.deps, session, { size: 1024, mimeType: 'image/png' })

    const presets = h.queue
      .callsTo('enqueueThumbnail')
      .map((call) => call.params.preset)
      .sort()
    expect(presets).toEqual(['kb-logo-lg', 'kb-logo-sm'])

    const commitAt = h.journal.entries.find((entry) => entry.op === 'commit')?.seq ?? -1
    const firstEnqueue = h.journal.entries.find((entry) => entry.channel === 'queue')?.seq ?? -1
    expect(commitAt).toBeGreaterThan(0)
    expect(firstEnqueue).toBeGreaterThan(commitAt)
  })

  it('enqueues nothing for an entity type with no presets', async () => {
    const session = aSession({ entityType: 'MESSAGE' as EntityType })
    seed(session)
    registerStubProcessor(session.entityType, ASSET_ID)

    await completeUpload(h.ctx, h.deps, session, { size: 1024, mimeType: 'image/png' })

    expect(h.queue.callsTo('enqueueThumbnail')).toHaveLength(0)
  })

  it('enqueues nothing when the persistence step created no asset', async () => {
    const session = aSession()
    seed(session)
    registerStubProcessor(session.entityType, undefined)

    await completeUpload(h.ctx, h.deps, session, { size: 1024, mimeType: 'image/png' })

    expect(h.queue.callsTo('enqueueThumbnail')).toHaveLength(0)
  })
})

describe('completeUpload — refusals and compensation', () => {
  let h: Harness

  beforeEach(() => {
    h = harness()
  })

  const seed = (session: PresignedUploadSession) => h.seed(session)

  it('400s a session that has already failed, without touching storage', async () => {
    const session = aSession({ status: 'failed' })
    seed(session)
    registerStubProcessor(session.entityType, ASSET_ID)

    const result = await completeUpload(h.ctx, h.deps, session, {
      size: 1024,
      mimeType: 'image/png',
    })

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(h.storage.calls).toHaveLength(0)
  })

  it('400s a multipart completion that names no parts', async () => {
    const session = aSession({ isMultipart: true, uploadId: 'mpu-1' })
    seed(session)
    registerStubProcessor(session.entityType, ASSET_ID)

    const result = await completeUpload(h.ctx, h.deps, session, {
      size: 1024,
      mimeType: 'image/png',
    })

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
  })

  it('422s an object whose delivered size contradicts the session', async () => {
    const session = aSession()
    seed(session)
    registerStubProcessor(session.entityType, ASSET_ID)

    h.storage = makeStoragePort({
      journal: h.journal,
      results: { head: { size: 9999, mimeType: 'image/png', etagOrRev: 'etag-b' } },
    })
    h.deps = { ...h.deps, storage: h.storage.port }

    const result = await completeUpload(h.ctx, h.deps, session, {
      size: 1024,
      mimeType: 'image/png',
    })

    expect(result._unsafeUnwrapErr().statusCode).toBe(422)
    expect(h.db.transactions).toBe(0)
  })

  it('deletes the object from the bucket it was written to when the transaction fails', async () => {
    const session = aSession()
    seed(session)

    ensureProcessorsInitialized()
    ProcessorRegistry.registerForEntity(session.entityType, () => {
      return {
        async process() {
          throw new Error('persistence blew up')
        },
      } as unknown as BaseProcessor
    })

    const result = await completeUpload(h.ctx, h.deps, session, {
      size: 1024,
      mimeType: 'image/png',
    })

    expect(result.isErr()).toBe(true)

    const deletes = h.storage.callsTo('deleteObject')
    expect(deletes).toHaveLength(1)
    // A wrong bucket here is invisible: S3 answers 204 for a key that is not in
    // the bucket you named, so the object leaks silently (#1816/#1817/#1818).
    expect(deletes[0]?.params.bucket).toBe(TEST_BUCKETS.public)
    expect(deletes[0]?.params.key).toBe(session.storageKey)
  })

  it('falls back to a durable cleanup job when the immediate delete fails', async () => {
    const session = aSession()
    seed(session)

    h.storage = makeStoragePort({
      journal: h.journal,
      results: { head: { size: 1024, mimeType: 'image/png', etagOrRev: 'etag-b' } },
      impl: {
        deleteObject: async () => {
          throw new Error('S3 unreachable')
        },
      },
    })
    h.deps = { ...h.deps, storage: h.storage.port }

    ensureProcessorsInitialized()
    ProcessorRegistry.registerForEntity(session.entityType, () => {
      return {
        async process() {
          throw new Error('persistence blew up')
        },
      } as unknown as BaseProcessor
    })

    await completeUpload(h.ctx, h.deps, session, { size: 1024, mimeType: 'image/png' })

    const cleanups = h.queue.callsTo('enqueueStorageCleanup')
    expect(cleanups).toHaveLength(1)
    expect(cleanups[0]?.params.bucket).toBe(TEST_BUCKETS.public)
  })
})
