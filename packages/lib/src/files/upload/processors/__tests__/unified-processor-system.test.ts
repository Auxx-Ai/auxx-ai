// packages/lib/src/files/upload/processors/__tests__/unified-processor-system.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../../../errors'
import type { EntityType } from '../../../types/entities'
import { ENTITY_TYPES } from '../../../types/entities'
import type { UploadInitConfig } from '../../init-types'
import { UserProfileProcessor, WorkflowRunProcessor } from '../entity-processors'
import { FileProcessor } from '../file-processor'
import { initializeProcessors } from '../index'
import { ProcessorRegistry } from '../processor-registry'
import { VisitQcItemProcessor } from '../visit-qc-processor'

// Hoist mock variables to be accessible inside vi.mock factories
const { ticketSelectRowsRef, workflowRunSelectRowsRef, createSelectBuilder } = vi.hoisted(() => {
  const ticketSelectRowsRef = { value: [{ id: 'ticket123' }] }
  const workflowRunSelectRowsRef = { value: [{ id: 'workflow123' }] }

  // Creates a lightweight Drizzle-style select builder chain.
  // `limit` resolves to the rows AND carries `.prepare`, because modules reached
  // transitively (e.g. `users/system-user-service.ts`) build prepared statements
  // at import time — a bare promise there fails collection with
  // `.prepare is not a function`.
  const createSelectBuilder = (rowsRef: { value: any[] }) => {
    const builder: Record<string, any> = {}
    builder.from = vi.fn().mockReturnValue(builder)
    builder.where = vi.fn().mockReturnValue(builder)
    builder.limit = vi.fn().mockImplementation(() => {
      const pending: any = Promise.resolve(rowsRef.value)
      pending.prepare = vi.fn(() => ({ execute: async () => rowsRef.value }))
      return pending
    })
    return builder
  }

  return { ticketSelectRowsRef, workflowRunSelectRowsRef, createSelectBuilder }
})

// Mock the database and services
vi.mock('@auxx/database', async () => ({
  database: {
    select: vi.fn(() => createSelectBuilder(ticketSelectRowsRef)),
    query: {
      Article: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      Dataset: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      WorkflowRun: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      User: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  schema: (await import('../../../../test/database-mock')).createSchemaMock({
    Article: { id: 'id', organizationId: 'organizationId' },
    WorkflowRun: { id: 'id', organizationId: 'organizationId' },
    User: { id: 'id' },
    MediaAsset: { id: 'id' },
    MediaAssetVersion: { id: 'id' },
    StorageLocation: { id: 'id' },
    Message: { id: 'id', organizationId: 'organizationId' },
    Comment: { id: 'id', organizationId: 'organizationId' },
    KnowledgeBase: { id: 'id', organizationId: 'organizationId' },
    Attachment: { id: 'id' },
    FolderFile: { id: 'id' },
  }),
}))

vi.mock('../../../../members', () => ({
  isMember: vi.fn().mockResolvedValue(true),
}))

// Partial mock: `@auxx/logger/run-log` imports sink-registration helpers from this
// barrel at module load, so a full replacement breaks collection.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock @auxx/database/models to avoid loading real database client
vi.mock('@auxx/database/models', () => ({}))

// Mock @auxx/database/types to avoid loading real database types
vi.mock('@auxx/database/types', () => ({}))

// Mock @auxx/credentials to avoid loading real credential service
vi.mock('@auxx/credentials', () => ({
  configService: { get: vi.fn() },
}))
vi.mock('@auxx/credentials/store', () => ({
  revealSecrets: vi.fn().mockResolvedValue({
    isErr: () => false,
    value: { record: { metadata: {} }, secrets: {} },
  }),
}))

// Mock @auxx/redis
// PARTIAL, not a replacement: `credentials/credential-lock.ts` binds
// `createCredentialLockProvider()` at MODULE SCOPE, so a factory that omits it
// kills this file at collection — reported as 0 tests, not as a failure.
// `importOriginal` cannot go stale the way an enumerated list does.
vi.mock('@auxx/redis', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRedisClient: vi.fn().mockResolvedValue(null),
}))

// Mock thumbnail-related modules
vi.mock('../../../files/thumbnails', () => ({
  ensureThumbnailPresets: vi.fn().mockResolvedValue([]),
}))

// Mock drizzle-orm operators used in entity processors
// Partial mock: modules reached transitively build SQL fragments at import time
// (`record-visibility-scope.ts` calls `sql.raw`), so a full replacement of
// drizzle-orm kills collection.
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => [a, b]),
  desc: vi.fn(),
  isNull: vi.fn(),
}))

// Mock storage manager
vi.mock('../../../files/storage/storage-manager', () => ({
  StorageManager: vi.fn().mockImplementation(() => ({})),
  createStorageManager: vi.fn(() => ({})),
}))

// Mock bullmq and job queues
vi.mock('../../../../jobs/queues', () => ({
  getQueue: vi.fn(),
  Queues: {},
}))

