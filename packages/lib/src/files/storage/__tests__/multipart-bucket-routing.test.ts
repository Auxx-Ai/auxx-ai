// packages/lib/src/files/storage/__tests__/multipart-bucket-routing.test.ts

/**
 * Regression tests for `docs/files-upload-architecture-guide.md` §11.5 / §10.4.
 *
 * `startMultipartUploadFromConfig` forwards `config.bucket`, but the three
 * follow-up calls (`generatePartUploadUrl`, `completeMultipartUploadOnly`,
 * `deleteByKey`) took no bucket at all, so the S3 adapter fell back to
 * `S3_PRIVATE_BUCKET`. A PUBLIC multipart upload therefore initiated in the
 * public bucket and presigned its parts against the private one (`NoSuchUpload`),
 * and the compensation delete removed a nonexistent key from the private bucket
 * while the real public object leaked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStorageAdapterCache } from '../providers'
import { StorageManager } from '../storage-manager'

vi.mock('@auxx/credentials', () => ({
  configService: {
    get: vi.fn(),
  },
}))
vi.mock('@auxx/credentials/store', () => ({
  revealSecrets: vi.fn().mockResolvedValue({
    isErr: () => false,
    value: {
      record: { metadata: { region: 'us-east-1', bucket: 'test-private-bucket' } },
      secrets: { accessToken: 'mock-access-token' },
    },
  }),
}))

// Partial mock: `@auxx/logger/run-log` imports sink-registration helpers from this
// barrel at module load, so a full replacement breaks whichever test file happens
// to load it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// The StorageLocation writes, mocked because `storage-manager` imports them at
// module level. Nothing in this file exercises persistence — it is about which
// bucket reaches the adapter.
vi.mock('../locations', () => ({
  createStorageLocation: vi.fn(),
  deleteStorageLocation: vi.fn(),
}))

const mockPresignPart = vi.fn().mockResolvedValue({
  url: 'https://example.s3.amazonaws.com/part',
  expiresAt: new Date(Date.now() + 3600_000),
})

const mockCompleteMultipart = vi.fn().mockResolvedValue({ etag: 'etag-123' })

const mockDeleteFile = vi.fn().mockResolvedValue(undefined)

vi.mock('../../adapters/s3-adapter', () => ({
  default: class MockS3Adapter {
    credentialProviderId = 'S3'

    getCapabilities() {
      return {
        presignUpload: true,
        presignDownload: true,
        serverSideDownload: false,
        versioning: false,
        webhooks: false,
        folders: false,
        search: false,
        metadata: true,
        multipart: true,
      }
    }

    resolvePlatformAuth() {
      return {
        region: 'us-east-1',
        bucket: 'test-private-bucket',
        publicBucket: 'test-public-bucket',
      }
    }

    resolveBucket() {
      return 'test-private-bucket'
    }

    presignPart = mockPresignPart
    completeMultipart = mockCompleteMultipart
    deleteFile = mockDeleteFile
  },
}))

describe('StorageManager – bucket routing for multipart parts, completion and compensation', () => {
  let manager: StorageManager

  beforeEach(() => {
    // Clear the adapter cache so each test starts fresh. It is a module-level
    // map in `storage/providers.ts` since PR 3b, with an exported test seam
    // instead of a private static reached through `as any`.
    clearStorageAdapterCache()
    manager = new StorageManager('org123')
    vi.clearAllMocks()
  })

  it('forwards the caller-supplied bucket to presignPart (§11.5)', async () => {
    await manager.generatePartUploadUrl({
      provider: 'S3',
      key: 'org123/avatar.mp4',
      uploadId: 'upload-1',
      partNumber: 1,
      size: 5 * 1024 * 1024,
      bucket: 'test-public-bucket',
    })

    expect(mockPresignPart).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'org123/avatar.mp4',
        uploadId: 'upload-1',
        partNumber: 1,
        bucket: 'test-public-bucket',
      })
    )
  })

  it('forwards the caller-supplied bucket to completeMultipart (§11.5)', async () => {
    await manager.completeMultipartUploadOnly({
      provider: 'S3',
      key: 'org123/avatar.mp4',
      uploadId: 'upload-1',
      parts: [{ partNumber: 1, etag: 'etag-1' }],
      bucket: 'test-public-bucket',
    })

    expect(mockCompleteMultipart).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'org123/avatar.mp4',
        uploadId: 'upload-1',
        bucket: 'test-public-bucket',
      })
    )
  })

  it('targets the caller-supplied bucket when compensating with deleteByKey (§10.4)', async () => {
    await manager.deleteByKey({
      provider: 'S3',
      key: 'org123/avatar.png',
      bucket: 'test-public-bucket',
    })

    expect(mockDeleteFile).toHaveBeenCalledTimes(1)
    const [locationRef] = mockDeleteFile.mock.calls[0]!
    expect(locationRef).toEqual(
      expect.objectContaining({
        provider: 'S3',
        externalId: 'org123/avatar.png',
        metadata: expect.objectContaining({
          bucket: 'test-public-bucket',
          key: 'org123/avatar.png',
        }),
      })
    )
  })

  it('still resolves a bucket for legacy deleteByKey callers that pass none', async () => {
    await manager.deleteByKey({
      provider: 'S3',
      key: 'org123/legacy.png',
    })

    expect(mockDeleteFile).toHaveBeenCalledTimes(1)
    const [locationRef] = mockDeleteFile.mock.calls[0]!
    expect(locationRef.metadata?.bucket).toBe('test-private-bucket')
  })
})
