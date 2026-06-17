// apps/web/src/components/kbar/record-href.ts
'use client'

import { getDefinitionId, type RecordId, type Resource } from '@auxx/lib/resources/client'
import { getRecordLink } from '~/components/resources/utils/get-record-link'

/**
 * Resolve a record's detail-page path, reusing the canonical {@link getRecordLink}
 * builder (system → `/app/<slug>/<id>`, custom → `/app/custom/<slug>/<id>`).
 * Returns `null` when the owning resource can't be resolved.
 */
export function recordHref(
  recordId: RecordId,
  getResourceById: (idOrSlug: string) => Resource | undefined
): string | null {
  const resource = getResourceById(getDefinitionId(recordId))
  if (!resource) return null
  return getRecordLink(recordId, resource)
}
