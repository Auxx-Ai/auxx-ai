// packages/lib/src/accounting/documents/lines/realtime.ts

import { getCachedEntityDefId } from '../../../cache'
import { LINE_KINDS, type Line, type LineDocumentType } from './client'

/**
 * Announce written lines on the parent def's record room (`lines:updated`). Call after the
 * write returns; never throws.
 */
export async function publishLinesUpdated(
  organizationId: string,
  data: {
    documentType: LineDocumentType
    documentId: string
    upserted: Line[]
    deleted: string[]
  },
  options: { excludeSocketId?: string } = {}
): Promise<void> {
  if (data.upserted.length === 0 && data.deleted.length === 0) return
  try {
    const parentDefId = await getCachedEntityDefId(
      organizationId,
      LINE_KINDS[data.documentType].parentEntityType
    )
    if (!parentDefId) return
    // Lazy, as `inventory/builds/build-realtime.ts`: a static import of the realtime barrel is a load-time cycle.
    const { getRealtimeService, publishLinesUpdatedEvent } = await import('../../../realtime')
    await publishLinesUpdatedEvent(getRealtimeService(), organizationId, parentDefId, data, {
      excludeSocketId: options.excludeSocketId,
    })
  } catch {
    // Best effort: the next `lines.list` fetch catches the view up.
  }
}
