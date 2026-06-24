// apps/web/src/components/data-connectors/ui/sample-review-banner.tsx
'use client'

import { Banner } from '@auxx/ui/components/banner'
import { Button } from '@auxx/ui/components/button'
import { FlaskConical, RefreshCw, Waypoints } from 'lucide-react'
import { useState } from 'react'

interface SampleReviewBannerProps {
  /** True when the latest run parked with `paused.reason === 'sample'` (trial-sync §5.2). */
  show: boolean
  /** Records imported in the sample (the run's `atRecords`, surfaced as `itemCount`). */
  recordCount: number
  /** "Sync everything" — resume the parked backfill with no cap (a full sync). */
  onSyncEverything: () => void
  /** Jump to the Streams tab to adjust mappings before committing. */
  onEditMappings: () => void
  isSyncing: boolean
}

/**
 * Parked-sample review banner (trial-sync §5.2). Shown after a sample run parks the
 * connector `paused` so the user can look at the real, mapped records before pulling
 * the rest. Positive framing — a sample is a voluntary "try before you buy", not an
 * error (§6). "Sync everything" resumes the backfill mid-chain (no cap); "Edit
 * mappings" sends them to the Streams tab. Dismiss hides it for the session; it
 * reappears on reload until the user syncs everything (which clears the paused state).
 */
export function SampleReviewBanner({
  show,
  recordCount,
  onSyncEverything,
  onEditMappings,
  isSyncing,
}: SampleReviewBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  if (!show || dismissed) return null

  const records = `${recordCount.toLocaleString()} ${recordCount === 1 ? 'record' : 'records'}`

  return (
    <Banner
      variant='info'
      icon={<FlaskConical />}
      title='Sample imported'
      onClose={() => setDismissed(true)}
      action={
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='sm' onClick={onEditMappings}>
            <Waypoints />
            Edit mappings
          </Button>
          <Button size='sm' loading={isSyncing} loadingText='Starting…' onClick={onSyncEverything}>
            <RefreshCw />
            Sync everything
          </Button>
        </div>
      }>
      {records} imported. Review them, then bring in the rest.
    </Banner>
  )
}
