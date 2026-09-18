// apps/web/src/components/accounting/ui/ledger/sync-queue/sync-queue-panel.tsx

'use client'

import { EXPORT_BATCH_TABS, type ExportBatchTab } from '@auxx/lib/postings/client'

export { EXPORT_BATCH_TABS as SYNC_QUEUE_TABS }
export type { ExportBatchTab as SyncQueueTab }

interface SyncQueuePanelProps {
  tab: ExportBatchTab
}

/** Export queue: rebuilt in step 3c. */
export function SyncQueuePanel(_props: SyncQueuePanelProps) {
  return <div className='p-3 text-muted-foreground text-sm'>Export queue: rebuilt in step 3c.</div>
}
