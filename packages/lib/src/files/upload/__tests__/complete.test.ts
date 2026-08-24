// packages/lib/src/files/upload/__tests__/complete.test.ts

/**
 * `completeUpload` end to end, against the real handler dispatch.
 *
 * ## What changed in PR 4d
 *
 * This file used to register a **stub processor** through
 * `ProcessorRegistry.registerForEntity` and assert that `completeUpload` called
 * it. That proved the orchestration called *something*; it could not prove the
 * something wrote the right rows, because the real persistence was four levels
 * of `super` away behind three service constructions.
 *
 * `persistUpload` takes `tx` as a parameter and dispatches on
 * `handler.persist`, so there is nothing left to stub: the assertions below run
 * the actual writes against the support kit's db stub and check which tables
 * were touched, in which order, on which side of `COMMIT`.
 *
 * ## The three properties this file exists for
 *
 * 1. **Nothing but database statements between `BEGIN` and `COMMIT`.** A
 *    thumbnail enqueued before `COMMIT` resolves its source asset on its own
 *    connection, reads the pre-transaction `currentVersionId`, answers `ready`
 *    against the previous version, and a re-uploaded avatar serves the old image
 *    forever (Tier-1 §1.3, guide §10.3). `journal.between('begin', 'commit')` is
 *    that bug, in one assertion.
 * 2. **The `EntityType` decides which rows exist.** `FILE` produces a
 *    `FolderFile` and no `assetId`; `KNOWLEDGE_BASE` produces a `MediaAsset`, an
 *    `Attachment` and a logo pointer. Picking the wrong one is silent in
 *    production (guide §11.3), so it is loud here.
 * 3. **Every side effect passes through a port.** Property 1 is only worth as
 *    much as the journal's coverage: before PR 6c the two cache busts on this
 *    path were `await import('../../../cache')` inside their handlers, so the
 *    `between('begin', 'commit')` assertion could not see the exact calls that
 *    had violated it in production. They are `deps.cache` now, and the
 *    post-commit describe block below asserts on them directly.
 *
 * `vi.mock` count in this file: **zero**.
 */

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  anAsset,
  aStorageLocation,
  makeCachePort,
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
import { ENTITY_TYPES, type EntityType } from '../../types/entities'
import { type CompleteUploadDeps, completeUpload } from '../complete'
import type { PresignedUploadSession } from '../session-types'

const SESSION_ID = 'sess_nanoid_000000000000'
const SESSION_KEY = `upload:session:${SESSION_ID}`
const LOCATION_ID = 'loc_completed_upload'
const ASSET_ID = 'ast_completed_upload'
const VERSION_ID = 'ver_completed_upload'
const ATTACHMENT_ID = 'att_completed_upload'
const FILE_ID = 'fil_completed_upload'

