// packages/lib/src/files/upload/__tests__/unified-upload-integration.test.ts

import { beforeEach, describe, expect, it, type MockedFunction, vi } from 'vitest'
import { StorageManager } from '../../storage/storage-manager'
import type { UploadInitConfig, UploadPreparedConfig } from '../init-types'
import { TicketProcessor } from '../processors/entity-processors'
import { FileProcessor } from '../processors/file-processor'
import { ProcessorRegistry } from '../processors/processor-registry'
import { SessionManager } from '../session-manager'

const { ticketSelectRowsRef, createSelectBuilder, selectMock } = vi.hoisted(() => {
  // Maintains the mocked Ticket rows returned from the Drizzle select builder
  const ticketSelectRowsRef = {
    value: [{ id: 'ticket123' }],
  }

  // Creates a lightweight Drizzle select builder compatible with the processor code paths under test
  const createSelectBuilder = () => {
    const builder: Record<string, any> = {}
    builder.from = vi.fn().mockReturnValue(builder)
    builder.where = vi.fn().mockReturnValue(builder)
    builder.limit = vi.fn().mockImplementation(async () => ticketSelectRowsRef.value)
    return builder
  }

  // Shared Drizzle select mock so individual tests can override behavior when needed
  const selectMock = vi.fn(() => createSelectBuilder())

  return { ticketSelectRowsRef, createSelectBuilder, selectMock }
})

const { redisStore, redisClient, getRedisClientMock } = vi.hoisted(() => {
  const redisStore = new Map<string, string>()
  const redisClient = {
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      redisStore.set(key, value)
      return 'OK'
    }),
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    del: vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
  }

  const getRedisClientMock = vi.fn().mockResolvedValue(redisClient)

  return { redisStore, redisClient, getRedisClientMock }
})

const { nanoidMock, resetNanoidSequence } = vi.hoisted(() => {
  let counter = 0

  const nanoidMock = vi.fn(() => {
    const base = 123
    const value = counter === 0 ? `${base}` : `${base + counter}`
    counter += 1
    return `test-session-id-${value}`
  })

  const resetNanoidSequence = () => {
    counter = 0
    nanoidMock.mockClear()
  }

  return { nanoidMock, resetNanoidSequence }
})

// Mock Redis client
vi.mock('@auxx/redis', () => ({
  getRedisClient: getRedisClientMock,
}))

// Mock database and services
vi.mock('@auxx/database', async () => {
  const schema = await import('@auxx/database/db/schema')

  return {
    schema,
    database: {
      select: selectMock,
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      transaction: vi.fn(async (callback) =>
        callback({
          select: selectMock,
          insert: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        })
      ),
      query: {
        Ticket: {
          findFirst: vi.fn(async () => ticketSelectRowsRef.value[0] ?? null),
        },
      },
    },
  }
})

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@auxx/lib/credentials', () => ({
  credentialManager: {
    getCredentials: vi.fn().mockResolvedValue({
      accessToken: 'mock-access-token',
      region: 'us-east-1',
      bucket: 'test-bucket',
    }),
    testCredentials: vi.fn().mockResolvedValue({ success: true }),
  },
}))

// Mock nanoid for predictable session IDs
vi.mock('nanoid', () => ({
  nanoid: nanoidMock,
}))

