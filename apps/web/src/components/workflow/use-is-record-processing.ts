// apps/web/src/components/workflow/use-is-record-processing.ts

import type { RecordId } from '@auxx/types/resource'
import { useWorkflowRunStatusStore } from '~/stores/workflow-run-status-store'

/** Design-only override: flip to `true` to force every row into processing state. */
const FORCE_PROCESSING_DEBUG = false

/**
 * Returns `true` while at least one workflow run is currently `running` for
 * the given record. `paused`, `completed`, and `failed` runs do not count.
 *
 * v1: reads the local in-tab store. Only reflects runs triggered in the
 * current tab — see `plans/mail/processing-indicator.md` for v2 plans.
 */
export function useIsRecordProcessing(recordId: RecordId | null | undefined): boolean {
  return useWorkflowRunStatusStore((s) => {
    if (FORCE_PROCESSING_DEBUG) return !!recordId
    if (!recordId) return false
    for (const run of s.runs.values()) {
      if (run.recordId === recordId && run.status === 'running') return true
    }
    return false
  })
}
