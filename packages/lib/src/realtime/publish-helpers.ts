// @auxx/lib/realtime/publish-helpers.ts

import type { FieldValueKey } from '@auxx/types/field'
import { getOrgCache } from '../cache'
import type { StoredFieldValue } from './events'
import type { RealtimeService } from './realtime-service'

const CHUNK_SIZE = 50

/**
 * Publish field value updates to the org channel, chunking if needed (Pusher 10KB limit).
 * Fire-and-forget — errors are logged by the provider, not thrown.
 */
export async function publishFieldValueUpdates(
  realtimeService: RealtimeService,
  organizationId: string,
  entries: Array<{ key: FieldValueKey; value: StoredFieldValue }>,
  options?: { excludeSocketId?: string }
) {
  if (entries.length === 0) return

  // Check realtimeSync feature flag (cached per-org, fast lookup)
  const { features } = await getOrgCache().getOrRecompute(organizationId, ['features'])
  if (!features?.realtimeSync) return

  if (entries.length <= CHUNK_SIZE) {
    await realtimeService.sendToOrganization(
      organizationId,
      'fieldValues:updated',
      { entries },
      options
    )
    return
  }

  // Chunk into multiple messages
  const totalChunks = Math.ceil(entries.length / CHUNK_SIZE)
  const promises: Promise<boolean>[] = []

  for (let i = 0; i < totalChunks; i++) {
    const chunk = entries.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    promises.push(
      realtimeService.sendToOrganization(
        organizationId,
        'fieldValues:updated',
        { entries: chunk, chunk: { index: i, total: totalChunks } },
        options
      )
    )
  }

  await Promise.allSettled(promises)
}
