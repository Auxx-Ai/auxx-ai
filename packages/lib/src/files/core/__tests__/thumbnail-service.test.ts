// packages/lib/src/files/core/__tests__/thumbnail-service.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThumbnailService } from '../thumbnail-service'
import type { ThumbnailSource } from '../thumbnail-types'
import { THUMBNAIL_PRESETS } from '../thumbnail-types'

// Hoist mock variables so they can be referenced inside vi.mock factories
const { mockRedisClient, mockStorageManager, createUpdateChain } = vi.hoisted(() => {
  const mockRedisClient = {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  }

  const mockStorageManager = {
    downloadFile: vi.fn(),
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    getContent: vi.fn(),
    uploadContent: vi.fn(),
  }

  // Helper to create a chainable update builder: .update(table).set({...}).where(...)
  const createUpdateChain = () => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
  })

  return { mockRedisClient, mockStorageManager, createUpdateChain }
})

// Mock dependencies
vi.mock('@auxx/database', () => ({
  database: {
    query: {
      MediaAsset: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      MediaAssetVersion: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      FolderFile: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      Attachment: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(() => createUpdateChain()),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn((fn: any) =>
      fn({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
          }),
        }),
        update: vi.fn(() => createUpdateChain()),
        delete: vi.fn(),
        query: {
          MediaAsset: { findFirst: vi.fn() },
        },
      })
    ),
  },
  schema: {
    MediaAsset: {},
    MediaAssetVersion: {},
    FolderFile: {},
    Attachment: {},
    StorageLocation: {},
  },
}))

vi.mock('@auxx/redis', () => ({
  getRedisClient: vi.fn().mockResolvedValue(mockRedisClient),
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

// Always return the same shared mock instance
vi.mock('../../storage/storage-manager', () => ({
  StorageManager: vi.fn().mockImplementation(() => mockStorageManager),
  createStorageManager: vi.fn(() => mockStorageManager),
}))

vi.mock('../../../jobs/queues', () => ({
  getQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-123' }),
  })),
  Queues: {
    thumbnailQueue: 'thumbnail',
  },
}))

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({
      width: 1920,
      height: 1080,
      format: 'jpeg',
      size: 1000000,
    }),
    rotate: vi.fn().mockReturnThis(),
    toColorspace: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    flatten: vi.fn().mockReturnThis(),
    clone: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue({
      data: Buffer.from('test-image'),
      info: {
        width: 64,
        height: 64,
        size: 5000,
      },
    }),
    toFormat: vi.fn().mockReturnThis(),
  })),
}))

vi.mock('file-type', () => ({
  fromBuffer: vi.fn().mockResolvedValue({
    mime: 'image/jpeg',
    ext: 'jpg',
  }),
}))

