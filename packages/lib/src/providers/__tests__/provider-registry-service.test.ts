// packages/lib/src/providers/__tests__/provider-registry-service.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted ensures these values are available when vi.mock factories run (hoisted above imports).
// ALL variables referenced inside vi.mock factories MUST be declared here.
const {
  IntegrationAuthStatus,
  IntegrationProviderType,
  mockIntegrationSchema,
  mockOrderBy,
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  createChain,
} = vi.hoisted(() => {
  // Recursive chainable fallback for transitive module-level prepared statements
  function createChain(): any {
    const fn = (..._args: any[]) => createChain()
    return new Proxy(fn, {
      get: (_target, prop) => {
        if (prop === 'then') return undefined
        return createChain()
      },
    })
  }

  const IntegrationAuthStatus = {
    AUTHENTICATED: 'AUTHENTICATED',
    UNAUTHENTICATED: 'UNAUTHENTICATED',
    ERROR: 'ERROR',
    INVALID_GRANT: 'INVALID_GRANT',
    EXPIRED_TOKEN: 'EXPIRED_TOKEN',
    REVOKED_ACCESS: 'REVOKED_ACCESS',
    INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
    RATE_LIMITED: 'RATE_LIMITED',
    PROVIDER_ERROR: 'PROVIDER_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  } as const

  const IntegrationProviderType = {
    google: 'google',
    outlook: 'outlook',
    facebook: 'facebook',
    instagram: 'instagram',
    openphone: 'openphone',
    mailgun: 'mailgun',
    sms: 'sms',
    whatsapp: 'whatsapp',
    chat: 'chat',
    email: 'email',
    shopify: 'shopify',
  } as const

  // Provide a minimal stand-in for schema.Integration column references.
  const mockIntegrationSchema = {
    id: 'Integration.id',
    organizationId: 'Integration.organizationId',
    enabled: 'Integration.enabled',
    provider: 'Integration.provider',
    updatedAt: 'Integration.updatedAt',
    metadata: 'Integration.metadata',
    authStatus: 'Integration.authStatus',
  }

  // Build a Drizzle select-builder mock chain.
  const mockOrderBy = vi.fn()
  const mockLimit = vi.fn()
  const mockWhere = vi.fn()
  const mockFrom = vi.fn()
  // Default to chainable proxy so module-level prepared statements don't crash
  const mockSelect = vi.fn().mockReturnValue(createChain())

  return {
    IntegrationAuthStatus,
    IntegrationProviderType,
    mockIntegrationSchema,
    mockOrderBy,
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    createChain,
  }
})

// Mock @auxx/database/enums before any imports that use it
vi.mock('@auxx/database/enums', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@auxx/database/enums')>()
  return {
    ...actual,
    IntegrationAuthStatus,
    IntegrationProviderType,
    IntegrationProviderTypeValues: Object.values(IntegrationProviderType),
    IntegrationAuthStatusValues: Object.values(IntegrationAuthStatus),
  }
})

import { ProviderRegistryService } from '../provider-registry-service'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock logger
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

/**
 * Wire up the chain so each builder method returns the next.
 * `terminalValue` is what the final awaited value should be.
 */
function setupSelectChain(terminalValue: unknown[]) {
  mockOrderBy.mockResolvedValue(terminalValue)
  mockLimit.mockResolvedValue(terminalValue)
  mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit })
  mockFrom.mockReturnValue({ where: mockWhere })
  mockSelect.mockReturnValue({ from: mockFrom })
}

vi.mock('@auxx/database', () => ({
  database: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
  schema: {
    Integration: mockIntegrationSchema,
    User: { id: 'User.id' },
    Organization: { id: 'Organization.id' },
  },
}))

// Mock drizzle-orm operators — these are called by the source but we don't
// need them to do anything meaningful in tests.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => col),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('../google/google-provider', () => {
  return {
    GoogleProvider: class {
      initialize = vi.fn().mockResolvedValue(undefined)
      send = vi.fn()
      reply = vi.fn()
    },
  }
})

vi.mock('../outlook/outlook-provider', () => {
  return {
    OutlookProvider: class {
      initialize = vi.fn().mockResolvedValue(undefined)
      send = vi.fn()
      reply = vi.fn()
    },
  }
})

vi.mock('../facebook/facebook-provider', () => {
  return {
    FacebookProvider: class {
      initialize = vi.fn().mockResolvedValue(undefined)
      send = vi.fn()
      reply = vi.fn()
    },
  }
})

