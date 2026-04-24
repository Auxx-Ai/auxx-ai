// packages/lib/src/field-values/normalize-for-lookup.ts

import type { FieldType } from '@auxx/database/types'
import { fieldValueSchemas } from './field-value-validator'

/**
 * Read-side value normalization for `lookupByField`.
 *
 * MUST stay in lockstep with write-path formatting in
 * `field-values/field-value-validator.ts` — if the two drift apart, dedup
 * silently misses (e.g. user captured `Foo@BAR.com` but lookup is keyed
 * on `foo@bar.com`). We reuse the same Zod schemas here so the two paths
 * share one normalization implementation.
 *
 * Returns `null` on inputs that can't be coerced (e.g. invalid email
 * syntax, uncoercible phone). Callers should treat null as "skip this
 * candidate" — never assume a raw fall-through, since that would bypass
 * normalization and silently miss valid rows.
 */
export function normalizeForLookup(fieldType: FieldType, value: unknown): unknown {
  if (value === null || value === undefined) return value

  switch (fieldType) {
    case 'EMAIL': {
      const result = fieldValueSchemas.email.safeParse(value)
      return result.success ? result.data : null
    }
    case 'URL': {
      const result = fieldValueSchemas.url.safeParse(value)
      return result.success ? result.data : null
    }
    case 'PHONE_INTL': {
      const result = fieldValueSchemas.phone.safeParse(value)
      return result.success ? result.data : null
    }
    case 'TEXT':
    case 'RICH_TEXT':
    case 'ADDRESS': {
      // Write path uses fieldValueSchemas.text which does String(v).trim().
      // Empty strings match nothing useful — treat as null for lookup.
      const result = fieldValueSchemas.text.safeParse(value)
      if (!result.success) return null
      return result.data === '' ? null : result.data
    }
    default:
      return value
  }
}