describe('ThumbnailService', () => {
  let service: ThumbnailService
  const mockOrgId = 'org_123'
  const mockUserId = 'user_456'

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ThumbnailService(mockOrgId, mockUserId)
  })

  describe('ensureThumbnail', () => {
    it('should return existing thumbnail if already generated', async () => {
      const source: ThumbnailSource = {
        type: 'asset',
        assetId: 'asset_789',
      }

      const mockAsset = {
        id: 'asset_789',
        currentVersionId: 'version_123',
        isPrivate: false,
        currentVersion: {
          id: 'version_123',
        },
      }

      const mockExistingThumbnail = {
        id: 'thumb_version_456',
        assetId: 'thumb_asset_123',
        storageLocationId: 'storage_789',
      }

      const { database } = await import('@auxx/database')
      vi.mocked(database.query.MediaAsset.findFirst).mockResolvedValue(mockAsset as any)
      vi.mocked(database.query.MediaAssetVersion.findFirst).mockResolvedValue(
        mockExistingThumbnail as any
      )

      const result = await service.ensureThumbnail(source, { preset: 'avatar-64' })

      expect(result).toEqual({
        status: 'ready',
        assetId: 'thumb_asset_123',
        assetVersionId: 'thumb_version_456',
        storageLocationId: 'storage_789',
      })
    })

    it('should queue thumbnail generation when queue option is true', async () => {
      const source: ThumbnailSource = {
        type: 'asset',
        assetId: 'asset_789',
      }

      const mockAsset = {
        id: 'asset_789',
        currentVersionId: 'version_123',
        isPrivate: false,
        currentVersion: {
          id: 'version_123',
        },
      }

      const { database } = await import('@auxx/database')

      vi.mocked(database.query.MediaAsset.findFirst).mockResolvedValue(mockAsset as any)
      vi.mocked(database.query.MediaAssetVersion.findFirst).mockResolvedValue(null)
      mockRedisClient.get.mockResolvedValue(null)

      const result = await service.ensureThumbnail(source, { preset: 'avatar-64', queue: true })

      expect(result).toEqual({
        status: 'queued',
        jobId: 'job-123',
      })
    })

    it('should generate thumbnail synchronously when queue option is false', async () => {
      const source: ThumbnailSource = {
        type: 'asset',
        assetId: 'asset_789',
      }

      const mockAsset = {
        id: 'asset_789',
        currentVersionId: 'version_123',
        isPrivate: false,
        organizationId: 'org_123',
        currentVersion: {
          id: 'version_123',
        },
        name: 'test-image',
        mimeType: 'image/jpeg',
      }

      const mockSourceVersion = {
        id: 'version_123',
        assetId: 'asset_789',
        storageLocationId: 'storage_original',
        size: BigInt(1000000),
        asset: mockAsset,
        storageLocation: { id: 'storage_original' },
      }

      const { database } = await import('@auxx/database')

      vi.mocked(database.query.MediaAsset.findFirst).mockResolvedValue(mockAsset as any)
      // First call: findByVersionAndPreset -> null (no existing thumbnail)
      // Second call: generateWithPlaceholder -> source version lookup
      vi.mocked(database.query.MediaAssetVersion.findFirst)
        .mockResolvedValueOnce(null) // findByVersionAndPreset
        .mockResolvedValueOnce(mockSourceVersion as any) // source version lookup

      // Mock storage manager methods
      mockStorageManager.getContent.mockResolvedValue(Buffer.from('test-image'))
      mockStorageManager.uploadContent.mockResolvedValue({ id: 'storage_new' })

      // Mock transaction for placeholder creation and finalization
      const mockTransaction = vi.mocked(database.transaction)
      mockTransaction.mockImplementation(async (fn: any) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi
                .fn()
                .mockResolvedValueOnce([{ id: 'thumb_asset_new' }]) // MediaAsset insert
                .mockResolvedValueOnce([{ id: 'thumb_version_new' }]), // MediaAssetVersion insert
            }),
          }),
          update: vi.fn(() => createUpdateChain()),
        }
        return fn(tx)
      })

      // Mock thumbnail processor worker
      vi.doMock('../thumbnail-processor.worker', () => ({
        processImage: vi.fn().mockResolvedValue({
          buffer: Buffer.from('processed-image'),
          size: 5000,
          format: 'webp',
          dimensions: { width: 64, height: 64 },
          actualDimensions: { width: 64, height: 64 },
          quality: 90,
          fit: 'cover',
        }),
      }))

      const result = await service.ensureThumbnail(source, { preset: 'avatar-64', queue: false })

      expect(result.status).toBe('generated')
      expect(result).toHaveProperty('assetId')
      expect(result).toHaveProperty('assetVersionId')
      expect(result).toHaveProperty('storageLocationId')
    })
  })

  describe('preset configuration', () => {
    it('should have correct avatar presets', () => {
      expect(THUMBNAIL_PRESETS['avatar-32']).toEqual({
        w: 32,
        h: 32,
        fit: 'cover',
        format: 'webp',
        quality: 90,
      })

      expect(THUMBNAIL_PRESETS['avatar-64']).toEqual({
        w: 64,
        h: 64,
        fit: 'cover',
        format: 'webp',
        quality: 90,
      })

      expect(THUMBNAIL_PRESETS['avatar-128']).toEqual({
        w: 128,
        h: 128,
        fit: 'cover',
        format: 'webp',
        quality: 85,
      })
    })

    it('should have correct article presets', () => {
      expect(THUMBNAIL_PRESETS['article-thumb']).toEqual({
        w: 200,
        h: 150,
        fit: 'cover',
        format: 'jpeg',
        quality: 85,
      })

      expect(THUMBNAIL_PRESETS['article-cover']).toEqual({
        w: 800,
        h: 400,
        fit: 'cover',
        format: 'jpeg',
        quality: 85,
      })
    })

    it('should have correct attachment presets', () => {
      expect(THUMBNAIL_PRESETS['attachment-preview']).toEqual({
        w: 400,
        h: 400,
        fit: 'inside',
        format: 'png',
        quality: 100,
      })

      expect(THUMBNAIL_PRESETS['attachment-thumb']).toEqual({
        w: 150,
        h: 150,
        fit: 'cover',
        format: 'webp',
        quality: 85,
      })
    })
  })

  describe('deleteThumbnailsForSource', () => {
    it('should soft delete all thumbnails for a source version', async () => {
      const sourceVersionId = 'version_123'
      const mockThumbnails = [
        {
          id: 'thumb_1',
          assetId: 'asset_1',
          storageLocation: { id: 'storage_1' },
        },
        {
          id: 'thumb_2',
          assetId: 'asset_2',
          storageLocation: { id: 'storage_2' },
        },
      ]

      const { database } = await import('@auxx/database')

      vi.mocked(database.query.MediaAssetVersion.findMany).mockResolvedValue(mockThumbnails as any)
      mockStorageManager.deleteFile.mockResolvedValue(undefined)

      await service.deleteThumbnailsForSource(sourceVersionId)

      // findMany is called with a function-based where clause
      expect(database.query.MediaAssetVersion.findMany).toHaveBeenCalledTimes(1)

      // storageManager.deleteFile called once per thumbnail with storage
      expect(mockStorageManager.deleteFile).toHaveBeenCalledTimes(2)

      // update called 4 times: 2 for MediaAssetVersion soft delete + 2 for MediaAsset soft delete
      expect(database.update).toHaveBeenCalledTimes(4)
    })
  })
})
