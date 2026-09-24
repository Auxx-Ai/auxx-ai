// packages/lib/src/ai/decision/fallback.ts

import { UnprocessableEntityError, UsageLimitError } from '../../errors'
import { QuotaExceededError } from '../errors/quota-errors'
import { ProviderConfigurationError, ProviderError } from '../providers/base/types'

/** ProviderError codes meaning the model cannot run for this org right now (D9). */
const TRIGGER_CODES = new Set([
  'LIMITED_USE_BLOCKED',
  'PROVIDER_NOT_REGISTERED',
  'DECISION_NOT_SUPPORTED',
  'PROVIDER_UNAVAILABLE',
  'REQUEST_TIMEOUT',
])

/** `ProviderConfigurationError.operationType`s that mean "no credentials for this provider". */
export const MISSING_CREDENTIALS_OPERATIONS = new Set([
  'PROVIDER_NOT_FOUND',
  'SYSTEM_CREDENTIALS_MISSING',
  'CREDENTIALS_MISSING',
])

const NETWORK_PATTERN = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i

// The orchestrator and clients re-wrap causes, so the reason is never the outermost error.
function errorChain(error: unknown): Error[] {
  const chain: Error[] = []
  let current: unknown = error
  while (current instanceof Error && chain.length < 8 && !chain.includes(current)) {
    chain.push(current)
    const next = (current as { originalError?: unknown }).originalError
    current = next instanceof Error ? next : current.cause
  }
  return chain
}

/** True when a failed decision call should be retried on the org's LLM default; quota never is. */
export function isDecisionFallbackTrigger(error: unknown): boolean {
  const chain = errorChain(error)
  const final = (e: Error) =>
    e instanceof QuotaExceededError ||
    e instanceof UsageLimitError ||
    e instanceof UnprocessableEntityError
  if (chain.some(final)) return false

  for (const link of chain) {
    if (link instanceof ProviderConfigurationError) {
      if (MISSING_CREDENTIALS_OPERATIONS.has(link.operationType)) return true
    } else if (link instanceof ProviderError && TRIGGER_CODES.has(link.code)) {
      return true
    }
    const status = (link as { status?: unknown }).status
    if (typeof status === 'number' && (status === 429 || status >= 500)) return true
    const code = (link as { code?: unknown }).code
    if (typeof code === 'string' && NETWORK_PATTERN.test(code)) return true
    if (NETWORK_PATTERN.test(link.message)) return true
  }
  return false
}
