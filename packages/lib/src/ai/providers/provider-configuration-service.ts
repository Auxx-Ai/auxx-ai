// packages/lib/src/ai/providers/provider-configuration-service.ts

import { configService } from '@auxx/credentials/config'
import { isMasked } from '@auxx/credentials/crypto'
import {
  deleteCredential,
  findCredential,
  listCredentials,
  revealSecrets,
} from '@auxx/credentials/store'
import { type Database, schema } from '@auxx/database'
import type {
  LoadBalancingConfigEntity as LoadBalancingConfigModel,
  ModelConfigurationEntity as ModelConfigurationModel,
  ProviderConfigurationEntity as ProviderConfigurationModel,
  ProviderPreferenceEntity as ProviderPreferenceModel,
} from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { getProviderByKey } from '../../connections/providers/provider-registry'
import { resolveConnectionForRuntime } from '../../connections/resolve-connection-for-runtime'
import { saveConnection } from '../../connections/save-connection'
import { createScopedLogger } from '../../logger'
import { UsageTrackingService } from '../usage/usage-tracking-service'
import { AI_PROVIDER_CONNECTION_KEY, AI_SYSTEM_ENV_MAP } from './connection-provider-map'
import { ProviderRegistry } from './provider-registry'
import {
  type CredentialsResponse,
  CredentialValidationError,
  type CustomConfiguration,
  type CustomModelConfiguration,
  type CustomProviderConfiguration,
  FetchFrom,
  type ModelCapabilities,
  type ModelCredentials,
  type ModelData,
  type ModelLoadBalancingConfiguration,
  type ModelSettings,
  ModelType,
  type ProviderCapabilities,
  type ProviderConfiguration,
  ProviderConfigurationError,
  type ProviderConfigurations,
  type ProviderCredentials,
  type ProviderQuotaType,
  type ProviderStatusInfo,
  ProviderType,
  QuotaUnit,
  type SystemConfiguration,
  type ValidationOptions,
} from './types'

const logger = createScopedLogger('ProviderConfigurationService')

/**
 * Providers that support system (platform-managed) credentials.
 * Only these providers can resolve API keys from environment variables for SYSTEM mode.
 * Must match the providers seeded in organization-seeder.ts.
 */
const SYSTEM_ELIGIBLE_PROVIDERS = new Set(['anthropic', 'openai'])

/**
 * Provider Configuration Service with comprehensive provider configuration management
 * Handles all provider credential management, validation, and configuration operations
 */
export class ProviderConfigurationService {
  /**
   * Constructor for ProviderConfigurationService
   * @param db - Drizzle database client instance
   * @param organizationId - Organization identifier for scoped operations
   * @param userId - User identifier for audit and scoping purposes
   */
  constructor(
    private db: Database,
    private organizationId: string,
    private userId: string
  ) {
    this.usageService = new UsageTrackingService(db)
  }

  private usageService: UsageTrackingService

  // ===== PROVIDER CONFIGURATION METHODS =====

  async getConfigurations(): Promise<ProviderConfigurations> {
    logger.info('Getting all provider configurations', {
      organizationId: this.organizationId,
    })

    try {
      const configurations: Record<string, ProviderConfiguration> = {}
      const allProviders = await ProviderRegistry.getAvailableProviders()

      // Fetch all data in parallel using efficient Map-based methods
      const [
        modelConfigurations,
        providerConfigurationsMap,
        loadBalancingConfigurations,
        providerPreferencesMap,
      ] = await Promise.all([
        this.getAllModelConfigurationsByProvider(),
        this.getAllProviderConfigurationsMap(), // Returns Map<string, ProviderConfigurationModel[]>
        this.getAllLoadBalancingConfigsByProvider(),
        this.getAllProviderPreferencesMap(), // Returns Map<string, ProviderPreferenceModel>
      ])

      // NO NEED for additional grouping - data is already efficiently grouped by provider

      for (const provider of allProviders) {
        // Direct O(1) lookups using Maps
        const providerConfigRecords = providerConfigurationsMap.get(provider) || [] // Array of records (system + custom)
        const providerPrefRecord = providerPreferencesMap.get(provider) || null // Single preference record

        // Now returns enhanced ProviderConfiguration with ModelData
        configurations[provider] = await this._getProviderConfiguration(
          provider,
          providerConfigRecords, // Array as expected by _getProviderConfiguration
          modelConfigurations.get(provider) || [], // Already provider-specific
          loadBalancingConfigurations.get(provider) || [], // Already provider-specific
          providerPrefRecord
          // NO allModelConfigsMap parameter needed
        )
      }

      return { organizationId: this.organizationId, configurations }
    } catch (error) {
      logger.error('Failed to get provider configurations', {
        organizationId: this.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })

      throw new ProviderConfigurationError(
        'Failed to retrieve provider configurations',
        'all',
        'CONFIGURATIONS_RETRIEVAL_FAILED'
      )
    }
  }

