// packages/lib/src/files/upload/processors/__tests__/unified-processor-system.test.ts

import { beforeEach, describe, expect, it, type MockedFunction, vi } from 'vitest'
import type { EntityType } from '../../../types/entities'
import { ENTITY_TYPES } from '../../../types/entities'
import type { UploadInitConfig } from '../../init-types'
import { TicketProcessor, UserProfileProcessor, WorkflowRunProcessor } from '../entity-processors'
import { FileProcessor } from '../file-processor'
import { ProcessorRegistry } from '../processor-registry'

// Hoist mock variables to be accessible inside vi.mock factories
const { ticketSelectRowsRef, workflowRunSelectRowsRef, createSelectBuilder } = vi.hoisted(() => {
  const ticketSelectRowsRef = { value: [{ id: 'ticket123' }] }
  const workflowRunSelectRowsRef = { value: [{ id: 'workflow123' }] }

  // Creates a lightweight Drizzle-style select builder chain
  const createSelectBuilder = (rowsRef: { value: any[] }) => {
    const builder: Record<string, any> = {}
    builder.from = vi.fn().mockReturnValue(builder)
    builder.where = vi.fn().mockReturnValue(builder)
    builder.limit = vi.fn().mockImplementation(async () => rowsRef.value)
    return builder
  }

  return { ticketSelectRowsRef, workflowRunSelectRowsRef, createSelectBuilder }
})

// Mock the database and services
vi.mock('@auxx/database', () => ({
  database: {
    select: vi.fn(() => createSelectBuilder(ticketSelectRowsRef)),
    query: {
      Ticket: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
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
  schema: {
    Ticket: { id: 'id', organizationId: 'organizationId' },
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
  },
}))

vi.mock('@auxx/lib/members', () => ({
  MemberService: {
    isMember: vi.fn().mockResolvedValue(true),
  },
}))

vi.mock('@auxx/logger', () => ({
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
  credentialManager: { getCredentials: vi.fn().mockResolvedValue({}) },
}))

// Mock @auxx/redis
vi.mock('@auxx/redis', () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
}))

// Mock thumbnail-related modules
vi.mock('../../../files/core/thumbnail-batch', () => ({
  ensureThumbnailPresets: vi.fn().mockResolvedValue([]),
}))

// Mock drizzle-orm operators used in entity processors
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => [a, b]),
  desc: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
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
      expect(ProcessorRegistry.hasProcessor(ENTITY_TYPES.TICKET)).toBe(false)
    })

    it('should return processor instance for registered EntityType', () => {
      ProcessorRegistry.registerForEntity(ENTITY_TYPES.FILE, (orgId) => new FileProcessor(orgId))

      const processor = ProcessorRegistry.getForEntityType(ENTITY_TYPES.FILE, 'org123')
      expect(processor).toBeInstanceOf(FileProcessor)
    })

    it('should throw error for unregistered EntityType with no default', () => {
      expect(() => {
        ProcessorRegistry.getForEntityType('unknown:entity' as EntityType, 'org123')
      }).toThrow('No processor found for entity type: unknown:entity')
    })

    it('should use default processor for unregistered EntityType', () => {
      ProcessorRegistry.setDefaultProcessor((orgId) => new FileProcessor(orgId))

      const processor = ProcessorRegistry.getForEntityType('unknown:entity' as EntityType, 'org123')
      expect(processor).toBeInstanceOf(FileProcessor)
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
        entityType: ENTITY_TYPES.TICKET as EntityType,
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

  describe('TicketProcessor processConfig', () => {
    let processor: TicketProcessor

    beforeEach(async () => {
      processor = new TicketProcessor('org123')

      // Set up ticket rows for the select builder to return
      ticketSelectRowsRef.value = [{ id: 'ticket123' }]

      // Also reset the database.select mock to use ticket rows
      const { database } = await import('@auxx/database')
      vi.mocked(database.select).mockImplementation(
        () => createSelectBuilder(ticketSelectRowsRef) as any
      )
    })

    it('should process config with ticket-specific policies', async () => {
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'attachment.pdf',
        mimeType: 'application/pdf',
        expectedSize: 5 * 1024 * 1024, // 5MB
        entityType: ENTITY_TYPES.TICKET,
        entityId: 'ticket123',
      }

      const result = await processor.processConfig(config)

      expect(result.config.policy.allowedMimeTypes).toContain('application/pdf')
      expect(result.config.policy.allowedMimeTypes).toContain('image/*')
      expect(result.warnings).toHaveLength(0)
    })

    it('should throw error when entityId is missing', async () => {
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'attachment.pdf',
        mimeType: 'application/pdf',
        expectedSize: 5 * 1024 * 1024,
        entityType: ENTITY_TYPES.TICKET,
        // entityId missing
      }

      await expect(processor.processConfig(config)).rejects.toThrow(
        'Entity ID is required for TICKET attachments'
      )
    })

    it('should throw error when file exceeds size limit', async () => {
      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'huge-file.pdf',
        mimeType: 'application/pdf',
        expectedSize: 30 * 1024 * 1024, // 30MB (exceeds 25MB limit)
        entityType: ENTITY_TYPES.TICKET,
        entityId: 'ticket123',
      }

      await expect(processor.processConfig(config)).rejects.toThrow(
        'File exceeds allowed size of 25MB'
      )
    })

    it('should throw error when entity access fails', async () => {
      // Return empty rows to simulate ticket not found
      ticketSelectRowsRef.value = []

      const config: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'attachment.pdf',
        mimeType: 'application/pdf',
        expectedSize: 5 * 1024 * 1024,
        entityType: ENTITY_TYPES.TICKET,
        entityId: 'nonexistent-ticket',
      }

      await expect(processor.processConfig(config)).rejects.toThrow(
        'Entity validation failed: Ticket not found or access denied'
      )
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
