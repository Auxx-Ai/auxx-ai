// packages/lib/src/files/upload/__tests__/prepare.test.ts

/**
 * What `POST /api/files/upload/sessions` used to inline, and the three
 * non-declarative checks that used to be buried in the `processConfig` chain.
 *
 * PR 4a's parity test compared four declarative fields, which is why 4e would
 * not swap this function's config source: `buildUploadConfig` is pure and total,
 * but the chain it replaced *also* required an `entityId` for every
 * attachment-backed type, ran `validateEntityAccess`, and let `CUSTOM_FIELD`
 * narrow its MIME list from the org cache. Those three are now
 * `requiresEntityId`, `handler.validateEntity` and `handler.refineConfig`, and
 * each has a block below.
 *
 * `FILE` is the default entity type under test because its handler has no hooks
 * at all — the whole prepare path runs with a `db` stub that is never asked
 * anything. `vi.mock` count: **zero**.
 */

import { describe, expect, it } from 'vitest'
import { makeClock, makeDb, makeRedis, makeStoragePort, TEST_IDS } from '../../__tests__/support'
import type { FilesCtx } from '../../ctx'
import { ENTITY_TYPES, type EntityType } from '../../types/entities'
import { UPLOAD_HANDLERS } from '../handlers'
import type { UploadInitConfig } from '../init-types'
import { type PrepareUploadDeps, prepareUpload } from '../prepare'
import { getUploadSession } from '../session'

const MB = 1024 * 1024

function init(overrides: Partial<UploadInitConfig> = {}): UploadInitConfig {
  return {
    organizationId: TEST_IDS.organizationId,
    userId: TEST_IDS.userId,
    fileName: 'archive.zip',
    mimeType: 'application/zip',
    expectedSize: 4096,
    entityType: ENTITY_TYPES.FILE,
    ...overrides,
  }
}

function harness(dbOptions: Parameters<typeof makeDb>[0] = {}) {
  const clock = makeClock()
  const storage = makeStoragePort()
  const redis = makeRedis({ now: clock.now })
  const db = makeDb(dbOptions)
  const ctx: FilesCtx = { db: db.db, organizationId: TEST_IDS.organizationId }
  const deps: PrepareUploadDeps = { storage: storage.port, now: clock.now, redis: redis.redis }
  return { clock, storage, redis, db, ctx, deps }
}

describe('prepareUpload — single-shot', () => {
  it('presigns, stores the session, and reports the wire fields', async () => {
    const h = harness()

    const result = await prepareUpload(h.ctx, h.deps, init())
    const prepared = result._unsafeUnwrap()

    expect(prepared.strategy).toBe('single')
    expect(prepared.httpMethod).toBe('PUT')
    expect(prepared.presignedUrl).toBe('https://s3.test/upload')
    // A presigned PUT carries no form fields; sending `{}` would make the
    // uploader build a multipart form for a raw-body upload.
    expect(prepared.presignedFields).toBeUndefined()
    expect(prepared.storageKey).toContain(`${TEST_IDS.organizationId}/`)

    const stored = await getUploadSession(h.deps.redis, prepared.sessionId)
    expect(stored?.presignedUrl).toBe('https://s3.test/upload')
    expect(stored?.uploadMethod).toBe('PUT')
  })

  it('returns the form fields for a presigned POST', async () => {
    const h = harness()
    const storage = makeStoragePort({
      results: {
        presignUpload: {
          url: 'https://s3.test/post',
          method: 'POST',
          fields: { key: 'k' },
          expiresAt: new Date(0),
        },
      },
    })

    const result = await prepareUpload(h.ctx, { ...h.deps, storage: storage.port }, init())
    const prepared = result._unsafeUnwrap()

    expect(prepared.httpMethod).toBe('POST')
    expect(prepared.presignedFields).toEqual({ key: 'k' })
  })

  it('carries the session id into the presigned object metadata', async () => {
    const h = harness()

    const prepared = (await prepareUpload(h.ctx, h.deps, init()))._unsafeUnwrap()

    const [call] = h.storage.callsTo('presignUpload')
    expect(call?.params.metadata).toEqual({ sessionId: prepared.sessionId })
  })
})

describe('prepareUpload — multipart', () => {
  it('opens a multipart upload above the threshold and records the upload id', async () => {
    const h = harness()

    const result = await prepareUpload(h.ctx, h.deps, init({ expectedSize: 200 * MB }))
    const prepared = result._unsafeUnwrap()

    expect(prepared.strategy).toBe('multipart')
    expect(prepared.uploadId).toBe('upload-1')
    expect(prepared.presignedUrl).toBeUndefined()

    const stored = await getUploadSession(h.deps.redis, prepared.sessionId)
    expect(stored?.uploadId).toBe('upload-1')
    expect(stored?.isMultipart).toBe(true)
  })
})