  /**
   * Get complete provider configuration for an organization
   * Retrieves and consolidates all configuration data for a specific provider including:
   * - System configuration (quota types, enabled status)
   * - Custom configuration (provider and model-specific credentials)
   * - Model settings (load balancing, enabled models)
   * - Provider preferences (system vs custom type preference)
   * @param provider - The provider name (e.g., 'openai', 'anthropic', 'google')
   * @returns Promise<ProviderConfiguration> - Complete configuration object with all settings
   * @throws ProviderConfigurationError - When configuration retrieval fails
   */
  async getProviderConfiguration(provider: string): Promise<ProviderConfiguration> {
    logger.info('Getting provider configuration', {
      organizationId: this.organizationId,
      provider,
    })

    try {
      logger.debug('Getting provider configuration', {
        organizationId: this.organizationId,
        provider,
      })

      // Get provider records
      const providerRecords = await this.db.query.ProviderConfiguration.findMany({
        where: and(
          eq(schema.ProviderConfiguration.organizationId, this.organizationId),
          eq(schema.ProviderConfiguration.provider, provider)
        ),
        columns: {
          id: true,
          createdAt: true,
          updatedAt: true,
          organizationId: true,
          provider: true,
          providerType: true,
          connectionDefinitionId: true,
          isEnabled: true,
          quotaType: true,
          quotaLimit: true,
          quotaPeriodEnd: true,
          quotaPeriodStart: true,
          quotaUsed: true,
        },
      })

      // Get model configurations for this provider
      const modelConfigurations = await this.db.query.ModelConfiguration.findMany({
        where: and(
          eq(schema.ModelConfiguration.organizationId, this.organizationId),
          eq(schema.ModelConfiguration.provider, provider)
        ),
        columns: {
          id: true,
          createdAt: true,
          updatedAt: true,
          organizationId: true,
          provider: true,
          model: true,
          modelType: true,
          enabled: true,
          config: true,
        },
      })

      // Get load balancing configs
      const loadBalancingConfigs = await this.db.query.LoadBalancingConfig.findMany({
        where: and(
          eq(schema.LoadBalancingConfig.organizationId, this.organizationId),
          eq(schema.LoadBalancingConfig.provider, provider)
        ),
        columns: {
          id: true,
          createdAt: true,
          updatedAt: true,
          organizationId: true,
          provider: true,
          model: true,
          modelType: true,
          name: true,
          connectionId: true,
          enabled: true,
          weight: true,
        },
      })

      // Get provider preferences
      const providerPreference = await this.db.query.ProviderPreference.findFirst({
        where: and(
          eq(schema.ProviderPreference.organizationId, this.organizationId),
          eq(schema.ProviderPreference.provider, provider)
        ),
        columns: {
          id: true,
          createdAt: true,
          updatedAt: true,
          organizationId: true,
          provider: true,
          preferredType: true,
        },
      })
      return await this._getProviderConfiguration(
        provider,
        providerRecords,
        modelConfigurations,
        loadBalancingConfigs,
        providerPreference ?? null
      )
    } catch (error) {
      logger.error('Failed to get provider configuration', {
        organizationId: this.organizationId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new ProviderConfigurationError(
        `Failed to get configuration for provider ${provider}`,
        provider,
        'CONFIG_RETRIEVAL_FAILED'
      )
    }
  }

  async _getProviderConfiguration(
    provider: string,
    providerRecords: ProviderConfigurationModel[],
    modelConfigurations: ModelConfigurationModel[],
    loadBalancingConfigs: LoadBalancingConfigModel[],
    providerPreference: ProviderPreferenceModel | null
  ): Promise<ProviderConfiguration> {
    logger.info('Getting provider configuration', {
      organizationId: this.organizationId,
      provider,
    })

    try {
      // Build configuration
      const systemConfig = await this._buildSystemConfiguration(provider, providerRecords)

      // customConfig = {provider, models}
      const customConfig = await this._buildCustomConfiguration(
        provider,
        providerRecords,
        modelConfigurations
      )
      const modelSettings = await this._buildModelSettings(provider, loadBalancingConfigs)

      logger.debug('Built configurations', {
        organizationId: this.organizationId,
        provider,
        customConfigHasProvider: !!customConfig.provider,
        customConfigModelsCount: customConfig.models.length,
      })

      // Determine provider types
      // Default to CUSTOM if no preference is set (which is the case for most users)
      const preferredProviderType =
        providerPreference?.preferredType === 'SYSTEM' ? ProviderType.SYSTEM : ProviderType.CUSTOM

      // Check availability of each provider type. BYO keys now live in the unified
      // Credential store, so "custom available" = the CUSTOM record points at a blueprint
      // (provider-default key) OR a pool binding references a credential.
      const systemViable = systemConfig.enabled
      const customRecord = providerRecords.find((r) => r.providerType === 'CUSTOM')
      const customAvailable =
        !!customRecord?.connectionDefinitionId || loadBalancingConfigs.some((c) => !!c.connectionId)

      // Determine actual provider type with fallback logic
      let usingProviderType: ProviderType

      if (preferredProviderType === ProviderType.SYSTEM) {
        if (systemViable) {
          // Preferred SYSTEM is available
          usingProviderType = ProviderType.SYSTEM
        } else if (customAvailable) {
          // SYSTEM disabled, fallback to CUSTOM
          usingProviderType = ProviderType.CUSTOM
        } else {
          // Neither available, stay with SYSTEM to show not_configured status
          usingProviderType = ProviderType.SYSTEM
        }
      } else {
        // Preference is CUSTOM
        if (customAvailable) {
          // Preferred CUSTOM is available
          usingProviderType = ProviderType.CUSTOM
        } else if (systemViable) {
          // CUSTOM not configured, fallback to SYSTEM
          usingProviderType = ProviderType.SYSTEM
        } else {
          // Neither available, stay with CUSTOM to show not_configured status
          usingProviderType = ProviderType.CUSTOM
        }
      }

      // Create basic config for model transformation
      const basicConfig = {
        usingProviderType,
        systemConfiguration: systemConfig,
        customConfiguration: customConfig,
        modelSettings,
      }

      // Build ProviderCapabilities data (inherited from ProviderData)
      const providerCapabilities = await ProviderRegistry.getProviderCapabilities(provider)

      // Transform ALL Models to ModelData[] (inherited from ProviderData)
      const models: ModelData[] = await this._buildCompleteModelDataArray(
        provider,
        basicConfig,
        modelConfigurations
      )

      // Calculate Provider Status Info (inherited from ProviderData)
      const statusInfo = await this._calculateProviderStatusInfo(provider, basicConfig)

      // Return Enhanced ProviderConfiguration that extends ProviderData
      return {
        // ProviderData fields (inherited):
        provider,
        label: providerCapabilities?.displayName || provider,
        statusInfo,
        models, // Complete ModelData[] with ModelCapabilities
        isDefaultProvider: false, // TODO: Implement default provider logic
        credentialSchema: providerCapabilities?.credentialSchema || [],
        // ProviderCapabilities fields (inherited):
        displayName: providerCapabilities?.displayName || provider,
        icon: providerCapabilities?.icon || '',
        color: providerCapabilities?.color || '',
        supportedModelTypes: providerCapabilities?.supportedModelTypes || [],
        defaultModel: providerCapabilities?.defaultModel || '',
        requiresApiKey: providerCapabilities?.requiresApiKey || true,
        toolFormat: providerCapabilities?.toolFormat || 'openai',
        parameterRules: providerCapabilities?.parameterRules,
        rateLimits: providerCapabilities?.rateLimits,
        description: providerCapabilities?.description,
        documentationUrl: providerCapabilities?.documentationUrl,
        setupInstructions: providerCapabilities?.setupInstructions,

        // ProviderConfiguration specific fields:
        organizationId: this.organizationId,
        preferredProviderType,
        usingProviderType,
        systemConfiguration: systemConfig,
        customConfiguration: customConfig,
        modelSettings,
      }
    } catch (error) {
      logger.error('Failed to get provider configuration', {
        organizationId: this.organizationId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new ProviderConfigurationError(
        `Failed to get configuration for provider ${provider}`,
        provider,
        'CONFIG_RETRIEVAL_FAILED'
      )
    }
  }

  // ===== Unified Credential store integration (AI BYO keys → Credential) =====

  /**
   * Resolve the seeded platform ConnectionDefinition for an AI provider. Returns the
   * blueprint providerKey (e.g. 'openaiApi') + row id, or null when the provider isn't
   * mapped or its blueprint hasn't been seeded (ensurePlatformProviders).
   */
  private async _resolveConnectionDefinition(
    provider: string
  ): Promise<{ providerKey: string; connectionDefinitionId: string } | null> {
    const providerKey = AI_PROVIDER_CONNECTION_KEY[provider]
    if (!providerKey) return null
    const row = await this.db.query.ConnectionDefinition.findFirst({
      where: and(
        eq(schema.ConnectionDefinition.providerKey, providerKey),
        eq(schema.ConnectionDefinition.major, 1)
      ),
      columns: { id: true },
    })
    return row ? { providerKey, connectionDefinitionId: row.id } : null
  }

  /**
   * Split canonical AI credentials into secret-flagged vs plain variables (per the
   * blueprint's connectionVariables), dropping empty and masked echoes so an unchanged
   * secret never overwrites the stored value.
   */
  private _splitAiCredentials(
    providerKey: string,
    credentials: Record<string, any>
  ): { secretFields: Record<string, string>; plainVariables: Record<string, string> } {
    const def = getProviderByKey(providerKey)
    const secretKeys = new Set(
      (def?.connectionVariables ?? []).filter((v) => v.secret).map((v) => v.key)
    )
    const secretFields: Record<string, string> = {}
    const plainVariables: Record<string, string> = {}
    for (const [key, value] of Object.entries(credentials)) {
      if (value === undefined || value === null || value === '') continue
      const str = String(value)
      // Never persist a masked echo (HIDDEN_VALUE or the legacy '[**HIDDEN**]' sentinel).
      if (isMasked(str) || str === '[**HIDDEN**]') continue
      if (secretKeys.has(key)) secretFields[key] = str
      else plainVariables[key] = str
    }
    return { secretFields, plainVariables }
  }

  /** Reveal a credential's canonical field bag (plain connectionVariables + secret fields). */
  private async _revealCredentialFields(credentialId: string): Promise<Record<string, any>> {
    const revealed = await revealSecrets<{ fields?: Record<string, any> }>(
      credentialId,
      this.organizationId
    )
    if (revealed.isErr()) return {}
    const plain = (revealed.value.record.metadata?.connectionVariables ?? {}) as Record<string, any>
    const secretFields = revealed.value.secrets.fields ?? {}
    return { ...plain, ...secretFields }
  }

  /** The org's primary (isDefault/newest) BYO credential id for an AI provider, or null. */
  private async _findOrgProviderCredentialId(providerKey: string): Promise<string | null> {
    const found = await findCredential({
      organizationId: this.organizationId,
      kind: 'workflow',
      type: providerKey,
      userId: null,
    })
    return found.isOk() && found.value ? found.value.id : null
  }

  /**
   * Delete every org-scoped BYO credential for an AI provider from the unified store. The
   * LoadBalancingConfig.connectionId FK (onDelete: cascade) removes any pool bindings too.
   */
  private async _deleteOrgProviderCredentials(provider: string): Promise<void> {
    const providerKey = AI_PROVIDER_CONNECTION_KEY[provider]
    if (!providerKey) return
    const existing = await listCredentials({
      organizationId: this.organizationId,
      kind: 'workflow',
      type: providerKey,
      userId: null,
    })
    if (existing.isErr()) return
    for (const cred of existing.value) {
      await deleteCredential(cred.id, this.organizationId)
    }
  }

  /**
   * Persist an org BYO provider key into the unified Credential store and upsert the CUSTOM
   * ProviderConfiguration (blueprint FK, no inline secret). Merges over an existing key when
   * one exists (edit) so an unchanged secret survives; otherwise inserts the first key.
   */
  private async _persistProviderCredential(
    provider: string,
    credentials: ProviderCredentials,
    options: ValidationOptions
  ): Promise<void> {
    const resolved = await this._resolveConnectionDefinition(provider)
    if (!resolved) {
      throw new ProviderConfigurationError(
        `No connection blueprint seeded for AI provider '${provider}'`,
        provider,
        'CONNECTION_DEFINITION_MISSING'
      )
    }
    const { providerKey, connectionDefinitionId } = resolved
    const connectionId = await this._findOrgProviderCredentialId(providerKey)

    const { secretFields, plainVariables } = this._splitAiCredentials(providerKey, credentials)

    // Validate the RESOLVED key (existing merged with the de-masked submission), so editing a
    // plain field without re-entering the secret still validates against the real stored key.
    if (!options.skipValidation) {
      const existingFields = connectionId ? await this._revealCredentialFields(connectionId) : {}
      await this.validateProviderCredentials(provider, {
        ...existingFields,
        ...secretFields,
        ...plainVariables,
      })
    }

    const saved = await saveConnection({
      connectionDefinitionId,
      providerKey,
      name: getProviderByKey(providerKey)?.label ?? provider,
      organizationId: this.organizationId,
      createdById: this.userId,
      userId: null,
      connectionId: connectionId ?? undefined,
      connectionData: { secretFields, metadata: { connectionVariables: plainVariables } },
    })
    if (saved.isErr()) throw saved.error

    const now = new Date()
    await this.db
      .insert(schema.ProviderConfiguration)
      .values({
        organizationId: this.organizationId,
        provider,
        providerType: 'CUSTOM',
        connectionDefinitionId,
        isEnabled: true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.ProviderConfiguration.organizationId,
          schema.ProviderConfiguration.provider,
          schema.ProviderConfiguration.providerType,
        ],
        set: { connectionDefinitionId, isEnabled: true, updatedAt: now },
      })

    await this.switchProviderType(provider, ProviderType.CUSTOM)
  }

  /**
   * Resolve the org's provider-default key fields (the primary among its BYO keys) from the
   * unified store, by blueprint providerKey. Returns the canonical field bag or null.
   */
  private async _resolveProviderDefaultFields(
    providerKey: string
  ): Promise<Record<string, any> | null> {
    const resolved = await resolveConnectionForRuntime({
      providerKey,
      organizationId: this.organizationId,
      userId: this.userId,
      ensureFresh: false,
    })
    if (resolved.isErr()) return null
    return resolved.value.organizationConnection?.fields ?? null
  }

  /**
   * Gather the enabled pool members for a (provider, model, modelType), revealing each
   * bound credential's canonical fields. A size-1 result is a pinned key.
   */
  private async _resolveModelPool(
    provider: string,
    model: string,
    modelType: string
  ): Promise<Array<{ id: string; name: string; fields: Record<string, any> }>> {
    const rows = await this.db.query.LoadBalancingConfig.findMany({
      where: and(
        eq(schema.LoadBalancingConfig.organizationId, this.organizationId),
        eq(schema.LoadBalancingConfig.provider, provider),
        eq(schema.LoadBalancingConfig.model, model),
        eq(schema.LoadBalancingConfig.modelType, modelType),
        eq(schema.LoadBalancingConfig.enabled, true)
      ),
    })
    const members: Array<{ id: string; name: string; fields: Record<string, any> }> = []
    for (const row of rows) {
      if (!row.connectionId) continue
      const fields = await this._revealCredentialFields(row.connectionId)
      if (Object.keys(fields).length > 0) members.push({ id: row.id, name: row.name, fields })
    }
    return members
  }

  /**
   * Validate and add custom provider credentials
   * Validates provider credentials against the actual provider API and stores them securely
   * Also updates the provider preference to use custom type after successful validation
   * @param provider - The provider name to configure
   * @param credentials - Provider credentials object (e.g., {apiKey: 'sk-...'})
   * @param options - Validation options including skipValidation flag
   * @returns Promise<void> - Resolves when credentials are successfully added
   * @throws CredentialValidationError - When credential validation fails
   * @throws ProviderConfigurationError - When credential storage fails
   */
  async addCustomProviderCredentials(
    provider: string,
    credentials: ProviderCredentials,
    options: ValidationOptions = {}
  ): Promise<void> {
    logger.info('Adding custom provider credentials', {
      organizationId: this.organizationId,
      provider,
    })

    try {
      // Mint/merge the BYO key into the unified Credential store and point the CUSTOM
      // ProviderConfiguration at the blueprint (no inline secret column anymore).
      await this._persistProviderCredential(provider, credentials, options)

      logger.info('Successfully added custom provider credentials', {
        organizationId: this.organizationId,
        provider,
      })
    } catch (error) {
      logger.error('Failed to add custom provider credentials', {
        organizationId: this.organizationId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      })

      if (error instanceof CredentialValidationError) {
        throw error
      }

      throw new ProviderConfigurationError(
        `Failed to add credentials for provider ${provider}`,
        provider,
        'CREDENTIAL_ADD_FAILED'
      )
    }
  }

  /**
   * Update provider credentials by merging with existing ones
   * Only validates and updates the provided credentials, keeps existing ones intact
   * @param provider - The provider name to update
   * @param credentialUpdates - Partial credentials to update
   * @returns Promise<void> - Resolves when credentials are successfully updated
   * @throws CredentialValidationError - When credential validation fails
   * @throws ProviderConfigurationError - When credential update fails
   */
  async updateProviderCredentials(
    provider: string,
    credentialUpdates: Partial<ProviderCredentials>
  ): Promise<void> {
    logger.info('Updating provider credentials', {
      organizationId: this.organizationId,
      provider,
      updateFields: Object.keys(credentialUpdates),
    })

    try {
      // The unified store merges submitted fields over the existing key (a masked/omitted
      // secret keeps its stored value), so a partial update is just a persist with merge.
      await this._persistProviderCredential(provider, credentialUpdates as ProviderCredentials, {})

      logger.info('Successfully updated provider credentials', {
        organizationId: this.organizationId,
        provider,
        updateFields: Object.keys(credentialUpdates),
      })
    } catch (error) {
      logger.error('Failed to update provider credentials', {
        organizationId: this.organizationId,
        provider,
        updateFields: Object.keys(credentialUpdates),
        error: error instanceof Error ? error.message : String(error),
      })

      if (error instanceof CredentialValidationError) {
        throw error
      }

      throw new ProviderConfigurationError(
        `Failed to update credentials for provider ${provider}`,
        provider,
        'CREDENTIAL_UPDATE_FAILED'
      )
    }
  }

  /**
   * Add or update custom model credentials
   * Creates or updates model-specific configuration with credentials and parameters
   * Links the model configuration to the appropriate AI integration record
   * @param provider - The provider name (e.g., 'openai')
   * @param model - The model name (e.g., 'gpt-4', 'claude-3-sonnet')
   * @param modelType - The model type enum (CHAT, COMPLETION, EMBEDDING, etc.)
   * @param credentials - Model-specific credentials object
   * @param options - Validation options including skipValidation flag
   * @returns Promise<void> - Resolves when model credentials are successfully added
   * @throws CredentialValidationError - When model credential validation fails
   * @throws ProviderConfigurationError - When model configuration storage fails
   */
  async addCustomModelCredentials(
    provider: string,
    model: string,
    modelType: ModelType,
    credentials: ModelCredentials,
    options: ValidationOptions = {}
  ): Promise<void> {
    logger.info('Adding custom model credentials', {
      organizationId: this.organizationId,
      provider,
      model,
      modelType,
    })

    try {
      const resolved = await this._resolveConnectionDefinition(provider)
      if (!resolved) {
        throw new ProviderConfigurationError(
          `No connection blueprint seeded for AI provider '${provider}'`,
          provider,
          'CONNECTION_DEFINITION_MISSING'
        )
      }
      const { providerKey, connectionDefinitionId } = resolved
      // A model-pinned key is a size-1 LoadBalancingConfig pool (the 'default' member).
      const POOL_NAME = 'default'

      // Existing pool member for this model → its credential, so an edit merges (and an
      // unchanged secret survives) rather than minting a duplicate key.
      const existingBinding = await this.db.query.LoadBalancingConfig.findFirst({
        where: and(
          eq(schema.LoadBalancingConfig.organizationId, this.organizationId),
          eq(schema.LoadBalancingConfig.provider, provider),
          eq(schema.LoadBalancingConfig.model, model),
          eq(schema.LoadBalancingConfig.modelType, modelType),
          eq(schema.LoadBalancingConfig.name, POOL_NAME)
        ),
        columns: { connectionId: true },
      })
      const connectionId = existingBinding?.connectionId ?? null

      const { secretFields, plainVariables } = this._splitAiCredentials(providerKey, credentials)

      // Validate the resolved key (existing merged with the de-masked submission).
      if (!options.skipValidation) {
        const existingFields = connectionId ? await this._revealCredentialFields(connectionId) : {}
        await this.validateModelCredentials(provider, model, modelType, {
          ...existingFields,
          ...secretFields,
          ...plainVariables,
        })
      }

      const saved = await saveConnection({
        connectionDefinitionId,
        providerKey,
        name: `${getProviderByKey(providerKey)?.label ?? provider} – ${model}`,
        organizationId: this.organizationId,
        createdById: this.userId,
        userId: null,
        connectionId: connectionId ?? undefined,
        connectionData: { secretFields, metadata: { connectionVariables: plainVariables } },
      })
      if (saved.isErr()) throw saved.error
      const credentialId = saved.value

      const now = new Date()
      // Upsert the size-1 pool binding pointing at the credential.
      await this.db
        .insert(schema.LoadBalancingConfig)
        .values({
          organizationId: this.organizationId,
          provider,
          model,
          modelType,
          name: POOL_NAME,
          connectionId: credentialId,
          enabled: true,
          weight: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.LoadBalancingConfig.organizationId,
            schema.LoadBalancingConfig.provider,
            schema.LoadBalancingConfig.model,
            schema.LoadBalancingConfig.modelType,
            schema.LoadBalancingConfig.name,
          ],
          set: { connectionId: credentialId, enabled: true, updatedAt: now },
        })

      // Keep the model row (params/enabled) without an inline secret; don't clobber config.
      await this.db
        .insert(schema.ModelConfiguration)
        .values({
          organizationId: this.organizationId,
          provider,
          model,
          modelType,
          config: {},
          enabled: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.ModelConfiguration.organizationId,
            schema.ModelConfiguration.provider,
            schema.ModelConfiguration.model,
            schema.ModelConfiguration.modelType,
          ],
          set: { enabled: true, updatedAt: now },
        })

      logger.info('Successfully added custom model credentials', {
        organizationId: this.organizationId,
        provider,
        model,
        modelType,
      })
    } catch (error) {
      logger.error('Failed to add custom model credentials', {
        organizationId: this.organizationId,
        provider,
        model,
        modelType,
        error: error instanceof Error ? error.message : String(error),
      })

      if (error instanceof CredentialValidationError) {
        throw error
      }

      throw new ProviderConfigurationError(
        `Failed to add model credentials for ${provider}/${model}`,
        provider,
        'MODEL_CREDENTIAL_ADD_FAILED'
      )
    }
  }

  /**
   * Switch provider type preference
   * Updates the organization's preference between system-provided and custom provider configurations
   * System providers use centrally managed quotas, custom providers use user-provided credentials
   * The providerType in the provider configuration system refers to how the AI provider is configured and funded for an organization. There
   * are two main types:
   *
   * 1. SYSTEM Provider Type
   * - Managed by the platform: The Auxx.ai platform provides and manages the API credentials
   * - Shared resources: Uses platform-owned API keys with quota limits
   * - Built-in quotas: Has usage limits (free, trial, paid tiers) managed by the platform
   * - Plug-and-play: Users don't need to provide their own API keys
   * - Limited control: Users can't customize advanced settings or have unlimited usage
   *
   * 2. CUSTOM Provider Type
   * - User-managed: Organizations provide their own API credentials
   * - Direct billing: Usage goes directly to the organization's provider account
   * - No platform quotas: Limited only by the organization's provider limits
   * - Full control: Users can configure advanced settings and parameters
   * - Self-service: Organizations manage their own provider relationships
   *
   * @param provider - The provider name to update preference for
   * @param providerType - The preferred provider type (SYSTEM or CUSTOM)
   * @returns Promise<void> - Resolves when preference is successfully updated
   * @throws ProviderConfigurationError - When preference update fails
   */
  async switchProviderType(provider: string, providerType: ProviderType): Promise<void> {
    logger.info('Switching provider type', {
      organizationId: this.organizationId,
      provider,
      providerType,
    })

    try {
      const now = new Date()
      await this.db
        .insert(schema.ProviderPreference)
        .values({
          organizationId: this.organizationId,
          provider,
          preferredType: providerType,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.ProviderPreference.organizationId, schema.ProviderPreference.provider],
          set: {
            preferredType: providerType,
            updatedAt: now,
          },
        })

      logger.info('Successfully switched provider type', {
        organizationId: this.organizationId,
        provider,
        providerType,
      })
    } catch (error) {
      logger.error('Failed to switch provider type', {
        organizationId: this.organizationId,
        provider,
        providerType,
        error: error instanceof Error ? error.message : String(error),
      })

      throw new ProviderConfigurationError(
        `Failed to switch provider type for ${provider}`,
        provider,
        'PROVIDER_TYPE_SWITCH_FAILED'
      )
    }
  }

