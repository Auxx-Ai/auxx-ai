// packages/lib/src/import/resolution/resolvers/domain.ts

import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/**
 * Extract domain from URL or email, or validate as domain.
 */
export function resolveDomain(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim().toLowerCase()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  let domain = trimmed

  // Extract domain from email
  if (trimmed.includes('@')) {
    const parts = trimmed.split('@')
    domain = parts[parts.length - 1]
  }

  // Extract domain from URL
  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed)
      domain = url.hostname
    } catch {
      return { type: 'error', error: `Invalid URL: ${rawValue}` }
    }
  }

  // Remove leading www.
  if (domain.startsWith('www.')) {
    domain = domain.substring(4)
  }

  // Basic domain validation
  const domainPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/
  if (!domainPattern.test(domain)) {
    return { type: 'error', error: `Invalid domain: ${domain}` }
  }

  return { type: 'value', value: domain }
}
