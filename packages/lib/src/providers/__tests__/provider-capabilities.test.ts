// packages/lib/src/providers/__tests__/provider-capabilities.test.ts

import { IntegrationProviderType } from '@auxx/database/enums'
import { describe, expect, it, vi } from 'vitest'
import { getProviderCapabilities, PROVIDER_CAPABILITIES } from '../provider-capabilities'
import { ProviderRegistryService } from '../provider-registry-service'

// Mock the database for ProviderRegistryService
vi.mock('@auxx/database', () => ({
  database: {
    select: vi.fn(),
    query: {
      Integration: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      OrganizationSetting: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  schema: { Integration: {} },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
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

// Mock all provider modules to avoid pulling in heavy dependencies (googleapis, etc.)
const mockProvider = {
  initialize: vi.fn().mockResolvedValue(undefined),
  getCapabilities: vi.fn(),
}

vi.mock('../google/google-provider', () => ({
  GoogleProvider: vi.fn().mockImplementation(() => ({ ...mockProvider })),
}))
vi.mock('../outlook/outlook-provider', () => ({
  OutlookProvider: vi.fn().mockImplementation(() => ({ ...mockProvider })),
}))
vi.mock('../facebook/facebook-provider', () => ({
  FacebookProvider: vi.fn().mockImplementation(() => ({ ...mockProvider })),
}))
vi.mock('../instagram/instagram-provider', () => ({
  InstagramProvider: vi.fn().mockImplementation(() => ({ ...mockProvider })),
}))
vi.mock('../openphone/openphone-provider', () => ({
  OpenPhoneProvider: vi.fn().mockImplementation(() => ({ ...mockProvider })),
}))

describe('Provider Capabilities', () => {
  describe('PROVIDER_CAPABILITIES constants', () => {
    it('should have capabilities defined for all provider types', () => {
      const expectedProviders = [
        IntegrationProviderType.email,
        IntegrationProviderType.facebook,
        IntegrationProviderType.instagram,
        IntegrationProviderType.sms,
        IntegrationProviderType.openphone,
        IntegrationProviderType.whatsapp,
        IntegrationProviderType.chat,
        IntegrationProviderType.shopify,
        IntegrationProviderType.outlook,
      ]

      expectedProviders.forEach((provider) => {
        expect(PROVIDER_CAPABILITIES[provider]).toBeDefined()
        expect(typeof PROVIDER_CAPABILITIES[provider]).toBe('object')
      })
    })

    it('should have consistent capability structure for all providers', () => {
      const requiredCapabilities = [
        'canSend',
        'canReply',
        'canForward',
        'canDraft',
        'canDelete',
        'canArchive',
        'canMarkSpam',
        'canMarkTrash',
        'canSearch',
        'canApplyLabel',
        'canRemoveLabel',
        'canCreateLabel',
        'labelScope',
        'canManageThreads',
        'canAssignThreads',
        'canBulkOperations',
        'canAttachFiles',
        'canScheduleSend',
        'canTrackOpens',
        'canUseTemplates',
        'canReact',
        'canShare',
      ]

      Object.values(PROVIDER_CAPABILITIES).forEach((capabilities) => {
        requiredCapabilities.forEach((capability) => {
          expect(capabilities).toHaveProperty(capability)
        })
      })
    })
  })

  describe('Email Provider Capabilities', () => {
    const emailCapabilities = PROVIDER_CAPABILITIES[IntegrationProviderType.email]

    it('should support full email operations', () => {
      expect(emailCapabilities.canSend).toBe(true)
      expect(emailCapabilities.canReply).toBe(true)
      expect(emailCapabilities.canForward).toBe(true)
      expect(emailCapabilities.canDraft).toBe(true)
      expect(emailCapabilities.canDelete).toBe(true)
      expect(emailCapabilities.canArchive).toBe(true)
      expect(emailCapabilities.canMarkSpam).toBe(true)
      expect(emailCapabilities.canMarkTrash).toBe(true)
    })

    it('should support thread-level labels', () => {
      expect(emailCapabilities.canApplyLabel).toBe(true)
      expect(emailCapabilities.canRemoveLabel).toBe(true)
      expect(emailCapabilities.canCreateLabel).toBe(true)
      expect(emailCapabilities.labelScope).toBe('thread')
    })

    it('should support bulk operations', () => {
      expect(emailCapabilities.canBulkOperations).toBe(true)
      expect(emailCapabilities.canManageThreads).toBe(true)
      expect(emailCapabilities.canAssignThreads).toBe(true)
    })

    it('should support attachments with reasonable limits', () => {
      expect(emailCapabilities.canAttachFiles).toBe(true)
      expect(emailCapabilities.maxAttachmentSize).toBe(25 * 1024 * 1024) // 25MB
    })
  })

  describe('Facebook Provider Capabilities', () => {
    const facebookCapabilities = PROVIDER_CAPABILITIES[IntegrationProviderType.facebook]

    it('should support basic messaging', () => {
      expect(facebookCapabilities.canSend).toBe(true)
      expect(facebookCapabilities.canReply).toBe(true)
      expect(facebookCapabilities.canReact).toBe(true)
    })

    it('should not support email-specific operations', () => {
      expect(facebookCapabilities.canDraft).toBe(false)
      expect(facebookCapabilities.canForward).toBe(false)
      expect(facebookCapabilities.canArchive).toBe(false)
      expect(facebookCapabilities.canMarkSpam).toBe(false)
    })

    it('should support conversation-level labels only', () => {
      expect(facebookCapabilities.canApplyLabel).toBe(true)
      expect(facebookCapabilities.canRemoveLabel).toBe(true)
      expect(facebookCapabilities.canCreateLabel).toBe(false)
      expect(facebookCapabilities.labelScope).toBe('conversation')
    })

    it('should have rate limits defined', () => {
      expect(facebookCapabilities.rateLimits).toBeDefined()
      expect(facebookCapabilities.rateLimits?.messagesPerMinute).toBe(200)
      expect(facebookCapabilities.rateLimits?.messagesPerHour).toBe(1000)
    })
  })

  describe('Instagram Provider Capabilities', () => {
    const instagramCapabilities = PROVIDER_CAPABILITIES[IntegrationProviderType.instagram]

    it('should support basic messaging but not labels', () => {
      expect(instagramCapabilities.canSend).toBe(true)
      expect(instagramCapabilities.canReply).toBe(true)
      expect(instagramCapabilities.canReact).toBe(true)
      expect(instagramCapabilities.canShare).toBe(true)
    })

    it('should not support any labeling', () => {
      expect(instagramCapabilities.canApplyLabel).toBe(false)
      expect(instagramCapabilities.canRemoveLabel).toBe(false)
      expect(instagramCapabilities.canCreateLabel).toBe(false)
      expect(instagramCapabilities.labelScope).toBe('none')
    })

    it('should not support advanced operations', () => {
      expect(instagramCapabilities.canDraft).toBe(false)
      expect(instagramCapabilities.canForward).toBe(false)
      expect(instagramCapabilities.canBulkOperations).toBe(false)
      expect(instagramCapabilities.canSearch).toBe(false)
    })
  })

  describe('SMS/OpenPhone Provider Capabilities', () => {
    const smsCapabilities = PROVIDER_CAPABILITIES[IntegrationProviderType.sms]
    const openPhoneCapabilities = PROVIDER_CAPABILITIES[IntegrationProviderType.openphone]

    it('should support basic SMS operations', () => {
      expect(smsCapabilities.canSend).toBe(true)
      expect(smsCapabilities.canReply).toBe(true)
      expect(smsCapabilities.canScheduleSend).toBe(true)
      expect(smsCapabilities.canUseTemplates).toBe(true)
    })

    it('should not support attachments or advanced features', () => {
      expect(smsCapabilities.canAttachFiles).toBe(false)
      expect(smsCapabilities.canDraft).toBe(false)
      expect(smsCapabilities.canApplyLabel).toBe(false)
      expect(smsCapabilities.labelScope).toBe('none')
    })

    it('should have message length metadata', () => {
      expect(smsCapabilities.metadata?.maxMessageLength).toBe(160)
      expect(smsCapabilities.metadata?.supportsUnicode).toBe(true)
    })

    it('OpenPhone should have extended capabilities', () => {
      expect(openPhoneCapabilities.metadata?.maxMessageLength).toBe(160)
      expect(openPhoneCapabilities.metadata?.supportsUnicode).toBe(true)
    })
  })

  describe('WhatsApp Provider Capabilities', () => {
    const whatsappCapabilities = PROVIDER_CAPABILITIES[IntegrationProviderType.whatsapp]

    it('should support messaging with attachments', () => {
      expect(whatsappCapabilities.canSend).toBe(true)
      expect(whatsappCapabilities.canReply).toBe(true)
      expect(whatsappCapabilities.canForward).toBe(true)
      expect(whatsappCapabilities.canAttachFiles).toBe(true)
      expect(whatsappCapabilities.maxAttachmentSize).toBe(16 * 1024 * 1024) // 16MB
    })

    it('should support conversation labels but not creation', () => {
      expect(whatsappCapabilities.canApplyLabel).toBe(true)
      expect(whatsappCapabilities.canRemoveLabel).toBe(true)
      expect(whatsappCapabilities.canCreateLabel).toBe(false)
      expect(whatsappCapabilities.labelScope).toBe('conversation')
    })

    it('should support templates and read receipts', () => {
      expect(whatsappCapabilities.canUseTemplates).toBe(true)
      expect(whatsappCapabilities.canTrackOpens).toBe(true)
    })
  })

  describe('Shopify Provider Capabilities', () => {
    const shopifyCapabilities = PROVIDER_CAPABILITIES[IntegrationProviderType.shopify]

    it('should not support any messaging operations', () => {
      expect(shopifyCapabilities.canSend).toBe(false)
      expect(shopifyCapabilities.canReply).toBe(false)
      expect(shopifyCapabilities.canApplyLabel).toBe(false)
      expect(shopifyCapabilities.canManageThreads).toBe(false)
    })

    it('should be identified as a data provider', () => {
      expect(shopifyCapabilities.metadata?.isDataProvider).toBe(true)
      expect(shopifyCapabilities.metadata?.providesOrderData).toBe(true)
      expect(shopifyCapabilities.metadata?.providesCustomerData).toBe(true)
    })
  })

  describe('Outlook Provider Capabilities', () => {
    const outlookCapabilities = PROVIDER_CAPABILITIES[IntegrationProviderType.outlook]

    it('should support full email operations like Gmail', () => {
      expect(outlookCapabilities.canSend).toBe(true)
      expect(outlookCapabilities.canReply).toBe(true)
      expect(outlookCapabilities.canForward).toBe(true)
      expect(outlookCapabilities.canDraft).toBe(true)
      expect(outlookCapabilities.canScheduleSend).toBe(true) // Outlook-specific
    })

    it('should support message-level labels (categories)', () => {
      expect(outlookCapabilities.canApplyLabel).toBe(true)
      expect(outlookCapabilities.canRemoveLabel).toBe(true)
      expect(outlookCapabilities.canCreateLabel).toBe(true)
      expect(outlookCapabilities.labelScope).toBe('message')
    })
  })

  describe('Helper Functions', () => {
    describe('getProviderCapabilities', () => {
      it('should return capabilities for valid provider types', () => {
        const capabilities = getProviderCapabilities(IntegrationProviderType.email)
        expect(capabilities).toBeDefined()
        expect(capabilities.canSend).toBe(true)
      })

      it('should return default minimal capabilities for unknown provider', () => {
        const capabilities = getProviderCapabilities(
          'unknown' as keyof typeof IntegrationProviderType
        )
        expect(capabilities).toBeDefined()
        expect(capabilities.canSend).toBe(false)
        expect(capabilities.labelScope).toBe('none')
      })
    })
  })

  describe('Cross-Provider Consistency', () => {
    it('should have consistent label scope definitions', () => {
      const validScopes = ['none', 'message', 'thread', 'conversation']

      Object.values(PROVIDER_CAPABILITIES).forEach((capabilities) => {
        expect(validScopes).toContain(capabilities.labelScope)
      })
    })

    it('should have logical capability combinations', () => {
      Object.entries(PROVIDER_CAPABILITIES).forEach(([providerType, capabilities]) => {
        // If can't apply labels, scope should be 'none'
        if (!capabilities.canApplyLabel) {
          expect(capabilities.labelScope).toBe('none')
        }

        // If can't attach files, shouldn't have attachment size limits
        if (!capabilities.canAttachFiles) {
          expect(capabilities.maxAttachmentSize).toBeUndefined()
        }

        // If can't send, shouldn't be able to reply or forward
        if (!capabilities.canSend) {
          expect(capabilities.canReply).toBe(false)
          expect(capabilities.canForward).toBe(false)
        }

        // If can't manage threads, shouldn't support bulk operations
        // Exception: mailgun is a bulk email service that supports bulk sends
        // without thread management
        if (!capabilities.canManageThreads && providerType !== 'mailgun') {
          expect(capabilities.canBulkOperations).toBe(false)
        }
      })
    })
  })

  describe('Action Type Coverage', () => {
    it('should cover all common action types', () => {
      const providerRegistry = new ProviderRegistryService('test-org')
      const commonActions = [
        'SEND_MESSAGE',
        'REPLY',
        'FORWARD',
        'DRAFT_EMAIL',
        'APPLY_LABEL',
        'REMOVE_LABEL',
        'ARCHIVE',
        'MARK_SPAM',
        'MARK_TRASH',
        'ASSIGN_THREAD',
        'ARCHIVE_THREAD',
        'UNARCHIVE_THREAD',
        'MOVE_TO_TRASH',
        'REACT_TO_MESSAGE',
        'SHARE_MESSAGE',
      ]

      // Test that each action can be checked against each provider
      commonActions.forEach((action) => {
        Object.keys(PROVIDER_CAPABILITIES).forEach((providerType) => {
          expect(() => {
            providerRegistry.isActionSupportedByProvider(
              action,
              providerType as keyof typeof IntegrationProviderType
            )
          }).not.toThrow()
        })
      })
    })
  })
})
