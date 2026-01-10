// apps/web/src/components/resources/hooks/use-record-hydration.ts

import { useEffect, useRef } from 'react'
import { hydrateFieldValues } from '~/stores/hydrate-field-values'
import type { Resource } from '@auxx/lib/resources/client'

interface UseRecordHydrationOptions {
  resource: Resource | undefined
  recordId: string | undefined
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
