// packages/lib/src/ai/providers/config/runtime-credentials.ts

import { createScopedLogger } from '../../../logger'
import {
  type CredentialsResponse,
  type ModelType,
  type ProviderConfiguration,
  ProviderType,
} from '../types'
import { computeProviderConfig } from './assemble'
import {
  resolveConnectionDefinition,
  resolveModelPool,
  resolveProviderDefaultFields,
} from './byo-store'
import type { AiProviderCtx } from './context'

const logger = createScopedLogger('ai-provider-runtime-credentials')

/**
 * Per-provider invariants for credential resolution: the assembled config plus the CUSTOM
 * BYO provider-default key. All of these are identical across a provider's models, so the
 * cache-compute path resolves them once (via `loadProviderCredentialContext`) and threads the
 * result into every `resolveCredentials` call — only the per-model pool lookup stays per call.
 */
export type ProviderCredentialContext = {
  config: ProviderConfiguration
  providerKey: string | null
  providerDefault: Record<string, any> | null
}

/**
 * Resolve the per-provider invariants once. SYSTEM short-circuits before touching the BYO
 * store (mirroring the SYSTEM path in `resolveCredentials`); CUSTOM resolves the blueprint key
 * + the provider-default field bag. Pass a precomputed `config` (the cache-compute path already
 * has it) to skip the single-provider DB re-assembly.
 */
export async function loadProviderCredentialContext(
  ctx: AiProviderCtx,
  provider: string,
  config?: ProviderConfiguration
): Promise<ProviderCredentialContext> {
  const cfg = config ?? (await computeProviderConfig(ctx, provider))
  if (cfg.usingProviderType === ProviderType.SYSTEM) {
    return { config: cfg, providerKey: null, providerDefault: null }
  }
  const resolvedDef = await resolveConnectionDefinition(ctx, provider)
  const providerKey = resolvedDef?.providerKey ?? null
  const providerDefault = providerKey ? await resolveProviderDefaultFields(ctx, providerKey) : null
  return { config: cfg, providerKey, providerDefault }
}

/**
 * Resolve the runtime credentials for a (provider, model, modelType), respecting the org's
 * provider-type preference (was ProviderConfigurationService.getCurrentCredentials). This is
 * the hot path the orchestrators reach through the cache layer's `getCredentials`.
 *
 * SYSTEM resolves the platform key from env; CUSTOM resolves BYO key(s) from the unified
 * Credential store via the model pool → provider-default hierarchy.
 *
 * Pass `precomputed` (from `loadProviderCredentialContext`) to reuse a provider's already-resolved
 * config + default key — the cache-compute loop does this to avoid re-assembling per model.
 */
export async function resolveCredentials(
  ctx: AiProviderCtx,
  provider: string,
  model: string | null,
  modelType: ModelType | null,
  precomputed?: ProviderCredentialContext
): Promise<CredentialsResponse> {
  try {
    const { config, providerDefault } =
      precomputed ?? (await loadProviderCredentialContext(ctx, provider))

    // SYSTEM: platform key resolved from env.
    if (config.usingProviderType === ProviderType.SYSTEM) {
      return {
        credentials: config.systemConfiguration.credentials || {},
        providerType: 'SYSTEM',
        credentialSource: 'SYSTEM',
      }
    }

    const response: CredentialsResponse = { credentials: {}, providerType: 'CUSTOM' }

    if (model && modelType) {
      // Model pool: model-specific members first, then the provider-level '*' sentinel pool.
      let pool = await resolveModelPool(ctx, provider, model, modelType)
      if (pool.length === 0) pool = await resolveModelPool(ctx, provider, '*', modelType)

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
    logger.error('Failed to resolve current credentials', {
      organizationId: ctx.organizationId,
      provider,
      model,
      modelType,
      error: error instanceof Error ? error.message : String(error),
    })
    return { credentials: {} }
  }
}
