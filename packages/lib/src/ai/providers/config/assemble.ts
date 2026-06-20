// packages/lib/src/ai/providers/config/assemble.ts

import { configService } from '@auxx/credentials/config'
import type {
  LoadBalancingConfigEntity as LoadBalancingConfigModel,
  ModelConfigurationEntity as ModelConfigurationModel,
  ProviderConfigurationEntity as ProviderConfigurationModel,
  ProviderPreferenceEntity as ProviderPreferenceModel,
} from '@auxx/database/types'
import { createScopedLogger } from '../../../logger'
import { AI_SYSTEM_ENV_MAP } from '../connection-provider-map'
import { ProviderRegistry } from '../provider-registry'
import {
  type CustomConfiguration,
  type CustomModelConfiguration,
  type CustomProviderConfiguration,
  FetchFrom,
  type ModelCapabilities,
  type ModelData,
  type ModelLoadBalancingConfiguration,
  type ModelSettings,
  ModelType,
  type ProviderCapabilities,
  type ProviderConfiguration,
  ProviderConfigurationError,
  type ProviderConfigurations,
  type ProviderQuotaType,
  type ProviderStatusInfo,
  ProviderType,
  QuotaUnit,
  type SystemConfiguration,
} from '../types'
import type { AiProviderCtx } from './context'
import { SYSTEM_ELIGIBLE_PROVIDERS } from './context'
import {
  getAllLoadBalancingConfigsByProvider,
  getAllModelConfigurationsByProvider,
  getAllProviderConfigurationsMap,
  getAllProviderPreferencesMap,
  getLoadBalancingConfigsForProvider,
  getModelConfigurationsForProvider,
  getOrganizationAiQuota,
  getProviderPreference,
  getProviderRecords,
  type OrganizationAiQuotaRow,
} from './queries'

const logger = createScopedLogger('ai-provider-config-assemble')

/**
 * Compute layer (DB-direct) read model for AI provider configurations. These functions
 * feed the org cache compute providers — they must never read the cache, or they recurse.
 */