/** A finished, single-shot, PUBLIC upload of a 1 KB PNG against a knowledge base. */
function aSession(overrides: Partial<PresignedUploadSession> = {}): PresignedUploadSession {
  const clock = makeClock()
  return {
    version: 2,
    id: SESSION_ID,
    organizationId: TEST_IDS.organizationId,
    userId: TEST_IDS.userId,
    entityType: ENTITY_TYPES.KNOWLEDGE_BASE as EntityType,
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

interface Harness {
  ctx: FilesCtx
  deps: CompleteUploadDeps
  journal: ReturnType<typeof makeJournal>
  queue: ReturnType<typeof makeQueuePort>
  storage: ReturnType<typeof makeStoragePort>
  cache: ReturnType<typeof makeCachePort>
  db: ReturnType<typeof makeDb>
  redis: ReturnType<typeof makeRedis>
  /** Put a session where `patchUploadSession` can find it. */
  seed(session: PresignedUploadSession): void
}

/**
 * The rows the asset path needs, in the order the writes ask for them.
 *
 * The stub is dumb by design (`__tests__/support/db.ts`) — it does not read a
 * `where` — so a queue entry per call is how a test says "this lookup hits".
 */
function assetPathRows() {
  return {
    insert: [
      [aStorageLocation({ id: LOCATION_ID, externalUrl: 'https://cdn.test/logo.png' })],
      [anAsset({ id: ASSET_ID, isPrivate: false })],
      [{ id: VERSION_ID, assetId: ASSET_ID, versionNumber: 1 }],
      [{ id: ATTACHMENT_ID }],
    ],
    query: {
      // 1. `requireAsset` inside `createAssetVersion`.
      // 2. the post-commit thumbnail fan-out's source lookup.
      MediaAsset: [
        anAsset({ id: ASSET_ID, currentVersionId: VERSION_ID, isPrivate: false }),
        anAsset({ id: ASSET_ID, currentVersionId: VERSION_ID, isPrivate: false }),
      ],
      // Empty: the new asset has no prior version, and every preset misses and
      // therefore enqueues.
      MediaAssetVersion: [],
      StorageLocation: [aStorageLocation({ id: LOCATION_ID })],
    },
  }
}

/**
 * Register the real table references so the journal carries names.
 *
 * Under Vitest this package's setup replaces `@auxx/database`'s `schema` with a
 * memoised proxy handing out bare `{}` objects, so a table cannot name itself
 * (`__tests__/support/db.ts`). Identity is still stable, which is what this map
 * relies on — and naming the tables is the whole point of the assertions below.
 */
const TABLES = {
  StorageLocation: schema.StorageLocation,
  MediaAsset: schema.MediaAsset,
  MediaAssetVersion: schema.MediaAssetVersion,
  Attachment: schema.Attachment,
  FolderFile: schema.FolderFile,
  FileVersion: schema.FileVersion,
  KnowledgeBase: schema.KnowledgeBase,
}

function harness(overrides: Parameters<typeof makeDb>[0] = {}): Harness {
  const journal = makeJournal()
  const clock = makeClock()
  const rows = assetPathRows()

  const db = makeDb({
    journal,
    tables: TABLES,
    insert: overrides.insert ?? rows.insert,
    query: overrides.query ?? rows.query,
    select: overrides.select,
  })

  const storage = makeStoragePort({
    journal,
    results: { head: { name: 'logo.png', size: 1024, mimeType: 'image/png', etagOrRev: 'etag-b' } },
  })
  const queue = makeQueuePort({ journal })
  const cache = makeCachePort({ journal })
  const redis = makeRedis({ now: clock.now })

  return {
    journal,
    queue,
    storage,
    cache,
    db,
    redis,
    ctx: { db: db.db, organizationId: TEST_IDS.organizationId },
    deps: {
      storage: storage.port,
      queue: queue.port,
      cache: cache.port,
      now: clock.now,
      redis: redis.redis,
    },
    seed: (session) => redis.seed(SESSION_KEY, JSON.stringify(session), 600_000),
  }
}

const COMPLETION = { size: 1024, mimeType: 'image/png' }

describe('completeUpload — phase boundaries', () => {
  let h: Harness

  beforeEach(() => {
    h = harness()
  })

  it('does no non-database work between BEGIN and COMMIT', async () => {
    const session = aSession()
    h.seed(session)

    const result = await completeUpload(h.ctx, h.deps, session, COMPLETION)

    expect(result.isOk()).toBe(true)

    const inside = h.journal.between('begin', 'commit')
    expect(inside.length).toBeGreaterThan(0)
    expect(inside.map((entry) => entry.channel)).toEqual(inside.map(() => 'db'))
  })

  it('opens exactly one transaction', async () => {
    const session = aSession()
    h.seed(session)

    await completeUpload(h.ctx, h.deps, session, COMPLETION)

    // `persistUpload` never calls `tx.transaction(...)`, which Drizzle answers
    // with a SAVEPOINT — the trap #1851 hit and what three of the processors did.
    expect(h.db.transactions).toBe(1)
    expect(h.journal.ops('db').filter((op) => op === 'begin')).toHaveLength(1)
  })
})

describe('completeUpload — the entity type decides the rows', () => {
  it('KNOWLEDGE_BASE writes an asset, a version, an attachment and the logo pointer', async () => {
    const h = harness()
    const session = aSession()
    h.seed(session)

    const result = await completeUpload(h.ctx, h.deps, session, COMPLETION)

    expect(result._unsafeUnwrap()).toMatchObject({
      sessionId: SESSION_ID,
      storageLocationId: LOCATION_ID,
      assetId: ASSET_ID,
      attachmentId: ATTACHMENT_ID,
    })
    expect(result._unsafeUnwrap().fileId).toBeUndefined()

    expect(h.db.inserts.map((row) => row.table)).toEqual([
      'StorageLocation',
      'MediaAsset',
      'MediaAssetVersion',
      'Attachment',
    ])
    // The logo pointer is written inside the same transaction as the asset, so
    // a failure later in the completion cannot leave a KB pointing at nothing.
    expect(h.db.updates.map((row) => row.table)).toContain('KnowledgeBase')
  })

  it('the asset it creates is public, because the session is', async () => {
    const h = harness()
    h.seed(aSession())

    await completeUpload(h.ctx, h.deps, aSession(), COMPLETION)

    const asset = h.db.inserts.find((row) => row.table === 'MediaAsset')
    // `isPrivate` comes from `session.visibility`, not a per-processor field —
    // which is what made `DatasetAssetProcessor`'s lowercase `'private'` route
    // dataset documents to the public bucket and record them as non-private.
    expect(asset?.values).toMatchObject({ isPrivate: false, kind: 'THUMBNAIL' })
  })

  it('FILE writes a FolderFile and no MediaAsset', async () => {
    const h = harness({
      insert: [
        [aStorageLocation({ id: LOCATION_ID })],
        [{ id: FILE_ID, name: 'logo.png', path: '/logo.png' }],
        [{ id: 'fver_1', fileId: FILE_ID, versionNumber: 1 }],
      ],
      query: {
        FileVersion: [],
        StorageLocation: [aStorageLocation({ id: LOCATION_ID })],
      },
      select: [
        // `resolveUniqueFilePath`'s collision probe: nothing takes the path.
        [],
        // `requireFolderFile`, inside `createFileVersion`.
        [{ id: FILE_ID, name: 'logo.png' }],
      ],
    })
    const session = aSession({
      entityType: ENTITY_TYPES.FILE as EntityType,
      entityId: undefined,
      visibility: 'PRIVATE',
      bucket: TEST_BUCKETS.private,
    })
    h.seed(session)

    const result = await completeUpload(h.ctx, h.deps, session, COMPLETION)

    const completed = result._unsafeUnwrap()
    expect(completed.fileId).toBe(FILE_ID)
    expect(completed.assetId).toBeUndefined()
    expect(completed.attachmentId).toBeUndefined()
    expect(h.db.inserts.map((row) => row.table)).toEqual([
      'StorageLocation',
      'FolderFile',
      'FileVersion',
    ])
  })
})

describe('completeUpload — post-commit thumbnails', () => {
  it('enqueues both KB logo presets, after the commit', async () => {
    const h = harness()
    h.seed(aSession())

    await completeUpload(h.ctx, h.deps, aSession(), COMPLETION)

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

  it('enqueues nothing for an entity type whose handler declares none', async () => {
    const h = harness()
    const session = aSession({
      entityType: ENTITY_TYPES.MESSAGE as EntityType,
      entityId: 'msg_test',
      visibility: 'PRIVATE',
      bucket: TEST_BUCKETS.private,
    })
    h.seed(session)

    await completeUpload(h.ctx, h.deps, session, COMPLETION)

    expect(h.queue.callsTo('enqueueThumbnail')).toHaveLength(0)
  })
})

describe('completeUpload — post-commit cache invalidation', () => {
  /**
   * The regression this covers is guide §10.3: `ChatWidgetProcessor` busted
   * `channel.settings_updated` the moment its own savepoint released, which was
   * still inside the route's open transaction, so a reader that lost the race
   * repopulated the cache from pre-commit state and kept serving the old logo.
   *
   * Before PR 6c the bust was `await import('../../../cache')` inside the
   * handler, which no double could see — this assertion was unwritable, and the
   * `journal.between('begin', 'commit')` check above passed without covering the
   * one call that had ever broken it.
   */
  it('CHAT_WIDGET busts the channels cache through the port, after the commit', async () => {
    const h = harness()
    const session = aSession({
      entityType: ENTITY_TYPES.CHAT_WIDGET as EntityType,
      entityId: 'cw_1',
    })
    h.seed(session)

    const result = await completeUpload(h.ctx, h.deps, session, COMPLETION)

    expect(result.isOk()).toBe(true)
    expect(h.cache.events()).toEqual(['channel.settings_updated'])
    expect(h.cache.busts[0]?.payload).toEqual({ orgId: TEST_IDS.organizationId })

    const commitAt = h.journal.entries.find((entry) => entry.op === 'commit')?.seq ?? -1
    const bustAt = h.journal.entries.find((entry) => entry.channel === 'cache')?.seq ?? -1
    expect(commitAt).toBeGreaterThan(0)
    expect(bustAt).toBeGreaterThan(commitAt)
  })

  it('USER_PROFILE drops the dehydrated user, and the agents key only for an agent target', async () => {
    const agentRows = {
      insert: [
        [aStorageLocation({ id: LOCATION_ID, externalUrl: 'https://cdn.test/avatar.png' })],
        [anAsset({ id: ASSET_ID, isPrivate: false })],
        [{ id: VERSION_ID, assetId: ASSET_ID, versionNumber: 1 }],
      ],
      // `findVersionedAsset` finds nothing, so a fresh avatar asset is minted.
      select: [[]],
      query: assetPathRows().query,
    }

    const agent = harness(agentRows)
    const agentSession = aSession({
      entityType: ENTITY_TYPES.USER_PROFILE as EntityType,
      entityId: 'usr_agent',
      fileName: 'avatar.png',
    })
    agent.seed(agentSession)

    await completeUpload(agent.ctx, agent.deps, agentSession, COMPLETION)

    expect(agent.cache.invalidatedUsers).toEqual(['usr_agent'])
    expect(agent.cache.events()).toEqual(['agent.updated'])

    // A self-upload touches the same user, and no agent roster.
    const self = harness(agentRows)
    const selfSession = aSession({
      entityType: ENTITY_TYPES.USER_PROFILE as EntityType,
      entityId: TEST_IDS.userId,
      fileName: 'avatar.png',
    })
    self.seed(selfSession)

    await completeUpload(self.ctx, self.deps, selfSession, COMPLETION)

    expect(self.cache.invalidatedUsers).toEqual([TEST_IDS.userId])
    expect(self.cache.events()).toEqual([])
  })

  it('a failing cache bust does not fail an upload whose rows are committed', async () => {
    const h = harness()
    const cache = makeCachePort({
      journal: h.journal,
      impl: {
        bust: async () => {
          throw new Error('Redis unreachable')
        },
      },
    })
    const session = aSession({
      entityType: ENTITY_TYPES.CHAT_WIDGET as EntityType,
      entityId: 'cw_1',
    })
    h.seed(session)

    const result = await completeUpload(
      h.ctx,
      { ...h.deps, cache: cache.port },
      session,
      COMPLETION
    )

    // The bytes are in storage and the rows are committed by this point; a
    // dehydration bust that throws must not turn that into a 500 that also marks
    // the session failed (#1857).
    expect(result.isOk()).toBe(true)
    expect(h.journal.ops('db')).toContain('commit')
  })
})

describe('completeUpload — refusals and compensation', () => {
  let h: Harness

  beforeEach(() => {
    h = harness()
  })

  it('400s a session that has already failed, without touching storage', async () => {
    const session = aSession({ status: 'failed' })
    h.seed(session)

    const result = await completeUpload(h.ctx, h.deps, session, COMPLETION)

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(h.storage.calls).toHaveLength(0)
  })

  it('400s a multipart completion that names no parts', async () => {
    const session = aSession({ isMultipart: true, uploadId: 'mpu-1' })
    h.seed(session)

    const result = await completeUpload(h.ctx, h.deps, session, COMPLETION)

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
  })

  it('422s an object whose delivered size contradicts the session', async () => {
    const session = aSession()
    h.seed(session)

    h.storage = makeStoragePort({
      journal: h.journal,
      results: { head: { size: 9999, mimeType: 'image/png', etagOrRev: 'etag-b' } },
    })
    h.deps = { ...h.deps, storage: h.storage.port }

    const result = await completeUpload(h.ctx, h.deps, session, COMPLETION)

    expect(result._unsafeUnwrapErr().statusCode).toBe(422)
    expect(h.db.transactions).toBe(0)
  })

  it('deletes the object from the bucket it was written to when the transaction fails', async () => {
    // The `MediaAsset` insert answers no row, which is what a rejected statement
    // looks like through `RETURNING`.
    const failing = harness({
      insert: [[aStorageLocation({ id: LOCATION_ID })], []],
      query: assetPathRows().query,
    })
    const session = aSession()
    failing.seed(session)

    const result = await completeUpload(failing.ctx, failing.deps, session, COMPLETION)

    expect(result.isErr()).toBe(true)
    expect(failing.journal.ops('db')).toContain('rollback')

    const deletes = failing.storage.callsTo('deleteObject')
    expect(deletes).toHaveLength(1)
    // A wrong bucket here is invisible: S3 answers 204 for a key that is not in
    // the bucket you named, so the object leaks silently (#1816/#1817/#1818).
    expect(deletes[0]?.params.bucket).toBe(TEST_BUCKETS.public)
    expect(deletes[0]?.params.key).toBe(session.storageKey)
  })

  it('falls back to a durable cleanup job when the immediate delete fails', async () => {
    const failing = harness({
      insert: [[aStorageLocation({ id: LOCATION_ID })], []],
      query: assetPathRows().query,
    })
    const session = aSession()
    failing.seed(session)

    const storage = makeStoragePort({
      journal: failing.journal,
      results: { head: { size: 1024, mimeType: 'image/png', etagOrRev: 'etag-b' } },
      impl: {
        deleteObject: async () => {
          throw new Error('S3 unreachable')
        },
      },
    })

    await completeUpload(
      failing.ctx,
      { ...failing.deps, storage: storage.port },
      session,
      COMPLETION
    )

    const cleanups = failing.queue.callsTo('enqueueStorageCleanup')
    expect(cleanups).toHaveLength(1)
    expect(cleanups[0]?.params.bucket).toBe(TEST_BUCKETS.public)
  })
})
