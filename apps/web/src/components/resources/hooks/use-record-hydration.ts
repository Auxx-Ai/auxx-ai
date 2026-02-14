// apps/web/src/components/resources/hooks/use-record-hydration.ts

import type { RecordId, Resource } from '@auxx/lib/resources/client'
import { useEffect, useRef } from 'react'
import { hydrateFieldValues } from '~/components/resources/store/hydrate-field-values'

interface UseRecordHydrationOptions {
  resource: Resource | undefined
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId | undefined
  recordData: Record<string, unknown> | undefined
  enabled?: boolean
}

/**
 * Hook that hydrates record data into customFieldValueStore when data changes.
 * Call this in components that display record fields (drawers, detail pages).
 */
export function useRecordHydration({
  resource,
  recordId,
  recordData,
  enabled = true,
}: UseRecordHydrationOptions): void {
  // Track what we've hydrated to avoid re-hydrating same data
  const hydratedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !resource || !recordId || !recordData) return

    // Create fingerprint to detect changes
    const fingerprint = `${recordId}:${JSON.stringify(recordData)}`
    if (hydratedRef.current === fingerprint) return

    hydrateFieldValues({
      resource,
      recordId,
      recordData,
    })

    hydratedRef.current = fingerprint
  }, [enabled, resource, recordId, recordData])
}
