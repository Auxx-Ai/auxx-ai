// apps/web/src/components/fields/utils/edit-mode.ts

import { FieldType } from '@auxx/database/enums'

/** Edit mode determines how the field editor renders */
export type EditMode = 'inline' | 'popover'

/** Field types that support inline editing (table cells, record header) */
const INLINE_EDITABLE_FIELD_TYPES = new Set<string>([
  FieldType.TEXT,
  FieldType.NUMBER,
  FieldType.CURRENCY,
  FieldType.EMAIL,
  FieldType.URL,
])

/** Options subset that changes the edit-mode answer. */
interface EditModeFieldOptions {
  /** Multi-value scalar storage (options.multi) — always edits in a popover. */
  multi?: boolean
}

/**
 * Determines the edit mode for a field type
 * - 'inline': Input renders directly in cell (TEXT, NUMBER, CURRENCY, EMAIL, URL)
 * - 'popover': Input renders in popover overlay (all other types — including
 *   any scalar type flagged `options.multi`, whose editor is the value-list
 *   picker rather than a single-line input)
 */
export function getEditModeForFieldType(
  fieldType: string | undefined,
  options?: EditModeFieldOptions | null
): EditMode {
  if (!fieldType) return 'popover'
  // Multi-value scalars leave inline editing — the editor is a list picker.
  if (options?.multi) return 'popover'
  return INLINE_EDITABLE_FIELD_TYPES.has(fieldType) ? 'inline' : 'popover'
}
