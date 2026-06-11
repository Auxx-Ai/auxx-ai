// packages/credentials/src/store/split-sensitive-fields.ts

/** Substrings that mark a scalar field name as sensitive (lifted from the legacy service). */
const SENSITIVE_PATTERNS = [
  'password',
  'passwd',
  'pwd',
  'key',
  'secret',
  'token',
  'auth',
  'credential',
  'privatekey',
  'passphrase',
]

/** True when a scalar field name looks like it holds a secret. */
function isSensitiveFieldName(fieldName: string): boolean {
  const lower = fieldName.toLowerCase()
  return SENSITIVE_PATTERNS.some((pattern) => lower.includes(pattern))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Partition a credential data bag into `secrets` (encrypted at rest) and `metadata` (plaintext).
 *
 * Rules:
 * - **Scalar field → secret** iff its key matches a sensitive pattern; otherwise metadata.
 * - **Object-valued field → secrets wholesale** (README decision 3). Nested bags (IMAP's
 *   `imap`/`smtp`/`ldap` objects) carry passwords under non-sensitive top-level keys, so
 *   key-name matching alone would leak them into plaintext. Keeping the whole object in
 *   `secrets` also preserves the shallow `{ ...metadata, ...secrets }` reconstruction.
 * - Arrays are treated as scalars (sensitive only by key name).
 *
 * Used by workflow-kind saves (fields arrive as one bag) and by the v2 backfill.
 */
export function splitSensitiveFields(data: Record<string, unknown>): {
  secrets: Record<string, unknown>
  metadata: Record<string, unknown>
} {
  const secrets: Record<string, unknown> = {}
  const metadata: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (isPlainObject(value) || isSensitiveFieldName(key)) {
      secrets[key] = value
    } else {
      metadata[key] = value
    }
  }

  return { secrets, metadata }
}
