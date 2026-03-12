// packages/lib/src/providers/provider-registry-service.ts
import { database as db, schema } from '@auxx/database'
import {
  IntegrationAuthStatus,
  IntegrationProviderType as IntegrationProviderEnum,
} from '@auxx/database/enums'
import type {
  IntegrationAuthStatus as IntegrationAuthStatusType,
  IntegrationProviderType,
} from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq } from 'drizzle-orm'
import type { ActiveIntegration, ProviderInstance } from '../email/message-service'
import { EmailForwardingProvider } from './email/email-forwarding-provider'
import { FacebookProvider } from './facebook/facebook-provider'
import { GoogleProvider } from './google/google-provider'
import { ImapProvider } from './imap/imap-provider'
import { InstagramProvider } from './instagram/instagram-provider'
import type { IntegrationProvider } from './integration-provider.interface'
import { OpenPhoneProvider } from './openphone/openphone-provider'
import { OutlookProvider } from './outlook/outlook-provider'
import { getProviderCapabilities, type ProviderCapabilities } from './provider-capabilities'

const logger = createScopedLogger('provider-registry-service')

/** Auth statuses that indicate re-authentication is required */
const REQUIRES_REAUTH_STATUSES: IntegrationAuthStatusType[] = [
  IntegrationAuthStatus.INVALID_GRANT,
  IntegrationAuthStatus.REVOKED_ACCESS,
  IntegrationAuthStatus.INSUFFICIENT_SCOPE,
]

/**
 * ProviderRegistryService - Provider management and discovery extracted from MessageService
 *
 * Responsibilities:
 * - Provider instance caching and management
 * - Provider initialization and configuration
 * - Integration discovery and validation
 * - Default provider selection logic
 *
 * Does NOT handle:
 * - Message sending operations
 * - Webhook management
 * - Message synchronization
 * - Database record creation
 */