  /**
   * Get current credentials for a model (respects provider type preference)
   * Retrieves the appropriate credentials based on the organization's provider type preference
   * For system providers: returns system-managed credentials
   * For custom providers: returns model-specific credentials or falls back to provider-level credentials
   * @param provider - The provider name
   * @param model - The model name
   * @param modelType - The model type enum
   * @param options - Caching options for credential retrieval
   * @returns Promise<Record<string, any> | null> - Credentials object or null if not found
   */
  async getCurrentCredentials(
    provider: string,
    model: string | null,
    modelType: ModelType | null
  ): Promise<CredentialsResponse> {
    logger.info('Getting current credentials', {
      organizationId: this.organizationId,
      provider,
      model,
      modelType,
      mode: model ? 'model' : 'provider',
    })

    try {
      const config = await this.getProviderConfiguration(provider)

      // SYSTEM: platform key resolved from env (unchanged).
      if (config.usingProviderType === ProviderType.SYSTEM) {
        return {
          credentials: config.systemConfiguration.credentials || {},
          providerType: 'SYSTEM',
          credentialSource: 'SYSTEM',
        }
      }

      // CUSTOM: resolve BYO key(s) from the unified Credential store via the §2 hierarchy.
      const resolvedDef = await this._resolveConnectionDefinition(provider)
      const providerKey = resolvedDef?.providerKey
      const providerDefault = providerKey
        ? await this._resolveProviderDefaultFields(providerKey)
        : null

      const response: CredentialsResponse = { credentials: {}, providerType: 'CUSTOM' }

      if (model && modelType) {
        // Model pool: model-specific members first, then the provider-level '*' sentinel pool.
        let pool = await this._resolveModelPool(provider, model, modelType)
        if (pool.length === 0) pool = await this._resolveModelPool(provider, '*', modelType)

        if (pool.length > 0) {
          // A size-1 pool is a deterministic pin; the primary is the first member. The
          // orchestrator does the weighted pick across `load_balancing.configs`.
          response.credentials = pool[0]!.fields
          response.credentialSource = 'LOAD_BALANCED'
          response.load_balancing = {
            enabled: pool.length > 1,
            configs: pool.map((member) => ({
              id: member.id,
              name: member.name,
              credentials: member.fields,
              enabled: true,
              in_cooldown: false,
              ttl: 0,
            })),
          }
        } else {
          response.credentials = providerDefault ?? {}
          response.credentialSource = 'CUSTOM'
          response.load_balancing = { enabled: false, configs: [] }
        }
      } else {
        // Provider mode: the provider-default key.
        response.credentials = providerDefault ?? {}
        response.credentialSource = 'CUSTOM'
      }

      return response
    } catch (error) {
      logger.error('Failed to get current credentials', {
        organizationId: this.organizationId,
        provider,
        model,
        modelType,
        error: error instanceof Error ? error.message : String(error),
      })

      return { credentials: {} }
    }
  }

