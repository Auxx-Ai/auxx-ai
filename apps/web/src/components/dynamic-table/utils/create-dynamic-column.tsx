// apps/web/src/components/dynamic-table/utils/create-dynamic-column.tsx

import { toRecordId } from '~/components/resources'
import { CustomFieldCell } from '../components/custom-field-cell'
import type { ExtendedColumnDef } from '../types'
import { decodeColumnId } from './column-id'

/**
 * Creates a minimal column definition for a field column ID.
 * Used for columns in columnOrder that weren't pre-created by createCustomFieldColumns.
 *
 * The cell and header components handle metadata fetching at render time,
 * so we only need to provide the structural wrapper.
 */
export function createDynamicFieldColumn<T>(
  columnId: string,
  entityDefinitionId: string
): ExtendedColumnDef<T> {
  const decoded = decodeColumnId(columnId)
  const isPath = decoded.type === 'path'

  return {
    id: columnId,
    accessorFn: () => undefined, // Not used - cell reads from store
    header: '', // HeaderCell will fetch label or render breadcrumb
    enableSorting: !isPath, // Paths don't support backend sorting
    enableFiltering: !isPath, // Paths don't support backend filtering
    enableResizing: true,
    enableReorder: true,
    defaultVisible: false,
    minSize: 100,
    size: 150,
    meta: {
      isCustomField: !isPath,
      isDynamicColumn: true, // Flag for debugging/identification
    },
    cell: ({ row }) => {
      // `DynamicView` is generic over `TData extends object`, so the row shape
      // is not statically known to carry an id. Every real caller supplies
      // records that do; degrade to an empty cell rather than minting a
      // `entityDefinitionId:undefined` RecordId if one ever does not.
      const rowId = (row.original as { id?: unknown }).id
      if (typeof rowId !== 'string') return null
      return (
        <CustomFieldCell recordId={toRecordId(entityDefinitionId, rowId)} columnId={columnId} />
      )
    },
  }
}
