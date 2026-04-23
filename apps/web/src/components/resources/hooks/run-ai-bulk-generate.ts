// apps/web/src/components/resources/hooks/run-ai-bulk-generate.ts

import type { FieldType } from '@auxx/database/types'
import { toRecordId } from '@auxx/lib/resources/client'
import type { FieldId } from '@auxx/types/field'
import { useCallback } from 'react'
import { useSaveFieldValue } from './use-save-field-value'

/**
 * Kick stage-1 AI autofill for a list of rows in a single column. Wraps
 * `saveBulkValues(..., { ai: true })` and handles the recordId construction
 * so the fill-handle and header-dropdown bulk paths share one dispatch point.
 *
 * Server flow is unchanged: one `fieldValue.setBulk` call fans out to N
 * `setValueWithBuiltIn` short-circuits → N BullMQ jobs → N realtime
 * `aiStatus='generating'` events.
 */
export function useRunAiBulkGenerate() {
  const { saveBulkValues } = useSaveFieldValue()

  return useCallback(
    (
      rowIds: string[],
      field: { id: FieldId; fieldType: FieldType },
      entityDefinitionId: string
    ): void => {
      if (rowIds.length === 0) return
      const recordIds = rowIds.map((id) => toRecordId(entityDefinitionId, id))
      saveBulkValues(recordIds, field.id, null, field.fieldType, { ai: true })
    },
    [saveBulkValues]
  )
}