vi.mock('../instagram/instagram-provider', () => {
  return {
    InstagramProvider: class {
      initialize = vi.fn().mockResolvedValue(undefined)
      send = vi.fn()
      reply = vi.fn()
    },
  }
})

vi.mock('../openphone/openphone-provider', () => {
  return {
    OpenPhoneProvider: class {
      initialize = vi.fn().mockResolvedValue(undefined)
      send = vi.fn()
      reply = vi.fn()
    },
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'test-org-id'

/** Creates a fake integration row as the DB would return. */
function makeIntegrationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'integration-1',
    organizationId: ORG_ID,
    provider: 'google',
    enabled: true,
    metadata: { email: 'test@example.com' },
    authStatus: IntegrationAuthStatus.AUTHENTICATED,
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderRegistryService', () => {
  let service: ProviderRegistryService

  beforeEach(() => {
    service = new ProviderRegistryService(ORG_ID)
    vi.clearAllMocks()
    // Restore default chainable return after clearAllMocks wipes it
    mockSelect.mockReturnValue(createChain())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // getAllIntegrations
  // -------------------------------------------------------------------------
  describe('getAllIntegrations', () => {
    it('should return active integrations with correct format', async () => {
      const rows = [
        makeIntegrationRow({
          id: 'int-1',
          provider: 'google',
          metadata: { email: 'alice@example.com' },
        }),
        makeIntegrationRow({
          id: 'int-2',
          provider: 'facebook',
          metadata: { pageId: 'page-abc' },
        }),
      ]
      setupSelectChain(rows)

      const result = await service.getAllIntegrations()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        type: IntegrationProviderType.google,
        id: 'int-1',
        details: { identifier: 'alice@example.com', provider: 'google' },
        metadata: { email: 'alice@example.com' },
      })
      expect(result[1]).toEqual({
        type: IntegrationProviderType.facebook,
        id: 'int-2',
        details: { identifier: 'page-abc', provider: 'facebook' },
        metadata: { pageId: 'page-abc' },
      })
    })

    it('should extract phoneNumber identifier from metadata', async () => {
      const rows = [
        makeIntegrationRow({
          id: 'int-phone',
          provider: 'openphone',
          metadata: { phoneNumber: '+15551234567' },
        }),
      ]
      setupSelectChain(rows)

      const result = await service.getAllIntegrations()

      expect(result).toHaveLength(1)
      expect(result[0].details.identifier).toBe('+15551234567')
    })

    it('should filter out unknown provider types', async () => {
      const rows = [
        makeIntegrationRow({ id: 'int-1', provider: 'google' }),
        makeIntegrationRow({ id: 'int-2', provider: 'unknown-provider' }),
      ]
      setupSelectChain(rows)

      const result = await service.getAllIntegrations()

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('int-1')
    })

    it('should return an empty array when no integrations exist', async () => {
      setupSelectChain([])

      const result = await service.getAllIntegrations()

      expect(result).toHaveLength(0)
    })

    it('should propagate database errors', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockRejectedValue(new Error('DB connection lost')),
          }),
        }),
      })

      await expect(service.getAllIntegrations()).rejects.toThrow('DB connection lost')
    })
  })

  // -------------------------------------------------------------------------
  // initializeAll
  // -------------------------------------------------------------------------
  describe('initializeAll', () => {
    it('should initialize providers for all active integrations', async () => {
      const rows = [
        makeIntegrationRow({ id: 'int-1', provider: 'google' }),
        makeIntegrationRow({ id: 'int-2', provider: 'outlook' }),
      ]
      setupSelectChain(rows)

      await service.initializeAll()

      const instances = service.getAllProviderInstances()
      expect(instances).toHaveLength(2)
      expect(instances.map((i) => i.integrationId).sort()).toEqual(['int-1', 'int-2'])
    })

    it('should not throw when no active integrations exist', async () => {
      setupSelectChain([])

      await expect(service.initializeAll()).resolves.not.toThrow()
      expect(service.getAllProviderInstances()).toHaveLength(0)
    })

    it('should continue initializing when one provider fails', async () => {
      const rows = [
        makeIntegrationRow({ id: 'int-fail', provider: 'google' }),
        makeIntegrationRow({ id: 'int-ok', provider: 'outlook' }),
      ]
      setupSelectChain(rows)

      // Temporarily replace GoogleProvider to make initialize throw
      const googleModule = await import('../google/google-provider')
      const OriginalGoogleProvider = googleModule.GoogleProvider
      const failingProvider = {
        initialize: vi.fn().mockRejectedValue(new Error('Google auth failed')),
        send: vi.fn(),
        reply: vi.fn(),
      }
      ;(googleModule as any).GoogleProvider = class {
        initialize = failingProvider.initialize
        send = failingProvider.send
        reply = failingProvider.reply
      }

      await expect(service.initializeAll()).resolves.not.toThrow()

      // Restore original mock
      ;(googleModule as any).GoogleProvider = OriginalGoogleProvider

      // Only the outlook provider should be cached
      const instances = service.getAllProviderInstances()
      expect(instances).toHaveLength(1)
      expect(instances[0].integrationId).toBe('int-ok')
    })

    it('should clear previously cached providers before re-initializing', async () => {
      // First initialization
      setupSelectChain([makeIntegrationRow({ id: 'int-1', provider: 'google' })])
      await service.initializeAll()
      expect(service.getAllProviderInstances()).toHaveLength(1)

      // Second initialization with different integrations
      setupSelectChain([makeIntegrationRow({ id: 'int-2', provider: 'outlook' })])
      await service.initializeAll()

      const instances = service.getAllProviderInstances()
      expect(instances).toHaveLength(1)
      expect(instances[0].integrationId).toBe('int-2')
    })
  })

  // -------------------------------------------------------------------------
  // getProvider
  // -------------------------------------------------------------------------
  describe('getProvider', () => {
    it('should fetch, initialize and cache a provider by integrationId', async () => {
      const row = makeIntegrationRow({
        id: 'int-gp',
        provider: 'google',
        metadata: { email: 'g@example.com' },
      })
      setupSelectChain([row])

      const provider = await service.getProvider('int-gp')

      expect(provider).toBeDefined()
      expect(provider.initialize).toHaveBeenCalledWith('int-gp')

      // Calling again should return cached provider without a new DB call
      vi.clearAllMocks()
      const cached = await service.getProvider('int-gp')
      expect(cached).toBe(provider)
      expect(mockSelect).not.toHaveBeenCalled()
    })

    it('should throw when the integration is not found in the database', async () => {
      setupSelectChain([])

      await expect(service.getProvider('non-existent')).rejects.toThrow(
        'Integration non-existent not found'
      )
    })

    it('should throw when the integration has an unknown provider type', async () => {
      const row = makeIntegrationRow({ id: 'int-unk', provider: 'carrier-pigeon' })
      setupSelectChain([row])

      await expect(service.getProvider('int-unk')).rejects.toThrow(
        'Unknown provider type: carrier-pigeon'
      )
    })

    it('should throw when integration requires re-authentication (INVALID_GRANT)', async () => {
      const row = makeIntegrationRow({
        id: 'int-reauth',
        provider: 'google',
        authStatus: IntegrationAuthStatus.INVALID_GRANT,
      })
      setupSelectChain([row])

      await expect(service.getProvider('int-reauth')).rejects.toThrow('requires re-authentication')
    })

    it('should throw when integration requires re-authentication (REVOKED_ACCESS)', async () => {
      const row = makeIntegrationRow({
        id: 'int-revoked',
        provider: 'google',
        authStatus: IntegrationAuthStatus.REVOKED_ACCESS,
      })
      setupSelectChain([row])

      await expect(service.getProvider('int-revoked')).rejects.toThrow('requires re-authentication')
    })

    it('should throw when integration requires re-authentication (INSUFFICIENT_SCOPE)', async () => {
      const row = makeIntegrationRow({
        id: 'int-scope',
        provider: 'outlook',
        authStatus: IntegrationAuthStatus.INSUFFICIENT_SCOPE,
      })
      setupSelectChain([row])

      await expect(service.getProvider('int-scope')).rejects.toThrow('requires re-authentication')
    })

    it('should allow getting provider for disabled integrations', async () => {
      const row = makeIntegrationRow({
        id: 'int-disabled',
        provider: 'google',
        enabled: false,
      })
      setupSelectChain([row])

      const provider = await service.getProvider('int-disabled')

      expect(provider).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // getProviderCapabilities / providerSupportsCapability
  // -------------------------------------------------------------------------
  describe('getProviderCapabilities', () => {
    it('should return capabilities for google', () => {
      const caps = service.getProviderCapabilities(IntegrationProviderType.google)
      expect(caps.canSend).toBe(true)
      expect(caps.canReply).toBe(true)
      expect(caps.canDraft).toBe(true)
      expect(caps.labelScope).toBe('thread')
      expect(caps.canReact).toBe(false)
    })

    it('should return capabilities for facebook', () => {
      const caps = service.getProviderCapabilities(IntegrationProviderType.facebook)
      expect(caps.canSend).toBe(true)
      expect(caps.canReact).toBe(true)
      expect(caps.canForward).toBe(false)
      expect(caps.labelScope).toBe('conversation')
    })

    it('should return capabilities for instagram', () => {
      const caps = service.getProviderCapabilities(IntegrationProviderType.instagram)
      expect(caps.canSend).toBe(true)
      expect(caps.canApplyLabel).toBe(false)
      expect(caps.labelScope).toBe('none')
      expect(caps.canReact).toBe(true)
      expect(caps.canShare).toBe(true)
    })

    it('should return capabilities for openphone (sms-like)', () => {
      const caps = service.getProviderCapabilities(IntegrationProviderType.openphone)
      expect(caps.canSend).toBe(true)
      expect(caps.canAttachFiles).toBe(false)
      expect(caps.canDraft).toBe(false)
    })

    it('should return capabilities for outlook', () => {
      const caps = service.getProviderCapabilities(IntegrationProviderType.outlook)
      expect(caps.canSend).toBe(true)
      expect(caps.labelScope).toBe('message')
      expect(caps.canScheduleSend).toBe(true)
    })
  })

  describe('providerSupportsCapability', () => {
    it('should return true for boolean capabilities that are true', () => {
      expect(service.providerSupportsCapability(IntegrationProviderType.google, 'canSend')).toBe(
        true
      )
    })

    it('should return false for boolean capabilities that are false', () => {
      expect(service.providerSupportsCapability(IntegrationProviderType.google, 'canReact')).toBe(
        false
      )
    })

    it('should return true for non-"none" string capabilities', () => {
      // google labelScope = 'thread'
      expect(service.providerSupportsCapability(IntegrationProviderType.google, 'labelScope')).toBe(
        true
      )
    })

    it('should return false when labelScope is "none"', () => {
      // instagram labelScope = 'none'
      expect(
        service.providerSupportsCapability(IntegrationProviderType.instagram, 'labelScope')
      ).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // providerSupportsAction / isActionSupportedByProvider
  // -------------------------------------------------------------------------
  describe('providerSupportsAction', () => {
    it('should return true for supported actions', async () => {
      expect(
        await service.providerSupportsAction(
          IntegrationProviderType.google,
          'int-1',
          'SEND_MESSAGE'
        )
      ).toBe(true)
    })

    it('should return false for unsupported actions', async () => {
      // instagram does not support APPLY_LABEL
      expect(
        await service.providerSupportsAction(
          IntegrationProviderType.instagram,
          'int-ig',
          'APPLY_LABEL'
        )
      ).toBe(false)
    })

    it('should return true for actions not in the action map (universal actions)', async () => {
      expect(
        await service.providerSupportsAction(
          IntegrationProviderType.instagram,
          'int-ig',
          'APPLY_TAG'
        )
      ).toBe(true)
    })
  })

  describe('isActionSupportedByProvider', () => {
    it('should return true for SEND_MESSAGE on google', () => {
      expect(
        service.isActionSupportedByProvider('SEND_MESSAGE', IntegrationProviderType.google)
      ).toBe(true)
    })

    it('should return false for DRAFT_EMAIL on openphone', () => {
      expect(
        service.isActionSupportedByProvider('DRAFT_EMAIL', IntegrationProviderType.openphone)
      ).toBe(false)
    })

    it('should return true for unknown action types (universal)', () => {
      expect(
        service.isActionSupportedByProvider('CUSTOM_ACTION', IntegrationProviderType.google)
      ).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // validateProviderAction
  // -------------------------------------------------------------------------
  describe('validateProviderAction', () => {
    it('should allow supported actions', async () => {
      const result = await service.validateProviderAction(
        IntegrationProviderType.google,
        'int-1',
        'SEND_MESSAGE'
      )
      expect(result.canPerform).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should reject unsupported actions and suggest alternatives', async () => {
      const result = await service.validateProviderAction(
        IntegrationProviderType.instagram,
        'int-ig',
        'APPLY_LABEL'
      )
      expect(result.canPerform).toBe(false)
      expect(result.reason).toContain('does not support APPLY_LABEL')
      expect(result.alternatives).toContain('APPLY_TAG')
    })

    it('should reject message-level labels for providers with conversation labelScope', async () => {
      // facebook labelScope = 'conversation', so message-level label is invalid
      const result = await service.validateProviderAction(
        IntegrationProviderType.facebook,
        'int-fb',
        'APPLY_LABEL',
        { targetType: 'message' }
      )
      expect(result.canPerform).toBe(false)
      expect(result.reason).toContain('does not support message-level labels')
      expect(result.alternatives).toContain('APPLY_TAG')
    })

    it('should reject conversation-level labels for providers with message labelScope', async () => {
      // outlook labelScope = 'message', so conversation scope not supported
      const result = await service.validateProviderAction(
        IntegrationProviderType.outlook,
        'int-ol',
        'APPLY_LABEL',
        { targetType: 'conversation' }
      )
      expect(result.canPerform).toBe(false)
      expect(result.reason).toContain('only supports message-level labels')
    })

    it('should reject attachments for providers that do not support them', async () => {
      // openphone canAttachFiles = false
      const result = await service.validateProviderAction(
        IntegrationProviderType.openphone,
        'int-op',
        'SEND_MESSAGE',
        { attachments: [{ size: 1024 }] }
      )
      expect(result.canPerform).toBe(false)
      expect(result.reason).toContain('does not support attachments')
    })

    it('should reject attachments that exceed the size limit', async () => {
      // google maxAttachmentSize = 25MB
      const result = await service.validateProviderAction(
        IntegrationProviderType.google,
        'int-g',
        'SEND_MESSAGE',
        { attachments: [{ size: 30 * 1024 * 1024 }] }
      )
      expect(result.canPerform).toBe(false)
      expect(result.reason).toContain('exceeds')
      expect(result.alternatives).toContain('Reduce attachment size')
    })

    it('should allow attachments within the size limit', async () => {
      const result = await service.validateProviderAction(
        IntegrationProviderType.google,
        'int-g',
        'SEND_MESSAGE',
        { attachments: [{ size: 1024 }] }
      )
      expect(result.canPerform).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // getProvidersWithCapability
  // -------------------------------------------------------------------------
  describe('getProvidersWithCapability', () => {
    it('should return only providers that support the given capability', async () => {
      // Initialize with google (canReact=false) and facebook (canReact=true)
      const rows = [
        makeIntegrationRow({ id: 'int-g', provider: 'google' }),
        makeIntegrationRow({ id: 'int-fb', provider: 'facebook' }),
      ]
      setupSelectChain(rows)
      await service.initializeAll()

      const providers = await service.getProvidersWithCapability('canReact')

      expect(providers).toHaveLength(1)
      expect(providers[0].integrationId).toBe('int-fb')
      expect(providers[0].type).toBe(IntegrationProviderType.facebook)
    })

    it('should return empty array when no providers support the capability', async () => {
      const rows = [makeIntegrationRow({ id: 'int-g', provider: 'google' })]
      setupSelectChain(rows)
      await service.initializeAll()

      const providers = await service.getProvidersWithCapability('canReact')

      expect(providers).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getBestProviderForAction
  // -------------------------------------------------------------------------
  describe('getBestProviderForAction', () => {
    it('should return the first provider that supports the action', async () => {
      const rows = [
        makeIntegrationRow({ id: 'int-g', provider: 'google' }),
        makeIntegrationRow({ id: 'int-ol', provider: 'outlook' }),
      ]
      setupSelectChain(rows)
      await service.initializeAll()

      const result = await service.getBestProviderForAction('SEND_MESSAGE')

      expect(result).not.toBeNull()
      expect(result!.integrationId).toBe('int-g')
    })

    it('should return null when no providers support the action', async () => {
      // Instagram does not support DRAFT_EMAIL
      const rows = [makeIntegrationRow({ id: 'int-ig', provider: 'instagram' })]
      setupSelectChain(rows)
      await service.initializeAll()

      const result = await service.getBestProviderForAction('DRAFT_EMAIL')

      expect(result).toBeNull()
    })

    it('should return null when no providers are initialized', async () => {
      const result = await service.getBestProviderForAction('SEND_MESSAGE')

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getAllProviderInstances
  // -------------------------------------------------------------------------
  describe('getAllProviderInstances', () => {
    it('should return all cached provider instances', async () => {
      const rows = [
        makeIntegrationRow({ id: 'int-1', provider: 'google' }),
        makeIntegrationRow({ id: 'int-2', provider: 'facebook' }),
        makeIntegrationRow({ id: 'int-3', provider: 'outlook' }),
      ]
      setupSelectChain(rows)
      await service.initializeAll()

      const instances = service.getAllProviderInstances()

      expect(instances).toHaveLength(3)
      for (const instance of instances) {
        expect(instance).toHaveProperty('provider')
        expect(instance).toHaveProperty('type')
        expect(instance).toHaveProperty('integrationId')
        expect(instance).toHaveProperty('details')
      }
    })

    it('should return empty array before any initialization', () => {
      expect(service.getAllProviderInstances()).toHaveLength(0)
    })
  })
})
