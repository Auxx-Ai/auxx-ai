// apps/web/src/components/resources/hooks/use-record-edit-state.ts
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { useRecord } from './use-record'

/** One row's edit-in-place state, as the line cards and the actions bar read it. */
export interface RecordEditState {
  /** An edit is open. False whenever {@link RecordEditState.isKnown} is false. */
  editing: boolean
  openedAt: string | null
  byUserId: string | null
  /**
   * The row arrived from a lane that stamps (`record.getByIds`). False means the
   * answer is unknown, and the caller must treat the record as locked — the safe
   * side for a posted document, and the same rule `_access` documents.
   */
  isKnown: boolean
}

/**
 * Read a record's open edit off the store stamp (74-D1 §1.2.1). No query of its
 * own: the stamp rides the batch that fetched the row, and the lane's
 * open/save/cancel push it live through `record:updated`.
 */
export function useRecordEditState(recordId: RecordId | null | undefined): RecordEditState {
  const { record } = useRecord({ recordId })
  const edit = record?.edit

  if (edit === undefined) {
    return { editing: false, openedAt: null, byUserId: null, isKnown: false }
  }
  if (edit === null) {
    return { editing: false, openedAt: null, byUserId: null, isKnown: true }
  }
  return { editing: true, openedAt: edit.openedAt, byUserId: edit.byUserId, isKnown: true }
}
