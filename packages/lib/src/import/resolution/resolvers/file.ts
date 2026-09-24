// packages/lib/src/import/resolution/resolvers/file.ts

import { isIP } from 'node:net'
import { normalizeImageUrl } from '../../../files/fetch-remote-image'
import { isOutboundAddressAllowed } from '../../../net/private-address'
import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/** Commas only separate URLs when another URL follows; CDN transform paths (`w_100,h_100`) contain them. */
const URL_SEPARATOR = /[\s|;]+|,(?=\s*https?:\/\/)/i

/**
 * Validate an image URL for download at execution time. Only what is decidable offline is
 * checked here; the fetch itself (and its connect-time SSRF guard) runs in `materializeFileFetches`.
 */
export function resolveFileUrl(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const candidates = rawValue
    .trim()
    .split(URL_SEPARATOR)
    .map((part) => part.replace(/^,+|,+$/g, '').trim())
    .filter(Boolean)
  const first = candidates[0]
  if (!first) return { type: 'value', value: null }

  let parsed: URL
  try {
    parsed = new URL(normalizeImageUrl(first))
  } catch {
    return skipImage(`Invalid image URL — image skipped: ${first}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return skipImage(`Image URL must start with http:// or https:// — image skipped: ${first}`)
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !isOutboundAddressAllowed(host)) {
    return skipImage(`Image URL points at a private address — image skipped: ${first}`)
  }

  const url = parsed.toString()
  if (candidates.length > 1) {
    return {
      type: 'warning',
      value: url,
      warning: 'Only the first image is used',
      fileFetch: { url },
    }
  }
  return { type: 'create', value: url, fileFetch: { url } }
}

/** An unusable URL never blocks the record: it imports without the image, with a warning. */
function skipImage(warning: string): ResolvedValue {
  return { type: 'warning', value: null, warning }
}
