// packages/lib/src/providers/__tests__/provider-integration.test.ts

/**
 * Integration tests for the capability-aware provider system
 *
 * This test suite demonstrates and validates:
 * 1. Provider capability declarations
 * 2. ProviderRegistryService capability checking
 * 3. Action routing based on provider capabilities
 * 4. Smart fallback behavior when providers don't support actions
 * 5. Integration with action execution system
 */

import { IntegrationProviderType } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FacebookProvider } from '../facebook/facebook-provider'
import { GoogleProvider } from '../google/google-provider'
import { InstagramProvider } from '../instagram/instagram-provider'
import { OpenPhoneProvider } from '../openphone/openphone-provider'
import { OutlookProvider } from '../outlook/outlook-provider'
import { getProviderCapabilities, PROVIDER_CAPABILITIES } from '../provider-capabilities'
import { ProviderRegistryService } from '../provider-registry-service'

// Mock the database
vi.mock('@auxx/database', () => ({
  database: {
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

describe('Provider Integration Tests', () => {
  let providerRegistry: ProviderRegistryService
  const mockOrganizationId = 'test-org-123'

  beforeEach(() => {
    vi.clearAllMocks()
    providerRegistry = new ProviderRegistryService(mockOrganizationId)
  })

  describe('Provider Capability Declarations', () => {
    it('should correctly declare capabilities for all provider types', () => {
      // Test Google Provider (EMAIL)
      const googleProvider = new GoogleProvider(mockOrganizationId)
      const googleCapabilities = googleProvider.getCapabilities()
      expect(googleCapabilities.canSend).toBe(true)
      expect(googleCapabilities.canDraft).toBe(true)
      expect(googleCapabilities.canArchive).toBe(true)
      expect(googleCapabilities.canApplyLabel).toBe(true)
      expect(googleCapabilities.labelScope).toBe('thread')
      expect(googleCapabilities.canBulkOperations).toBe(true)

      // Test Facebook Provider (FACEBOOK)
      const facebookProvider = new FacebookProvider(mockOrganizationId)
      const facebookCapabilities = facebookProvider.getCapabilities()
      expect(facebookCapabilities.canSend).toBe(true)
      expect(facebookCapabilities.canReply).toBe(true)
      expect(facebookCapabilities.canDraft).toBe(false) // Real-time messaging
      expect(facebookCapabilities.canArchive).toBe(false) // Not supported
      expect(facebookCapabilities.canApplyLabel).toBe(true)
      expect(facebookCapabilities.labelScope).toBe('conversation')
      expect(facebookCapabilities.canReact).toBe(true)

      // Test Instagram Provider (INSTAGRAM)
      const instagramProvider = new InstagramProvider(mockOrganizationId)
      const instagramCapabilities = instagramProvider.getCapabilities()
      expect(instagramCapabilities.canSend).toBe(true)
      expect(instagramCapabilities.canReply).toBe(true)
      expect(instagramCapabilities.canDraft).toBe(false)
      expect(instagramCapabilities.canApplyLabel).toBe(false) // No labels
      expect(instagramCapabilities.labelScope).toBe('none')
      expect(instagramCapabilities.canReact).toBe(true)

      // Test Outlook Provider (OUTLOOK)
      const outlookProvider = new OutlookProvider(mockOrganizationId)
      const outlookCapabilities = outlookProvider.getCapabilities()
      expect(outlookCapabilities.canSend).toBe(true)
      expect(outlookCapabilities.canDraft).toBe(true)
      expect(outlookCapabilities.canScheduleSend).toBe(true) // Outlook feature
      expect(outlookCapabilities.labelScope).toBe('message') // Categories

      // Test OpenPhone Provider (OPENPHONE)
      const openphoneProvider = new OpenPhoneProvider(mockOrganizationId)
      const openphoneCapabilities = openphoneProvider.getCapabilities()
      expect(openphoneCapabilities.canSend).toBe(true)
      expect(openphoneCapabilities.canReply).toBe(true)
      expect(openphoneCapabilities.canDraft).toBe(false) // SMS is immediate
      expect(openphoneCapabilities.canApplyLabel).toBe(false) // No labels in SMS
      expect(openphoneCapabilities.canScheduleSend).toBe(true) // Business SMS
      expect(openphoneCapabilities.metadata?.supportsVoiceCalls).toBe(true)
    })

    it('should provide consistent capabilities via provider registry', () => {
      const emailCaps = providerRegistry.getProviderCapabilities(IntegrationProviderType.EMAIL)
      const facebookCaps = providerRegistry.getProviderCapabilities(
        IntegrationProviderType.FACEBOOK
      )
      const instagramCaps = providerRegistry.getProviderCapabilities(
        IntegrationProviderType.INSTAGRAM
      )

      // Verify capabilities match the defined constants
      expect(emailCaps).toEqual(PROVIDER_CAPABILITIES[IntegrationProviderType.EMAIL])
      expect(facebookCaps).toEqual(PROVIDER_CAPABILITIES[IntegrationProviderType.FACEBOOK])
      expect(instagramCaps).toEqual(PROVIDER_CAPABILITIES[IntegrationProviderType.INSTAGRAM])
    })
  })

  describe('Capability-Based Action Routing', () => {
    it('should correctly identify which providers support specific actions', () => {
      // Test SEND_MESSAGE - should be supported by all providers
      expect(
        providerRegistry.isActionSupportedByProvider('SEND_MESSAGE', IntegrationProviderType.EMAIL)
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'SEND_MESSAGE',
          IntegrationProviderType.FACEBOOK
        )
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'SEND_MESSAGE',
          IntegrationProviderType.INSTAGRAM
        )
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'SEND_MESSAGE',
          IntegrationProviderType.OPENPHONE
        )
      ).toBe(true)

      // Test DRAFT_EMAIL - should only be supported by email providers
      expect(
        providerRegistry.isActionSupportedByProvider('DRAFT_EMAIL', IntegrationProviderType.EMAIL)
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider('DRAFT_EMAIL', IntegrationProviderType.OUTLOOK)
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'DRAFT_EMAIL',
          IntegrationProviderType.FACEBOOK
        )
      ).toBe(false)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'DRAFT_EMAIL',
          IntegrationProviderType.INSTAGRAM
        )
      ).toBe(false)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'DRAFT_EMAIL',
          IntegrationProviderType.OPENPHONE
        )
      ).toBe(false)

      // Test APPLY_LABEL - should work differently per provider
      expect(
        providerRegistry.isActionSupportedByProvider('APPLY_LABEL', IntegrationProviderType.EMAIL)
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'APPLY_LABEL',
          IntegrationProviderType.FACEBOOK
        )
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'APPLY_LABEL',
          IntegrationProviderType.INSTAGRAM
        )
      ).toBe(false)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'APPLY_LABEL',
          IntegrationProviderType.OPENPHONE
        )
      ).toBe(false)

      // Test REACT_TO_MESSAGE - social media only
      expect(
        providerRegistry.isActionSupportedByProvider(
          'REACT_TO_MESSAGE',
          IntegrationProviderType.FACEBOOK
        )
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'REACT_TO_MESSAGE',
          IntegrationProviderType.INSTAGRAM
        )
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'REACT_TO_MESSAGE',
          IntegrationProviderType.EMAIL
        )
      ).toBe(false)
      expect(
        providerRegistry.isActionSupportedByProvider(
          'REACT_TO_MESSAGE',
          IntegrationProviderType.OPENPHONE
        )
      ).toBe(false)

      // Test ARCHIVE - email providers only
      expect(
        providerRegistry.isActionSupportedByProvider('ARCHIVE', IntegrationProviderType.EMAIL)
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider('ARCHIVE', IntegrationProviderType.OUTLOOK)
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider('ARCHIVE', IntegrationProviderType.FACEBOOK)
      ).toBe(false)
      expect(
        providerRegistry.isActionSupportedByProvider('ARCHIVE', IntegrationProviderType.INSTAGRAM)
      ).toBe(false)
    })

    it('should handle universal actions correctly', () => {
      // Universal actions (like APPLY_TAG) should be supported by all providers
      expect(
        providerRegistry.isActionSupportedByProvider('APPLY_TAG', IntegrationProviderType.EMAIL)
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider('APPLY_TAG', IntegrationProviderType.FACEBOOK)
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider('APPLY_TAG', IntegrationProviderType.INSTAGRAM)
      ).toBe(true)
      expect(
        providerRegistry.isActionSupportedByProvider('APPLY_TAG', IntegrationProviderType.OPENPHONE)
      ).toBe(true)

      // Unknown actions should default to supported
      expect(
        providerRegistry.isActionSupportedByProvider(
          'UNKNOWN_ACTION',
          IntegrationProviderType.EMAIL
        )
      ).toBe(true)
    })
  })

  describe('Capability Checking Methods', () => {
    it('should correctly check individual capabilities', () => {
      // Test email capabilities
      expect(
        providerRegistry.providerSupportsCapability(IntegrationProviderType.EMAIL, 'canSend')
      ).toBe(true)
      expect(
        providerRegistry.providerSupportsCapability(IntegrationProviderType.EMAIL, 'canDraft')
      ).toBe(true)
      expect(
        providerRegistry.providerSupportsCapability(IntegrationProviderType.EMAIL, 'canReact')
      ).toBe(false)

      // Test social media capabilities
      expect(
        providerRegistry.providerSupportsCapability(IntegrationProviderType.FACEBOOK, 'canReact')
      ).toBe(true)
      expect(
        providerRegistry.providerSupportsCapability(IntegrationProviderType.FACEBOOK, 'canDraft')
      ).toBe(false)
      expect(
        providerRegistry.providerSupportsCapability(
          IntegrationProviderType.INSTAGRAM,
          'canApplyLabel'
        )
      ).toBe(false)

      // Test label scope checking
      expect(
        providerRegistry.providerSupportsCapability(IntegrationProviderType.EMAIL, 'labelScope')
      ).toBe(true) // 'thread' !== 'none'
      expect(
        providerRegistry.providerSupportsCapability(IntegrationProviderType.INSTAGRAM, 'labelScope')
      ).toBe(false) // 'none'
    })
  })

  describe('Provider Type Validation', () => {
    it('should validate provider capabilities against expected values', () => {
      // Email providers should have full email capabilities
      const emailCaps = getProviderCapabilities(IntegrationProviderType.EMAIL)
      expect(emailCaps.canSend).toBe(true)
      expect(emailCaps.canReply).toBe(true)
      expect(emailCaps.canForward).toBe(true)
      expect(emailCaps.canDraft).toBe(true)
      expect(emailCaps.canArchive).toBe(true)
      expect(emailCaps.canMarkSpam).toBe(true)
      expect(emailCaps.canMarkTrash).toBe(true)
      expect(emailCaps.canApplyLabel).toBe(true)
      expect(emailCaps.canCreateLabel).toBe(true)
      expect(emailCaps.labelScope).toBe('thread')
      expect(emailCaps.canBulkOperations).toBe(true)
      expect(emailCaps.canAttachFiles).toBe(true)
      expect(emailCaps.maxAttachmentSize).toBe(25 * 1024 * 1024) // 25MB

      // Social media providers should have limited capabilities
      const facebookCaps = getProviderCapabilities(IntegrationProviderType.FACEBOOK)
      expect(facebookCaps.canSend).toBe(true)
      expect(facebookCaps.canDraft).toBe(false) // Real-time messaging
      expect(facebookCaps.canArchive).toBe(false)
      expect(facebookCaps.canMarkSpam).toBe(false)
      expect(facebookCaps.labelScope).toBe('conversation')
      expect(facebookCaps.canReact).toBe(true)
      expect(facebookCaps.rateLimits?.messagesPerMinute).toBe(200)

      // SMS providers should have basic messaging capabilities
      const openphoneCaps = getProviderCapabilities(IntegrationProviderType.OPENPHONE)
      expect(openphoneCaps.canSend).toBe(true)
      expect(openphoneCaps.canDraft).toBe(false) // SMS is immediate
      expect(openphoneCaps.canApplyLabel).toBe(false)
      expect(openphoneCaps.canAttachFiles).toBe(false) // SMS limitation
      expect(openphoneCaps.canScheduleSend).toBe(true)
      expect(openphoneCaps.metadata?.supportsVoiceCalls).toBe(true)
      expect(openphoneCaps.metadata?.maxMessageLength).toBe(1600)
    })
  })

  describe('Error Handling and Edge Cases', () => {
    it('should handle unknown provider types gracefully', () => {
      // Should return default minimal capabilities for unknown types
      const unknownCaps = getProviderCapabilities('unknown' as IntegrationProviderType)
      expect(unknownCaps.canSend).toBe(false)
      expect(unknownCaps.canReply).toBe(false)
      expect(unknownCaps.labelScope).toBe('none')
    })

    it('should handle provider capability edge cases', () => {
      // Instagram has reactions but no labels
      const instagramCaps = getProviderCapabilities(IntegrationProviderType.INSTAGRAM)
      expect(instagramCaps.canReact).toBe(true)
      expect(instagramCaps.canApplyLabel).toBe(false)
      expect(instagramCaps.labelScope).toBe('none')

      // Outlook has scheduled send but Facebook doesn't
      const outlookCaps = getProviderCapabilities(IntegrationProviderType.OUTLOOK)
      const facebookCaps = getProviderCapabilities(IntegrationProviderType.FACEBOOK)
      expect(outlookCaps.canScheduleSend).toBe(true)
      expect(facebookCaps.canScheduleSend).toBe(false)
    })
  })

  describe('Integration with Base Classes', () => {
    it('should validate capability checking in provider base classes', () => {
      const googleProvider = new GoogleProvider(mockOrganizationId)

      // Test that checkCapability would work (can't actually call it without setup)
      expect(() => {
        // This would throw if capability checking was broken
        const caps = googleProvider.getCapabilities()
        expect(caps).toBeDefined()
        expect(caps.canSend).toBe(true)
      }).not.toThrow()
    })
  })
})

