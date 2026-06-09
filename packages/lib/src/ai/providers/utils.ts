// packages/lib/src/ai/providers/utils.ts

import { createScopedLogger } from '../../logger'
import { providerPositions } from './provider-registry'
import {
  type CredentialFormSchema,
  FormType,
  HIDDEN_VALUE,
  isModelType,
  isProviderQuotaType,
  isProviderType,
  isSupportedProvider,
  type ModelType,
  type ProviderConfiguration,
  type ProviderQuotaType,
  type ProviderType,
} from './types'

const logger = createScopedLogger('ProviderUtils')

// ===== LLM HTTP OBSERVABILITY =====

/**
 * Scoped to `agent-llm` on purpose: the per-session agent run-log only tees
 * `agent-*` / `kopilot-*` scopes (provider-client scopes are dropped), so these
 * lines land next to the existing `Calling LLM` / `LLM complete` entries. The
 * `ProviderUtils` logger above would never reach that file.
 */
const llmHttpLogger = createScopedLogger('agent-llm')

/**
 * Headers always surfaced regardless of the rate-limit name pattern — request
 * correlation, throttle backoff, and auth-challenge details.
 */
const ALWAYS_LOG_HEADERS = new Set([
  'retry-after',
  'retry-after-ms', // OpenAI's calibrated backoff hint — not covered by the *ratelimit* pattern
  'request-id',
  'x-request-id',
  'www-authenticate',
])

type ObservingFetch = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Wrap a provider SDK's `fetch` so every HTTP attempt — including the SDK's
 * silent 4xx/5xx retries — logs its status, latency, and diagnostic headers into
 * the agent-session trace. Pass the result as the SDK client's `fetch` option.
 *
 * Captures the full failure surface, not just throttling: auth failures (401/403
 * + `www-authenticate`), bad requests (400), server/overload errors (5xx/529),
 * and rate limits (429 + `retry-after` + `*-remaining`). Header capture is
 * name-pattern based (`*ratelimit*` / `*rate-limit*` plus the always-log set), so
 * it's provider-agnostic: Anthropic emits `anthropic-ratelimit-*`, OpenAI-family
 * SDKs emit `x-ratelimit-*`.
 *
 * Reading the result:
 * - Two attempts split by a long timestamp gap + a `retry-after` value ⇒ the
 *   request was *parked* by rate limiting, not the model thinking.
 * - A 401/403 with `www-authenticate` ⇒ a credential/auth problem.
 * - One attempt with healthy `*-remaining` ⇒ genuine model latency.
 *
 * `latencyMs` is time-to-response-headers. For a streaming 200 that's fast even
 * when first-token is slow (the body streams separately) — so trust the
 * attempt count + status + `retry-after`, not `latencyMs`, to spot a throttle.
 *
 * Provider variance (status is universal — `429` everywhere — but the rest is not):
 * - OpenAI: `x-ratelimit-*` + `retry-after-ms`. Anthropic: `anthropic-ratelimit-*`
 *   + `retry-after`, `529` for overload.
 * - DeepSeek throttles by holding the connection open and streaming keep-alives,
 *   NOT by returning `429` — so a throttle there looks like a slow `200`.
 * - Kimi's `429` is ambiguous (rate-limit vs quota vs account); the reason lives
 *   in the response body's `error.type`, which this wrapper does not read.
 * - DeepSeek/Qwen/Kimi don't document `*ratelimit*` quota headers; expect only
 *   status + latency from them.
 *
 * @param provider - provider label included in each line (e.g. `'anthropic'`)
 * @param baseFetch - underlying fetch (defaults to global `fetch`)
 */
export function createObservingFetch(
  provider: string,
  baseFetch: ObservingFetch = fetch
): ObservingFetch {
  return async (url, init) => {
    const startedAt = Date.now()
    const response = await baseFetch(url, init)

    try {
      const diagnosticHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        const name = key.toLowerCase()
        if (
          name.includes('ratelimit') ||
          name.includes('rate-limit') ||
          ALWAYS_LOG_HEADERS.has(name)
        ) {
          diagnosticHeaders[key] = value
        }
      })

      const meta = {
        provider,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        ...diagnosticHeaders,
      }

      if (response.status >= 400) {
        llmHttpLogger.warn('LLM HTTP error response', meta)
      } else {
        llmHttpLogger.info('LLM HTTP response', meta)
      }
    } catch {
      // Observability must never break the request path.
    }

    return response
  }
}

// ===== PROVIDER SORTING UTILITIES =====

