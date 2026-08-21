// packages/lib/src/custom-fields/notify.ts

import { onCacheEvent } from '../cache/invalidate'

/**
 * Single chokepoint for "a custom field changed" — busts the server-side org
 * cache AND broadcasts a coarse `resource:*` realtime event so every open
 * client refetches the def's field catalog live.
 *
 * Why the broadcast half exists: `custom-field.updated` invalidates
 * `resources` / `customFields` / `recordRules` server-side, but NOTHING
 * broadcasts. After the option cascade in `updateCustomField` other tabs
 * receive the reduced values via `publishFieldValueUpdates` while still
 * holding the STALE option list, so every cascaded value renders as a muted
 * unknown chip until some unrelated refetch happens to bust their cache.
 * Sending both from one call makes cache-bust and realtime impossible to
 * diverge.
 *
 * Callers must invoke this exactly ONCE per logical change.
 *
 * @param orgId - Organization the field belongs to
 * @param entityDefinitionId - The def whose field catalog changed
 * @param kind - Which lifecycle transition happened
 */
export async function notifyCustomFieldChanged(
  orgId: string,
  entityDefinitionId: string,
  kind: 'created' | 'updated' | 'deleted'
): Promise<void> {
  await onCacheEvent(`custom-field.${kind}`, { orgId })

  // Best-effort realtime. Lazy-import the barrel to dodge the load-time cycle
  // (realtime → publish-helpers → cache) that breaks vi.mock — same pattern as
  // `entity-definitions/notify.ts`.
  try {
    const { getRealtimeService, publishResourceDefChanged } = await import('../realtime')
    await publishResourceDefChanged(getRealtimeService(), orgId, { entityDefinitionId, kind })
  } catch {}
}
