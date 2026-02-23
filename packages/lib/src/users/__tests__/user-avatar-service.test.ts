// packages/lib/src/users/__tests__/user-avatar-service.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserAvatarService } from '../user-avatar-service'

// Mock dependencies
const mockLimit = vi.fn()
const mockWhere = vi.fn(() => ({ limit: mockLimit }))
const mockFrom = vi.fn(() => ({ where: mockWhere }))
const mockSelect = vi.fn(() => ({ from: mockFrom }))
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

vi.mock('../../files/upload/processors/entity-processors', () => {
  return {
    UserProfileProcessor: class {
      processConfig = vi.fn().mockResolvedValue({
        config: {
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
        },
      })
      process = vi.fn().mockResolvedValue({
        assetId: 'test-asset-id',
        storageLocationId: 'test-location-id',
      })
    },
  }
})

vi.mock('../../files/upload/session-manager', () => ({
  SessionManager: {
    createSessionFromConfig: vi.fn().mockResolvedValue({
      id: 'test-session-id',
      organizationId: 'test-org',
      userId: 'test-user',
      bucket: 'auxx-private-local',
      visibility: 'PRIVATE',
    }),
    deleteSession: vi.fn(),
  },
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
