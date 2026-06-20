// packages/lib/src/ai/providers/config/validation.ts

import { createScopedLogger } from '../../../logger'
import { ProviderRegistry } from '../provider-registry'
import {
  CredentialValidationError,
  type ModelCredentials,
  type ModelType,
  type ProviderCredentials,
} from '../types'
import type { AiProviderCtx } from './context'
import { resolveCredentials } from './runtime-credentials'

const logger = createScopedLogger('ai-provider-validation')

/**
 * Validate provider credentials by testing against the provider API. Delegates to the
 * provider-specific client; skips gracefully when the client isn't available (build time /
 * client side).
 */
export async function validateProviderCredentials(
  ctx: AiProviderCtx,
  provider: string,
  credentials: ProviderCredentials
): Promise<void> {
  try {
    if (!ProviderRegistry.isProviderRegistered(provider)) {
      logger.warn('Provider client not available for validation', {
        provider,
        organizationId: ctx.organizationId,
      })
      return
    }

    const providerClient = await ProviderRegistry.createClient(
      provider,
      ctx.organizationId,
      ctx.userId
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
    if (error instanceof Error && error.message.includes('not available on client side')) {
      logger.warn('Skipping validation due to client-side limitation', {
        provider,
        organizationId: ctx.organizationId,
        error: error.message,
      })
      return
    }

    if (error instanceof CredentialValidationError) throw error
    throw new CredentialValidationError(
      `Provider validation failed: ${error instanceof Error ? error.message : String(error)}`,
      provider,
      'provider_credentials'
    )
  }
}

/**
 * Validate model-specific credentials. Currently delegates to provider-level validation since
 * models inherit provider credentials.
 */
export async function validateModelCredentials(
  ctx: AiProviderCtx,
  provider: string,
  _model: string,
  _modelType: ModelType,
  credentials: ModelCredentials
): Promise<void> {
  await validateProviderCredentials(ctx, provider, credentials)
}

/**
 * Test provider credentials by making a validation call. Resolves the org's stored key from
 * the unified store when no credentials are provided. Returns true if valid, false otherwise.
 */
export async function testCredentials(
  ctx: AiProviderCtx,
  provider: string,
  credentials?: ProviderCredentials
): Promise<boolean> {
  try {
    if (!credentials || Object.keys(credentials).length === 0) {
      const resolved = await resolveCredentials(ctx, provider, null, null)
      credentials = resolved.credentials
      if (!credentials || Object.keys(credentials).length === 0) {
        throw new Error('No credentials available to test')
      }
    }

    await validateProviderCredentials(ctx, provider, credentials)
    return true
  } catch (error) {
    logger.error('Credential test failed', {
      organizationId: ctx.organizationId,
      provider,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
