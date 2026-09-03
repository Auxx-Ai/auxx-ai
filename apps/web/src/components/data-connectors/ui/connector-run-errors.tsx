// apps/web/src/components/data-connectors/ui/connector-run-errors.tsx
'use client'

import { Badge, type BadgeProps } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toCsv } from '@auxx/utils/csv'
import { Download } from 'lucide-react'
import { downloadCsv } from '~/lib/csv'

/** The two-tier error sample carried on a run row (Step 9 §1.1 / §2). */
export interface ConnectorRunError {
  externalId: string
  error: string
  /**
   * 'invalid' = dropped before the write; 'rejected' = the write threw; 'skipped' = a
   * deliberate no-op with a reason (a true in-source duplicate, money plan 39 section
   * 6.1); absent = engine-level.
   */
  tier?: 'invalid' | 'rejected' | 'skipped'
}

/** errorSample is capped server-side (`service.ts` finalizeRun → `.slice(0, 50)`). */
const ERROR_SAMPLE_CAP = 50

const TIER_META: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  invalid: { label: 'Invalid', variant: 'amber' },
  rejected: { label: 'Rejected', variant: 'red' },
  skipped: { label: 'Skipped', variant: 'gray' },
}
const UNTAGGED_TIER = { label: 'Error', variant: 'gray' as const }

function tierMeta(tier?: string) {
  return (tier && TIER_META[tier]) || UNTAGGED_TIER
}

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'connector'
  )
}

/**
 * The drill-in for a run's failures (Step 9 §2). A "N errors" affordance opens a
 * dialog rendering the run's `errorSample` as a Reason / Record / Type table with a
 * tier badge, plus a "Download rows with errors" CSV. The sample is capped at 50, so
 * the dialog says so rather than implying the export is every failed row.
 */
export function ConnectorRunErrors({
  errors,
  connectorLabel,
  runId,
}: {
  errors: ConnectorRunError[]
  connectorLabel: string
  runId: string
}) {
  if (errors.length === 0) return null
  const capped = errors.length >= ERROR_SAMPLE_CAP

  const handleDownload = () => {
    const rows = errors.map((e) => ({
      tier: e.tier ?? 'error',
      externalId: e.externalId,
      error: e.error,
    }))
    downloadCsv(
      toCsv(rows, ['tier', 'externalId', 'error']),
      `${slugify(connectorLabel)}-errors-${runId}.csv`
    )
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type='button'
          className='self-start text-xs font-medium text-red-600 underline-offset-2 hover:underline'>
          {errors.length} error{errors.length === 1 ? '' : 's'}
        </button>
      </DialogTrigger>
      <DialogContent size='lg'>
        <DialogHeader>
          <DialogTitle>Sync errors</DialogTitle>
          <DialogDescription>
            {capped
              ? `Showing the first ${ERROR_SAMPLE_CAP} errors from this run — there may be more.`
              : `${errors.length} record${errors.length === 1 ? '' : 's'} couldn’t be synced in this run.`}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className='max-h-[50vh]'>
          <table className='w-full text-left text-sm'>
            <thead className='sticky top-0 bg-background'>
              <tr className='border-b text-xs text-muted-foreground'>
                <th className='py-2 pr-3 font-medium'>Reason</th>
                <th className='py-2 pr-3 font-medium'>Record</th>
                <th className='py-2 font-medium'>Type</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => {
                const tier = tierMeta(e.tier)
                return (
                  <tr key={i} className='border-b last:border-0 align-top'>
                    <td className='py-2 pr-3 text-foreground'>{e.error}</td>
                    <td className='py-2 pr-3 font-mono text-xs text-muted-foreground'>
                      {e.externalId || '—'}
                    </td>
                    <td className='py-2'>
                      <Badge variant={tier.variant} size='xs'>
                        {tier.label}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ScrollArea>

        <DialogFooter>
          <Button variant='outline' onClick={handleDownload}>
            <Download />
            Download rows with errors
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
