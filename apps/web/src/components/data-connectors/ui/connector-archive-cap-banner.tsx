// apps/web/src/components/data-connectors/ui/connector-archive-cap-banner.tsx
'use client'

import { Banner } from '@auxx/ui/components/banner'
import { Button } from '@auxx/ui/components/button'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { Archive, TriangleAlert } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import type { RouterOutputs } from '~/trpc/react'

type ArchiveCapTripped = NonNullable<
  RouterOutputs['dataConnector']['getStatus']['archiveCapTripped']
>

interface ConnectorArchiveCapBannerProps {
  /** From `getStatus().archiveCapTripped`; null/undefined means nothing tripped, no banner. */
  tripped: ArchiveCapTripped | null | undefined
  /** Write the one-shot override and enqueue a sync (`confirmOrphanArchival`). */
  onConfirm: () => void
  isConfirming: boolean
}

/**
 * The archive cap refused the last reconcile pass (v12.1 Phase 3d): too many of the
 * connector's records vanished from one crawl to archive them unattended. Same shape
 * as `ConnectorResyncBanner`, pinned under the tabs strip. The one action is
 * destructive-styled and confirmed, because it archives records the connector was
 * told not to touch on its own. No dismiss: the banner clears itself on the next pass
 * that does not trip, and a merchant who legitimately deleted 600 products can never
 * reconcile without seeing it.
 */
export function ConnectorArchiveCapBanner({
  tripped,
  onConfirm,
  isConfirming,
}: ConnectorArchiveCapBannerProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  if (!tripped) return null

  const n = tripped.orphans
  const records = `${n} ${n === 1 ? 'record' : 'records'}`

  const handleConfirm = async () => {
    const ok = await confirm({
      title: `Archive ${records} anyway?`,
      description:
        `The last sync could not find ${records} of ${tripped.bound} upstream and refused ` +
        'to archive that many at once. Confirm only if they were really deleted at the ' +
        'source. The next sync archives them; records this connector did not create are ' +
        'flagged instead of archived.',
      confirmText: 'Archive anyway',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) onConfirm()
  }

  return (
    <>
      <ConfirmDialog />
      <Banner
        variant='warning'
        icon={<TriangleAlert />}
        title='Archiving paused'
        action={
          <Button
            variant='destructive'
            size='xs'
            loading={isConfirming}
            loadingText='Starting sync...'
            onClick={() => void handleConfirm()}>
            <Archive />
            Archive {records} anyway
          </Button>
        }>
        {tripped.reason}{' '}
        <span className='whitespace-nowrap'>
          Refused <LastUpdated timestamp={tripped.at} /> in run{' '}
          <Tooltip content={tripped.runId}>
            <span className='font-mono'>{tripped.runId.slice(0, 8)}</span>
          </Tooltip>
          .
        </span>
      </Banner>
    </>
  )
}
