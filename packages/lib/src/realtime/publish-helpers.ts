// @auxx/lib/realtime/publish-helpers.ts

import { getOrgCache } from '../cache'
import type { FieldValueUpdateEntry } from './events'
import type { RealtimeService } from './realtime-service'

const CHUNK_SIZE = 50

/**
 * Publish field value updates to the org channel, chunking if needed (Pusher 10KB limit).
 * Fire-and-forget — errors are logged by the provider, not thrown.
 *
 * Each entry can carry any combination of `value`, `aiStatus`, and
 * `aiMetadata`. Omit `value` to publish a pure AI-state transition (e.g. the
 * stage-1 enqueue or a stage-2 error); include both to commit a successful
 * AI generation. Omit the AI fields for regular writes.
 */
export async function publishFieldValueUpdates(
  realtimeService: RealtimeService,
  organizationId: string,
  entries: FieldValueUpdateEntry[],
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
