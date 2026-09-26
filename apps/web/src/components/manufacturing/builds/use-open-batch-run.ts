// apps/web/src/components/manufacturing/builds/use-open-batch-run.ts
'use client'

import type { Operator } from '@auxx/lib/conditions/client'
import { useRouter } from 'next/navigation'
import { useRecordsSearchStore } from '~/components/records/records-search-store'
import { useFieldByKey, useResourceProperty } from '~/components/resources'

/** Where the builds list lives. */
const BUILDS_PATH = '/app/builds'

/** Open the builds list filtered to one batch run; `null` until the org's run field resolves. */
export function useOpenBatchRun(): ((runNumber: number) => void) | null {
  const router = useRouter()
  const buildDefId = useResourceProperty('build', 'id')
  // The list filters on the org's materialized CustomField id, not the registry ref.
  const batchRunField = useFieldByKey(buildDefId, 'build_batch_run')
  if (!buildDefId || !batchRunField) return null

  return (runNumber: number) => {
    // Context before conditions: `RecordsSearchBar` clears conditions when the context changes.
    const store = useRecordsSearchStore.getState()
    store.setContext(buildDefId)
    store.setConditions([
      {
        id: 'build-batch-run',
        fieldId: batchRunField.id,
        operator: 'is' as Operator,
        value: runNumber,
      },
    ])
    router.push(BUILDS_PATH)
  }
}
