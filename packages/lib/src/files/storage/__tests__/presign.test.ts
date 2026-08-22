// packages/lib/src/files/storage/__tests__/presign.test.ts

/**
 * `storage/presign.ts` against a fake {@link StoragePort}. **Zero `vi.mock`.**
 *
 * What these four functions are *for* is the policy gate and the bucket that
 * travels with a multipart upload, so that is what is asserted: which calls
 * reach the port at all, what they carry, and what a port failure turns into.
 */

import { describe, expect, it } from 'vitest'
import { makeStoragePort, TEST_BUCKETS, TEST_IDS } from '../../__tests__/support'
import {
  StorageAdapterError,
  StorageAuthError,
  StorageFileNotFoundError,
} from '../../adapters/base-adapter'
import type { UploadPreparedConfig } from '../../upload/init-types'
import type { PresignUploadParams } from '../ports'
import { completeMultipart, presignPart, presignUpload, startMultipartUpload } from '../presign'

function aPlan(overrides: Partial<UploadPreparedConfig> = {}): PresignUploadParams {
  return {
    organizationId: TEST_IDS.organizationId,
    userId: TEST_IDS.userId,
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    expectedSize: 1024,
    entityType: 'FILE',
    entityId: 'ent_1',
    provider: 'S3',
    storageKey: `${TEST_IDS.organizationId}/file/report.pdf`,
    ttlSec: 600,
    visibility: 'PRIVATE',
    bucket: TEST_BUCKETS.private,
    policy: {
      keyPrefix: `${TEST_IDS.organizationId}/`,
      contentLengthRange: [0, 10 * 1024 * 1024],
      maxTtl: 3600,
      allowedMimeTypes: ['application/pdf'],
    },
    uploadPlan: { strategy: 'single' },
    ...overrides,
  }
}

describe('presignUpload', () => {
  it('forwards the whole prepared config to the port and returns its answer', async () => {
    const storage = makeStoragePort()
    const plan = aPlan()

    const result = await presignUpload(storage.port, plan)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().url).toBe('https://s3.test/upload')
    expect(storage.callsTo('presignUpload')).toHaveLength(1)
    expect(storage.callsTo('presignUpload')[0]?.params).toEqual(plan)
  })

  it('enforces the policy BEFORE the port is touched', async () => {
    const storage = makeStoragePort()

    const result = await presignUpload(storage.port, aPlan({ storageKey: 'someone-else/x.pdf' }))

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('Key must start with')
    // The point of the ordering: a rejected upload must never be signed.
    expect(storage.calls).toHaveLength(0)
  })

  it('maps a not-found adapter error to NotFoundError, keeping the message', async () => {
    const storage = makeStoragePort({
      impl: {
        presignUpload: () => {
          throw new StorageFileNotFoundError('S3', 'org_test/file/report.pdf')
        },
      },
    })

    const result = await presignUpload(storage.port, aPlan())

    const error = result._unsafeUnwrapErr()
    expect(error.statusCode).toBe(404)
    expect(error.message).toBe('File not found: org_test/file/report.pdf')
    // The original is still reachable, which is what keeps StorageManager's
    // throw shape unchanged for its legacy callers.
    expect(error.cause).toBeInstanceOf(StorageFileNotFoundError)
  })

  it('maps an auth adapter error to UnauthorizedError', async () => {
    const storage = makeStoragePort({
      impl: {
        presignUpload: () => {
          throw new StorageAuthError('S3', 'presignUpload')
        },
      },
    })

    const error = (await presignUpload(storage.port, aPlan()))._unsafeUnwrapErr()
    expect(error.statusCode).toBe(401)
    expect(error.message).toBe('Authentication failed for S3')
  })

  it('maps a generic adapter error to a 500 that still names the failure', async () => {
    const storage = makeStoragePort({
      impl: {
        presignUpload: () => {
          throw new StorageAdapterError('S3 presignUpload failed: boom', 'S3', 'presignUpload')
        },
      },
    })

    const error = (await presignUpload(storage.port, aPlan()))._unsafeUnwrapErr()
    expect(error.statusCode).toBe(500)
    // The plain `files/guard.ts` would have flattened this to 'Internal error'.
    expect(error.message).toBe('S3 presignUpload failed: boom')
  })
})