export class ProviderRegistryService {
  private providers: Map<string, ProviderInstance> = new Map()
  constructor(private organizationId: string) {}
  /**
   * Map string provider names to IntegrationProviderType enum
   */
  private static getProviderTypeMap(): Record<string, IntegrationProviderType> {
    return {
      google: IntegrationProviderEnum.google,
      outlook: IntegrationProviderEnum.outlook,
      facebook: IntegrationProviderEnum.facebook,
      instagram: IntegrationProviderEnum.instagram,
      openphone: IntegrationProviderEnum.openphone,
      mailgun: IntegrationProviderEnum.mailgun,
      imap: IntegrationProviderEnum.imap,
      email: IntegrationProviderEnum.email,
    }
  }
  /**
   * Get identifier from metadata (helper extracted from MessageService)
   */
  private static getIdentifierFromMetadata(metadata: any | null): string | undefined {
    if (metadata && typeof metadata === 'object') {
      if ('email' in metadata && typeof metadata.email === 'string') return metadata.email
      if ('phoneNumber' in metadata && typeof metadata.phoneNumber === 'string')
        return metadata.phoneNumber
      if ('pageId' in metadata && typeof metadata.pageId === 'string') return metadata.pageId
      // Add checks for other identifiers
    }
    return undefined
  }
  /**
   * Get all available and active integrations for an organization
   * Extracted from MessageService.getAllIntegrations
   */
  async getAllIntegrations(): Promise<ActiveIntegration[]> {
    try {
      const integrations: ActiveIntegration[] = []
      // Get all enabled integrations from the Integration table
      const dbIntegrations = await db
        .select()
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.organizationId, this.organizationId),
            eq(schema.Integration.enabled, true)
          )
        )
        .orderBy(desc(schema.Integration.updatedAt))
      const providerTypeMap = ProviderRegistryService.getProviderTypeMap()
      for (const integration of dbIntegrations) {
        // Map string provider to IntegrationProviderType
        const providerType = providerTypeMap[integration.provider]
        if (providerType) {
          const identifier =
            integration.email ||
            ProviderRegistryService.getIdentifierFromMetadata(integration.metadata)
          integrations.push({
            type: providerType,
            id: integration.id,
            details: { identifier: identifier, provider: integration.provider },
            metadata: integration.metadata,
          })
        } else {
          logger.warn(`Skipping unknown integration provider type: ${integration.provider}`, {
            id: integration.id,
          })
        }
      }
      return integrations
    } catch (error) {
      logger.error('Error getting all integrations:', {
        error: error instanceof Error ? error.message : String(error),
        organizationId: this.organizationId,
      })
      throw error
    }
  }
  /**
   * Initialize all active providers for the organization
   * Extracted from MessageService.initializeAll
   */
  async initializeAll(): Promise<void> {
    try {
      this.providers.clear()
      const integrations = await this.getAllIntegrations()
      if (integrations.length === 0) {
        logger.warn('No active integrations found to initialize.', {
          organizationId: this.organizationId,
        })
        return
      }
      // Initialize providers concurrently
      const initPromises = integrations.map((integration) =>
        this.initializeProvider(
          integration.type,
          integration.id,
          integration.details,
          integration.metadata
        ).catch((err) => {
          // Log error but don't let one failed init stop others
          logger.error(`Failed to initialize provider for integration ${integration.id}`, {
            error: err instanceof Error ? err.message : String(err),
          })
          return null // Indicate failure for this specific provider
        })
      )
      await Promise.all(initPromises)
      logger.info('All available providers initialized', {
        count: this.providers.size,
        organizationId: this.organizationId,
      })
    } catch (error) {
      logger.error('Error during provider initialization process:', {
        error: error instanceof Error ? error.message : String(error),
        organizationId: this.organizationId,
      })
    }
  }
  /**
   * Initialize a specific provider instance
   * Extracted from MessageService.initializeProvider
   */
  private async initializeProvider(
    type: IntegrationProviderType,
    integrationId: string,
    details: {
      identifier?: string
      provider: string
    },
    metadata?: any
  ): Promise<IntegrationProvider> {
    const key = `${integrationId}`
    if (this.providers.has(key)) {
      return this.providers.get(key)!.provider
    }
    try {
      let provider: IntegrationProvider
      switch (type) {
        case IntegrationProviderEnum.google:
          provider = new GoogleProvider(this.organizationId)
          break
        case IntegrationProviderEnum.outlook:
          provider = new OutlookProvider(this.organizationId)
          break
        case IntegrationProviderEnum.facebook:
          provider = new FacebookProvider(this.organizationId)
          break
        case IntegrationProviderEnum.instagram:
          provider = new InstagramProvider(this.organizationId)
          break
        case IntegrationProviderEnum.openphone:
          provider = new OpenPhoneProvider(this.organizationId)
          break
        case IntegrationProviderEnum.imap:
          provider = new ImapProvider(this.organizationId)
          break
        case IntegrationProviderEnum.email:
          provider = new EmailForwardingProvider(this.organizationId)
          break
        default:
          logger.error('Attempted to initialize unsupported provider type', { type, integrationId })
          throw new Error(`Unsupported provider type: ${type}`)
      }
      // Initialize the provider with its specific integration ID
      await provider.initialize(integrationId)
      // Store the initialized provider instance
      this.providers.set(key, { provider, type, integrationId, details, metadata })
      logger.info(`Provider initialized: ${type} for integration ${integrationId}`)
      return provider
    } catch (error) {
      logger.error('Error initializing provider:', {
        error: error instanceof Error ? error.message : String(error),
        type,
        integrationId,
      })
      // Remove from map if initialization failed partially
      if (this.providers.has(key)) {
        this.providers.delete(key)
      }
      throw error
    }
  }
  /**
   * Retrieve or initialize a provider instance
   * Extracted from MessageService.getProvider
   */
  async getProvider(
    // type: IntegrationProviderType,
    integrationId: string
  ): Promise<IntegrationProvider> {
    const key = `${integrationId}`
    console.log('Getting provider for integration:', key, this.organizationId)
    if (!this.providers.has(key)) {
      logger.info(`Provider not found in cache, initializing: ${key}`, {
        organizationId: this.organizationId,
      })
      // Fetch integration details if not already initialized
      const [integration] = await db
        .select()
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, integrationId),
            eq(schema.Integration.organizationId, this.organizationId)
          )
        )
        .limit(1)
      if (!integration) {
        throw new Error(`Integration ${integrationId} not found`)
      }

      // Check if integration requires re-authentication
      if (integration.authStatus && REQUIRES_REAUTH_STATUSES.includes(integration.authStatus)) {
        const metadata = integration.metadata as {
          auth?: {
            consecutiveFailures?: number
            googleError?: string
            googleErrorDescription?: string
          }
        } | null
        const authDetails = metadata?.auth || {}

        logger.warn(
          `Integration ${integrationId} requires re-authentication (status: ${integration.authStatus})`,
          {
            organizationId: this.organizationId,
            authStatus: integration.authStatus,
            consecutiveFailures: authDetails.consecutiveFailures,
            googleError: authDetails.googleError,
            googleErrorDescription: authDetails.googleErrorDescription,
          }
        )

        throw new Error(
          `Integration ${integrationId} requires re-authentication (status: ${integration.authStatus}). ` +
            `User must re-connect the integration.`
        )
      }

      if (!integration.enabled) {
        logger.warn(`Attempting to get provider for disabled integration: ${integrationId}`, {
          organizationId: this.organizationId,
          authStatus: integration.authStatus,
        })
        // Allow getting provider for disabled integrations (e.g., for webhook cleanup)
      }
      // Map string provider to IntegrationProviderType
      const providerTypeMap = ProviderRegistryService.getProviderTypeMap()
      const providerType = providerTypeMap[integration.provider]
      if (!providerType) {
        throw new Error(`Unknown provider type: ${integration.provider}`)
      }
      const identifier = ProviderRegistryService.getIdentifierFromMetadata(integration.metadata)
      const details = { identifier: identifier, provider: integration.provider }
      logger.info(`Initializing provider for integration: ${integrationId}`, {
        provider: details.provider,
      })
      // Initialize and cache the provider
      return await this.initializeProvider(
        providerType,
        integrationId,
        details,
        integration.metadata
      )
    }
    return this.providers.get(key)!.provider
  }
  /**
   * Get all cached provider instances
   */
  getAllProviderInstances(): ProviderInstance[] {
    return Array.from(this.providers.values())
  }
  /**
   * Get provider capabilities for a specific provider type
   * New method for capability checking
   */
  getProviderCapabilities(type: IntegrationProviderType): ProviderCapabilities {
    return getProviderCapabilities(type)
  }
  /**
   * Check if a provider supports a specific capability
   */
  providerSupportsCapability(
    type: IntegrationProviderType,
    capability: keyof ProviderCapabilities
  ): boolean {
    const capabilities = this.getProviderCapabilities(type)
    const value = capabilities[capability]
    return typeof value === 'boolean' ? value : value !== 'none'
  }
  /**
   * Get providers that support a specific capability
   */
  async getProvidersWithCapability(capability: keyof ProviderCapabilities): Promise<
    {
      type: IntegrationProviderType
      integrationId: string
      provider: IntegrationProvider
    }[]
  > {
    const supportingProviders: {
      type: IntegrationProviderType
      integrationId: string
      provider: IntegrationProvider
    }[] = []
    for (const [key, instance] of this.providers) {
      if (this.providerSupportsCapability(instance.type, capability)) {
        supportingProviders.push({
          type: instance.type,
          integrationId: instance.integrationId,
          provider: instance.provider,
        })
      }
    }
    return supportingProviders
  }
  /**
   * Check if an action type is supported by a provider
   */
  isActionSupportedByProvider(actionType: string, providerType: IntegrationProviderType): boolean {
    const capabilities = this.getProviderCapabilities(providerType)
    // Map action types to capabilities
    const actionCapabilityMap: Record<string, keyof ProviderCapabilities> = {
      SEND_MESSAGE: 'canSend',
      REPLY: 'canReply',
      FORWARD: 'canForward',
      DRAFT_EMAIL: 'canDraft',
      APPLY_LABEL: 'canApplyLabel',
      REMOVE_LABEL: 'canRemoveLabel',
      ARCHIVE: 'canArchive',
      MARK_SPAM: 'canMarkSpam',
      MARK_TRASH: 'canMarkTrash',
      ASSIGN_THREAD: 'canAssignThreads',
      ARCHIVE_THREAD: 'canArchive',
      UNARCHIVE_THREAD: 'canArchive',
      MOVE_TO_TRASH: 'canMarkTrash',
      REACT_TO_MESSAGE: 'canReact',
      SHARE_MESSAGE: 'canShare',
    }
    const requiredCapability = actionCapabilityMap[actionType]
    if (!requiredCapability) {
      // Action type not in map, assume it's a universal action (like APPLY_TAG)
      return true
    }
    return this.providerSupportsCapability(providerType, requiredCapability)
  }
  /**
   * Get the best provider for a specific action
   */
  async getBestProviderForAction(actionType: string): Promise<{
    type: IntegrationProviderType
    integrationId: string
    provider: IntegrationProvider
  } | null> {
    // Get all available providers and check which ones support the action
    for (const [key, instance] of this.providers) {
      if (this.isActionSupportedByProvider(actionType, instance.type)) {
        return {
          type: instance.type,
          integrationId: instance.integrationId,
          provider: instance.provider,
        }
      }
    }
    logger.warn(`No providers found that support action: ${actionType}`, {
      organizationId: this.organizationId,
      availableProviders: Array.from(this.providers.keys()),
    })
    return null
  }
  /**
   * Check if a provider supports a specific action
   * New method for action validation
   */
  async providerSupportsAction(
    type: IntegrationProviderType,
    integrationId: string,
    actionType: string
  ): Promise<boolean> {
    try {
      const capabilities = this.getProviderCapabilities(type)
      // Map action types to capabilities
      const actionCapabilityMap: Record<string, keyof ProviderCapabilities> = {
        SEND_MESSAGE: 'canSend',
        REPLY: 'canReply',
        FORWARD: 'canForward',
        DRAFT_EMAIL: 'canDraft',
        APPLY_LABEL: 'canApplyLabel',
        REMOVE_LABEL: 'canRemoveLabel',
        ARCHIVE: 'canArchive',
        MARK_SPAM: 'canMarkSpam',
        MARK_TRASH: 'canMarkTrash',
        ASSIGN_THREAD: 'canAssignThreads',
        ARCHIVE_THREAD: 'canArchive',
        UNARCHIVE_THREAD: 'canArchive',
        MOVE_TO_TRASH: 'canMarkTrash',
        REACT_TO_MESSAGE: 'canReact',
        SHARE_MESSAGE: 'canShare',
      }
      const requiredCapability = actionCapabilityMap[actionType]
      if (!requiredCapability) {
        // Action type not in map, assume it's a universal action (like APPLY_TAG)
        return true
      }
      const capabilityValue = capabilities[requiredCapability]
      return typeof capabilityValue === 'boolean' ? capabilityValue : capabilityValue !== 'none'
    } catch (error) {
      logger.error('Error checking provider capability', {
        type,
        integrationId,
        actionType,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }
  /**
   * Validate if an action can be performed by a provider
   * Returns detailed validation result
   */
  async validateProviderAction(
    type: IntegrationProviderType,
    integrationId: string,
    actionType: string,
    params?: any
  ): Promise<{
    canPerform: boolean
    reason?: string
    alternatives?: string[]
  }> {
    const capabilities = this.getProviderCapabilities(type)
    // Check basic capability support
    const supportsAction = await this.providerSupportsAction(type, integrationId, actionType)
    if (!supportsAction) {
      return {
        canPerform: false,
        reason: `${type} provider does not support ${actionType}`,
        alternatives: this.getSuggestedAlternatives(actionType, capabilities),
      }
    }
    // Additional validation for specific actions
    if (actionType === 'APPLY_LABEL' || actionType === 'REMOVE_LABEL') {
      if (params?.targetType && capabilities.labelScope !== 'none') {
        const targetType = params.targetType as 'message' | 'thread' | 'conversation'
        if (targetType === 'message' && capabilities.labelScope !== 'message') {
          return {
            canPerform: false,
            reason: `${type} provider does not support message-level labels`,
            alternatives: ['APPLY_TAG'],
          }
        }
        if (targetType === 'conversation' && capabilities.labelScope === 'message') {
          return {
            canPerform: false,
            reason: `${type} provider only supports message-level labels`,
            alternatives: ['APPLY_TAG'],
          }
        }
      }
    }
    // Check attachment constraints
    if (actionType === 'SEND_MESSAGE' && params?.attachments) {
      if (!capabilities.canAttachFiles) {
        return {
          canPerform: false,
          reason: `${type} provider does not support attachments`,
          alternatives: ['SEND_MESSAGE without attachments'],
        }
      }
      // Check attachment size limits
      if (
        capabilities.maxAttachmentSize &&
        params.attachments.some((att: any) => att.size > capabilities.maxAttachmentSize!)
      ) {
        return {
          canPerform: false,
          reason: `Attachment exceeds ${type} provider's size limit of ${capabilities.maxAttachmentSize} bytes`,
          alternatives: ['Reduce attachment size', 'Use external link'],
        }
      }
    }
    return { canPerform: true }
  }
  /**
   * Get suggested alternative actions when primary action is not supported
   */
  private getSuggestedAlternatives(
    actionType: string,
    capabilities: ProviderCapabilities
  ): string[] {
    const alternatives: string[] = []
    switch (actionType) {
      case 'APPLY_LABEL':
      case 'REMOVE_LABEL':
        alternatives.push('APPLY_TAG', 'REMOVE_TAG')
        break
      case 'ARCHIVE':
      case 'ARCHIVE_THREAD':
        if (capabilities.canMarkTrash) alternatives.push('MARK_TRASH')
        alternatives.push('APPLY_TAG with "archived" tag')
        break
      case 'MARK_SPAM':
        if (capabilities.canMarkTrash) alternatives.push('MARK_TRASH')
        alternatives.push('APPLY_TAG with "spam" tag')
        break
      case 'FORWARD':
        if (capabilities.canSend) alternatives.push('SEND_MESSAGE with original content')
        break
      case 'DRAFT_EMAIL':
        if (capabilities.canSend) alternatives.push('SEND_MESSAGE immediately')
        break
    }
    return alternatives
  }
}