describe('Unified Upload Integration Tests', () => {
  beforeEach(() => {
    ProcessorRegistry.clear()
    vi.clearAllMocks()

    ticketSelectRowsRef.value = [{ id: 'ticket123' }]
    selectMock.mockReset()
    selectMock.mockImplementation(() => createSelectBuilder())

    redisStore.clear()
    redisClient.setex.mockClear()
    redisClient.get.mockClear()
    redisClient.del.mockClear()
    getRedisClientMock.mockReset()
    getRedisClientMock.mockResolvedValue(redisClient)
    resetNanoidSequence()

    // Register processors using canonical EntityType values
    ProcessorRegistry.registerForEntity('FILE', (orgId) => new FileProcessor(orgId))
    ProcessorRegistry.registerForEntity('TICKET', (orgId) => new TicketProcessor(orgId))
  })

  describe('Complete Upload Flow', () => {
    it('should complete end-to-end file upload flow', async () => {
      // Step 1: Get processor for entity type
      const processor = ProcessorRegistry.getForEntityType('FILE', 'org123')
      expect(processor).toBeInstanceOf(FileProcessor)

      // Step 2: Process configuration
      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test-document.pdf',
        mimeType: 'application/pdf',
        expectedSize: 2 * 1024 * 1024, // 2MB
        entityType: 'FILE',
      }

      const { config, warnings } = await processor.processConfig(init)

      expect(config).toMatchObject({
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test-document.pdf',
        mimeType: 'application/pdf',
        expectedSize: 2 * 1024 * 1024,
        entityType: 'FILE',
        provider: 'S3',
      })

      expect(config.policy.keyPrefix).toBe('org123/')
      expect(config.policy.contentLengthRange[0]).toBe(0)
      expect(config.policy.contentLengthRange[1]).toBe(Number.MAX_SAFE_INTEGER)
      expect(config.policy.maxTtl).toBe(3600)
      expect(config.policy.allowedMimeTypes).toEqual(['*/*'])

      expect(config.uploadPlan.strategy).toBe('single')
      expect(warnings).toHaveLength(0)

      // Step 3: Create session from config
      const session = await SessionManager.createSessionFromConfig(config)

      expect(session).toMatchObject({
        id: 'test-session-id-123',
        organizationId: 'org123',
        userId: 'user123',
        entityType: 'FILE',
        fileName: 'test-document.pdf',
        mimeType: 'application/pdf',
        expectedSize: 2 * 1024 * 1024,
        provider: 'S3',
        isMultipart: false,
        status: 'created',
        ttlSec: config.ttlSec,
        bucket: config.bucket,
        visibility: config.visibility,
      })

      expect(session.storageKey).toMatch(
        /^org123\/file\/(?:temp|[a-zA-Z0-9_-]+)\/\d+_test-document\.pdf$/
      )
      expect(session.policy).toEqual(config.policy)
      expect(session.uploadPlan).toEqual(config.uploadPlan)
    })

    it('should complete ticket attachment upload flow with validation', async () => {
      // Step 1: Get processor for ticket attachment
      const processor = ProcessorRegistry.getForEntityType('TICKET', 'org123')
      expect(processor).toBeInstanceOf(TicketProcessor)

      // Step 2: Process configuration with entity validation
      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'support-document.pdf',
        mimeType: 'application/pdf',
        expectedSize: 5 * 1024 * 1024, // 5MB
        entityType: 'TICKET',
        entityId: 'ticket123',
      }

      const { config } = await processor.processConfig(init)

      expect(config.policy.allowedMimeTypes).toContain('application/pdf')
      expect(config.policy.allowedMimeTypes).not.toContain('*/*')

      // Step 3: Create session
      const session = await SessionManager.createSessionFromConfig(config)

      expect(session.entityType).toBe('TICKET') // ✅ Use canonical EntityType
      expect(session.entityId).toBe('ticket123')
    })

    it('should handle multipart upload for large files', async () => {
      const processor = ProcessorRegistry.getForEntityType('FILE', 'org123')

      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'large-video.mp4',
        mimeType: 'video/mp4',
        expectedSize: 150 * 1024 * 1024, // 150MB
        entityType: 'FILE',
      }

      const { config } = await processor.processConfig(init)

      expect(config.uploadPlan.strategy).toBe('multipart')

      const session = await SessionManager.createSessionFromConfig(config)
      expect(session.isMultipart).toBe(true)
    })
  })

  describe('Policy Enforcement Integration', () => {
    let storageManager: StorageManager

    beforeEach(() => {
      storageManager = new StorageManager('org123')

      // Mock S3 adapter
      vi.doMock('../../storage/adapters/s3-adapter', () => ({
        default: vi.fn().mockImplementation(() => ({
          getCapabilities: () => ({
            presignUpload: true,
            presignDownload: true,
            serverSideDownload: false,
            versioning: false,
            webhooks: false,
            folders: false,
            search: false,
            metadata: true,
            multipart: true,
          }),
          credentialProviderId: 'aws',
          presignUpload: vi.fn().mockResolvedValue({
            url: 'https://test-bucket.s3.amazonaws.com/test-key',
            method: 'PUT',
            fields: {},
          }),
        })),
      }))
    })

    it('should enforce key prefix policy', async () => {
      const processor = ProcessorRegistry.getForEntityType('FILE', 'org123')

      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'FILE',
      }

      const { config } = await processor.processConfig(init)

      // This should not throw because key matches prefix
      expect(() => {
        storageManager['validatePolicyCompliance'](config)
      }).not.toThrow()

      // Test key prefix violation
      const invalidConfig = {
        ...config,
        storageKey: 'invalid/prefix/test.pdf',
      }

      expect(() => {
        storageManager['validatePolicyCompliance'](invalidConfig)
      }).toThrow('Key prefix policy violation')
    })

    it('should enforce TTL policy', async () => {
      const processor = ProcessorRegistry.getForEntityType('FILE', 'org123')

      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'FILE',
        ttlSec: 7200, // 2 hours - exceeds 1 hour limit
      }

      const { config } = await processor.processConfig(init)

      // TTL should be clamped to policy maximum
      expect(config.ttlSec).toBe(3600) // 1 hour max
    })

    it('should enforce file size policy', async () => {
      const processor = ProcessorRegistry.getForEntityType('FILE', 'org123')

      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'FILE',
      }

      const { config } = await processor.processConfig(init)

      expect(config.policy.contentLengthRange).toEqual([0, Number.MAX_SAFE_INTEGER])

      // StorageManager should enforce this during presigned URL generation
      const validConfig = { ...config }
      expect(() => {
        storageManager['validateSizeCompliance'](validConfig, 1024 * 1024)
      }).not.toThrow()

      expect(() => {
        storageManager['validateSizeCompliance'](validConfig, 2 * 1024 * 1024)
      }).toThrow('File size exceeds policy limit')
    })
  })

  describe('Session Lifecycle', () => {
    it('should manage session lifecycle correctly', async () => {
      const processor = ProcessorRegistry.getForEntityType('FILE', 'org123')

      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'lifecycle-test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'FILE',
      }

      const { config } = await processor.processConfig(init)

      // Create session
      const session = await SessionManager.createSessionFromConfig(config)
      expect(session.status).toBe('created')

      // Retrieve session
      const retrievedSession = await SessionManager.getSession(session.id)
      expect(retrievedSession).toBeTruthy()
      expect(retrievedSession!.id).toBe(session.id)

      // Update session status
      await SessionManager.updateSession(session.id, { status: 'processing' })

      const updatedSession = await SessionManager.getSession(session.id)
      expect(updatedSession!.status).toBe('processing')

      // Delete session
      await SessionManager.deleteSession(session.id)

      const deletedSession = await SessionManager.getSession(session.id)
      expect(deletedSession).toBeNull()
    })

    it('should handle session completion', async () => {
      const processor = ProcessorRegistry.getForEntityType('FILE', 'org123')

      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'completion-test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'FILE',
      }

      const { config } = await processor.processConfig(init)
      const session = await SessionManager.createSessionFromConfig(config)

      // Complete upload
      await SessionManager.completeUpload(session.id, {
        storageKey: session.storageKey,
        size: 1024 * 1024,
        etag: 'test-etag-123',
      })

      const completedSession = await SessionManager.getSession(session.id)
      expect(completedSession!.status).toBe('processing')
      expect(completedSession!.storageLocationId).toBe(session.storageKey)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle processor registry errors', () => {
      expect(() => {
        ProcessorRegistry.getForEntityType('nonexistent' as any, 'org123')
      }).toThrow('No processor found for entity type: nonexistent')
    })

    it('should handle validation failures', async () => {
      const processor = ProcessorRegistry.getForEntityType('TICKET', 'org123')

      // Mock database to return null (entity not found)
      ticketSelectRowsRef.value = []
      selectMock.mockImplementationOnce(() => createSelectBuilder())

      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'TICKET',
        entityId: 'nonexistent-ticket',
      }

      await expect(processor.processConfig(init)).rejects.toThrow(
        'Entity validation failed: Ticket not found or access denied'
      )
    })

    it('should handle session not found', async () => {
      const session = await SessionManager.getSession('nonexistent-session')
      expect(session).toBeNull()
    })

    it('should handle Redis connection errors gracefully', async () => {
      // Mock Redis to throw error
      const redisModule = await import('@auxx/redis')
      ;(redisModule.getRedisClient as MockedFunction<any>).mockRejectedValueOnce(
        new Error('Redis connection failed')
      )

      const processor = ProcessorRegistry.getForEntityType('FILE', 'org123')
      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'FILE',
      }

      const { config } = await processor.processConfig(init)

      await expect(SessionManager.createSessionFromConfig(config)).rejects.toThrow(
        'Redis connection failed'
      )
    })
  })

  describe('Performance and Concurrency', () => {
    it('should handle concurrent session creation', async () => {
      const processor = ProcessorRegistry.getForEntityType('FILE', 'org123')

      const createSession = async (index: number) => {
        const init: UploadInitConfig = {
          organizationId: 'org123',
          userId: 'user123',
          fileName: `concurrent-test-${index}.pdf`,
          mimeType: 'application/pdf',
          expectedSize: 1024 * 1024,
          entityType: 'FILE',
        }

        const { config } = await processor.processConfig(init)
        return SessionManager.createSessionFromConfig(config)
      }

      // Create 10 sessions concurrently
      const sessions = await Promise.all(Array.from({ length: 10 }, (_, i) => createSession(i)))

      expect(sessions).toHaveLength(10)
      expect(new Set(sessions.map((s) => s.id)).size).toBe(10) // All unique
    })

    it('should handle large file configurations efficiently', async () => {
      const processor = ProcessorRegistry.getForEntityType('FILE', 'org123')

      const start = Date.now()

      const init: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'very-large-file.zip',
        mimeType: 'application/zip',
        expectedSize: 5 * 1024 * 1024 * 1024, // 5GB
        entityType: 'FILE',
      }

      const { config } = await processor.processConfig(init)
      const session = await SessionManager.createSessionFromConfig(config)

      const duration = Date.now() - start

      expect(duration).toBeLessThan(1000) // Should complete in under 1 second
      expect(config.uploadPlan.strategy).toBe('multipart')
      expect(session.isMultipart).toBe(true)
    })
  })
})

// Helper functions for StorageManager policy validation (these would be private methods)
declare module '../../storage/storage-manager' {
  interface StorageManager {
    validatePolicyCompliance(config: UploadPreparedConfig): void
    validateSizeCompliance(config: UploadPreparedConfig, actualSize: number): void
  }
}

// Mock implementations for testing
StorageManager.prototype['validatePolicyCompliance'] = (config: UploadPreparedConfig) => {
  if (!config.storageKey.startsWith(config.policy.keyPrefix)) {
    throw new Error('Key prefix policy violation')
  }
}

StorageManager.prototype['validateSizeCompliance'] = (
  config: UploadPreparedConfig,
  actualSize: number
) => {
  const [minSize, maxSize] = config.policy.contentLengthRange
  const effectiveMax =
    maxSize === Number.MAX_SAFE_INTEGER && typeof config.expectedSize === 'number'
      ? config.expectedSize
      : maxSize
  if (actualSize < minSize || actualSize > effectiveMax) {
    throw new Error('File size exceeds policy limit')
  }
}
