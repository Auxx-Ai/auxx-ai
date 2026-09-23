// packages/lib/src/accounting/work-items/realtime.ts

import type { AccountingWorkChangedEvent } from '../../realtime/events'

/** Tell the Blocked tab a sweep moved parked work. Never throws: realtime is best-effort. */
export async function publishAccountingWork(
  organizationId: string,
  data: AccountingWorkChangedEvent['data']
): Promise<void> {
  try {
    // Lazy: a static import of the realtime barrel creates a load-time cycle, as in `export/realtime.ts`.
    const { getRealtimeService, publishAccountingWorkChanged } = await import('../../realtime')
    await publishAccountingWorkChanged(getRealtimeService(), organizationId, data)
  } catch {
    // swallowed - realtime is best-effort
  }
}