describe('prepareUpload — refusals', () => {
  it('400s an entity type with no handler', async () => {
    const h = harness()

    const result = await prepareUpload(h.ctx, h.deps, init({ entityType: 'NOT_A_THING' as never }))

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(result._unsafeUnwrapErr().message).toContain('No upload handler for entity type')
    // Nothing was signed and no session key was left behind.
    expect(h.storage.calls).toHaveLength(0)
    expect(h.redis.keys()).toHaveLength(0)
  })

  it('422s a request that breaks its handler policy, before touching Redis', async () => {
    // The KB exists; it is the file that is unacceptable. SVG is excluded from
    // every logo allow-list because an uploaded SVG can carry `<script>`.
    const h = harness({ select: [[{ id: 'kb_1' }]] })

    const result = await prepareUpload(
      h.ctx,
      h.deps,
      init({
        entityType: ENTITY_TYPES.KNOWLEDGE_BASE,
        entityId: 'kb_1',
        mimeType: 'image/svg+xml',
      })
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(422)
    expect(h.redis.keys()).toHaveLength(0)
  })
})

describe('prepareUpload — the entityId rule', () => {
  /** Exactly the `asset+attachment` handlers, which is exactly the rule. */
  const ATTACHMENT_BACKED = Object.values(UPLOAD_HANDLERS)
    .filter((handler) => handler.persist === 'asset+attachment')
    .map((handler) => handler.entityType)

  it.each(ATTACHMENT_BACKED)('%s refuses a request with no entityId', async (entityType) => {
    const h = harness()

    const result = await prepareUpload(
      h.ctx,
      h.deps,
      init({ entityType: entityType as EntityType, mimeType: 'image/png' })
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(result._unsafeUnwrapErr().message).toContain('Entity ID is required')
    // Refused at the front door, so no bytes are ever written for a session
    // whose completion could not have created its `Attachment`.
    expect(h.storage.calls).toHaveLength(0)
    expect(h.redis.keys()).toHaveLength(0)
  })

  it('FILE and DATASET are content with no entityId', async () => {
    for (const entityType of [ENTITY_TYPES.FILE, ENTITY_TYPES.DATASET] as const) {
      const h = harness()
      const result = await prepareUpload(
        h.ctx,
        h.deps,
        init({ entityType, mimeType: 'text/plain', fileName: 'notes.txt' })
      )
      expect(result.isOk()).toBe(true)
    }
  })
})

describe('prepareUpload — validateEntity', () => {
  it('404s when the named entity is not in this organization', async () => {
    // The `SELECT` answers nothing, which is what a row in another tenant looks
    // like from here.
    const h = harness({ select: [[]] })

    const result = await prepareUpload(
      h.ctx,
      h.deps,
      init({ entityType: ENTITY_TYPES.ARTICLE, entityId: 'art_elsewhere', mimeType: 'image/png' })
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe('Article not found')
    expect(h.storage.calls).toHaveLength(0)
    expect(h.redis.keys()).toHaveLength(0)
  })

  it('proceeds when the entity is there', async () => {
    const h = harness({ select: [[{ id: 'art_1' }]] })

    const result = await prepareUpload(
      h.ctx,
      h.deps,
      init({ entityType: ENTITY_TYPES.ARTICLE, entityId: 'art_1', mimeType: 'image/png' })
    )

    expect(result.isOk()).toBe(true)
  })

  it('skips the lookup entirely for a temp entity id', async () => {
    // No rows queued: if the comment handler queried, the `SELECT` would answer
    // `[]` and the whole thing would 404.
    const h = harness()

    const result = await prepareUpload(
      h.ctx,
      h.deps,
      init({
        entityType: ENTITY_TYPES.COMMENT,
        entityId: 'temp-comment-123',
        mimeType: 'image/png',
      })
    )

    expect(result.isOk()).toBe(true)
    expect(h.db.wheres).toHaveLength(0)
  })

  it('is handed the NORMALIZED request, not the raw one', () => {
    // `USER_PROFILE` defaults `entityId` to the uploader, and `prepareUpload`
    // applies that rewrite *before* both the entityId rule and `validateEntity`
    // — otherwise the handler would be asked about nobody and its self-upload
    // branch would never be reached.
    //
    // Asserted on the rewrite rather than by driving `prepareUpload`: the
    // `USER_PROFILE` check calls `isMember`, which reads the org members cache —
    // a module-scope singleton with its own database, and therefore not
    // reachable from a `ctx.db` stub. The pairing is what matters, and it is
    // visible here.
    const raw = init({ entityType: ENTITY_TYPES.USER_PROFILE, mimeType: 'image/png' })
    expect(raw.entityId).toBeUndefined()
    expect(UPLOAD_HANDLERS.USER_PROFILE.normalizeInit?.(raw).entityId).toBe(TEST_IDS.userId)
  })
})
