// packages/credentials/src/crypto/client.ts
// Pure, client-safe helpers — no server dependencies (no node crypto, no DB).
// The secret-edit lifecycle shared across connections, AI providers, and MCP:
// mask a stored secret for the edit form, then strip the sentinel on save so an
// untouched secret is preserved by the store merge.

/**
 * Sentinel a form submits in place of an unchanged masked secret.
 * The server strips it (or swaps it back for the stored ciphertext) instead of persisting it.
 */
export const HIDDEN_VALUE = '__HIDDEN__'

/** Mask-shaped values, as produced by `maskValue` (the full mask included). */
const MASK_SHAPE = /^.{2,4}\*+.{2,4}$/

/**
 * True when a submitted value is a client echoing a masked prefill back — the
 * `HIDDEN_VALUE` sentinel or a `maskValue`-shaped string. Never persist it.
 */
export function isMasked(value: string): boolean {
  return value === HIDDEN_VALUE || MASK_SHAPE.test(value)
}

/** A declared field reduced to the only attributes the mask/merge core needs. */
export type MaskField = {
  /** Variable key (matches the stored bag key). */
  key: string
  /** Whether the field holds a secret (drives masking + merge). */
  secret: boolean
}

/**
 * Project stored values into the shape an edit form should seed with:
 * - secret field with a stored value → `HIDDEN_VALUE` (a "set" marker; the real value never leaves the server)
 * - secret field with nothing stored → `''`
 * - plain field → the stored value as a string
 *
 * Only declared `fields` are emitted, so app/system-provisioned keys (tokens,
 * `client_id`) are structurally excluded — pass a strict field list.
 */
export function maskForEdit(
  fields: MaskField[],
  stored: Record<string, unknown>
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    const raw = stored[field.key]
    if (field.secret) {
      values[field.key] = raw != null && raw !== '' ? HIDDEN_VALUE : ''
    } else {
      values[field.key] = raw == null ? '' : String(raw)
    }
  }
  return values
}

/**
 * Split a submitted form bag into the secret and plain values to persist, dropping
 * any masked echo so the sentinel never reaches the store (a downstream merge keeps
 * the existing value for the dropped key). Only declared `fields` are considered.
 */
export function resolveForWrite(
  submitted: Record<string, string>,
  fields: MaskField[]
): { secrets: Record<string, string>; plain: Record<string, string> } {
  const secrets: Record<string, string> = {}
  const plain: Record<string, string> = {}
  for (const field of fields) {
    const value = submitted[field.key]
    if (value === undefined) continue
    if (field.secret) {
      if (isMasked(value)) continue // unchanged → let the store merge keep existing
      secrets[field.key] = value
    } else {
      plain[field.key] = value
    }
  }
  return { secrets, plain }
}
