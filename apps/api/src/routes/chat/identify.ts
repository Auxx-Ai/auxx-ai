// apps/api/src/routes/chat/identify.ts

import type { ChatIdentifyClaim } from '@auxx/credentials/passport'

/**
 * Coerce an arbitrary request body field into a `ChatIdentifyClaim`. Returns
 * `null` when the input is not an object or contains no usable fields. Strings
 * are trimmed and empty values are dropped so the claim stays compact.
 */
export function parseIdentifyPayload(raw: unknown): ChatIdentifyClaim | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const name = trimmed(input.name)
  const email = trimmed(input.email)
  const externalId = trimmed(input.externalId)
  if (!name && !email && !externalId) return null
  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(externalId ? { externalId } : {}),
    source: 'embedder',
    capturedAt: new Date().toISOString(),
  }
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t.length ? t : undefined
}