describe('startMultipartUpload', () => {
  it('enforces the same policy and forwards to the port', async () => {
    const storage = makeStoragePort()
    const plan = aPlan({ uploadPlan: { strategy: 'multipart' } })

    const result = await startMultipartUpload(storage.port, plan)

    expect(result._unsafeUnwrap().uploadId).toBe('upload-1')
    expect(storage.callsTo('startMultipart')[0]?.params).toEqual(plan)
  })

  it('rejects a MIME the policy does not allow, without opening an upload', async () => {
    const storage = makeStoragePort()

    const result = await startMultipartUpload(
      storage.port,
      aPlan({ mimeType: 'application/x-msdownload', uploadPlan: { strategy: 'multipart' } })
    )

    expect(result._unsafeUnwrapErr().message).toContain("MIME 'application/x-msdownload'")
    expect(storage.calls).toHaveLength(0)
  })

  it('carries the plan bucket, which every later part and the completion must reuse', async () => {
    const storage = makeStoragePort()
    const plan = aPlan({ bucket: TEST_BUCKETS.public, visibility: 'PUBLIC' })

    await startMultipartUpload(storage.port, plan)

    expect(storage.callsTo('startMultipart')[0]?.params.bucket).toBe(TEST_BUCKETS.public)
  })
})

describe('presignPart', () => {
  it('forwards the part descriptor verbatim', async () => {
    const storage = makeStoragePort()

    const result = await presignPart(storage.port, {
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: 'org_test/file/big.mp4',
      uploadId: 'upl_1',
      partNumber: 3,
      size: 5 * 1024 * 1024,
    })

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('presignPart')[0]?.params).toEqual({
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: 'org_test/file/big.mp4',
      uploadId: 'upl_1',
      partNumber: 3,
      size: 5 * 1024 * 1024,
    })
  })

  it('applies no policy — there is none on a part', async () => {
    const storage = makeStoragePort()

    // A part far larger than any upload policy would allow still presigns:
    // nothing bounds a multipart upload's bytes until the post-completion head.
    const result = await presignPart(storage.port, {
      provider: 'S3',
      bucket: TEST_BUCKETS.private,
      key: 'org_test/file/big.mp4',
      uploadId: 'upl_1',
      partNumber: 1,
      size: 4 * 1024 * 1024 * 1024,
    })

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('presignPart')).toHaveLength(1)
  })
})

describe('completeMultipart', () => {
  it('forwards the parts list and returns the etag', async () => {
    const storage = makeStoragePort({ results: { completeMultipart: { etag: 'final', size: 42 } } })

    const result = await completeMultipart(storage.port, {
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: 'org_test/file/big.mp4',
      uploadId: 'upl_1',
      parts: [
        { partNumber: 1, etag: 'a' },
        { partNumber: 2, etag: 'b' },
      ],
    })

    expect(result._unsafeUnwrap()).toEqual({ etag: 'final', size: 42 })
    expect(storage.callsTo('completeMultipart')[0]?.params.parts).toHaveLength(2)
    expect(storage.callsTo('completeMultipart')[0]?.params.bucket).toBe(TEST_BUCKETS.public)
  })

  it('surfaces NoSuchUpload as a 500 that names the bucket mismatch', async () => {
    const storage = makeStoragePort({
      impl: {
        completeMultipart: () => {
          throw new StorageAdapterError(
            'S3 completeMultipart failed: NoSuchUpload (errorCode: NoSuchUpload)',
            'S3',
            'completeMultipart'
          )
        },
      },
    })

    const error = (
      await completeMultipart(storage.port, {
        provider: 'S3',
        bucket: TEST_BUCKETS.private,
        key: 'org_test/file/big.mp4',
        uploadId: 'upl_1',
        parts: [{ partNumber: 1, etag: 'a' }],
      })
    )._unsafeUnwrapErr()

    expect(error.message).toContain('NoSuchUpload')
  })
})