  /**
   * Delete provider configuration and all associated models
   * Removes all provider-related data including:
   * - Provider configuration records
   * - Provider preferences
   * - Load balancing configurations
   * This is a destructive operation that cannot be undone
   * @param provider - The provider name to delete configuration for
   * @returns Promise<{count: number}> - Object containing count of deleted records
   * @throws ProviderConfigurationError - When deletion fails
   */
  async deleteProvider(provider: string): Promise<{ count: number }> {
    logger.info('Deleting provider configuration', {
      organizationId: this.organizationId,
      provider,
    })

    try {
      // Delete the org's BYO keys from the unified store (cascades pool bindings).
      await this._deleteOrgProviderCredentials(provider)

      // Delete provider configuration
      const deletedProviderConfig = await this.db
        .delete(schema.ProviderConfiguration)
        .where(
          and(
            eq(schema.ProviderConfiguration.organizationId, this.organizationId),
            eq(schema.ProviderConfiguration.provider, provider)
          )
        )
        .returning({ id: schema.ProviderConfiguration.id })

      // Delete provider preferences
      await this.db
        .delete(schema.ProviderPreference)
        .where(
          and(
            eq(schema.ProviderPreference.organizationId, this.organizationId),
            eq(schema.ProviderPreference.provider, provider)
          )
        )

      // Delete load balancing configs
      await this.db
        .delete(schema.LoadBalancingConfig)
        .where(
          and(
            eq(schema.LoadBalancingConfig.organizationId, this.organizationId),
            eq(schema.LoadBalancingConfig.provider, provider)
          )
        )

      // Delete model configurations for this provider
      const deletedModelConfigs = await this.db
        .delete(schema.ModelConfiguration)
        .where(
          and(
            eq(schema.ModelConfiguration.organizationId, this.organizationId),
            eq(schema.ModelConfiguration.provider, provider)
          )
        )
        .returning({ id: schema.ModelConfiguration.id })

      logger.info('Successfully deleted provider configuration', {
        organizationId: this.organizationId,
        provider,
        deletedProviderConfigs: deletedProviderConfig.length,
        deletedModelConfigs: deletedModelConfigs.length,
      })

      return { count: deletedProviderConfig.length || 1 } // Return at least 1 for UI feedback
    } catch (error) {
      logger.error('Failed to delete provider configuration', {
        organizationId: this.organizationId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      })

      throw new ProviderConfigurationError(
        `Failed to delete provider ${provider}`,
        provider,
        'DELETE_FAILED'
      )
    }
  }

