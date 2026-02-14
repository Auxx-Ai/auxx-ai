// packages/lib/src/providers/__tests__/provider-registry-service.test.ts

import { IntegrationProviderType } from '@auxx/database/enums'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderRegistryService } from '../provider-registry-service'

// Mock the database
const mockDb = {
  integration: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  organizationSetting: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}

// Mock the logger
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock provider classes
vi.mock('../google/google-provider', () => ({
  GoogleProvider: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockReturnValue({
      canSend: true,
      canApplyLabel: true,
      labelScope: 'thread',
    }),
  })),
}))

vi.mock('../outlook/outlook-provider', () => ({
  OutlookProvider: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockReturnValue({
      canSend: true,
      canApplyLabel: true,
      labelScope: 'message',
    }),
  })),
}))

vi.mock('../facebook/facebook-provider', () => ({
  FacebookProvider: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockReturnValue({
      canSend: true,
      canReact: true,
      labelScope: 'conversation',
    }),
  })),
}))

describe('ProviderRegistryService', () => {
  let service: ProviderRegistryService
  const organizationId = 'test-org-id'

  beforeEach(() => {
    service = new ProviderRegistryService(organizationId)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getAllIntegrations', () => {
    it('should return active integrations with correct format', async () => {
      const mockIntegrations = [
        {
          id: 'integration-1',
          provider: 'google',
          enabled: true,
          metadata: { email: 'test@example.com' },
          updatedAt: new Date(),
        },
        {
          id: 'integration-2',
          provider: 'facebook',
          enabled: true,
          metadata: { pageId: 'page123' },
          updatedAt: new Date(),
        },
      ]

      mockDb.integration.findMany = vi.fn().mockResolvedValue(mockIntegrations)

      const result = await service.getAllIntegrations()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        type: 'google',
        id: 'integration-1',
        details: { identifier: 'test@example.com', provider: 'google' },
        metadata: { email: 'test@example.com' },
      })
      expect(result[1]).toEqual({
        type: 'facebook',
        id: 'integration-2',
        details: { identifier: 'page123', provider: 'facebook' },
        metadata: { pageId: 'page123' },
      })
    })

    it('should filter out unknown providers', async () => {
      const mockIntegrations = [
        {
          id: 'integration-1',
          provider: 'google',
          enabled: true,
          metadata: { email: 'test@example.com' },
          updatedAt: new Date(),
        },
        {
          id: 'integration-2',
          provider: 'unknown-provider',
          enabled: true,
          metadata: {},
          updatedAt: new Date(),
        },
      ]

      mockDb.integration.findMany = vi.fn().mockResolvedValue(mockIntegrations)

      const result = await service.getAllIntegrations()

      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('google')
    })

    it('should handle empty integrations', async () => {
      mockDb.integration.findMany = vi.fn().mockResolvedValue([])

      const result = await service.getAllIntegrations()

      expect(result).toHaveLength(0)
    })
  })

  describe('Provider Capability Methods', () => {
    describe('getProviderCapabilities', () => {
      it('should return capabilities for known providers', () => {
        const emailCapabilities = service.getProviderCapabilities(IntegrationProviderType.email)
        expect(emailCapabilities.canSend).toBe(true)
        expect(emailCapabilities.labelScope).toBe('thread')

        const facebookCapabilities = service.getProviderCapabilities(
          IntegrationProviderType.facebook
        )
        expect(facebookCapabilities.canReact).toBe(true)
        expect(facebookCapabilities.labelScope).toBe('conversation')
      })
    })

    describe('providerSupportsAction', () => {
      it('should return true for supported actions', async () => {
        expect(
          await service.providerSupportsAction(
            IntegrationProviderType.email,
            'integration-1',
            'SEND_MESSAGE'
          )
        ).toBe(true)

        expect(
          await service.providerSupportsAction(
            IntegrationProviderType.facebook,
            'integration-2',
            'REACT_TO_MESSAGE'
          )
        ).toBe(true)
      })

      it('should return false for unsupported actions', async () => {
        expect(
          await service.providerSupportsAction(
            IntegrationProviderType.instagram,
            'integration-3',
            'APPLY_LABEL'
          )
        ).toBe(false)

        expect(
          await service.providerSupportsAction(
            IntegrationProviderType.sms,
            'integration-4',
            'DRAFT_EMAIL'
          )
        ).toBe(false)
      })

      it('should return true for universal actions', async () => {
        expect(
          await service.providerSupportsAction(
            IntegrationProviderType.instagram,
            'integration-3',
            'APPLY_TAG'
          )
        ).toBe(true)

        expect(
          await service.providerSupportsAction(
            IntegrationProviderType.sms,
            'integration-4',
            'ESCALATE'
          )
        ).toBe(true)
      })
    })

    describe('validateProviderAction', () => {
      it('should validate supported actions', async () => {
        const result = await service.validateProviderAction(
          IntegrationProviderType.email,
          'integration-1',
          'SEND_MESSAGE'
        )

        expect(result.canPerform).toBe(true)
        expect(result.reason).toBeUndefined()
      })

      it('should reject unsupported actions with alternatives', async () => {
        const result = await service.validateProviderAction(
          IntegrationProviderType.instagram,
          'integration-3',
          'APPLY_LABEL'
        )

        expect(result.canPerform).toBe(false)
        expect(result.reason).toContain('does not support APPLY_LABEL')
        expect(result.alternatives).toContain('APPLY_TAG')
      })

      it('should validate label scope constraints', async () => {
        const result = await service.validateProviderAction(
          IntegrationProviderType.facebook,
          'integration-2',
          'APPLY_LABEL',
          { targetType: 'message' }
        )

        expect(result.canPerform).toBe(false)
        expect(result.reason).toContain('does not support message-level labels')
        expect(result.alternatives).toContain('APPLY_TAG')
      })

      it('should validate attachment constraints', async () => {
        const largeAttachment = {
          attachments: [{ size: 30 * 1024 * 1024 }], // 30MB
        }

        const result = await service.validateProviderAction(
          IntegrationProviderType.email,
          'integration-1',
          'SEND_MESSAGE',
          largeAttachment
        )

        expect(result.canPerform).toBe(false)
        expect(result.reason).toContain('exceeds')
        expect(result.alternatives).toContain('Reduce attachment size')
      })

      it("should reject attachments for providers that don't support them", async () => {
        const result = await service.validateProviderAction(
          IntegrationProviderType.sms,
          'integration-4',
          'SEND_MESSAGE',
          { attachments: [{ size: 1024 }] }
        )

        expect(result.canPerform).toBe(false)
        expect(result.reason).toContain('does not support attachments')
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDb.integration.findMany = vi.fn().mockRejectedValue(new Error('Database error'))

      await expect(service.getAllIntegrations()).rejects.toThrow('Database error')
    })

    it('should handle provider initialization failures', async () => {
      const mockIntegrations = [
        {
          id: 'integration-1',
          provider: 'google',
          enabled: true,
          metadata: { email: 'test@example.com' },
          updatedAt: new Date(),
        },
      ]

      mockDb.integration.findMany = vi.fn().mockResolvedValue(mockIntegrations)

      // Mock initializeProvider to fail
      const originalInit = service['initializeProvider']
      service['initializeProvider'] = vi.fn().mockRejectedValue(new Error('Init failed'))

      // Should not throw, but should log error
      await expect(service.initializeAll()).resolves.not.toThrow()

      // Restore original method
      service['initializeProvider'] = originalInit
    })
  })
})
