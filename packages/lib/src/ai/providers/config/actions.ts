// packages/lib/src/ai/providers/config/actions.ts

import { onCacheEvent } from '../../../cache/invalidate'
import { createScopedLogger } from '../../../logger'
import { ProviderRegistry } from '../provider-registry'
import { type ModelType, ProviderConfigurationError, type ProviderType } from '../types'
import { listOrgProviderCredentials, type ProviderCredentialSummary } from './byo-store'
import type { AiProviderCtx } from './context'
import * as mutations from './mutations'
import { testCredentials } from './validation'

const logger = createScopedLogger('ai-provider-actions')

/**
 * Public write API (write-then-invalidate). Each action runs the matching compute-layer
 * mutation then fires the appropriate cache event, so callers (tRPC) never invalidate by hand.
 */

export async function saveProvider(
  ctx: AiProviderCtx,
  provider: string,
  credentials: Record<string, any>,
  options?: { forceNew?: boolean; label?: string }
): Promise<void> {
  await mutations.addCustomProviderCredentials(ctx, provider, credentials, options)
  await onCacheEvent('ai-provider.configured', { orgId: ctx.organizationId })
}

/**
 * List the org's BYO keys for a provider (label + which is default). Read-only — the key picker
 * in settings consumes this. No cache event.
 */
export async function listProviderKeys(
  ctx: AiProviderCtx,
  provider: string
): Promise<ProviderCredentialSummary[]> {
  return listOrgProviderCredentials(ctx, provider)
}

/** Make one of a provider's BYO keys the org-level default, then recompute cached configs. */
export async function setProviderDefaultKey(
  ctx: AiProviderCtx,
  provider: string,
  credentialId: string
): Promise<void> {
  await mutations.setProviderDefaultCredential(ctx, provider, credentialId)
  await onCacheEvent('ai-provider.configured', { orgId: ctx.organizationId })
}

export async function deleteProvider(ctx: AiProviderCtx, provider: string): Promise<void> {
  await mutations.deleteProvider(ctx, provider)
  await onCacheEvent('ai-provider.deleted', { orgId: ctx.organizationId })
}

export async function removeCustomCredentials(
  ctx: AiProviderCtx,
  provider: string
): Promise<{ removed: boolean; switchedToSystem: boolean }> {
  const result = await mutations.removeCustomCredentials(ctx, provider)
  await onCacheEvent('ai-provider.deleted', { orgId: ctx.organizationId })
  return result
}

export async function testProvider(
  ctx: AiProviderCtx,
  provider: string,
  credentials: Record<string, any>
): Promise<boolean> {
  return testCredentials(ctx, provider, credentials)
}

export async function toggleModel(
  ctx: AiProviderCtx,
  provider: string,
  model: string,
  enabled: boolean
): Promise<void> {
  await mutations.toggleModel(ctx, provider, model, enabled)
  await onCacheEvent('ai-provider.configured', { orgId: ctx.organizationId })
}

export async function updateModelConfig(
  ctx: AiProviderCtx,
  provider: string,
  model: string,
  config: Record<string, any>
): Promise<void> {
  await mutations.updateModelConfig(ctx, provider, model, config)
  await onCacheEvent('ai-provider.configured', { orgId: ctx.organizationId })
}

export async function saveCustomModel(
  ctx: AiProviderCtx,
  params: {
    provider: string
    modelId: string
    modelType: ModelType
    credentials: Record<string, any>
    mode: 'create' | 'edit'
  }
): Promise<void> {
  const { provider, modelId, modelType, credentials } = params

  const providerCaps = await ProviderRegistry.getProviderCapabilities(provider)
  if (!providerCaps) {
    throw new ProviderConfigurationError(
      `Provider '${provider}' not found in registry`,
      provider,
      'PROVIDER_NOT_FOUND'
    )
  }

  await mutations.addCustomModelCredentials(ctx, provider, modelId, modelType, credentials)
  await onCacheEvent('ai-model.configured', { orgId: ctx.organizationId })

  logger.info('Custom model saved successfully', {
    organizationId: ctx.organizationId,
    provider,
    modelId,
    mode: params.mode,
  })
}

export async function deleteCustomModel(
  ctx: AiProviderCtx,
  params: { provider: string; modelId: string }
): Promise<{ deleted: boolean }> {
  const result = await mutations.deleteCustomModel(ctx, params.provider, params.modelId)
  await onCacheEvent('ai-model.deleted', { orgId: ctx.organizationId })
  return result
}

/**
 * Switch the org's provider-type preference and fire `ai-provider.type-switched` so the cached
 * configs/credentials are recomputed — the bare mutation only writes ProviderPreference.
 */
export async function switchProviderType(
  ctx: AiProviderCtx,
  provider: string,
  providerType: ProviderType
): Promise<void> {
  await mutations.switchProviderType(ctx, provider, providerType)
  await onCacheEvent('ai-provider.type-switched', { orgId: ctx.organizationId })
}
