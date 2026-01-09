// apps/web/src/components/dynamic-table/utils/edit-mode.ts

import { FieldType } from '@auxx/database/enums'

/** Edit mode determines how the cell editor renders */
export type EditMode = 'inline' | 'popover'

/** Field types that support inline editing in cells */
const INLINE_EDITABLE_FIELD_TYPES = new Set<string>([
  FieldType.TEXT,
  FieldType.NUMBER,
  FieldType.CURRENCY,
])

/**
 * Determines the edit mode for a field type
 * - 'inline': Input renders directly in cell (TEXT, NUMBER, CURRENCY)
 * - 'popover': Input renders in popover overlay (all other types)
 */
export function getEditModeForFieldType(fieldType: string | undefined): EditMode {
  if (!fieldType) return 'popover'
  return INLINE_EDITABLE_FIELD_TYPES.has(fieldType) ? 'inline' : 'popover'
}
