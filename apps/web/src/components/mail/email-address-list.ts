// apps/web/src/components/mail/email-address-list.ts

/**
 * Normalize a system-value read of a (possibly multi-value) EMAIL field into
 * an ordered address list. Multi-value fields (`options.multi`) read back as
 * arrays ordered by sortKey — index 0 is the primary; single-value fields (and
 * optimistic scalar writes) read back as a bare string. Empty/non-string
 * entries are dropped.
 */
export function toEmailAddressList(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : []
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  }
  return []
}
