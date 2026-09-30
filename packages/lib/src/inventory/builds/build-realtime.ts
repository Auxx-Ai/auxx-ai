// packages/lib/src/inventory/builds/build-realtime.ts

import type { BuildRecord } from './types'

/** Builds per frame; keeps a backflush run's announcement under the transport's frame cap. */
const BUILDS_PER_FRAME = 500

/** What a `build:changed` frame is keyed by; a {@link BuildRecord} satisfies it. */
export type ChangedBuild = Pick<BuildRecord, 'buildId' | 'partId' | 'orderId' | 'batchRun'>

/**
 * Announce written builds on the org channel (`build:changed`, ids only). Call after the commit;
 * fire and forget, never throws.
 */
export async function publishBuildsChanged(
  organizationId: string,
  builds: readonly ChangedBuild[]
): Promise<void> {
  if (builds.length === 0) return
  try {
    // Lazy, as `backflush-run-realtime.ts`: a static import of the realtime barrel is a load-time cycle.
    const { getRealtimeService, publishBuildChangedEvent } = await import('../../realtime')
    const service = getRealtimeService()
    for (let i = 0; i < builds.length; i += BUILDS_PER_FRAME) {
      const frame = builds.slice(i, i + BUILDS_PER_FRAME)
      await publishBuildChangedEvent(service, organizationId, {
        buildIds: distinct(frame.map((build) => build.buildId)),
        partIds: distinct(frame.map((build) => build.partId)),
        orderIds: distinct(frame.map((build) => build.orderId)),
        batchRuns: distinct(frame.map((build) => build.batchRun)),
      })
    }
  } catch {
    // Best effort: the next fetch catches the view up.
  }
}

function distinct<T>(values: ReadonlyArray<T | null>): T[] {
  return [...new Set(values.filter((value): value is T => value != null))]
}