/**
 * Sort providers by configuration status first, then by predefined position order
 * Configured providers appear first, then unconfigured providers
 * Within each group, providers are sorted by their position in providerPositions array
 * @param providers - Array of provider data to sort
 * @returns ProviderData[] - Sorted array of providers
 */
export function getSortedProviders(providers: ProviderConfiguration[]): ProviderConfiguration[] {
  return providers.sort((a, b) => {
    // Sort by configuration status first (configured providers first)
    const aConfigured = a.statusInfo.configured
    const bConfigured = b.statusInfo.configured

    if (aConfigured !== bConfigured) {
      return bConfigured ? 1 : -1 // configured providers come first
    }

    // Within same configuration status, sort by provider position
    const aIndex = providerPositions.indexOf(a.provider)
    const bIndex = providerPositions.indexOf(b.provider)

    // If provider not in positions array, put it at the end of its group
    const aPosition = aIndex === -1 ? providerPositions.length : aIndex
    const bPosition = bIndex === -1 ? providerPositions.length : bIndex

    return aPosition - bPosition
  })
}

// ===== CREDENTIAL UTILITIES =====

/**
 * Extract secret input form variables from credential schemas
 */
export function extractSecretVariables(credentialFormSchemas: CredentialFormSchema[]): string[] {
  return credentialFormSchemas
    .filter((schema) => schema.type === FormType.SECRET_INPUT)
    .map((schema) => schema.variable)
}

/**
 * Obfuscate credentials for safe logging/display
 */
export function obfuscateCredentials(
  credentials: Record<string, any>,
  credentialFormSchemas: CredentialFormSchema[]
): Record<string, any> {
  const secretVariables = extractSecretVariables(credentialFormSchemas)
  const obfuscated = { ...credentials }

  for (const [key, value] of Object.entries(obfuscated)) {
    if (secretVariables.includes(key) && typeof value === 'string') {
      obfuscated[key] = obfuscateToken(value)
    }
  }

  return obfuscated
}

/**
 * Obfuscate a token/API key for display
 */
export function obfuscateToken(token: string): string {
  if (!token || token.length < 8) {
    return HIDDEN_VALUE
  }

  const start = token.slice(0, 4)
  const end = token.slice(-4)
  const middle = '*'.repeat(Math.min(token.length - 8, 20))

  return `${start}${middle}${end}`
}

/**
 * Check if credentials contain hidden values
 */
export function hasHiddenValues(credentials: Record<string, any>): boolean {
  return Object.values(credentials).some((value) => value === HIDDEN_VALUE)
}

/**
 * Merge credentials, preserving existing values when hidden values are provided
 */
export function mergeCredentials(
  existingCredentials: Record<string, any>,
  newCredentials: Record<string, any>,
  secretVariables: string[]
): Record<string, any> {
  const merged = { ...newCredentials }

  for (const key of secretVariables) {
    if (merged[key] === HIDDEN_VALUE && existingCredentials[key]) {
      merged[key] = existingCredentials[key]
    }
  }

  return merged
}

// ===== VALIDATION UTILITIES =====

/**
 * Validate provider configuration data
 */
export function validateProviderConfig(config: any): string[] {
  const errors: string[] = []

  if (!config.organizationId) {
    errors.push('Organization ID is required')
  }

  if (!config.provider) {
    errors.push('Provider is required')
  } else if (!isSupportedProvider(config.provider)) {
    errors.push(`Unsupported provider: ${config.provider}`)
  }

  if (config.preferredProviderType && !isProviderType(config.preferredProviderType)) {
    errors.push(`Invalid provider type: ${config.preferredProviderType}`)
  }

  return errors
}

/**
 * Validate model configuration data
 */
export function validateModelConfig(config: any): string[] {
  const errors: string[] = []

  if (!config.model) {
    errors.push('Model is required')
  }

  if (!config.modelType) {
    errors.push('Model type is required')
  } else if (!isModelType(config.modelType)) {
    errors.push(`Invalid model type: ${config.modelType}`)
  }

  if (!config.provider) {
    errors.push('Provider is required')
  }

  return errors
}

/**
 * Validate credentials structure
 */