describe('Unified Processor System', () => {
  beforeEach(() => {
    ProcessorRegistry.clear()
    vi.clearAllMocks()
  })

  describe('ProcessorRegistry', () => {
    it('should register processors by EntityType', () => {
      ProcessorRegistry.registerForEntity(ENTITY_TYPES.FILE, (orgId) => new FileProcessor(orgId))

      expect(ProcessorRegistry.hasProcessor(ENTITY_TYPES.FILE)).toBe(true)
      expect(ProcessorRegistry.hasProcessor(ENTITY_TYPES.ARTICLE)).toBe(false)
    })

    it('should return processor instance for registered EntityType', () => {
      ProcessorRegistry.registerForEntity(ENTITY_TYPES.FILE, (orgId) => new FileProcessor(orgId))
      ProcessorRegistry.markInitialized()

      const processor = ProcessorRegistry.getForEntityType(ENTITY_TYPES.FILE, 'org123')
      expect(processor).toBeInstanceOf(FileProcessor)
    })

    it('should throw error for unregistered EntityType with no default', () => {
      ProcessorRegistry.markInitialized()

      expect(() => {
        ProcessorRegistry.getForEntityType('unknown:entity' as EntityType, 'org123')
      }).toThrow('No upload processor registered for entity type: unknown:entity')
    })

    // Regression for §11.3 — an unregistered entity type used to fall through to
    // `setDefaultProcessor(FileProcessor)`, silently producing a `FolderFile` (and no
    // `assetId`) for entity types that need a `MediaAsset` + `Attachment`.
    it('should throw for an unregistered EntityType even after full initialization', () => {
      initializeProcessors()

      expect(() =>
        ProcessorRegistry.getForEntityType('some-unregistered-type' as EntityType, 'org123')
      ).toThrow(BadRequestError)
    })

    it('should throw when the registry was never initialized', () => {
      // `clear()` (run in beforeEach) leaves the registry uninitialized — a silently
      // uninitialized registry used to only `logger.warn` and then hand back the default.
      expect(() => ProcessorRegistry.getForEntityType(ENTITY_TYPES.FILE, 'org123')).toThrow(
        /not initialized/i
      )
    })

    // The guard that stops §11.3 recurring: adding a value to `ENTITY_TYPES` without
    // registering a processor for it must fail here, not in production.
    it('registers a processor for every ENTITY_TYPES value', () => {
      initializeProcessors()

      const missing = Object.values(ENTITY_TYPES).filter(
        (entityType) => !ProcessorRegistry.hasProcessor(entityType)
      )

      expect(missing).toEqual([])
    })

    it('registers an attachment processor for visit_qc_item', () => {
      initializeProcessors()

      const processor = ProcessorRegistry.getForEntityType(ENTITY_TYPES.VISIT_QC_ITEM, 'org123')
      expect(processor).toBeInstanceOf(VisitQcItemProcessor)
      expect(processor.getMetadata().supportsAttachments).toBe(true)
    })
  })

  describe('FileProcessor processConfig', () => {
    let processor: FileProcessor
    let baseConfig: UploadInitConfig

    beforeEach(() => {
      processor = new FileProcessor('org123')
      baseConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024, // 1MB
        entityType: ENTITY_TYPES.FILE,
      }
    })

    it('should process config with default policies', async () => {
      const result = await processor.processConfig(baseConfig)

      expect(result.config).toMatchObject({
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: ENTITY_TYPES.FILE,
        provider: 'S3',
        ttlSec: 600, // 10 minutes clamped
      })

      expect(result.config.policy).toMatchObject({
        keyPrefix: 'org123/',
        contentLengthRange: [0, Number.MAX_SAFE_INTEGER],
        maxTtl: 3600, // 1 hour
        allowedMimeTypes: ['*/*'], // File processor allows all types
      })

      expect(result.config.uploadPlan).toMatchObject({
        strategy: 'single', // Under 100MB threshold
      })

      expect(result.warnings).toHaveLength(0)
    })

    it('should use multipart for large files', async () => {
      const largeConfig = {
        ...baseConfig,
        expectedSize: 150 * 1024 * 1024, // 150MB
      }

      const result = await processor.processConfig(largeConfig)

      expect(result.config.uploadPlan).toMatchObject({
        strategy: 'multipart',
      })
    })

    it('should warn when entityType suggests attachment processor', async () => {
      const attachmentConfig = {
        ...baseConfig,
        entityType: ENTITY_TYPES.COMMENT as EntityType,
      }

      const result = await processor.processConfig(attachmentConfig)

      expect(result.warnings).toContain(
        'EntityType suggests attachment processor, but file processor is being used'
      )
    })

    it('should create immutable config', async () => {
      const result = await processor.processConfig(baseConfig)

      expect(() => {
        ;(result.config as any).provider = 'GOOGLE_DRIVE'
      }).toThrow()
    })
  })

  describe('UserProfileProcessor processConfig', () => {
    let processor: UserProfileProcessor

    beforeEach(() => {
      processor = new UserProfileProcessor('org123')
    })

    it('should auto-set entityId to userId when missing', async () => {
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'avatar.jpg',
        mimeType: 'image/jpeg',
        expectedSize: 1024 * 1024, // 1MB
        entityType: ENTITY_TYPES.USER_PROFILE,
        // entityId missing - should be auto-set to userId
      }

      const result = await processor.processConfig(config)

      expect(result.config.entityId).toBe('user123')
      expect(result.warnings).toContain(
        'EntityId was automatically set to the authenticated user ID for user profile upload'
      )
    })

    it('should not warn when entityId is explicitly provided', async () => {
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'avatar.jpg',
        mimeType: 'image/jpeg',
        expectedSize: 1024 * 1024,
        entityType: ENTITY_TYPES.USER_PROFILE,
        entityId: 'user123',
      }

      const result = await processor.processConfig(config)

      expect(result.warnings).not.toContain(
        'EntityId was automatically set to the authenticated user ID for user profile upload'
      )
    })

    it('should enforce image-only MIME types', async () => {
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'avatar.jpg',
        mimeType: 'image/jpeg',
        expectedSize: 1024 * 1024,
        entityType: ENTITY_TYPES.USER_PROFILE,
        entityId: 'user123',
      }

      const result = await processor.processConfig(config)

      expect(result.config.policy.allowedMimeTypes).toEqual([
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
      ])
    })
  })

  describe('WorkflowRunProcessor processConfig', () => {
    let processor: WorkflowRunProcessor

    beforeEach(async () => {
      processor = new WorkflowRunProcessor('org123')

      // WorkflowRunProcessor.validateEntityAccess is currently a no-op (commented out code),
      // but we still set up the select builder for consistency
      workflowRunSelectRowsRef.value = [{ id: 'workflow123' }]

      const { database } = await import('@auxx/database')
      vi.mocked(database.select).mockImplementation(
        () => createSelectBuilder(workflowRunSelectRowsRef) as any
      )
    })

    it('should use multipart for files > 25MB', async () => {
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'workflow-output.zip',
        mimeType: 'application/zip',
        expectedSize: 30 * 1024 * 1024, // 30MB
        entityType: ENTITY_TYPES.WORKFLOW_RUN,
        entityId: 'workflow123',
      }

      const result = await processor.processConfig(config)

      expect(result.config.uploadPlan.strategy).toBe('multipart')
    })

    it('should allow all MIME types for workflow files', async () => {
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'any-file.xyz',
        mimeType: 'application/octet-stream',
        expectedSize: 1024 * 1024,
        entityType: ENTITY_TYPES.WORKFLOW_RUN,
        entityId: 'workflow123',
      }

      const result = await processor.processConfig(config)

      expect(result.config.policy.allowedMimeTypes).toContain('*/*')
    })
  })

  describe('Policy Enforcement Integration', () => {
    it('should generate consistent storage keys', async () => {
      const processor = new FileProcessor('org123')
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test file.pdf', // Contains space
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: ENTITY_TYPES.FILE,
      }

      const result = await processor.processConfig(config)

      expect(result.config.storageKey).toMatch(
        /^org123\/file\/(?:temp|[a-zA-Z0-9_-]+)\/\d+_test_file\.pdf$/
      )
      expect(result.config.policy.keyPrefix).toBe('org123/')
      expect(result.config.storageKey.startsWith(result.config.policy.keyPrefix)).toBe(true)
    })

    it('should enforce content length range in policy', async () => {
      const processor = new FileProcessor('org123')
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 5 * 1024 * 1024, // 5MB
        entityType: ENTITY_TYPES.FILE,
      }

      const result = await processor.processConfig(config)

      expect(result.config.policy.contentLengthRange).toEqual([0, Number.MAX_SAFE_INTEGER])
    })

    it('should clamp TTL values within bounds', async () => {
      const processor = new FileProcessor('org123')
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: ENTITY_TYPES.FILE,
        ttlSec: 10000, // Very high value
      }

      const result = await processor.processConfig(config)

      expect(result.config.ttlSec).toBe(3600) // Clamped to 1 hour max
    })
  })

  describe('Error Handling and Validation', () => {
    it('should handle missing organization ID', async () => {
      const processor = new FileProcessor('org123')
      const config: UploadInitConfig = {
        organizationId: '', // Empty org ID
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: ENTITY_TYPES.FILE,
      }

      // Should not throw but produce an invalid key prefix
      const result = await processor.processConfig(config)
      expect(result.config.policy.keyPrefix).toBe('')
    })

    it('should sanitize invalid file names', async () => {
      const processor = new FileProcessor('org123')
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test/file:with|invalid*chars?.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: ENTITY_TYPES.FILE,
      }

      const result = await processor.processConfig(config)

      expect(result.config.storageKey).toMatch(/test_file_with_invalid_chars_\.pdf$/)
    })

    it('should normalize MIME types', async () => {
      const processor = new FileProcessor('org123')
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'APPLICATION/PDF; charset=utf-8', // Mixed case with params
        expectedSize: 1024 * 1024,
        entityType: ENTITY_TYPES.FILE,
      }

      const result = await processor.processConfig(config)

      expect(result.config.mimeType).toBe('application/pdf')
    })
  })
})
