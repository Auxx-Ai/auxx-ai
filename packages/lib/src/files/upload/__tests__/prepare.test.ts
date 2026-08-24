// packages/lib/src/files/upload/__tests__/prepare.test.ts

/**
 * What `POST /api/files/upload/sessions` used to inline.
 *
 * `FILE` is the entity type under test because `FileProcessor.processConfig`
 * touches no database — every other processor runs `validateEntityAccess` — so
 * the whole prepare path is exercised with a `db` stub that is never asked
 * anything. `vi.mock` count: **zero**.
 */

import { describe, expect, it } from 'vitest'
import { makeClock, makeDb, makeRedis, makeStoragePort, TEST_IDS } from '../../__tests__/support'
import type { FilesCtx } from '../../ctx'
import { ENTITY_TYPES } from '../../types/entities'
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

function harness() {
  const clock = makeClock()
  const storage = makeStoragePort()
  const redis = makeRedis({ now: clock.now })
  const ctx: FilesCtx = { db: makeDb().db, organizationId: TEST_IDS.organizationId }
  const deps: PrepareUploadDeps = { storage: storage.port, now: clock.now, redis: redis.redis }
  return { clock, storage, redis, ctx, deps }
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
  it('400s an entity type with no registered processor', async () => {
    const h = harness()

    const result = await prepareUpload(h.ctx, h.deps, init({ entityType: 'NOT_A_THING' as never }))

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    // Nothing was signed and no session key was left behind.
    expect(h.storage.calls).toHaveLength(0)
    expect(h.redis.keys()).toHaveLength(0)
  })
})