export function validateCredentials(
  credentials: Record<string, any>,
  credentialFormSchemas: CredentialFormSchema[]
): string[] {
  const errors: string[] = []

  for (const schema of credentialFormSchemas) {
    const value = credentials[schema.variable]

    if (schema.required && (value === undefined || value === null || value === '')) {
      errors.push(`${schema.variable} is required`)
      continue
    }

    if (value !== undefined && value !== null && value !== '') {
      // Type-specific validation
      switch (schema.type) {
        case FormType.SECRET_INPUT:
        case FormType.TEXT_INPUT:
          if (typeof value !== 'string') {
            errors.push(`${schema.variable} must be a string`)
          }
          break

        case FormType.BOOLEAN:
          if (typeof value !== 'boolean') {
            errors.push(`${schema.variable} must be a boolean`)
          }
          break

        case FormType.SELECT:
          if (schema.options && !schema.options.some((opt) => opt.value === value)) {
            errors.push(
              `${schema.variable} must be one of: ${schema.options.map((o) => o.value).join(', ')}`
            )
          }
          break
      }
    }
  }

  return errors
}

// ===== CONVERSION UTILITIES =====

/**
 * Convert model type string to enum value
 */
export function parseModelType(value: string): ModelType | null {
  return isModelType(value) ? (value as ModelType) : null
}

/**
 * Convert provider type string to enum value
 */
export function parseProviderType(value: string): ProviderType | null {
  return isProviderType(value) ? (value as ProviderType) : null
}

/**
 * Convert quota type string to enum value
 */
export function parseQuotaType(value: string): ProviderQuotaType | null {
  return isProviderQuotaType(value) ? (value as ProviderQuotaType) : null
}

/**
 * Convert database record to configuration object
 */
export function recordToConfig(record: any): Record<string, any> {
  const config: Record<string, any> = {}

  // Copy all properties except internal ones
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith('_') && key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
      config[key] = value
    }
  }

  return config
}

// ===== QUOTA UTILITIES =====

/**
 * Check if quota is valid (not exceeded)
 */
export function isQuotaValid(used: number, limit: number): boolean {
  if (limit === -1) return true // Unlimited
  return used < limit
}

/**
 * Calculate quota usage percentage
 */
export function getQuotaUsagePercentage(used: number, limit: number): number {
  if (limit === -1) return 0 // Unlimited
  if (limit === 0) return 100
  return Math.min((used / limit) * 100, 100)
}

/**
 * Get remaining quota
 */
export function getRemainingQuota(used: number, limit: number): number {
  if (limit === -1) return -1 // Unlimited
  return Math.max(limit - used, 0)
}

/**
 * Determine quota status
 */
export function getQuotaStatus(used: number, limit: number): 'active' | 'warning' | 'exceeded' {
  if (limit === -1) return 'active' // Unlimited

  const percentage = getQuotaUsagePercentage(used, limit)

  if (percentage >= 100) return 'exceeded'
  if (percentage >= 80) return 'warning'
  return 'active'
}

// ===== SORTING UTILITIES =====

/**
 * Sort providers by preference
 */
export function sortProviders(providers: string[]): string[] {
  const preferenceOrder = ['openai', 'anthropic', 'google', 'groq', 'deepseek', 'qwen', 'kimi']

  return providers.sort((a, b) => {
    const aIndex = preferenceOrder.indexOf(a)
    const bIndex = preferenceOrder.indexOf(b)

    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b)
    if (aIndex === -1) return 1
    if (bIndex === -1) return -1

    return aIndex - bIndex
  })
}

/**
 * Sort models by type and name
 */
export function sortModels(
  models: Array<{ model: string; modelType: ModelType }>
): Array<{ model: string; modelType: ModelType }> {
  return models.sort((a, b) => {
    if (a.modelType !== b.modelType) {
      return a.modelType.localeCompare(b.modelType)
    }
    return a.model.localeCompare(b.model)
  })
}

// ===== CREDENTIAL UTILITIES =====

/**
 * Merge new credentials with existing credentials, preserving existing values for hidden fields
 * If a field has the value '[**HIDDEN**]', it will be replaced with the existing value from existingCredentials
 *
 * @param newCredentials - The new credential values from the form
 * @param existingCredentials - The existing stored credential values
 * @returns Record<string, any> - Merged credentials with hidden fields preserved
 */
export function mergeCredentialsWithHidden(
  newCredentials: Record<string, any>,
  existingCredentials: Record<string, any> = {}
): Record<string, any> {
  const mergedCredentials = { ...newCredentials }

  // Replace any '[**HIDDEN**]' values with existing values
  for (const [key, value] of Object.entries(newCredentials)) {
    if (value === '[**HIDDEN**]' && existingCredentials[key] !== undefined) {
      mergedCredentials[key] = existingCredentials[key]
    }
  }

  return mergedCredentials
}
