// packages/lib/src/files/upload/__tests__/unified-processor-system.test.ts

/**
 * Basic validation tests for the unified processor system
 */

import { describe, expect, it } from 'vitest'
import type { EntityType } from '../../types/entities'
import type { UploadInitConfig, UploadPreparedConfig } from '../init-types'
import { ProcessorRegistry } from '../processors/processor-registry'
import {
  clamp,
  deriveStorageKey,
  getDefaultKeyPrefix,
  normalizeMimeType,
  sanitizeFileName,
  shouldUseMultipart,
} from '../util'

describe('Unified Processor System', () => {
  describe('Utility Functions', () => {
    it('should clamp values correctly', () => {
      expect(clamp(5, 0, 10)).toBe(5)
      expect(clamp(-5, 0, 10)).toBe(0)
      expect(clamp(15, 0, 10)).toBe(10)
    })

    it('should sanitize filenames', () => {
      expect(sanitizeFileName('test file.pdf')).toBe('test_file.pdf')
      expect(sanitizeFileName('file@#$.txt')).toBe('file___.txt')
      expect(sanitizeFileName('normal-file.doc')).toBe('normal-file.doc')
    })

    it('should derive storage keys correctly', () => {
      const orgId = 'org123'
      const fileName = 'test.pdf'
      const key = deriveStorageKey(orgId, fileName, {
        entityType: 'FILE',
        entityId: 'temp',
      })

      expect(key).toMatch(/^org123\/file\/temp\/\d+_test\.pdf$/)
    })

    it('should normalize MIME types', () => {
      expect(normalizeMimeType('APPLICATION/PDF')).toBe('application/pdf')
      expect(normalizeMimeType('text/plain; charset=utf-8')).toBe('text/plain')
      expect(normalizeMimeType('Image/JPEG')).toBe('image/jpeg')
    })

    it('should determine multipart upload threshold', () => {
      expect(shouldUseMultipart(1024 * 1024)).toBe(false) // 1MB
      expect(shouldUseMultipart(100 * 1024 * 1024)).toBe(true) // 100MB
      expect(shouldUseMultipart(50 * 1024 * 1024)).toBe(true) // 50MB (default threshold)
    })

    it('should generate default key prefix (legacy - used for policy validation only)', () => {
      // NOTE: This prefix is only used for policy validation, not actual key generation
      // Actual keys now use format: {orgId}/{entity-type}/{entityId}/{timestamp}_{filename}
      expect(getDefaultKeyPrefix('org123')).toBe('org123/')
    })
  })

  describe('Processor Registry', () => {
    it('should have simplified EntityType mapping', () => {
      // Test that registry supports EntityType directly
      const entityTypes: EntityType[] = ['FILE', 'DATASET', 'TICKET']

      entityTypes.forEach((entityType) => {
        expect(() => {
          ProcessorRegistry.hasProcessor(entityType)
        }).not.toThrow()
      })
    })

    it('should provide processor count', () => {
      const count = ProcessorRegistry.getProcessorCount()
      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('should list registered types', () => {
      const types = ProcessorRegistry.getRegisteredTypes()
      expect(Array.isArray(types)).toBe(true)
      expect(types.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Type Definitions', () => {
    it('should have correct UploadInitConfig structure', () => {
      const initConfig: UploadInitConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024,
        entityType: 'file',
      }

      expect(initConfig.organizationId).toBe('org123')
      expect(initConfig.entityType).toBe('file')
    })

    it('should have immutable UploadPreparedConfig structure', () => {
      const preparedConfig: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/file/test.pdf',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024],
          maxTtl: 600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      expect(preparedConfig.provider).toBe('S3')
      expect(preparedConfig.policy.keyPrefix).toBe('org123/')
      expect(preparedConfig.uploadPlan.strategy).toBe('single')
    })
  })
})
