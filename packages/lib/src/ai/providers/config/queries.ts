// packages/lib/src/ai/providers/config/queries.ts

import { schema } from '@auxx/database'
import type {
  LoadBalancingConfigEntity as LoadBalancingConfigModel,
  ModelConfigurationEntity as ModelConfigurationModel,
  ProviderConfigurationEntity as ProviderConfigurationModel,
  ProviderPreferenceEntity as ProviderPreferenceModel,
} from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import type { AiProviderCtx } from './context'

// ===== Provider configuration rows =====

export async function getAllProviderConfigurations(
  ctx: AiProviderCtx
): Promise<ProviderConfigurationModel[]> {
  return ctx.db.query.ProviderConfiguration.findMany({
    where: eq(schema.ProviderConfiguration.organizationId, ctx.organizationId),
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

/** Provider configurations grouped by provider (can have multiple per provider: system + custom). */
export async function getAllProviderConfigurationsMap(
  ctx: AiProviderCtx
): Promise<Map<string, ProviderConfigurationModel[]>> {
  const records = await getAllProviderConfigurations(ctx)
  const map = new Map<string, ProviderConfigurationModel[]>()
  for (const config of records) {
    if (!map.has(config.provider)) map.set(config.provider, [])
    map.get(config.provider)!.push(config)
  }
  return map
}

export async function getProviderRecords(
  ctx: AiProviderCtx,
  provider: string
): Promise<ProviderConfigurationModel[]> {
  return ctx.db.query.ProviderConfiguration.findMany({
    where: and(
      eq(schema.ProviderConfiguration.organizationId, ctx.organizationId),
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
}

// ===== Model configuration rows =====

export async function getAllModelConfigurations(
  ctx: AiProviderCtx
): Promise<ModelConfigurationModel[]> {
  return ctx.db.query.ModelConfiguration.findMany({
    where: eq(schema.ModelConfiguration.organizationId, ctx.organizationId),
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

/** Model configurations grouped by provider. */
export async function getAllModelConfigurationsByProvider(
  ctx: AiProviderCtx
): Promise<Map<string, ModelConfigurationModel[]>> {
  const configs = await getAllModelConfigurations(ctx)
  const map = new Map<string, ModelConfigurationModel[]>()
  for (const config of configs) {
    if (!map.has(config.provider)) map.set(config.provider, [])
    map.get(config.provider)!.push(config)
  }
  return map
}

export async function getModelConfigurationsForProvider(
  ctx: AiProviderCtx,
  provider: string
): Promise<ModelConfigurationModel[]> {
  return ctx.db.query.ModelConfiguration.findMany({
    where: and(
      eq(schema.ModelConfiguration.organizationId, ctx.organizationId),
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
}

export async function getModelConfiguration(
  ctx: AiProviderCtx,
  provider: string,
  model: string,
  modelType = 'llm'
): Promise<ModelConfigurationModel | null> {
  const config = await ctx.db.query.ModelConfiguration.findFirst({
    where: and(
      eq(schema.ModelConfiguration.organizationId, ctx.organizationId),
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

/** Enabled models for the org, optionally filtered by provider. */
export async function getEnabledModels(
  ctx: AiProviderCtx,
  provider?: string
): Promise<ModelConfigurationModel[]> {
  const conditions = [
    eq(schema.ModelConfiguration.organizationId, ctx.organizationId),
    eq(schema.ModelConfiguration.enabled, true),
  ]
  if (provider) conditions.push(eq(schema.ModelConfiguration.provider, provider))

  return ctx.db.query.ModelConfiguration.findMany({
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

// ===== Load balancing config rows =====

/** Load balancing configurations grouped by provider. */
export async function getAllLoadBalancingConfigsByProvider(
  ctx: AiProviderCtx
): Promise<Map<string, LoadBalancingConfigModel[]>> {
  const configs = await ctx.db.query.LoadBalancingConfig.findMany({
    where: eq(schema.LoadBalancingConfig.organizationId, ctx.organizationId),
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

  const map = new Map<string, LoadBalancingConfigModel[]>()
  for (const config of configs) {
    if (!map.has(config.provider)) map.set(config.provider, [])
    map.get(config.provider)!.push(config)
  }
  return map
}

export async function getLoadBalancingConfigsForProvider(
  ctx: AiProviderCtx,
  provider: string
): Promise<LoadBalancingConfigModel[]> {
  return ctx.db.query.LoadBalancingConfig.findMany({
    where: and(
      eq(schema.LoadBalancingConfig.organizationId, ctx.organizationId),
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
}

// ===== Organization quota row =====

/**
 * The org's single Ai quota row (org-level, provider-independent). Fetch once and thread into
 * the per-provider assembly so a P-provider compute doesn't run P identical quota queries.
 */
export async function getOrganizationAiQuota(ctx: AiProviderCtx) {
  return ctx.db.query.OrganizationAiQuota.findFirst({
    where: eq(schema.OrganizationAiQuota.organizationId, ctx.organizationId),
  })
}

export type OrganizationAiQuotaRow = Awaited<ReturnType<typeof getOrganizationAiQuota>>

// ===== Provider preference rows =====

export async function getAllProviderPreferences(
  ctx: AiProviderCtx
): Promise<ProviderPreferenceModel[]> {
  return ctx.db.query.ProviderPreference.findMany({
    where: eq(schema.ProviderPreference.organizationId, ctx.organizationId),
    columns: {
      id: true,
      createdAt: true,
      updatedAt: true,
      organizationId: true,
      provider: true,
      preferredType: true,
    },
  })
}

export async function getAllProviderPreferencesMap(
  ctx: AiProviderCtx
): Promise<Map<string, ProviderPreferenceModel>> {
  const preferences = await getAllProviderPreferences(ctx)
  const map = new Map<string, ProviderPreferenceModel>()
  for (const pref of preferences) map.set(pref.provider, pref)
  return map
}

export async function getProviderPreference(
  ctx: AiProviderCtx,
  provider: string
): Promise<ProviderPreferenceModel | null> {
  const pref = await ctx.db.query.ProviderPreference.findFirst({
    where: and(
      eq(schema.ProviderPreference.organizationId, ctx.organizationId),
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
  return pref ?? null
}
