// packages/lib/src/export/realtime.ts
// Live CSV-export progress over realtime. One entry point — `publishExportJob` —
// emits a `dataExport:job` frame so the toolbar progress element moves live
// instead of on a poll. Mirrors `data-connectors/realtime.ts`.

import type { DataExportJobEvent } from '../realtime/events'

/** Client routing hint — `progress` patches in place; lifecycle edges refetch. */
export type ExportJobEventKind = DataExportJobEvent['data']['kind']

/**
 * Min interval between `progress` emits per export job. A page (up to 500 rows)
 * is already coarse, but a large export fans out many pages — coalesce to ≤1
 * progress emit / interval. Lifecycle edges (`started` / `finished`) bypass it.
 */
const PROGRESS_MIN_INTERVAL_MS = 750
const lastProgressEmit = new Map<string, number>()

/**
 * Publish the export job's current progress to its org channel. `progress` is
 * throttled per-job; `started` / `finished` always emit (and reset the throttle).
 * Fire-and-forget — never throws into the export job.
 */
export async function publishExportJob(
  organizationId: string,
  data: DataExportJobEvent['data']
): Promise<void> {
  if (data.kind === 'progress') {
    const now = Date.now()
    if (now - (lastProgressEmit.get(data.exportJobId) ?? 0) < PROGRESS_MIN_INTERVAL_MS) return
    lastProgressEmit.set(data.exportJobId, now)
  } else {
    lastProgressEmit.delete(data.exportJobId)
  }

  try {
    // Lazy-import the realtime barrel: a static import from a lib module creates a
    // load-time cycle (realtime → publish-helpers → cache → …) that breaks vi.mock
    // interception. Same pattern as `data-connectors/realtime.ts`.
    const { getRealtimeService, publishDataExportJob } = await import('../realtime')
    await publishDataExportJob(getRealtimeService(), organizationId, data)
  } catch {
    // swallowed — realtime is best-effort
  }
}
