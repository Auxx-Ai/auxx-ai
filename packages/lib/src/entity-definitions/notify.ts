// packages/lib/src/entity-definitions/notify.ts

import { onCacheEvent } from '../cache/invalidate'

/**
 * Single chokepoint for "an entity definition changed" — busts the server-side org
 * cache AND broadcasts a coarse `resource:*` realtime event so every open client
 * refetches its resource list live. Replaces bare `onCacheEvent('entity-def.*')`
 * calls so cache-bust and realtime can never diverge.
 *
 * Callers must invoke this exactly ONCE per logical change (the UI service fires
 * once per create/update/delete; connector provisioning coalesces its internal
 * pointer writes into one terminal call — see `provisionTarget`).
 *
 * @param kind `'created'` only on a genuine new def; `'updated'` for renames,
 *   pointer/field changes, or adopting an existing def (never flash a phantom
 *   "new resource" on adopt).
 */
export async function notifyEntityDefChanged(
  orgId: string,
  entityDefinitionId: string,
  kind: 'created' | 'updated' | 'deleted'
): Promise<void> {
  await onCacheEvent(`entity-def.${kind}`, { orgId })
  // Deleting a def cascades its custom fields — keep the existing fields cache-bust.
  if (kind === 'deleted') await onCacheEvent('custom-field.deleted', { orgId })

  // Best-effort realtime. Lazy-import the barrel to dodge the load-time cycle
  // (realtime → publish-helpers → cache) that breaks vi.mock — same pattern as
  // the data-connector publish path.
  try {
    const { getRealtimeService, publishResourceDefChanged } = await import('../realtime')
    await publishResourceDefChanged(getRealtimeService(), orgId, { entityDefinitionId, kind })
  } catch {}
}
