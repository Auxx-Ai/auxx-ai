// packages/lib/src/inventory/builds/backflush-run-realtime.ts

import type { BackflushRunEvent } from '../../realtime/events'

/** Min interval between `progress` frames per run; `started` / `finished` always go out. */
const PROGRESS_MIN_INTERVAL_MS = 750
const lastProgressEmit = new Map<string, number>()

/** Publish a backflush run's progress on its org channel. Throttled, best-effort, never throws. */
export async function publishBackflushRun(
  organizationId: string,
  data: BackflushRunEvent['data']
): Promise<void> {
  if (data.kind === 'progress') {
    const now = Date.now()
    if (now - (lastProgressEmit.get(data.runId) ?? 0) < PROGRESS_MIN_INTERVAL_MS) return
    lastProgressEmit.set(data.runId, now)
  } else {
    lastProgressEmit.delete(data.runId)
  }

  try {
    // Lazy, as `export/realtime.ts`: a static import of the realtime barrel is a load-time cycle.
    const { getRealtimeService, publishBackflushRunEvent } = await import('../../realtime')
    await publishBackflushRunEvent(getRealtimeService(), organizationId, data)
  } catch {
    // Best effort; the dialog's poll converges.
  }
}