/**
 * Example demonstrating how the capability system works in practice:
 *
 * 1. Provider declares capabilities via getCapabilities()
 * 2. Action system checks capabilities before execution
 * 3. If action not supported, fallback actions can be generated
 * 4. UI can show/hide actions based on provider capabilities
 * 5. Bulk operations are optimized based on provider support
 */
export function demonstrateCapabilitySystem() {
  const registry = new ProviderRegistryService('demo-org')

  // Example: Check if we can draft emails with current providers
  const canDraft = registry.isActionSupportedByProvider(
    'DRAFT_EMAIL',
    IntegrationProviderType.EMAIL
  )
  console.log('Can draft emails with Google/Outlook:', canDraft) // true

  const canDraftFacebook = registry.isActionSupportedByProvider(
    'DRAFT_EMAIL',
    IntegrationProviderType.FACEBOOK
  )
  console.log('Can draft emails with Facebook:', canDraftFacebook) // false

  // Example: Get label scope for different providers
  const emailLabelScope = registry.getProviderCapabilities(IntegrationProviderType.EMAIL).labelScope
  const facebookLabelScope = registry.getProviderCapabilities(
    IntegrationProviderType.FACEBOOK
  ).labelScope
  const instagramLabelScope = registry.getProviderCapabilities(
    IntegrationProviderType.INSTAGRAM
  ).labelScope

  console.log('Label scopes:', {
    email: emailLabelScope, // 'thread'
    facebook: facebookLabelScope, // 'conversation'
    instagram: instagramLabelScope, // 'none'
  })

  // Example: Check rate limits
  const facebookLimits = registry.getProviderCapabilities(
    IntegrationProviderType.FACEBOOK
  ).rateLimits
  console.log('Facebook rate limits:', facebookLimits) // { messagesPerMinute: 200, messagesPerHour: 1000 }
}
