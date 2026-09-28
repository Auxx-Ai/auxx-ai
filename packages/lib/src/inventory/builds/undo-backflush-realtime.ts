// packages/lib/src/inventory/builds/undo-backflush-realtime.ts

import type { UndoBackflushRunEvent } from '../../realtime/events'

/** Min interval between `progress` frames per run; `started` / `finished` always go out. */
const PROGRESS_MIN_INTERVAL_MS = 750
const lastProgressEmit = new Map<string, number>()

/** Publish an undo run's progress on its org channel. Throttled, best-effort, never throws. */
export async function publishUndoBackflushRun(
  organizationId: string,
  data: UndoBackflushRunEvent['data']
): Promise<void> {
  if (data.kind === 'progress') {
    const now = Date.now()
    if (now - (lastProgressEmit.get(data.runId) ?? 0) < PROGRESS_MIN_INTERVAL_MS) return
    lastProgressEmit.set(data.runId, now)
  } else {
    lastProgressEmit.delete(data.runId)
  }

  try {
    // Lazy, as `backflush-run-realtime.ts`: a static import of the realtime barrel is a load-time cycle.
    const { getRealtimeService, publishUndoBackflushRunEvent } = await import('../../realtime')
    await publishUndoBackflushRunEvent(getRealtimeService(), organizationId, data)
  } catch {
    // Best effort; the panel's poll converges.
  }
}
