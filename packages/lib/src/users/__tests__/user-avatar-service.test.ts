// packages/lib/src/users/__tests__/user-avatar-service.test.ts

/**
 * **Legacy shape, kept alive across PR 4d's module move.**
 *
 * `UserAvatarService` is a static class over the module-scope `database`, a
 * `new S3Adapter()` it constructs itself, and `uploadSessionRedis()`. Nothing
 * about it is injectable, so this file is full-replacement `vi.mock` all the way
 * down. Converting it to `files/__tests__/support` means converting the service
 * to the `files/ctx.ts` contract first, which is Phase 6's job — the mocks below
 * were retargeted from `UserProfileProcessor` onto `getUploadHandler` /
 * `buildUploadConfig` / `persistUpload`, and nothing else changed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserAvatarService } from '../user-avatar-service'

// Mock dependencies
const mockLimit = vi.fn()
const mockWhere = vi.fn(() => ({ limit: mockLimit }))
const mockFrom = vi.fn(() => ({ where: mockWhere }))
const mockSelect = vi.fn((..._args: unknown[]) => ({ from: mockFrom }))
const mockInsertReturning = vi
  .fn()
  .mockResolvedValue([{ id: 'storage-loc-1', provider: 'S3', key: 'test-key' }])
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }))

vi.mock('@auxx/database', () => ({
  database: {
    select: (...args: any[]) => mockSelect(...args),
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(),
    delete: vi.fn(),
    // The service opens the one transaction `persistUpload` runs in. The double
    // hands the body the same surface, which is all the mocked `persistUpload`
    // below needs.
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
  },
  schema: {
    User: {
      id: 'id',
      image: 'image',
      avatarAssetId: 'avatarAssetId',
      defaultOrganizationId: 'defaultOrganizationId',
    },
    StorageLocation: {},
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}))

vi.mock('../../logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../files/adapters/s3-adapter', () => {
  return {
    S3Adapter: class {
      init = vi.fn()
      upload = vi.fn().mockResolvedValue({ key: 'test-key' })
      putObject = vi.fn().mockResolvedValue({ key: 'test-key', etag: 'test-etag' })
    },
  }
})

// The three modules `UserProfileProcessor` was replaced by. Mocked rather than
// exercised for the same reason the processor was: this file has no real
// database behind it, and `handlers/index.ts` reaches the org cache and the
// dataset queue at import time.
vi.mock('../../files/upload/handlers', () => ({
  getUploadHandler: vi.fn(() => ({
    entityType: 'USER_PROFILE',
    persist: 'versioned-asset',
    assetKind: 'USER_AVATAR',
  })),
}))

vi.mock('../../files/upload/config', () => ({
  buildUploadConfig: vi.fn(() => ({
    storageKey: 'test-org/user-profile/test-user/123_avatar-test.jpg',
    organizationId: 'test-org',
    userId: 'test-user',
    bucket: 'auxx-private-local',
    visibility: 'PRIVATE',
    ttlSec: 600,
    policy: {
      keyPrefix: 'test-org/',
      contentLengthRange: [0, Number.MAX_SAFE_INTEGER],
      maxTtl: 600,
      allowedMimeTypes: ['image/jpeg'],
    },
    uploadPlan: { strategy: 'single' },
  })),
}))

vi.mock('../../files/upload/persist', () => ({
  persistUpload: vi.fn().mockResolvedValue({
    assetId: 'test-asset-id',
    storageLocationId: 'storage-loc-1',
    externalUrl: '',
  }),
}))

vi.mock('../../files/upload/session', () => ({
  uploadSessionRedis: vi.fn(async () => ({})),
  createUploadSession: vi.fn().mockResolvedValue({
    id: 'test-session-id',
    organizationId: 'test-org',
    userId: 'test-user',
    bucket: 'auxx-private-local',
    visibility: 'PRIVATE',
  }),
  deleteUploadSession: vi.fn(),
}))

describe('UserAvatarService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('downloadAndCreateAvatarAsset', () => {
    it('should successfully download and create avatar asset', async () => {
      // Mock fetch response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('image/jpeg'),
        },
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1000)),
      })

      const result = await UserAvatarService.downloadAndCreateAvatarAsset(
        'test-user',
        'https://example.com/avatar.jpg',
        'test-org'
      )

      expect(result).toBe('test-asset-id')
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/avatar.jpg')
    })

    it('should return null if image download fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })

      const result = await UserAvatarService.downloadAndCreateAvatarAsset(
        'test-user',
        'https://example.com/avatar.jpg',
        'test-org'
      )

      expect(result).toBeNull()
    })

    it('should return null if image is too large', async () => {
      // Mock a 6MB image (over the 5MB limit)
      const largeBuffer = new ArrayBuffer(6 * 1024 * 1024)

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('image/jpeg'),
        },
        arrayBuffer: vi.fn().mockResolvedValue(largeBuffer),
      })

      const result = await UserAvatarService.downloadAndCreateAvatarAsset(
        'test-user',
        'https://example.com/avatar.jpg',
        'test-org'
      )

      expect(result).toBeNull()
    })
  })

  describe('checkAndMigrateAvatar', () => {
    it('should skip migration if user already has avatarAssetId', async () => {
      mockLimit.mockResolvedValue([
        {
          id: 'test-user',
          image: 'https://example.com/avatar.jpg',
          avatarAssetId: 'existing-asset',
          defaultOrganizationId: 'test-org',
        },
      ])

      const result = await UserAvatarService.checkAndMigrateAvatar('test-user')

      expect(result).toBe(false)
    })

    it('should skip migration if user has no image URL', async () => {
      mockLimit.mockResolvedValue([
        {
          id: 'test-user',
          image: null,
          avatarAssetId: null,
          defaultOrganizationId: 'test-org',
        },
      ])

      const result = await UserAvatarService.checkAndMigrateAvatar('test-user')

      expect(result).toBe(false)
    })
  })
})
