// apps/web/src/components/apps/host/data-handlers/unwrap-value.ts

import type { FieldType } from '@auxx/database/types'
import { extractValues } from '@auxx/lib/field-values/client'
import type { TypedFieldValue } from '@auxx/types/field-value'

/**
 * Unwrap a typed field value to a plain JS value for an app's `record.data`.
 *
 * LOCKED shape (multi-email plan C5): `options.multi` fields are STABLY
 * `string[]` — one value is `['a@x.com']`, never `'a@x.com'`. A count-dependent
 * shape is exactly the bug the Stripe link dialog was written against
 * (`record.data.primary_email as string`). Single-value fields keep the
 * historic scalar-or-array-by-count behavior.
 */
export function unwrapValue(
  value: TypedFieldValue | TypedFieldValue[] | null,
  fieldType: FieldType,
  fieldOptions?: { multi?: boolean }
): unknown {
  const raws = extractValues(value, fieldType)
  if (fieldOptions?.multi) return raws
  return raws.length <= 1 ? (raws[0] ?? null) : raws
}