/** Compute all provider configurations for the org (was ProviderConfigurationService.getConfigurations). */
export async function computeProviderConfigs(ctx: AiProviderCtx): Promise<ProviderConfigurations> {
  logger.info('Computing all provider configurations', { organizationId: ctx.organizationId })

  try {
    const configurations: Record<string, ProviderConfiguration> = {}
    const allProviders = await ProviderRegistry.getAvailableProviders()

    const [
      modelConfigurations,
      providerConfigurationsMap,
      loadBalancingConfigurations,
      providerPreferencesMap,
      orgQuota,
    ] = await Promise.all([
      getAllModelConfigurationsByProvider(ctx),
      getAllProviderConfigurationsMap(ctx),
      getAllLoadBalancingConfigsByProvider(ctx),
      getAllProviderPreferencesMap(ctx),
      getOrganizationAiQuota(ctx),
    ])

    for (const provider of allProviders) {
      const providerConfigRecords = providerConfigurationsMap.get(provider) || []
      const providerPrefRecord = providerPreferencesMap.get(provider) || null

      configurations[provider] = await assembleProviderConfiguration(
        ctx,
        provider,
        providerConfigRecords,
        modelConfigurations.get(provider) || [],
        loadBalancingConfigurations.get(provider) || [],
        providerPrefRecord,
        orgQuota
      )
    }

    return { organizationId: ctx.organizationId, configurations }
  } catch (error) {
    logger.error('Failed to compute provider configurations', {
      organizationId: ctx.organizationId,
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
 * Compute the complete configuration for a single provider, fetching its rows directly
 * (was ProviderConfigurationService.getProviderConfiguration + _getProviderConfiguration).
 */
export async function computeProviderConfig(
  ctx: AiProviderCtx,
  provider: string
): Promise<ProviderConfiguration> {
  try {
    const [
      providerRecords,
      modelConfigurations,
      loadBalancingConfigs,
      providerPreference,
      orgQuota,
    ] = await Promise.all([
      getProviderRecords(ctx, provider),
      getModelConfigurationsForProvider(ctx, provider),
      getLoadBalancingConfigsForProvider(ctx, provider),
      getProviderPreference(ctx, provider),
      getOrganizationAiQuota(ctx),
    ])

    return await assembleProviderConfiguration(
      ctx,
      provider,
      providerRecords,
      modelConfigurations,
      loadBalancingConfigs,
      providerPreference,
      orgQuota
    )
  } catch (error) {
    logger.error('Failed to compute provider configuration', {
      organizationId: ctx.organizationId,
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
 * Assemble a ProviderConfiguration from already-fetched rows. Shared by the bulk and
 * single-provider compute paths.
 */
async function assembleProviderConfiguration(
  ctx: AiProviderCtx,
  provider: string,
  providerRecords: ProviderConfigurationModel[],
  modelConfigurations: ModelConfigurationModel[],
  loadBalancingConfigs: LoadBalancingConfigModel[],
  providerPreference: ProviderPreferenceModel | null,
  orgQuota: OrganizationAiQuotaRow
): Promise<ProviderConfiguration> {
  try {
    const systemConfig = buildSystemConfiguration(provider, providerRecords, orgQuota)
    const customConfig = buildCustomConfiguration(providerRecords, modelConfigurations)
    const modelSettings = buildModelSettings(loadBalancingConfigs)

    // Default to CUSTOM if no preference is set (the case for most users).
    const preferredProviderType =
      providerPreference?.preferredType === 'SYSTEM' ? ProviderType.SYSTEM : ProviderType.CUSTOM

    // BYO keys live in the unified Credential store, so "custom available" = the CUSTOM
    // record points at a blueprint OR a pool binding references a credential.
    const systemViable = systemConfig.enabled
    const customRecord = providerRecords.find((r) => r.providerType === 'CUSTOM')
    const customAvailable =
      !!customRecord?.connectionDefinitionId || loadBalancingConfigs.some((c) => !!c.connectionId)

    let usingProviderType: ProviderType
    if (preferredProviderType === ProviderType.SYSTEM) {
      if (systemViable) usingProviderType = ProviderType.SYSTEM
      else if (customAvailable) usingProviderType = ProviderType.CUSTOM
      else usingProviderType = ProviderType.SYSTEM
    } else {
      if (customAvailable) usingProviderType = ProviderType.CUSTOM
      else if (systemViable) usingProviderType = ProviderType.SYSTEM
      else usingProviderType = ProviderType.CUSTOM
    }

    const basicConfig = {
      usingProviderType,
      systemConfiguration: systemConfig,
      customConfiguration: customConfig,
      modelSettings,
    }

    const providerCapabilities = await ProviderRegistry.getProviderCapabilities(provider)
    const models: ModelData[] = await buildModelDataArray(
      provider,
      basicConfig,
      modelConfigurations
    )
    const statusInfo = calculateProviderStatusInfo(basicConfig)

    return {
      provider,
      label: providerCapabilities?.displayName || provider,
      statusInfo,
      models,
      isDefaultProvider: false,
      connectionVariables: providerCapabilities?.connectionVariables || [],
      fieldMeta: providerCapabilities?.fieldMeta || {},
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
      organizationId: ctx.organizationId,
      preferredProviderType,
      usingProviderType,
      systemConfiguration: systemConfig,
      customConfiguration: customConfig,
      modelSettings,
    }
  } catch (error) {
    logger.error('Failed to assemble provider configuration', {
      organizationId: ctx.organizationId,
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
 * Build system configuration object for a provider. Quota is org-level (OrganizationAiQuota),
 * mirrored into the per-provider quota shape the downstream UI still expects.
 */
function buildSystemConfiguration(
  provider: string,
  providerRecords: ProviderConfigurationModel[],
  orgQuota: OrganizationAiQuotaRow
): SystemConfiguration {
  const systemRecord = providerRecords.find((r) => r.providerType === 'SYSTEM')

  const quotaConfigurations: SystemConfiguration['quotaConfigurations'] = []
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

  // SYSTEM credentials resolve from env for eligible providers — no inline secret column.
  let credentials: Record<string, any> | undefined
  if (SYSTEM_ELIGIBLE_PROVIDERS.has(provider)) {
    credentials = resolveSystemCredentialsFromEnv(provider)
  }

  return {
    enabled: !!systemRecord?.isEnabled,
    currentQuotaType: orgQuota?.quotaType ? (orgQuota.quotaType as ProviderQuotaType) : undefined,
    quotaConfigurations,
    credentials,
  }
}

/**
 * Resolve system credentials from environment via configService. Only called for
 * SYSTEM_ELIGIBLE_PROVIDERS (anthropic, openai). Maps each canonical credential field to its
 * config key via AI_SYSTEM_ENV_MAP. Returns undefined if no credentials are found.
 */
export function resolveSystemCredentialsFromEnv(provider: string): Record<string, any> | undefined {
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
 * Build custom configuration object for a provider. A BYO key exists when the CUSTOM record
 * points at a blueprint (key in the unified store); model rows carry params/enabled only.
 */
function buildCustomConfiguration(
  providerRecords: ProviderConfigurationModel[],
  modelConfigurations: ModelConfigurationModel[]
): CustomConfiguration {
  const customProviderRecord = providerRecords.find((r) => r.providerType === 'CUSTOM')
  const customProvider: CustomProviderConfiguration | undefined =
    customProviderRecord?.connectionDefinitionId ? { credentials: {} } : undefined

  const customModels: CustomModelConfiguration[] = modelConfigurations.map((mc) => ({
    model: mc.model,
    modelType: mc.modelType as ModelType,
    credentials: undefined,
    parameters: mc.config ? [mc.config] : [],
  }))

  return { provider: customProvider, models: customModels }
}

/**
 * Build model settings array for a provider, grouping load balancing configs by model and
 * model type. Credentials live in the unified store; this display shape carries identity only.
 */
function buildModelSettings(loadBalancingConfigs: LoadBalancingConfigModel[]): ModelSettings[] {
  const modelGroups = new Map<string, LoadBalancingConfigModel[]>()
  for (const config of loadBalancingConfigs) {
    const key = `${config.model}:${config.modelType}`
    if (!modelGroups.has(key)) modelGroups.set(key, [])
    modelGroups.get(key)!.push(config)
  }

  const modelSettings: ModelSettings[] = []
  for (const [key, configs] of modelGroups) {
    const [model, modelType] = key.split(':')
    const loadBalancingConfigurations: ModelLoadBalancingConfiguration[] = configs.map(
      (config) => ({ id: config.id, name: config.name, credentials: {} })
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
 * Build complete ModelData array with all ModelCapabilities from ProviderRegistry. Transforms
 * registry + custom models into ModelData objects with status, configuration, and capabilities.
 */
async function buildModelDataArray(
  provider: string,
  basicConfig: {
    usingProviderType: ProviderType
    systemConfiguration: SystemConfiguration
    customConfiguration: CustomConfiguration
    modelSettings: ModelSettings[]
  },
  modelConfigurations: ModelConfigurationModel[]
): Promise<ModelData[]> {
  const providerCapabilities = await ProviderRegistry.getProviderCapabilities(provider)
  const registryModels = ProviderRegistry.getAllModelsForProvider(provider)

  const allModelNames = new Set([
    ...registryModels,
    ...modelConfigurations.map((config) => config.model),
  ])

  const modelConfigMap = new Map<string, ModelConfigurationModel>()
  for (const config of modelConfigurations) modelConfigMap.set(config.model, config)

  // Provider-level configured flag is invariant across all models — resolve once.
  const providerConfigured = isProviderConfigured(basicConfig)

  return Array.from(allModelNames)
    .map((modelName) => {
      let modelCapabilities = ProviderRegistry.getModelCapabilities(modelName)

      if (!modelCapabilities) {
        const modelConfig = modelConfigMap.get(modelName)
        if (modelConfig) {
          modelCapabilities = createCustomModelCapabilities(
            modelName,
            provider,
            modelConfig.modelType as ModelType,
            providerCapabilities
          )
        } else {
          return null
        }
      }

      const modelConfig = modelConfigMap.get(modelName)
      const modelEnabled = modelConfig?.enabled ?? true

      // A SYSTEM-credentialed LLM with no list price can't be metered, so it can't run on
      // platform credits (BYO key only). Block its selection.
      const unpricedOnSystem =
        basicConfig.usingProviderType === ProviderType.SYSTEM &&
        modelCapabilities.modelType === ModelType.LLM &&
        !modelCapabilities.costPer1kTokens

      let modelStatus: 'active' | 'disabled' | 'not_configured' | 'deprecated' | 'retired'
      if (!providerConfigured) {
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

      const loadBalancingEnabled =
        basicConfig.modelSettings.some(
          (ms) => ms.model === modelName && ms.loadBalancingConfigs.length > 1
        ) || false

      return {
        ...modelCapabilities,
        fetchFrom: modelCapabilities.fetchFrom,
        modelId: modelName,
        enabled: modelEnabled,
        status: modelStatus,
        isDefault: false,
        providerType: basicConfig.usingProviderType === ProviderType.SYSTEM ? 'system' : 'custom',
        isProviderEnabled: providerConfigured,
        config: modelConfig?.config || {},
        loadBalancingEnabled,
      } as ModelData
    })
    .filter(Boolean) as ModelData[]
}

/** Check if provider is configured and available for use. */
function isProviderConfigured(basicConfig: {
  usingProviderType: ProviderType
  systemConfiguration: SystemConfiguration
  customConfiguration: CustomConfiguration
}): boolean {
  if (basicConfig.usingProviderType === ProviderType.SYSTEM) {
    return basicConfig.systemConfiguration.enabled
  }
  return !!(
    basicConfig.customConfiguration.provider || basicConfig.customConfiguration.models.length > 0
  )
}

/** Calculate comprehensive provider status information. */
function calculateProviderStatusInfo(basicConfig: {
  usingProviderType: ProviderType
  systemConfiguration: SystemConfiguration
  customConfiguration: CustomConfiguration
}): ProviderStatusInfo {
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
    }
  } else {
    if (hasCustomConfig) {
      status = 'custom_configured'
      configured = true
    } else {
      status = 'not_configured'
    }
  }

  return {
    configured,
    usingProviderType: basicConfig.usingProviderType,
    status,
    hasValidCredentials,
  }
}

/**
 * Create synthetic ModelCapabilities for custom models that don't exist in the registry.
 * Uses provider capabilities as a base template; only sets values we know for certain.
 */
function createCustomModelCapabilities(
  modelName: string,
  provider: string,
  modelType: ModelType,
  providerCapabilities: ProviderCapabilities | null
): ModelCapabilities {
  return {
    provider,
    displayName: modelName,
    icon: providerCapabilities?.icon || '',
    color: providerCapabilities?.color || '',
    modelType,
    fetchFrom: FetchFrom.CUSTOMIZABLE_MODEL,
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
