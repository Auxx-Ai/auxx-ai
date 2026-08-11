// apps/web/src/components/fields/rows/to-panel-field.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import type { PanelField } from './types'

/**
 * Fold a registry {@link ResourceField} into the {@link PanelField} shape every
 * editable field surface consumes: `id` narrowed to a plain string (system
 * fields have no DB id and fall back to their key), `name` carrying the display
 * label, and `readOnly` folding the field's own capability together with the
 * surface's read-only mode.
 *
 * Extracted so the Details panel (`EntityFieldsContent`) and the record header
 * (`RecordIdentityHeader`) can never disagree about what read-only means — the
 * capability half is the question the server answers, and a surface that asks it
 * differently silently offers an editor for a write that will be rejected.
 */
export function toPanelField(field: ResourceField, readOnly = false): PanelField {
  return {
    ...field,
    id: field.id || field.key,
    name: field.label,
    readOnly: field.capabilities?.updatable === false || readOnly,
  }
}