  /**
   * Remove custom provider credentials while preserving system configuration
   * Clears credentials and switches to SYSTEM mode, keeping quota data intact
   * @param provider - The provider name
   * @returns Promise<RemoveCredentialsResult> - Result with status info
   */
  async removeCustomCredentials(provider: string): Promise<{
    removed: boolean
    switchedToSystem: boolean
  }> {
    logger.info('Removing custom provider credentials', {
      organizationId: this.organizationId,
      provider,
    })

    try {
      // Delete the CUSTOM record (SYSTEM record is preserved if one exists)
      const deleted = await this.db
        .delete(schema.ProviderConfiguration)
        .where(
          and(
            eq(schema.ProviderConfiguration.organizationId, this.organizationId),
            eq(schema.ProviderConfiguration.provider, provider),
            eq(schema.ProviderConfiguration.providerType, 'CUSTOM')
          )
        )
        .returning({ id: schema.ProviderConfiguration.id })

      if (deleted.length === 0) {
        return {
          removed: false,
          switchedToSystem: false,
        }
      }

      // Update preference to SYSTEM
      await this.switchProviderType(provider, ProviderType.SYSTEM)

      // Delete the org's BYO keys from the unified store. The connectionId FK
      // (onDelete: cascade) removes the provider's pool bindings along with them.
      await this._deleteOrgProviderCredentials(provider)

      // Note: ModelConfiguration rows (params/enabled) are kept.

      logger.info('Successfully removed custom provider credentials', {
        organizationId: this.organizationId,
        provider,
        switchedToSystem: true,
      })

      return {
        removed: true,
        switchedToSystem: true,
      }
    } catch (error) {
      logger.error('Failed to remove custom provider credentials', {
        organizationId: this.organizationId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      })

      throw new ProviderConfigurationError(
        `Failed to remove custom credentials for provider ${provider}`,
        provider,
        'CUSTOM_CREDENTIALS_REMOVAL_FAILED'
      )
    }
  }

  /**
   * Delete a specific custom model configuration
   * Removes only the model configuration record, leaving the provider intact
   * @param provider - The provider name
   * @param model - The model name/ID to delete
   * @returns Promise<{ deleted: boolean }> - Object indicating if deletion occurred
   * @throws ProviderConfigurationError - When deletion fails
   */
  async deleteCustomModel(provider: string, model: string): Promise<{ deleted: boolean }> {
    logger.info('Deleting custom model configuration', {
      organizationId: this.organizationId,
      provider,
      model,
    })

    try {
      // Collect the model's pool bindings, then delete them. Each binding's credential is
      // removed too, unless another binding still references it (shared key).
      const bindings = await this.db.query.LoadBalancingConfig.findMany({
        where: and(
          eq(schema.LoadBalancingConfig.organizationId, this.organizationId),
          eq(schema.LoadBalancingConfig.provider, provider),
          eq(schema.LoadBalancingConfig.model, model)
        ),
        columns: { connectionId: true },
      })

      await this.db
        .delete(schema.LoadBalancingConfig)
        .where(
          and(
            eq(schema.LoadBalancingConfig.organizationId, this.organizationId),
            eq(schema.LoadBalancingConfig.provider, provider),
            eq(schema.LoadBalancingConfig.model, model)
          )
        )

      for (const binding of bindings) {
        if (!binding.connectionId) continue
        const stillReferenced = await this.db.query.LoadBalancingConfig.findFirst({
          where: and(
            eq(schema.LoadBalancingConfig.organizationId, this.organizationId),
            eq(schema.LoadBalancingConfig.connectionId, binding.connectionId)
          ),
          columns: { id: true },
        })
        if (!stillReferenced) await deleteCredential(binding.connectionId, this.organizationId)
      }

      const result = await this.db
        .delete(schema.ModelConfiguration)
        .where(
          and(
            eq(schema.ModelConfiguration.organizationId, this.organizationId),
            eq(schema.ModelConfiguration.provider, provider),
            eq(schema.ModelConfiguration.model, model)
          )
        )
        .returning({ id: schema.ModelConfiguration.id })

      logger.info('Successfully deleted custom model configuration', {
        organizationId: this.organizationId,
        provider,
        model,
        deleted: result.length > 0,
      })

      return { deleted: result.length > 0 || bindings.length > 0 }
    } catch (error) {
      logger.error('Failed to delete custom model configuration', {
        organizationId: this.organizationId,
        provider,
        model,
        error: error instanceof Error ? error.message : String(error),
      })

      throw new ProviderConfigurationError(
        `Failed to delete custom model ${model} for provider ${provider}`,
        provider,
        'CUSTOM_MODEL_DELETE_FAILED'
      )
    }
  }

  /**
   * Test provider credentials
   * Validates credentials by making a test API call to the provider
   * Can test provided credentials or current stored credentials
   * Used for credential verification before saving or for health checks
   * @param provider - The provider name to test credentials for
   * @param credentials - Optional credentials to test (uses stored if not provided)
   * @returns Promise<boolean> - True if credentials are valid, false otherwise
   */
  async testCredentials(provider: string, credentials?: ProviderCredentials): Promise<boolean> {
    logger.info('Testing provider credentials', {
      organizationId: this.organizationId,
      provider,
    })

    try {
      // If no credentials provided (or empty object), resolve the org's saved key from the
      // unified Credential store (BYO keys no longer live inline on the config row).
      if (!credentials || Object.keys(credentials).length === 0) {
        const resolved = await this.getCurrentCredentials(provider, null, null)
        credentials = resolved.credentials

        if (!credentials || Object.keys(credentials).length === 0) {
          throw new Error('No credentials available to test')
        }
      }

      // Use the factory to test credentials
      await this.validateProviderCredentials(provider, credentials)

      logger.info('Credential test successful', {
        organizationId: this.organizationId,
        provider,
      })

      return true
    } catch (error) {
      logger.error('Credential test failed', {
        organizationId: this.organizationId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      })

      return false
    }
  }

  // ===== QUOTA MANAGEMENT METHODS =====

