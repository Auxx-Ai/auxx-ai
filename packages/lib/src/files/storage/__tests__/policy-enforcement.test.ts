// packages/lib/src/files/storage/__tests__/policy-enforcement.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadPreparedConfig } from '../../upload/init-types'
import { StorageManager } from '../storage-manager'

// Mock the credential manager
vi.mock('@auxx/lib/credentials', () => ({
  credentialManager: {
    getCredentials: vi.fn().mockResolvedValue({
      accessToken: 'mock-access-token',
      region: 'us-east-1',
      bucket: 'test-bucket',
    }),
  },
}))

// Mock logger
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock S3 adapter
vi.mock('../adapters/s3-adapter', () => ({
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
    startMultipartUpload: vi.fn().mockResolvedValue({
      uploadId: 'test-upload-id',
      expiresAt: new Date(Date.now() + 3600000),
    }),
  })),
}))

describe('Storage Manager Policy Enforcement', () => {
  let storageManager: StorageManager
  let mockAdapter: any

  beforeEach(() => {
    storageManager = new StorageManager('org123')
    vi.clearAllMocks()

    // Get the mocked adapter
    const S3Adapter = require('../../adapters/s3-adapter').default
    mockAdapter = new S3Adapter()
  })

  describe('Key Prefix Policy Enforcement', () => {
    it('should allow uploads with correct key prefix', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        entityId: 'file456',
        provider: 'S3',
        storageKey: 'org123/file/file456/1234567890_test.pdf', // New format: {orgId}/{entity-type}/{entityId}/{timestamp}_{filename}
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/', // Org-scoped prefix for policy validation
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
        visibility: 'PRIVATE', // Add visibility
        bucket: 'test-private-bucket', // Add bucket
      }

      // Should not throw
      await expect(
        storageManager.generatePresignedUploadUrlWithPolicy(config)
      ).resolves.toBeDefined()

      expect(mockAdapter.presignUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'org123/file/file456/1234567890_test.pdf',
        })
      )
    })

    it('should reject uploads with incorrect key prefix', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'wrong/prefix/test.pdf', // Wrong prefix
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow(
        "Key prefix policy violation: key must start with 'org123/'"
      )
    })

    it('should prevent path traversal attacks', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/../../../etc/passwd', // Path traversal attempt
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow(
        'Key prefix policy violation'
      )
    })

    it('should prevent cross-organization access', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org456/test.pdf', // Different org
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow(
        'Key prefix policy violation'
      )
    })
  })

  describe('TTL Policy Enforcement', () => {
    it('should allow TTL within policy limits', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/test.pdf',
        ttlSec: 1800, // 30 minutes
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600, // 1 hour max
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(
        storageManager.generatePresignedUploadUrlWithPolicy(config)
      ).resolves.toBeDefined()

      expect(mockAdapter.presignUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          ttlSec: 1800,
        })
      )
    })

    it('should reject TTL exceeding policy maximum', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/test.pdf',
        ttlSec: 7200, // 2 hours - exceeds policy
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600, // 1 hour max
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow(
        'TTL exceeds policy maximum of 3600 seconds'
      )
    })

    it('should prevent extremely long TTL values', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/test.pdf',
        ttlSec: 86400 * 365, // 1 year
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow(
        'TTL exceeds policy maximum'
      )
    })
  })

  describe('File Size Policy Enforcement', () => {
    it('should allow files within size limits', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 512 * 1024, // 512KB
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/test.pdf',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [100, 1024 * 1024], // 100B to 1MB
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(
        storageManager.generatePresignedUploadUrlWithPolicy(config)
      ).resolves.toBeDefined()
    })

    it('should reject files exceeding maximum size', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'huge-file.pdf',
        mimeType: 'application/pdf',
        expectedSize: 5 * 1024 * 1024, // 5MB
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/huge-file.pdf',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024], // Max 1MB
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow(
        'File size 5242880 is outside allowed range [0, 1048576]'
      )
    })

    it('should reject files below minimum size', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'tiny-file.pdf',
        mimeType: 'application/pdf',
        expectedSize: 50, // 50 bytes
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/tiny-file.pdf',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [1000, 1024 * 1024], // Min 1000 bytes
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow(
        'File size 50 is outside allowed range [1000, 1048576]'
      )
    })

    it('should prevent integer overflow attacks', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'overflow-test.pdf',
        mimeType: 'application/pdf',
        expectedSize: Number.MAX_SAFE_INTEGER,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/overflow-test.pdf',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow(
        'File size'
      )
    })
  })

  describe('MIME Type Policy Enforcement', () => {
    it('should allow exact MIME type matches', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/test.pdf',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf', 'text/plain'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(
        storageManager.generatePresignedUploadUrlWithPolicy(config)
      ).resolves.toBeDefined()
    })

    it('should allow wildcard MIME type matches', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.jpg',
        mimeType: 'image/jpeg',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/test.jpg',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['image/*'], // Wildcard
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(
        storageManager.generatePresignedUploadUrlWithPolicy(config)
      ).resolves.toBeDefined()
    })

    it('should allow universal wildcard', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'any-file.xyz',
        mimeType: 'application/octet-stream',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/any-file.xyz',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['*/*'], // Universal wildcard
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(
        storageManager.generatePresignedUploadUrlWithPolicy(config)
      ).resolves.toBeDefined()
    })

    it('should reject disallowed MIME types', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'malicious.exe',
        mimeType: 'application/x-msdownload',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/malicious.exe',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['image/*', 'application/pdf'], // Executables not allowed
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow(
        "MIME type 'application/x-msdownload' not allowed by policy"
      )
    })

    it('should prevent MIME type spoofing', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'fake-image.jpg.exe',
        mimeType: 'application/x-msdownload',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/fake-image.jpg.exe',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['image/*'], // Only images allowed
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow(
        "MIME type 'application/x-msdownload' not allowed by policy"
      )
    })
  })

  describe('Multipart Upload Policy Enforcement', () => {
    it('should enforce policies for multipart uploads', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'large-file.zip',
        mimeType: 'application/zip',
        expectedSize: 100 * 1024 * 1024, // 100MB
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/large-file.zip',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 500 * 1024 * 1024], // Up to 500MB
          maxTtl: 3600,
          allowedMimeTypes: ['application/zip'],
        },
        uploadPlan: {
          strategy: 'multipart',
        },
      }

      await expect(storageManager.startMultipartUploadFromConfig(config)).resolves.toBeDefined()

      expect(mockAdapter.startMultipartUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'org123/large-file.zip',
          mimeType: 'application/zip',
        })
      )
    })

    it('should apply same policy validation to multipart uploads', async () => {
      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'large-file.zip',
        mimeType: 'application/zip',
        expectedSize: 100 * 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'wrong/prefix/large-file.zip', // Wrong prefix
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 500 * 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['application/zip'],
        },
        uploadPlan: {
          strategy: 'multipart',
        },
      }

      await expect(storageManager.startMultipartUploadFromConfig(config)).rejects.toThrow(
        'Key prefix policy violation'
      )
    })
  })

  describe('Security Edge Cases', () => {
    it('should handle null and undefined values safely', async () => {
      const config: any = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: null, // Null filename
        mimeType: undefined, // Undefined MIME type
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/test.pdf',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      // Should handle gracefully without crashing
      await expect(storageManager.generatePresignedUploadUrlWithPolicy(config)).rejects.toThrow()
    })

    it('should prevent policy object manipulation', async () => {
      const policy = {
        keyPrefix: 'org123/',
        contentLengthRange: [0, 1024 * 1024] as [number, number],
        maxTtl: 3600,
        allowedMimeTypes: ['application/pdf'],
      }

      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/test.pdf',
        ttlSec: 600,
        policy,
        uploadPlan: {
          strategy: 'single',
        },
      }

      // Attempt to modify policy after creation (should not affect validation)
      policy.allowedMimeTypes.push('application/x-msdownload')

      await expect(
        storageManager.generatePresignedUploadUrlWithPolicy(config)
      ).resolves.toBeDefined()
    })

    it('should handle very long file names', async () => {
      const longFileName = 'a'.repeat(1000) + '.pdf'

      const config: UploadPreparedConfig = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: longFileName,
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: `org123/file/${longFileName}`,
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          contentLengthRange: [0, 1024 * 1024],
          maxTtl: 3600,
          allowedMimeTypes: ['application/pdf'],
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      // Should handle long file names without issues
      await expect(
        storageManager.generatePresignedUploadUrlWithPolicy(config)
      ).resolves.toBeDefined()
    })

    it('should validate all policy fields are present', async () => {
      const incompleteConfig: any = {
        organizationId: 'org123',
        userId: 'user123',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        expectedSize: 1024 * 1024,
        entityType: 'file',
        provider: 'S3',
        storageKey: 'org123/test.pdf',
        ttlSec: 600,
        policy: {
          keyPrefix: 'org123/',
          // Missing other policy fields
        },
        uploadPlan: {
          strategy: 'single',
        },
      }

      // Should handle incomplete policy gracefully
      await expect(
        storageManager.generatePresignedUploadUrlWithPolicy(incompleteConfig)
      ).rejects.toThrow()
    })
  })
})
