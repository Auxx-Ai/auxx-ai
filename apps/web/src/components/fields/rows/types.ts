// apps/web/src/components/fields/rows/types.ts

import type { ResourceField } from '@auxx/lib/resources/client'

/**
 * A `ResourceField` as the field panel hands it to a row: `id` is narrowed to a
 * plain string (system fields fall back to their key), `name` carries the display
 * label, and `readOnly` folds together the field's own capability and the panel's
 * read-only mode.
 */
export type PanelField = Omit<ResourceField, 'id'> & {
  id: string
  name: string
  readOnly: boolean
}
