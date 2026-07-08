// apps/web/src/components/dashboard/lib/column-ref.ts
//
// Shared mapping between a record-list `WidgetFieldRef` and the DynamicTable
// column-id string the cells decode. Used by both the renderer
// (`use-record-list-columns`) and the config-panel column manager
// (`ui/config/columns-row`) so the two agree on a stable per-column id —
// critical for the manager's drag-sort keys lining up with what's rendered.

import type { WidgetFieldRef } from '@auxx/lib/dashboards/client'
import { isFieldPath, type ResourceFieldId } from '@auxx/types/field'
import { encodeFieldPathColumnId } from '~/components/dynamic-table/utils/column-id'

/** A `WidgetFieldRef` → the `columnId` string `CustomFieldCell` decodes. */
export function columnId(ref: WidgetFieldRef): string {
  return isFieldPath(ref) ? encodeFieldPathColumnId(ref) : ref
}

/** The terminal (last-hop) `ResourceFieldId` of a ref, for header-label + icon lookup. */
export function terminalFieldId(ref: WidgetFieldRef): ResourceFieldId {
  return isFieldPath(ref) ? ref[ref.length - 1] : ref
}
