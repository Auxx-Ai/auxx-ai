// packages/lib/src/ai/providers/config/mutations.ts

import { deleteCredential } from '@auxx/credentials/store'
import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { getProviderByKey } from '../../../connections/providers/provider-registry'
import { saveConnection } from '../../../connections/save-connection'
import { createScopedLogger } from '../../../logger'
import {
  CredentialValidationError,
  type ModelCredentials,
  type ModelType,
  ProviderConfigurationError,
  type ProviderCredentials,
  ProviderType,
  type ValidationOptions,
} from '../types'
import {
  deleteOrgProviderCredentials,
  findOrgProviderCredentialId,
  resolveConnectionDefinition,
  revealCredentialFields,
  splitAiCredentials,
} from './byo-store'
import type { AiProviderCtx } from './context'
import { getDefaultModelConfig } from './model-params'
import { validateModelCredentials, validateProviderCredentials } from './validation'

const logger = createScopedLogger('ai-provider-mutations')

/**
 * Persist an org BYO provider key into the unified Credential store and upsert the CUSTOM
 * ProviderConfiguration (blueprint FK, no inline secret). Merges over an existing key when one
 * exists (edit) so an unchanged secret survives; otherwise inserts the first key.
 */
async function persistProviderCredential(
  ctx: AiProviderCtx,
  provider: string,
  credentials: ProviderCredentials,
  options: ValidationOptions
): Promise<void> {
  const resolved = await resolveConnectionDefinition(ctx, provider)
  if (!resolved) {
    throw new ProviderConfigurationError(
      `No connection blueprint seeded for AI provider '${provider}'`,
      provider,
      'CONNECTION_DEFINITION_MISSING'
    )
  }
  const { providerKey, connectionDefinitionId } = resolved
  const connectionId = await findOrgProviderCredentialId(ctx, providerKey)

  const { secretFields, plainVariables } = splitAiCredentials(providerKey, credentials)

  // Validate the RESOLVED key (existing merged with the de-masked submission), so editing a
  // plain field without re-entering the secret still validates against the real stored key.
  if (!options.skipValidation) {
    const existingFields = connectionId ? await revealCredentialFields(ctx, connectionId) : {}
    await validateProviderCredentials(ctx, provider, {
      ...existingFields,
      ...secretFields,
      ...plainVariables,
    })
  }

  const saved = await saveConnection({
    connectionDefinitionId,
    providerKey,
    name: getProviderByKey(providerKey)?.label ?? provider,
    organizationId: ctx.organizationId,
    createdById: ctx.userId,
    userId: null,
    connectionId: connectionId ?? undefined,
    connectionData: { secretFields, metadata: { connectionVariables: plainVariables } },
  })
  if (saved.isErr()) throw saved.error

  const now = new Date()
  await ctx.db
    .insert(schema.ProviderConfiguration)
    .values({
      organizationId: ctx.organizationId,
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

  await switchProviderType(ctx, provider, ProviderType.CUSTOM)
}

/**
 * Validate and add custom provider credentials. Mints/merges the BYO key into the unified
 * store and points the CUSTOM ProviderConfiguration at the blueprint.
 */
export async function addCustomProviderCredentials(
  ctx: AiProviderCtx,
  provider: string,
  credentials: ProviderCredentials,
  options: ValidationOptions = {}
): Promise<void> {
  try {
    await persistProviderCredential(ctx, provider, credentials, options)
  } catch (error) {
    logger.error('Failed to add custom provider credentials', {
      organizationId: ctx.organizationId,
      provider,
      error: error instanceof Error ? error.message : String(error),
    })
    if (error instanceof CredentialValidationError) throw error
    throw new ProviderConfigurationError(
      `Failed to add credentials for provider ${provider}`,
      provider,
      'CREDENTIAL_ADD_FAILED'
    )
  }
}

/**
 * Update provider credentials by merging with existing ones. The unified store merges
 * submitted fields over the existing key, so a partial update is a persist with merge.
 */
export async function updateProviderCredentials(
  ctx: AiProviderCtx,
  provider: string,
  credentialUpdates: Partial<ProviderCredentials>
): Promise<void> {
  try {
    await persistProviderCredential(ctx, provider, credentialUpdates as ProviderCredentials, {})
  } catch (error) {
    logger.error('Failed to update provider credentials', {
      organizationId: ctx.organizationId,
      provider,
      error: error instanceof Error ? error.message : String(error),
    })
    if (error instanceof CredentialValidationError) throw error
    throw new ProviderConfigurationError(
      `Failed to update credentials for provider ${provider}`,
      provider,
      'CREDENTIAL_UPDATE_FAILED'
    )
  }
}

/**
 * Add or update custom model credentials. A model-pinned key is a size-1 LoadBalancingConfig
 * pool (the 'default' member) referencing a credential in the unified store.
 */
export async function addCustomModelCredentials(
  ctx: AiProviderCtx,
  provider: string,
  model: string,
  modelType: ModelType,
  credentials: ModelCredentials,
  options: ValidationOptions = {}
): Promise<void> {
  try {
    const resolved = await resolveConnectionDefinition(ctx, provider)
    if (!resolved) {
      throw new ProviderConfigurationError(
        `No connection blueprint seeded for AI provider '${provider}'`,
        provider,
        'CONNECTION_DEFINITION_MISSING'
      )
    }
    const { providerKey, connectionDefinitionId } = resolved
    const POOL_NAME = 'default'

    // Existing pool member for this model → its credential, so an edit merges rather than
    // minting a duplicate key.
    const existingBinding = await ctx.db.query.LoadBalancingConfig.findFirst({
      where: and(
        eq(schema.LoadBalancingConfig.organizationId, ctx.organizationId),
        eq(schema.LoadBalancingConfig.provider, provider),
        eq(schema.LoadBalancingConfig.model, model),
        eq(schema.LoadBalancingConfig.modelType, modelType),
        eq(schema.LoadBalancingConfig.name, POOL_NAME)
      ),
      columns: { connectionId: true },
    })
    const connectionId = existingBinding?.connectionId ?? null

    const { secretFields, plainVariables } = splitAiCredentials(providerKey, credentials)

    if (!options.skipValidation) {
      const existingFields = connectionId ? await revealCredentialFields(ctx, connectionId) : {}
      await validateModelCredentials(ctx, provider, model, modelType, {
        ...existingFields,
        ...secretFields,
        ...plainVariables,
      })
    }

    const saved = await saveConnection({
      connectionDefinitionId,
      providerKey,
      name: `${getProviderByKey(providerKey)?.label ?? provider} – ${model}`,
      organizationId: ctx.organizationId,
      createdById: ctx.userId,
      userId: null,
      connectionId: connectionId ?? undefined,
      connectionData: { secretFields, metadata: { connectionVariables: plainVariables } },
    })
    if (saved.isErr()) throw saved.error
    const credentialId = saved.value

    const now = new Date()
    // Upsert the size-1 pool binding pointing at the credential.
    await ctx.db
      .insert(schema.LoadBalancingConfig)
      .values({
        organizationId: ctx.organizationId,
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
    await ctx.db
      .insert(schema.ModelConfiguration)
      .values({
        organizationId: ctx.organizationId,
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
  } catch (error) {
    logger.error('Failed to add custom model credentials', {
      organizationId: ctx.organizationId,
      provider,
      model,
      modelType,
      error: error instanceof Error ? error.message : String(error),
    })
    if (error instanceof CredentialValidationError) throw error
    throw new ProviderConfigurationError(
      `Failed to add model credentials for ${provider}/${model}`,
      provider,
      'MODEL_CREDENTIAL_ADD_FAILED'
    )
  }
}

/**
 * Switch the org's provider type preference (SYSTEM = platform-managed credits, CUSTOM =
 * user-provided keys). Pure write to ProviderPreference — cache invalidation is the action
 * layer's responsibility.
 */
export async function switchProviderType(
  ctx: AiProviderCtx,
  provider: string,
  providerType: ProviderType
): Promise<void> {
  try {
    const now = new Date()
    await ctx.db
      .insert(schema.ProviderPreference)
      .values({
        organizationId: ctx.organizationId,
        provider,
        preferredType: providerType,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.ProviderPreference.organizationId, schema.ProviderPreference.provider],
        set: { preferredType: providerType, updatedAt: now },
      })
  } catch (error) {
    logger.error('Failed to switch provider type', {
      organizationId: ctx.organizationId,
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
 * Delete a provider configuration and all associated models, preferences, pool bindings, and
 * BYO keys. Destructive and irreversible.
 */
export async function deleteProvider(
  ctx: AiProviderCtx,
  provider: string
): Promise<{ count: number }> {
  try {
    // Delete the org's BYO keys from the unified store (cascades pool bindings).
    await deleteOrgProviderCredentials(ctx, provider)

    const deletedProviderConfig = await ctx.db
      .delete(schema.ProviderConfiguration)
      .where(
        and(
          eq(schema.ProviderConfiguration.organizationId, ctx.organizationId),
          eq(schema.ProviderConfiguration.provider, provider)
        )
      )
      .returning({ id: schema.ProviderConfiguration.id })

    await ctx.db
      .delete(schema.ProviderPreference)
      .where(
        and(
          eq(schema.ProviderPreference.organizationId, ctx.organizationId),
          eq(schema.ProviderPreference.provider, provider)
        )
      )

    await ctx.db
      .delete(schema.LoadBalancingConfig)
      .where(
        and(
          eq(schema.LoadBalancingConfig.organizationId, ctx.organizationId),
          eq(schema.LoadBalancingConfig.provider, provider)
        )
      )

    await ctx.db
      .delete(schema.ModelConfiguration)
      .where(
        and(
          eq(schema.ModelConfiguration.organizationId, ctx.organizationId),
          eq(schema.ModelConfiguration.provider, provider)
        )
      )

    return { count: deletedProviderConfig.length || 1 }
  } catch (error) {
    logger.error('Failed to delete provider configuration', {
      organizationId: ctx.organizationId,
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
 * Remove custom provider credentials while preserving system configuration. Deletes the CUSTOM
 * record, switches preference to SYSTEM, and removes BYO keys (which cascade pool bindings).
 */
export async function removeCustomCredentials(
  ctx: AiProviderCtx,
  provider: string
): Promise<{ removed: boolean; switchedToSystem: boolean }> {
  try {
    const deleted = await ctx.db
      .delete(schema.ProviderConfiguration)
      .where(
        and(
          eq(schema.ProviderConfiguration.organizationId, ctx.organizationId),
          eq(schema.ProviderConfiguration.provider, provider),
          eq(schema.ProviderConfiguration.providerType, 'CUSTOM')
        )
      )
      .returning({ id: schema.ProviderConfiguration.id })

    if (deleted.length === 0) {
      return { removed: false, switchedToSystem: false }
    }

    await switchProviderType(ctx, provider, ProviderType.SYSTEM)

    // The connectionId FK (onDelete: cascade) removes the provider's pool bindings too.
    await deleteOrgProviderCredentials(ctx, provider)

    return { removed: true, switchedToSystem: true }
  } catch (error) {
    logger.error('Failed to remove custom provider credentials', {
      organizationId: ctx.organizationId,
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
 * Delete a specific custom model configuration. Removes its pool bindings and any credential no
 * longer referenced by another binding (shared key safe).
 */
export async function deleteCustomModel(
  ctx: AiProviderCtx,
  provider: string,
  model: string
): Promise<{ deleted: boolean }> {
  try {
    const bindings = await ctx.db.query.LoadBalancingConfig.findMany({
      where: and(
        eq(schema.LoadBalancingConfig.organizationId, ctx.organizationId),
        eq(schema.LoadBalancingConfig.provider, provider),
        eq(schema.LoadBalancingConfig.model, model)
      ),
      columns: { connectionId: true },
    })

    await ctx.db
      .delete(schema.LoadBalancingConfig)
      .where(
        and(
          eq(schema.LoadBalancingConfig.organizationId, ctx.organizationId),
          eq(schema.LoadBalancingConfig.provider, provider),
          eq(schema.LoadBalancingConfig.model, model)
        )
      )

    for (const binding of bindings) {
      if (!binding.connectionId) continue
      const stillReferenced = await ctx.db.query.LoadBalancingConfig.findFirst({
        where: and(
          eq(schema.LoadBalancingConfig.organizationId, ctx.organizationId),
          eq(schema.LoadBalancingConfig.connectionId, binding.connectionId)
        ),
        columns: { id: true },
      })
      if (!stillReferenced) await deleteCredential(binding.connectionId, ctx.organizationId)
    }

    const result = await ctx.db
      .delete(schema.ModelConfiguration)
      .where(
        and(
          eq(schema.ModelConfiguration.organizationId, ctx.organizationId),
          eq(schema.ModelConfiguration.provider, provider),
          eq(schema.ModelConfiguration.model, model)
        )
      )
      .returning({ id: schema.ModelConfiguration.id })

    return { deleted: result.length > 0 || bindings.length > 0 }
  } catch (error) {
    logger.error('Failed to delete custom model configuration', {
      organizationId: ctx.organizationId,
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

/** Toggle a model's enabled state, initializing defaults when first configured. */
export async function toggleModel(
  ctx: AiProviderCtx,
  provider: string,
  model: string,
  enabled: boolean,
  modelType = 'llm'
): Promise<void> {
  const now = new Date()
  await ctx.db
    .insert(schema.ModelConfiguration)
    .values({
      organizationId: ctx.organizationId,
      provider,
      model,
      modelType,
      enabled,
      config: getDefaultModelConfig(model),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.ModelConfiguration.organizationId,
        schema.ModelConfiguration.provider,
        schema.ModelConfiguration.model,
        schema.ModelConfiguration.modelType,
      ],
      set: { enabled, updatedAt: now },
    })
}

/** Update a model's parameter configuration, creating the row if it doesn't exist. */
export async function updateModelConfig(
  ctx: AiProviderCtx,
  provider: string,
  model: string,
  config: Record<string, any>,
  modelType = 'llm'
): Promise<void> {
  const now = new Date()
  await ctx.db
    .insert(schema.ModelConfiguration)
    .values({
      organizationId: ctx.organizationId,
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
      set: { config, updatedAt: now },
    })
}

/** Set quota configuration for a provider (usage limits for system/custom providers). */
export async function setQuotaConfiguration(
  ctx: AiProviderCtx,
  provider: string,
  quotaConfig: {
    quotaType: 'trial' | 'paid' | 'free'
    quotaLimit: number
    periodStart?: Date
    periodEnd?: Date
  }
): Promise<void> {
  try {
    const now = new Date()
    await ctx.db
      .insert(schema.ProviderConfiguration)
      .values({
        organizationId: ctx.organizationId,
        provider,
        providerType: 'SYSTEM',
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
  } catch (error) {
    logger.error('Failed to set quota configuration', {
      organizationId: ctx.organizationId,
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
