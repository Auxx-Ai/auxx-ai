// apps/web/src/components/custom-fields/ui/bulk-edit-field-gate.ts

/** Field types whose multi-value variants are excluded from bulk edit. */
const MULTI_VALUE_EXCLUDED_TYPES = new Set(['EMAIL', 'URL', 'PHONE', 'PHONE_INTL'])

export interface BulkEditFieldGate {
  disabled: boolean
  /** Hint rendered as the field's description when disabled. */
  description?: string
}

/**
 * Decide whether a field is editable in the bulk-edit dialog.
 *
 * - Unique fields are disabled when editing multiple records (a shared value
 *   would violate uniqueness on all but one).
 * - Multi-value EMAIL/URL/PHONE fields (`options.multi`) are excluded outright
 *   (locked decision, multi-email plan): a bulk set is a whole-list replace
 *   across N records — it would wipe N alias lists, and per-value email
 *   uniqueness makes the same value succeed on one record and conflict on the
 *   rest. Edit per record via the picker instead.
 */
export function getBulkEditFieldGate(
  field: { isUnique?: boolean; fieldType?: string; options?: { multi?: boolean } },
  instanceCount: number
): BulkEditFieldGate {
  if (field.isUnique && instanceCount > 1) {
    return { disabled: true, description: 'Unique fields cannot be bulk edited' }
  }
  if (field.options?.multi === true && MULTI_VALUE_EXCLUDED_TYPES.has(field.fieldType ?? '')) {
    return { disabled: true, description: 'Multi-value fields are edited per record' }
  }
  return { disabled: false }
}