  /**
   * Set quota configuration for a provider
   * Configures usage quotas and limits for system or custom providers
   * @param provider - The provider name to configure
   * @param quotaConfig - Quota configuration parameters
   * @returns Promise<void> - Resolves when quota is successfully configured
   */
  async setQuotaConfiguration(
    provider: string,
    quotaConfig: {
      quotaType: 'trial' | 'paid' | 'free'
      quotaLimit: number
      periodStart?: Date
      periodEnd?: Date
    }
  ): Promise<void> {
    logger.info('Setting quota configuration', {
      organizationId: this.organizationId,
      provider,
      quotaType: quotaConfig.quotaType,
      quotaLimit: quotaConfig.quotaLimit,
    })

    try {
      const now = new Date()
      await this.db
        .insert(schema.ProviderConfiguration)
        .values({
          organizationId: this.organizationId,
          provider,
          providerType: 'SYSTEM', // Default for quota-enabled providers
          quotaType: quotaConfig.quotaType,
          quotaLimit: quotaConfig.quotaLimit,
          quotaUsed: 0,
          quotaPeriodStart: quotaConfig.periodStart ?? null,
          quotaPeriodEnd: quotaConfig.periodEnd ?? null,
          isEnabled: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.ProviderConfiguration.organizationId,
            schema.ProviderConfiguration.provider,
            schema.ProviderConfiguration.providerType,
          ],
          set: {
            quotaType: quotaConfig.quotaType,
            quotaLimit: quotaConfig.quotaLimit,
            quotaUsed: 0,
            quotaPeriodStart: quotaConfig.periodStart ?? null,
            quotaPeriodEnd: quotaConfig.periodEnd ?? null,
            isEnabled: true,
            updatedAt: now,
          },
        })

      logger.info('Successfully set quota configuration', {
        organizationId: this.organizationId,
        provider,
        quotaType: quotaConfig.quotaType,
      })
    } catch (error) {
      logger.error('Failed to set quota configuration', {
        organizationId: this.organizationId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      })

      throw new ProviderConfigurationError(
        `Failed to set quota configuration for provider ${provider}`,
        provider,
        'QUOTA_SET_FAILED'
      )
    }
  }

  /**
   * Get quota information for a provider
   * @param provider - The provider name to get quota info for
   * @returns Promise<QuotaInfo | null> - Quota information or null if not configured
   */
  async getQuotaInfo(provider: string): Promise<{
    quotaType: string | null
    quotaUsed: number
    quotaLimit: number
    quotaPeriodStart: Date | null
    quotaPeriodEnd: Date | null
    usagePercentage: number
    isUnlimited: boolean
  } | null> {
    return this.usageService.getQuotaInfo(this.organizationId, provider)
  }

  /**
   * Get usage statistics for a provider
   * @param provider - The provider name to get stats for
   * @param periodStart - Optional start date for statistics period
   * @param periodEnd - Optional end date for statistics period
   * @returns Promise<UsageStats> - Usage statistics
   */
  async getUsageStats(
    provider: string,
    periodStart?: Date,
    periodEnd?: Date
  ): Promise<{
    totalTokens: number
    totalCost: number
    requestCount: number
    avgResponseTime: number
  }> {
    return this.usageService.getUsageStats(this.organizationId, provider, periodStart, periodEnd)
  }

  /**
   * Reset quota period for a provider
   * @param provider - The provider name to reset quota for
   * @param newPeriodStart - New period start date
   * @param newPeriodEnd - New period end date
   * @returns Promise<void> - Resolves when quota period is reset
   */
  async resetQuotaPeriod(
    provider: string,
    newPeriodStart: Date,
    newPeriodEnd: Date
  ): Promise<void> {
    return this.usageService.resetQuotaPeriod(
      this.organizationId,
      provider,
      newPeriodStart,
      newPeriodEnd
    )
  }

  // ===== MODEL TRANSFORMATION METHODS =====

  /**
   * Build complete ModelData array with all ModelCapabilities from ProviderRegistry
   * Transforms registry models into complete ModelData objects with status, configuration, and capabilities
   * @param provider - The provider name
   * @param basicConfig - Basic configuration with system/custom configs and model settings
   * @param modelConfigurations - Provider-specific model configuration records
   * @returns Promise<ModelData[]> - Complete array of ModelData with all capabilities
   */
  private async _buildCompleteModelDataArray(
    provider: string,
    basicConfig: {
      usingProviderType: ProviderType
      systemConfiguration: SystemConfiguration
      customConfiguration: CustomConfiguration
      modelSettings: ModelSettings[]
    },
    modelConfigurations: ModelConfigurationModel[]
  ): Promise<ModelData[]> {
    // Get provider capabilities from registry
    const providerCapabilities = await ProviderRegistry.getProviderCapabilities(provider)
    const registryModels = ProviderRegistry.getAllModelsForProvider(provider)

    // Get all unique models: registry models + custom models from database
    const allModelNames = new Set([
      ...registryModels,
      ...modelConfigurations.map((config) => config.model),
    ])

    // Create lookup map from provider-specific model configurations for O(1) access
    const modelConfigMap = new Map<string, ModelConfigurationModel>()
    for (const config of modelConfigurations) {
      modelConfigMap.set(config.model, config) // Just use model name as key since it's provider-specific
    }

    // Provider-level configured flag is invariant across all models — resolve once.
    const isProviderConfigured = this._isProviderConfigured(basicConfig)

    return Array.from(allModelNames)
      .map((modelName) => {
        // Try to get model capabilities from registry first
        let modelCapabilities = ProviderRegistry.getModelCapabilities(modelName)

        // If not in registry, create synthetic capabilities for custom model
        if (!modelCapabilities) {
          const modelConfig = modelConfigMap.get(modelName)
          if (modelConfig) {
            modelCapabilities = this._createCustomModelCapabilities(
              modelName,
              provider,
              modelConfig.modelType as ModelType,
              providerCapabilities
            )
          } else {
            // Skip if we can't determine capabilities
            return null
          }
        }

        // Get model configuration from provider-specific array (O(1) lookup!)
        const modelConfig = modelConfigMap.get(modelName)

        // Apply default-enabled logic: models are enabled by default for configured providers
        // `isProviderConfigured` is hoisted above the .map — invariant per provider.
        const modelEnabled = modelConfig?.enabled ?? true // Default: enabled

        // A SYSTEM-credentialed LLM with no list price can't be metered, so it
        // can't run on platform credits (BYO key only). Block its selection.
        const unpricedOnSystem =
          basicConfig.usingProviderType === ProviderType.SYSTEM &&
          modelCapabilities.modelType === ModelType.LLM &&
          !modelCapabilities.costPer1kTokens

        // Determine model status (priority: retired > unpriced-on-system > disabled > deprecated > active)
        let modelStatus: 'active' | 'disabled' | 'not_configured' | 'deprecated' | 'retired'
        if (!isProviderConfigured) {
          modelStatus = 'not_configured'
        } else if (modelCapabilities.retired) {
          modelStatus = 'retired'
        } else if (unpricedOnSystem) {
          modelStatus = 'disabled'
        } else if (modelConfig?.enabled === false) {
          modelStatus = 'disabled'
        } else if (modelCapabilities.deprecated) {
          modelStatus = 'deprecated'
        } else {
          modelStatus = 'active'
        }

        // Check load balancing configuration (moved from ProviderManager)
        const loadBalancingEnabled =
          basicConfig.modelSettings.some(
            (ms) => ms.model === modelName && ms.loadBalancingConfigs.length > 1
          ) || false

        // Return complete ModelData with all ModelCapabilities. `costPer1kTokens`
        // flows through the spread and drives the model-cost badge in the UI.
        return {
          ...modelCapabilities,
          fetchFrom: modelCapabilities.fetchFrom,
          // Additional model state fields
          modelId: modelName,
          enabled: modelEnabled,
          status: modelStatus,
          isDefault: false, // TODO: Implement default model logic
          providerType: basicConfig.usingProviderType === ProviderType.SYSTEM ? 'system' : 'custom',
          isProviderEnabled: isProviderConfigured,
          config: modelConfig?.config || {},
          loadBalancingEnabled,
        } as ModelData
      })
      .filter(Boolean) as ModelData[] // Remove any null entries
  }

  /**
   * Check if provider is configured and available for use
   * @param basicConfig - Basic configuration with system/custom configs
   * @returns boolean - True if provider is configured, false otherwise
   */
  private _isProviderConfigured(basicConfig: {
    usingProviderType: ProviderType
    systemConfiguration: SystemConfiguration
    customConfiguration: CustomConfiguration
  }): boolean {
    if (basicConfig.usingProviderType === ProviderType.SYSTEM) {
      return basicConfig.systemConfiguration.enabled
    } else {
      return !!(
        basicConfig.customConfiguration.provider ||
        basicConfig.customConfiguration.models.length > 0
      )
    }
  }

  /**
   * Calculate comprehensive provider status information
   * Moved from ProviderManager._calculateProviderStatus()
   * @param provider - The provider name
   * @param basicConfig - Basic configuration data
   * @returns ProviderStatusInfo - Complete status information
   */
  private async _calculateProviderStatusInfo(
    provider: string,
    basicConfig: {
      usingProviderType: ProviderType
      systemConfiguration: SystemConfiguration
      customConfiguration: CustomConfiguration
    }
  ): Promise<ProviderStatusInfo> {
    // Move logic from ProviderManager._calculateProviderStatus() (lines 462-506)
    const hasCustomConfig = !!(
      basicConfig.customConfiguration.provider || basicConfig.customConfiguration.models.length > 0
    )
    const hasSystemConfig = basicConfig.systemConfiguration.enabled
    const hasValidCredentials =
      basicConfig.usingProviderType === ProviderType.SYSTEM ? hasSystemConfig : hasCustomConfig

    let status: ProviderStatusInfo['status']
    let configured = false

    if (basicConfig.usingProviderType === ProviderType.SYSTEM) {
      if (hasSystemConfig) {
        status = 'system_configured'
        configured = true
      } else {
        status = 'not_configured'
        configured = false
      }
    } else {
      if (hasCustomConfig) {
        status = 'custom_configured'
        configured = true
      } else {
        status = 'not_configured'
        configured = false
      }
    }

    return {
      configured,
      usingProviderType: basicConfig.usingProviderType,
      status,
      hasValidCredentials,
    }
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Build system configuration object for a provider
   * Constructs system-level configuration including quota types and system-managed credentials
   * System configurations represent centrally managed provider access with usage quotas
   * @param provider - The provider name
   * @param providerRecords - Array of provider configuration records from database
   * @returns Promise<SystemConfiguration> - System configuration object
   */
  private async _buildSystemConfiguration(
    provider: string,
    providerRecords: any[]
  ): Promise<SystemConfiguration> {
    const systemRecord = providerRecords.find((r) => r.providerType === 'SYSTEM')

    // Quota is org-level. Read OrganizationAiQuota; mirror it into the
    // per-provider `quotaConfigurations` shape so the downstream UI that
    // still expects a per-provider quota keeps working without a schema break.
    const quotaConfigurations: SystemConfiguration['quotaConfigurations'] = []
    const orgQuota = await this.db.query.OrganizationAiQuota.findFirst({
      where: eq(schema.OrganizationAiQuota.organizationId, this.organizationId),
    })
    if (orgQuota) {
      const quotaLimit = orgQuota.quotaLimit
      const quotaUsed = orgQuota.quotaUsed
      const isValid = quotaLimit === -1 || (quotaLimit > 0 && quotaUsed < quotaLimit)
      quotaConfigurations.push({
        quotaType: orgQuota.quotaType as ProviderQuotaType,
        quotaUnit: QuotaUnit.CREDITS,
        quotaLimit,
        quotaUsed,
        isValid,
        restrictModels: [],
        quotaPeriodStart: orgQuota.quotaPeriodStart,
        quotaPeriodEnd: orgQuota.quotaPeriodEnd,
      })
    }

    // SYSTEM credentials resolve from env (canonical vocabulary) for eligible providers —
    // there is no inline secret column anymore.
    let credentials: Record<string, any> | undefined
    if (SYSTEM_ELIGIBLE_PROVIDERS.has(provider)) {
      credentials = await this._resolveSystemCredentialsFromEnv(provider)
    }

    return {
      enabled: !!systemRecord?.isEnabled,
      currentQuotaType: orgQuota?.quotaType ? (orgQuota.quotaType as ProviderQuotaType) : undefined,
      quotaConfigurations,
      credentials,
    }
  }

  /**
   * Resolve system credentials from environment via configService.
   * Only called for SYSTEM_ELIGIBLE_PROVIDERS (anthropic, openai).
   *
   * Maps each canonical credential field (`apiKey`, `organization`, …) to its
   * config key (e.g. `OPENAI_API_KEY`) via AI_SYSTEM_ENV_MAP, which configService
   * resolves from DB override → process.env → SST Resource → registry default.
   * Returns the credentials in the canonical vocabulary the provider clients read.
   *
   * Returns undefined if no credentials are found.
   */
  private async _resolveSystemCredentialsFromEnv(
    provider: string
  ): Promise<Record<string, any> | undefined> {
    const envMap = AI_SYSTEM_ENV_MAP[provider]
    if (!envMap) return undefined

    const credentials: Record<string, any> = {}
    let hasAny = false

    for (const [field, configKey] of Object.entries(envMap)) {
      const value = configService.get(configKey)
      if (value) {
        credentials[field] = value
        hasAny = true
      }
    }

    return hasAny ? credentials : undefined
  }

  /**
   * Build custom configuration object for a provider
   * Constructs user-provided configuration including custom credentials and model settings
   * Uses provider records and model configurations to build the configuration
   * @param provider - The provider name
   * @param providerRecords - Array of provider configuration records from database
   * @param modelConfigurations - Array of model configuration records
   * @returns Promise<CustomConfiguration> - Custom configuration object with provider and model configs
   */
  private async _buildCustomConfiguration(
    provider: string,
    providerRecords: ProviderConfigurationModel[],
    modelConfigurations: ModelConfigurationModel[]
  ): Promise<CustomConfiguration> {
    // A BYO key exists when the CUSTOM record points at a blueprint (key in the unified store).
    // Runtime keys resolve from the store in getCurrentCredentials; the masked display path
    // reveals + masks from the store. No inline secret column anymore.
    const customProviderRecord = providerRecords.find((r) => r.providerType === 'CUSTOM')
    const customProvider: CustomProviderConfiguration | undefined =
      customProviderRecord?.connectionDefinitionId ? { credentials: {} } : undefined

    // Model rows carry params/enabled only; pinned keys live in LoadBalancingConfig.
    const customModels: CustomModelConfiguration[] = modelConfigurations.map((mc) => ({
      model: mc.model,
      modelType: mc.modelType as ModelType,
      credentials: undefined,
      parameters: mc.config ? [mc.config] : [], // Convert config to parameters array format
    }))

    return {
      provider: customProvider,
      models: customModels,
    }
  }

  /**
   * Build model settings array for a provider
   * Groups load balancing configurations by model and model type
   * Creates model settings with load balancing configuration for high-availability scenarios
   * @param provider - The provider name
   * @param loadBalancingConfigs - Array of load balancing configuration records
   * @returns Promise<ModelSettings[]> - Array of model settings with load balancing configs
   */
  private async _buildModelSettings(
    provider: string,
    loadBalancingConfigs: LoadBalancingConfigModel[]
  ): Promise<ModelSettings[]> {
    // Group by model and modelType
    const modelGroups = new Map<string, any[]>()

    loadBalancingConfigs.forEach((config) => {
      const key = `${config.model}:${config.modelType}`
      if (!modelGroups.has(key)) {
        modelGroups.set(key, [])
      }
      modelGroups.get(key)!.push(config)
    })

    const modelSettings: ModelSettings[] = []

    for (const [key, configs] of modelGroups) {
      const [model, modelType] = key.split(':')

      // Credentials live in the unified store (resolved via connectionId in getCurrentCredentials);
      // this display shape carries identity only.
      const loadBalancingConfigurations: ModelLoadBalancingConfiguration[] = configs.map(
        (config) => ({
          id: config.id,
          name: config.name,
          credentials: {},
        })
      )

      modelSettings.push({
        model,
        modelType: modelType as ModelType,
        enabled: configs.every((c) => c.enabled),
        loadBalancingConfigs: loadBalancingConfigurations,
      })
    }

    return modelSettings
  }

  /**
   * Validate provider credentials by testing against provider API
   * Delegates validation to provider-specific client implementations
   * Makes actual API calls to verify credentials are valid and have required permissions
   * @param provider - The provider name to validate credentials for
   * @param credentials - The credentials object to validate
   * @returns Promise<void> - Resolves if valid, throws CredentialValidationError if invalid
   * @throws CredentialValidationError - When credentials are invalid or validation fails
   */
  private async validateProviderCredentials(
    provider: string,
    credentials: ProviderCredentials
  ): Promise<void> {
    try {
      // Check if the provider client is available before attempting validation
      const isProviderRegistered = ProviderRegistry.isProviderRegistered(provider)
      if (!isProviderRegistered) {
        logger.warn('Provider client not available for validation', {
          provider,
          organizationId: this.organizationId,
        })
        // Skip validation if provider client is not available (e.g., during build time)
        return
      }

      const providerClient = await ProviderRegistry.createClient(
        provider,
        this.organizationId,
        this.userId
      )

      const result = await providerClient.validateCredentials(credentials)

      if (!result.isValid) {
        throw new CredentialValidationError(
          `Provider credential validation failed: ${result.error}`,
          provider,
          'provider_credentials'
        )
      }
    } catch (error) {
      // Handle client-side errors gracefully
      if (error instanceof Error && error.message.includes('not available on client side')) {
        logger.warn('Skipping validation due to client-side limitation', {
          provider,
          organizationId: this.organizationId,
          error: error.message,
        })
        return
      }

      if (error instanceof CredentialValidationError) {
        throw error
      }
      throw new CredentialValidationError(
        `Provider validation failed: ${error instanceof Error ? error.message : String(error)}`,
        provider,
        'provider_credentials'
      )
    }
  }

  /**
   * Validate model-specific credentials
   * Currently delegates to provider-level validation since models inherit provider credentials
   * Future enhancement could include model-specific validation logic
   * @param provider - The provider name
   * @param model - The model name
   * @param modelType - The model type enum
   * @param credentials - The model credentials to validate
   * @returns Promise<void> - Resolves if valid, throws if invalid
   */
  private async validateModelCredentials(
    provider: string,
    model: string,
    modelType: ModelType,
    credentials: ModelCredentials
  ): Promise<void> {
    // For now, use provider-level validation since models inherit provider credentials
    await this.validateProviderCredentials(provider, credentials)
  }

  // ===== MODEL CONFIGURATION METHODS (MERGED FROM ModelConfigurationService) =====

  /**
   * Get enabled models for organization
   * Retrieves all models that are currently enabled for use within the organization
   * Can be filtered by provider if specified
   * @param provider - Optional provider name to filter by
   * @returns Promise<any[]> - Array of enabled model configuration records
   */
  async getEnabledModels(provider?: string): Promise<any[]> {
    const conditions = [
      eq(schema.ModelConfiguration.organizationId, this.organizationId),
      eq(schema.ModelConfiguration.enabled, true),
    ]

    if (provider) {
      conditions.push(eq(schema.ModelConfiguration.provider, provider))
    }

    return this.db.query.ModelConfiguration.findMany({
      where: and(...conditions),
      columns: {
        id: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        provider: true,
        model: true,
        modelType: true,
        enabled: true,
        config: true,
      },
    })
  }

  /**
   * Get model configuration with parameter values
   * Retrieves the complete configuration for a specific model including custom parameters
   * Returns null if no configuration exists for the model
   * @param provider - The provider name
   * @param model - The model name
   * @returns Promise<any | null> - Model configuration record or null if not found
   */
  async getModelConfiguration(
    provider: string,
    model: string,
    modelType: string = 'llm'
  ): Promise<ModelConfigurationModel | null> {
    const config = await this.db.query.ModelConfiguration.findFirst({
      where: and(
        eq(schema.ModelConfiguration.organizationId, this.organizationId),
        eq(schema.ModelConfiguration.provider, provider),
        eq(schema.ModelConfiguration.model, model),
        eq(schema.ModelConfiguration.modelType, modelType)
      ),
      columns: {
        id: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        provider: true,
        model: true,
        modelType: true,
        enabled: true,
        config: true,
      },
    })

    return config ?? null
  }

  async getAllModelConfigurations(): Promise<ModelConfigurationModel[]> {
    return await this.db.query.ModelConfiguration.findMany({
      where: eq(schema.ModelConfiguration.organizationId, this.organizationId),
      columns: {
        id: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        provider: true,
        model: true,
        modelType: true,
        enabled: true,
        config: true,
      },
    })
  }
  /**
   * Get all model configurations grouped by provider.
   * Returns a map where each key is a provider and the value is an array of model configurations.
   */
  async getAllModelConfigurationsByProvider(): Promise<Map<string, ModelConfigurationModel[]>> {
    const configs = await this.getAllModelConfigurations()

    // Group configurations by provider
    const configMap = new Map<string, ModelConfigurationModel[]>()
    for (const config of configs) {
      if (!configMap.has(config.provider)) {
        configMap.set(config.provider, [])
      }
      configMap.get(config.provider)!.push(config)
    }

    return configMap
  }

  /**
   * Get all model configurations for the organization as a map for efficient lookups
   * Much more efficient than individual getModelConfiguration calls
   * @returns Promise<Map<string, any>> - Map of "provider:model" -> configuration
   */
  async getAllModelConfigurationsMap(): Promise<Map<string, ModelConfigurationModel>> {
    const configs = await this.getAllModelConfigurations()

    // Create a map for O(1) lookups: "provider:model" -> config
    const configMap = new Map<string, ModelConfigurationModel>()
    for (const config of configs) {
      const key = `${config.provider}:${config.model}`
      configMap.set(key, config)
    }

    return configMap
  }

  async getAllProviderConfigurations(): Promise<ProviderConfigurationModel[]> {
    // Get provider records
    return await this.db.query.ProviderConfiguration.findMany({
      where: eq(schema.ProviderConfiguration.organizationId, this.organizationId),
      columns: {
        id: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        provider: true,
        providerType: true,
        connectionDefinitionId: true,
        isEnabled: true,
        quotaType: true,
        quotaLimit: true,
        quotaPeriodStart: true,
        quotaPeriodEnd: true,
        quotaUsed: true,
      },
    })
  }

  async getAllProviderConfigurationsMap(): Promise<Map<string, ProviderConfigurationModel[]>> {
    // Get provider records
    const providerRecords = await this.getAllProviderConfigurations()

    // Group provider configurations by provider (can have multiple per provider: system + custom)
    const providerConfigsByProvider = new Map<string, ProviderConfigurationModel[]>()
    for (const config of providerRecords) {
      if (!providerConfigsByProvider.has(config.provider)) {
        providerConfigsByProvider.set(config.provider, [])
      }
      providerConfigsByProvider.get(config.provider)!.push(config)
    }

    return providerConfigsByProvider
  }
  async getAllLoadBalancingConfigs(): Promise<LoadBalancingConfigModel[]> {
    // Get load balancing configs
    const loadBalancingConfigs = await this.db.query.LoadBalancingConfig.findMany({
      where: eq(schema.LoadBalancingConfig.organizationId, this.organizationId),
      columns: {
        id: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        provider: true,
        model: true,
        modelType: true,
        name: true,
        connectionId: true,
        enabled: true,
        weight: true,
      },
    })

    return loadBalancingConfigs
  }
  /**
   * Get all load balancing configurations grouped by provider.
   * Returns a map where each key is a provider and the value is an array of load balancing configs.
   */
  async getAllLoadBalancingConfigsByProvider(): Promise<Map<string, LoadBalancingConfigModel[]>> {
    const configs = await this.db.query.LoadBalancingConfig.findMany({
      where: eq(schema.LoadBalancingConfig.organizationId, this.organizationId),
      columns: {
        id: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        provider: true,
        model: true,
        modelType: true,
        name: true,
        connectionId: true,
        enabled: true,
        weight: true,
      },
    })

    const configMap = new Map<string, LoadBalancingConfigModel[]>()
    for (const config of configs) {
      if (!configMap.has(config.provider)) {
        configMap.set(config.provider, [])
      }
      configMap.get(config.provider)!.push(config)
    }

    return configMap
  }

  /**
   * Get all provider preferences as a map for efficient lookups
   * Returns a map where each key is a provider and the value is the provider preference model
   * @returns Promise<Map<string, ProviderPreferenceModel>> - Map of provider -> preference
   */
  async getAllProviderPreferencesMap(): Promise<Map<string, ProviderPreferenceModel>> {
    const preferences = await this.getAllProviderPreferences()
    const prefMap = new Map<string, ProviderPreferenceModel>()
    for (const pref of preferences) {
      prefMap.set(pref.provider, pref)
    }
    return prefMap
  }

  async getAllProviderPreferences(): Promise<ProviderPreferenceModel[]> {
    // Get provider preferences
    const providerPreferences = await this.db.query.ProviderPreference.findMany({
      where: eq(schema.ProviderPreference.organizationId, this.organizationId),
      columns: {
        id: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        provider: true,
        preferredType: true,
      },
    })

    return providerPreferences
  }

  /**
   * Toggle model enabled state
   * Enables or disables a model for use within the organization
   * Creates new configuration with defaults if model hasn't been configured before
   * @param provider - The provider name
   * @param model - The model name
   * @param enabled - Boolean flag to enable (true) or disable (false)
   * @returns Promise<void> - Resolves when model state is updated
   */
  async toggleModel(
    provider: string,
    model: string,
    enabled: boolean,
    modelType: string = 'llm'
  ): Promise<void> {
    const now = new Date()
    await this.db
      .insert(schema.ModelConfiguration)
      .values({
        organizationId: this.organizationId,
        provider,
        model,
        modelType,
        enabled,
        config: this.getDefaultModelConfig(model), // Initialize with defaults
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.ModelConfiguration.organizationId,
          schema.ModelConfiguration.provider,
          schema.ModelConfiguration.model,
          schema.ModelConfiguration.modelType,
        ],
        set: {
          enabled,
          updatedAt: now,
        },
      })
  }

  /**
   * Update model parameter configuration
   * Updates custom parameter values for a model (temperature, max_tokens, etc.)
   * Creates new configuration if model hasn't been configured before
   * @param provider - The provider name
   * @param model - The model name
   * @param config - Configuration object with parameter values
   * @returns Promise<void> - Resolves when configuration is updated
   */
  async updateModelConfig(
    provider: string,
    model: string,
    config: Record<string, any>,
    modelType: string = 'llm'
  ): Promise<void> {
    const now = new Date()
    await this.db
      .insert(schema.ModelConfiguration)
      .values({
        organizationId: this.organizationId,
        provider,
        model,
        modelType,
        enabled: true,
        config,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.ModelConfiguration.organizationId,
          schema.ModelConfiguration.provider,
          schema.ModelConfiguration.model,
          schema.ModelConfiguration.modelType,
        ],
        set: {
          config,
          updatedAt: now,
        },
      })
  }

  /**
   * Get default parameter configuration for a model
   * Extracts default parameter values from ModelRegistry capabilities
   * Used when creating new model configurations or resetting to defaults
   * @param modelName - The model name to get defaults for
   * @returns Record<string, any> - Object containing default parameter values
   */
  private getDefaultModelConfig(modelName: string): Record<string, any> {
    const modelCaps = ProviderRegistry.getModelCapabilities(modelName)
    if (!modelCaps?.parameterRules) return {}

    const defaultConfig: Record<string, any> = {}
    for (const rule of modelCaps.parameterRules) {
      if (rule.default !== null && rule.default !== undefined) {
        defaultConfig[rule.name] = rule.default
      }
    }
    return defaultConfig
  }

  /**
   * Get effective configuration (merging defaults with user overrides)
   * Combines model defaults from registry with user-customized values
   * User configurations take precedence over defaults
   * @param provider - The provider name
   * @param model - The model name
   * @returns Promise<Record<string, any>> - Merged configuration object
   */
  async getEffectiveConfig(
    provider: string,
    model: string,
    modelType: string = 'llm'
  ): Promise<Record<string, any>> {
    const modelConfig = await this.getModelConfiguration(provider, model, modelType)
    const defaultConfig = this.getDefaultModelConfig(model)

    // Merge defaults with user config (user config takes precedence)
    return { ...defaultConfig, ...(modelConfig?.config || {}) }
  }

  /**
   * Create synthetic ModelCapabilities for custom models that don't exist in registry
   * Uses provider capabilities as base template and custom model data
   * Only sets values we know for certain, leaves others undefined/null
   * @param modelName - The custom model name/ID
   * @param provider - The provider name
   * @param modelType - The model type enum
   * @param providerCapabilities - Provider capabilities to use as template
   * @returns ModelCapabilities - Synthetic capabilities for the custom model
   */
  private _createCustomModelCapabilities(
    modelName: string,
    provider: string,
    modelType: ModelType,
    providerCapabilities: ProviderCapabilities | null
  ): ModelCapabilities {
    // Only set values we know for certain, leave technical specs undefined
    return {
      provider,
      displayName: modelName, // Use modelId as display name (as per unified dialog)
      icon: providerCapabilities?.icon || '',
      color: providerCapabilities?.color || '',
      modelType,
      fetchFrom: FetchFrom.CUSTOMIZABLE_MODEL, // Mark as custom

      // Keep technical specifications undefined since we don't know them
      contextLength: undefined,
      maxTokens: undefined,
      features: [],
      supports: {},
      costPer1kTokens: undefined,
      deprecated: false,
      releaseDate: undefined,
      description: undefined,
      parameterRules: [],
    } as ModelCapabilities
  }
}
