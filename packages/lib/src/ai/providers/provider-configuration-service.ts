// packages/lib/src/ai/providers/provider-configuration-service.ts
import { type Database, schema } from '@auxx/database'
import type {
  LoadBalancingConfigEntity as LoadBalancingConfigModel,
  ModelConfigurationEntity as ModelConfigurationModel,
  ProviderConfigurationEntity as ProviderConfigurationModel,
  ProviderPreferenceEntity as ProviderPreferenceModel,
} from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import { UsageTrackingService } from '../usage/usage-tracking-service'
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
  type ModelType,
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
import { mergeCredentialsWithHidden, obfuscateCredentials } from './utils'

const logger = createScopedLogger('ProviderConfigurationService')

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
          credentials: true,
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
          credentials: true,
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
          credentials: true,
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

      // Check availability of each provider type
      const systemViable = systemConfig.enabled && this._hasValidQuota(systemConfig)
      const customAvailable = this._hasCustomCredentials(customConfig)

      // Determine actual provider type with fallback logic
      let usingProviderType: ProviderType

      if (preferredProviderType === ProviderType.SYSTEM) {
        if (systemViable) {
          // Preferred SYSTEM is available
          usingProviderType = ProviderType.SYSTEM
        } else if (customAvailable) {
          // SYSTEM exhausted/disabled, fallback to CUSTOM
          usingProviderType = ProviderType.CUSTOM
        } else {
          // Neither available, stay with SYSTEM to show quota_exceeded status
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
      const statusInfo = this._calculateProviderStatusInfo(provider, basicConfig)

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
      // Validate credentials if not skipped
      if (!options.skipValidation) {
        await this.validateProviderCredentials(provider, credentials)
        logger.info('✅ Credentials validated successfully for', provider)
      }

      // Encrypt credentials
      const encryptedCredentials = await this._encryptCredentials(credentials)

      // Upsert provider configuration
      const now = new Date()
      await this.db
        .insert(schema.ProviderConfiguration)
        .values({
          organizationId: this.organizationId,
          provider,
          providerType: 'CUSTOM',
          credentials: encryptedCredentials,
          isEnabled: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.ProviderConfiguration.organizationId,
            schema.ProviderConfiguration.provider,
          ],
          set: {
            credentials: encryptedCredentials,
            providerType: 'CUSTOM',
            isEnabled: true,
            updatedAt: now,
          },
        })

      // Update provider preference to custom
      await this.switchProviderType(provider, ProviderType.CUSTOM)

      // Initialize all models for this provider as enabled by default
      // await this.initializeProviderModels(provider);

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
      // Validate only the provided credentials
      await this.validateProviderCredentials(provider, credentialUpdates)

      // Get existing credentials
      const existingConfig = await this.getProviderConfiguration(provider)
      const existingCredentials = existingConfig.customConfiguration.provider?.credentials || {}

      // Merge existing with updates
      const mergedCredentials = { ...existingCredentials, ...credentialUpdates }

      // Encrypt the merged credentials
      const encryptedCredentials = await this._encryptCredentials(mergedCredentials)

      // Update the provider configuration
      const now = new Date()
      await this.db
        .insert(schema.ProviderConfiguration)
        .values({
          organizationId: this.organizationId,
          provider,
          providerType: 'CUSTOM',
          credentials: encryptedCredentials,
          isEnabled: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.ProviderConfiguration.organizationId,
            schema.ProviderConfiguration.provider,
          ],
          set: {
            credentials: encryptedCredentials,
            providerType: 'CUSTOM',
            isEnabled: true,
            updatedAt: now,
          },
        })

      // Update provider preference to custom
      await this.switchProviderType(provider, ProviderType.CUSTOM)

      // Initialize all models for this provider as enabled by default (safe due to skipDuplicates)
      // await this.initializeProviderModels(provider);

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
      // Get existing credentials to handle hidden fields
      let finalCredentials = credentials

      // Check if any credentials have '[**HIDDEN**]' values
      const hasHiddenFields = Object.values(credentials).some((value) => value === '[**HIDDEN**]')

      if (hasHiddenFields) {
        // Fetch existing model configuration to get current credentials
        const existingModel = await this.db.query.ModelConfiguration.findFirst({
          where: and(
            eq(schema.ModelConfiguration.organizationId, this.organizationId),
            eq(schema.ModelConfiguration.provider, provider),
            eq(schema.ModelConfiguration.model, model),
            eq(schema.ModelConfiguration.modelType, modelType)
          ),
          columns: {
            credentials: true,
          },
        })

        if (existingModel?.credentials) {
          // Decrypt existing credentials and merge with new ones
          const existingDecrypted = await this._decryptCredentials(existingModel.credentials as any)
          finalCredentials = mergeCredentialsWithHidden(credentials, existingDecrypted)
        }
      }

      // Validate final credentials if not skipped
      if (!options.skipValidation) {
        await this.validateModelCredentials(provider, model, modelType, finalCredentials)
      }

      // Encrypt final credentials
      const encryptedCredentials = await this._encryptCredentials(finalCredentials)

      // Upsert model configuration
      const now = new Date()
      await this.db
        .insert(schema.ModelConfiguration)
        .values({
          organizationId: this.organizationId,
          provider,
          model,
          modelType,
          config: {}, // Initialize with empty config object
          enabled: true,
          credentials: encryptedCredentials,
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
            config: {},
            enabled: true,
            credentials: encryptedCredentials,
            updatedAt: now,
          },
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
      let credentials: Record<string, any> | null = null
      let credentialSource: 'SYSTEM' | 'CUSTOM' | 'MODEL_SPECIFIC' | 'LOAD_BALANCED' = 'CUSTOM'

      if (config.usingProviderType === ProviderType.SYSTEM) {
        // System provider: return system credentials
        credentials = config.systemConfiguration.credentials || null
        credentialSource = 'SYSTEM'
      } else {
        // Custom provider: handle provider vs model mode
        if (!model || !modelType) {
          // Provider mode: return provider-level credentials only
          credentials = config.customConfiguration.provider?.credentials || null
          credentialSource = 'CUSTOM'
        } else {
          // Model mode: try model-specific credentials first, then fall back to provider
          const modelConfig = config.customConfiguration.models.find(
            (m) => m.model === model && m.modelType === modelType
          )

          if (modelConfig?.credentials) {
            credentials = modelConfig.credentials
            credentialSource = 'MODEL_SPECIFIC'
          } else {
            // Check for load balancing
            const modelSettings = config.modelSettings.find(
              (ms) => ms.model === model && ms.modelType === modelType
            )
            if (modelSettings && modelSettings.loadBalancingConfigs.length > 1) {
              credentialSource = 'LOAD_BALANCED'
            } else {
              credentialSource = 'CUSTOM'
            }
            // Fall back to provider-level credentials
            credentials = config.customConfiguration.provider?.credentials || null
          }
        }
      }

      const response: CredentialsResponse = {
        credentials: credentials || {},
        // Include provider type for quota tracking
        providerType: config.usingProviderType === ProviderType.SYSTEM ? 'SYSTEM' : 'CUSTOM',
        credentialSource,
      }

      // Add load balancing config for model mode (available in modelSettings)
      if (model && modelType) {
        const modelSettings = config.modelSettings.find(
          (ms) => ms.model === model && ms.modelType === modelType
        )

        if (modelSettings && modelSettings.loadBalancingConfigs.length > 0) {
          response.load_balancing = {
            enabled: modelSettings.loadBalancingConfigs.length > 1,
            configs: modelSettings.loadBalancingConfigs.map((lbConfig) => ({
              id: lbConfig.id,
              name: lbConfig.name,
              credentials: lbConfig.credentials,
              enabled: true,
              in_cooldown: false,
              ttl: 0,
            })),
          }
        } else {
          response.load_balancing = {
            enabled: false,
            configs: [],
          }
        }
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

  async getCustomProviderCredentials(
    provider: string,
    model: string | null,
    modelType: ModelType | null,
    obfuscate: boolean
  ): Promise<CredentialsResponse> {
    logger.info('Getting custom provider credentials', {
      organizationId: this.organizationId,
      provider,
      model,
      modelType,
    })
    try {
      const config = await this.getProviderConfiguration(provider)

      let credentials: Record<string, any> // | null = null

      if (config.usingProviderType === ProviderType.SYSTEM) {
        // System provider: return system credentials
        credentials = {}
      } else {
        // Custom provider: handle provider vs model mode
        if (!model || !modelType) {
          // Provider mode: return provider-level credentials only
          credentials = config.customConfiguration.provider?.credentials!
        } else {
          // Model mode: try model-specific credentials first, then fall back to provider
          const modelConfig = config.customConfiguration.models.find(
            (m) => m.model === model && m.modelType === modelType
          )

          if (modelConfig?.credentials) {
            credentials = modelConfig.credentials
          } else {
            // Fall back to provider-level credentials
            credentials = config.customConfiguration.provider?.credentials!
          }
        }
      }
      // Obfuscate credentials if requested
      if (obfuscate) {
        credentials = await this._obfuscateProviderCredentials(credentials || {}, provider)!
      }

      return { credentials }
    } catch (error) {
      logger.error('Failed to get custom provider credentials', {
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
   * Get all provider configurations for the organization
   * Retrieves configuration status for all available providers in the system
   * Returns array of provider objects with status, credentials (masked), and metadata
   * Used primarily for admin interfaces to show all provider statuses at once
   * @returns Promise<any[]> - Array of provider configuration objects with status information
   * @throws ProviderConfigurationError - When retrieval of provider configurations fails
   */
  async getAllProviders(): Promise<any[]> {
    logger.info('Getting all provider configurations', {
      organizationId: this.organizationId,
    })

    try {
      // allProviders is a list of [openai, anthropic, etc]
      const allProviders = Object.keys(ProviderRegistry.getAllProviders())

      const providerConfigs = await Promise.all(
        allProviders.map(async (provider) => {
          const config = await this.getProviderConfiguration(provider)
          const providerCaps = await ProviderRegistry.getProviderCapabilities(provider)

          // Check if provider is configured
          const isConfigured =
            config.usingProviderType === ProviderType.SYSTEM
              ? config.systemConfiguration.enabled
              : !!config.customConfiguration.provider

          // Get masked credentials if configured
          const credentials = isConfigured
            ? await this._obfuscateProviderCredentials(
                config.customConfiguration.provider?.credentials || {},
                provider
              )
            : {}

          return {
            id: `${provider}_${this.organizationId}`, // Generate consistent ID
            provider,
            model: providerCaps?.defaultModel || 'default',
            credentials, // Return full credentials object as expected by frontend
            status: isConfigured ? 'VALID' : 'NOT_CONFIGURED',
            isDefault: false, // TODO: Implement default logic
            organizationId: this.organizationId,
            userId: this.userId,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        })
      )

      return providerConfigs
    } catch (error) {
      logger.error('Failed to get all provider configurations', {
        organizationId: this.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new ProviderConfigurationError(
        'Failed to get provider configurations',
        'all',
        'GET_ALL_FAILED'
      )
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
    hasQuota: boolean
  }> {
    logger.info('Removing custom provider credentials', {
      organizationId: this.organizationId,
      provider,
    })

    try {
      // 1. Get current configuration to check quota status
      const config = await this.db.query.ProviderConfiguration.findFirst({
        where: and(
          eq(schema.ProviderConfiguration.organizationId, this.organizationId),
          eq(schema.ProviderConfiguration.provider, provider)
        ),
      })

      if (!config) {
        return {
          removed: false,
          switchedToSystem: false,
          hasQuota: false,
        }
      }

      const hasQuota = !!(
        config.quotaLimit &&
        config.quotaLimit > 0 &&
        config.quotaUsed < config.quotaLimit
      )

      // 2. Update the row: clear credentials and switch to SYSTEM
      const now = new Date()
      await this.db
        .update(schema.ProviderConfiguration)
        .set({
          credentials: null,
          providerType: 'SYSTEM',
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.ProviderConfiguration.organizationId, this.organizationId),
            eq(schema.ProviderConfiguration.provider, provider)
          )
        )

      // 3. Update preference to SYSTEM
      await this.switchProviderType(provider, ProviderType.SYSTEM)

      // 4. Delete load balancing configs (tied to custom credentials)
      await this.db
        .delete(schema.LoadBalancingConfig)
        .where(
          and(
            eq(schema.LoadBalancingConfig.organizationId, this.organizationId),
            eq(schema.LoadBalancingConfig.provider, provider)
          )
        )

      // Note: Custom models (ModelConfiguration) are kept - they may have their own credentials

      logger.info('Successfully removed custom provider credentials', {
        organizationId: this.organizationId,
        provider,
        switchedToSystem: true,
        hasQuota,
      })

      return {
        removed: true,
        switchedToSystem: true,
        hasQuota,
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

      return { deleted: result.length > 0 }
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
      // If no credentials provided (or empty object), get current ones from database
      if (!credentials || Object.keys(credentials).length === 0) {
        const config = await this.getProviderConfiguration(provider)
        credentials = config.customConfiguration.provider?.credentials

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
          ],
          set: {
            quotaType: quotaConfig.quotaType,
            quotaLimit: quotaConfig.quotaLimit,
            quotaUsed: 0,
            quotaPeriodStart: quotaConfig.periodStart ?? null,
            quotaPeriodEnd: quotaConfig.periodEnd ?? null,
            providerType: 'SYSTEM',
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
        const isProviderConfigured = this._isProviderConfigured(basicConfig)
        const modelEnabled = modelConfig?.enabled ?? true // Default: enabled

        // Determine model status (moved from ProviderManager.getModelStatus)
        let modelStatus: 'active' | 'disabled' | 'not_configured'
        if (!isProviderConfigured) {
          modelStatus = 'not_configured' // Provider not set up
        } else if (modelCapabilities.deprecated || modelConfig?.enabled === false) {
          modelStatus = 'disabled' // Explicitly disabled or deprecated
        } else {
          modelStatus = 'active' // Default: enabled for configured providers
        }

        // Check load balancing configuration (moved from ProviderManager)
        const loadBalancingEnabled =
          basicConfig.modelSettings.some(
            (ms) => ms.model === modelName && ms.loadBalancingConfigs.length > 1
          ) || false

        // Return complete ModelData with all ModelCapabilities
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
      return (
        basicConfig.systemConfiguration.enabled &&
        this._hasValidQuota(basicConfig.systemConfiguration)
      )
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
  private _calculateProviderStatusInfo(
    provider: string,
    basicConfig: {
      usingProviderType: ProviderType
      systemConfiguration: SystemConfiguration
      customConfiguration: CustomConfiguration
    }
  ): ProviderStatusInfo {
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
        if (this._hasValidQuota(basicConfig.systemConfiguration)) {
          status = 'system_configured'
          configured = true
        } else {
          status = 'quota_exceeded'
          configured = false
        }
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
      quotaStatus: this._getProviderQuotaInfo(basicConfig) || undefined,
    }
  }

  /**
   * Get provider quota information
   * Moved from ProviderManager._getProviderQuotaInfo()
   * @param basicConfig - Basic configuration with system config
   * @returns object | null - Quota information or null if not applicable
   */
  private _getProviderQuotaInfo(basicConfig: {
    usingProviderType: ProviderType
    systemConfiguration: SystemConfiguration
  }) {
    // Always show quota if system configuration has quota available
    // This lets users see their available credits even when using custom credentials
    const activeQuota = basicConfig.systemConfiguration.quotaConfigurations.find(
      (q) => q.quotaType === basicConfig.systemConfiguration.currentQuotaType
    )

    if (activeQuota) {
      return {
        type: activeQuota.quotaType,
        used: activeQuota.quotaUsed,
        limit: activeQuota.quotaLimit,
        isValid: activeQuota.isValid,
        resetsAt: activeQuota.quotaPeriodEnd ?? null,
      }
    }
    return null
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Obfuscate provider credentials for safe display
   * Uses provider-specific credential form schemas to identify secret fields and mask them appropriately
   * Falls back to simple pattern matching if schemas are not available
   * @param credentials - The credentials object to obfuscate
   * @param providerName - The provider name to get credential form schemas
   * @returns Record<string, any> - Credentials object with sensitive values obfuscated
   */
  private async _obfuscateProviderCredentials(
    credentials: Record<string, any>,
    providerName: string
  ) {
    try {
      const providerCaps = await ProviderRegistry.getProviderCapabilities(providerName)

      if (providerCaps?.credentialSchema) {
        return obfuscateCredentials(credentials, providerCaps.credentialSchema)
      }
    } catch (error) {
      logger.warn('Failed to get provider capabilities for credential obfuscation', {
        provider: providerName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

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
    // This would integrate with your hosting configuration
    // For now, return a basic implementation
    const systemRecord = providerRecords.find((r) => r.providerType === 'SYSTEM')

    // Build quota configurations from the system record
    const quotaConfigurations: SystemConfiguration['quotaConfigurations'] = []
    if (systemRecord?.quotaType && systemRecord?.quotaLimit !== undefined) {
      const quotaLimit = systemRecord.quotaLimit ?? 0
      const quotaUsed = systemRecord.quotaUsed ?? 0
      // Calculate isValid: unlimited (-1) or has remaining quota
      const isValid = quotaLimit === -1 || (quotaLimit > 0 && quotaUsed < quotaLimit)

      quotaConfigurations.push({
        quotaType: systemRecord.quotaType as ProviderQuotaType,
        quotaUnit: QuotaUnit.CREDITS,
        quotaLimit,
        quotaUsed,
        isValid,
        restrictModels: [],
        quotaPeriodStart: systemRecord.quotaPeriodStart ?? null,
        quotaPeriodEnd: systemRecord.quotaPeriodEnd ?? null,
      })
    }

    return {
      enabled: !!systemRecord?.isEnabled,
      currentQuotaType: systemRecord?.quotaType
        ? (systemRecord.quotaType as ProviderQuotaType)
        : undefined,
      quotaConfigurations,
      credentials: systemRecord?.credentials
        ? await this._decryptCredentials(systemRecord.credentials)
        : undefined,
    }
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
    // Look for CUSTOM record first, then fallback to any record with credentials
    // This handles the case where providerType may have been switched but credentials still exist
    const customProviderRecord =
      providerRecords.find((r) => r.providerType === 'CUSTOM') ||
      providerRecords.find((r) => r.credentials && Object.keys(r.credentials).length > 0)

    // Check if there is a custom provider configuration with actual credentials
    let customProvider: CustomProviderConfiguration | undefined

    if (
      customProviderRecord?.credentials &&
      Object.keys(customProviderRecord.credentials).length > 0
    ) {
      customProvider = {
        credentials: await this._decryptCredentials(customProviderRecord.credentials),
      }
    }

    // Model configurations now contain config, not parameters
    const customModels: CustomModelConfiguration[] = await Promise.all(
      modelConfigurations.map(async (mc) => ({
        model: mc.model,
        modelType: mc.modelType as ModelType,
        credentials: mc.credentials,
        parameters: mc.config ? [mc.config] : [], // Convert config to parameters array format
      }))
    )

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

      const loadBalancingConfigurations: ModelLoadBalancingConfiguration[] = await Promise.all(
        configs.map(async (config) => ({
          id: config.id,
          name: config.name,
          credentials: await this._decryptCredentials(config.credentials),
        }))
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
   * Check if system configuration has valid remaining quota
   * @param systemConfig - The system configuration to check
   * @returns boolean - true if quota is available (unlimited or has remaining credits)
   */
  private _hasValidQuota(systemConfig: SystemConfiguration): boolean {
    if (!systemConfig.enabled) return false
    if (systemConfig.quotaConfigurations.length === 0) return false

    return systemConfig.quotaConfigurations.some((q) => {
      // quotaLimit = -1 means unlimited
      if (q.quotaLimit === -1) return true
      // quotaLimit = 0 means no quota available
      if (q.quotaLimit === 0) return false
      // Check if we have remaining quota
      return q.quotaUsed < q.quotaLimit
    })
  }

  /**
   * Check if custom configuration has valid credentials
   * Provider-level credentials or model-specific credentials count as "has credentials"
   * @param customConfig - The custom configuration to check
   * @returns boolean - true if any custom credentials exist
   */
  private _hasCustomCredentials(customConfig: CustomConfiguration): boolean {
    // Check provider-level credentials
    if (
      customConfig.provider?.credentials &&
      Object.keys(customConfig.provider.credentials).length > 0
    ) {
      return true
    }
    // Check model-specific credentials
    return customConfig.models.some((m) => m.credentials && Object.keys(m.credentials).length > 0)
  }

  /**
   * Encrypt credentials for secure storage
   * TODO: Implement proper encryption using existing encryption utilities
   * Currently returns credentials as-is but should encrypt sensitive fields in production
   * @param credentials - The credentials object to encrypt
   * @returns Promise<Record<string, any>> - Encrypted credentials object
   */
  private async _encryptCredentials(
    credentials: Record<string, any>
  ): Promise<Record<string, any>> {
    // TODO: Implement proper encryption using your existing encryption utilities
    // For now, return as-is (in production, encrypt sensitive fields)
    return credentials
  }

  /**
   * Decrypt credentials for use
   * TODO: Implement proper decryption using existing encryption utilities
   * Currently returns credentials as-is but should decrypt sensitive fields in production
   * @param encryptedCredentials - The encrypted credentials object to decrypt
   * @returns Promise<Record<string, any>> - Decrypted credentials object
   */
  private async _decryptCredentials(encryptedCredentials: any): Promise<Record<string, any>> {
    // TODO: Implement proper decryption using your existing encryption utilities
    // For now, return as-is (in production, decrypt sensitive fields)
    return encryptedCredentials || {}
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
        credentials: true,
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
        credentials: true,
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
        credentials: true,
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
        credentials: true,
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
        credentials: true,
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
        credentials: true,
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
