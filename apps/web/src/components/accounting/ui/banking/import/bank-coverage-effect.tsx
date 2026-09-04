// apps/web/src/components/accounting/ui/banking/import/bank-coverage-effect.tsx

'use client'

// The card the confirm step gains for a bank statement (ui-plan.md §2.9).
//
// 🛑 It answers the two questions a person actually has before pressing Start
// Import, and neither is "how many rows":
//
// 1. **Does this close the hole?** A reconciliation must refuse to run across a
//    gap (05 §7), and a balance sheet spanning one renders happily and is wrong.
// 2. **How much of this do I already have?** The overlap band is the NORMAL case
//    (05 §6): files cover up to the cutover, the API reaches 180 days back, and
//    01 §4.1 overlaps them deliberately so there is no hole. Without this number
//    a person reads the linked rows as a mistake.

import { isMatchRole } from '@auxx/lib/import/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { BookmarkCheck, CalendarRange, GitMerge, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

interface BankCoverageEffectProps {
  jobId: string
  bankAccountId: string
}

export function BankCoverageEffect({ jobId, bankAccountId }: BankCoverageEffectProps) {
  const effect = api.banking.bankingImport.coverageEffect.useQuery({ jobId, bankAccountId })

  if (effect.isPending) {
    return (
      <div className='border-b p-4'>
        <Skeleton className='h-4 w-2/3' />
      </div>
    )
  }

  if (effect.error) {
    return (
      <div className='flex items-start gap-2 border-b bg-amber-50 p-4 text-sm dark:bg-amber-950/40'>
        <TriangleAlert className='mt-0.5 size-4 shrink-0' />
        <span>{effect.error.message}</span>
      </div>
    )
  }

  const data = effect.data
  if (!data) return null

  const { overlap } = data

  return (
    <div className='flex flex-col gap-2 border-b p-4 text-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        <CalendarRange className='size-4 text-muted-foreground' />
        {data.fileFrom && data.fileTo ? (
          <span>
            This file covers <span className='font-medium'>{data.fileFrom}</span> to{' '}
            <span className='font-medium'>{data.fileTo}</span>.
          </span>
        ) : (
          <span className='text-muted-foreground'>
            No row in this file carries a readable date, so it cannot say what period it covers.
          </span>
        )}
        {data.newCoverageFrom && data.newCoverageFrom !== data.coverage.coverageFrom && (
          <Badge variant='blue' size='xs'>
            Coverage moves back to {data.newCoverageFrom}
          </Badge>
        )}
      </div>

      {data.gapsClosed.length > 0 && (
        <p>
          It closes {data.gapsClosed.map((gap) => `${gap.from} → ${gap.to}`).join(', ')} on this
          account.
        </p>
      )}
      {data.gapsClosed.length === 0 && data.gapsTouched.length > 0 && (
        <p className='text-muted-foreground'>
          It reaches into {data.gapsTouched.map((gap) => `${gap.from} → ${gap.to}`).join(', ')}{' '}
          without closing it end to end.
        </p>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <GitMerge className='size-4 text-muted-foreground' />
        <span>
          <span className='font-medium'>{overlap.added}</span> new,{' '}
          <span className='font-medium'>{overlap.byExternalId}</span> already here by id
          {overlap.byMatchKey > 0 ? (
            <>
              , <span className='font-medium'>{overlap.byMatchKey}</span> matching lines the feed
              already brought in - those are linked, not duplicated
            </>
          ) : null}
          .
        </span>
      </div>

      {data.unusableRowCount > 0 && (
        <p className='flex items-start gap-2 text-muted-foreground'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0' />
          <span>
            {data.unusableRowCount} row{data.unusableRowCount === 1 ? '' : 's'} carr
            {data.unusableRowCount === 1 ? 'ies' : 'y'} no readable date or amount. They will import
            as blanks and land in the review queue with nothing to reconcile against.
          </span>
        </p>
      )}

      <RememberMapping jobId={jobId} />
    </div>
  )
}

/**
 * "Remember this mapping for files with these columns."
 *
 * ⚠️ It lives on the CONFIRM step, not the mapping step, and deliberately: by
 * here the mapping is what the person actually settled on, including anything
 * they corrected after seeing the review step's errors. Offering it while the
 * columns are still being pointed at fields would remember the half-finished
 * one, and a bad remembered mapping is worse than none - it prefills silently
 * every month afterwards.
 *
 * 🛑 Keyed by the file's HEADER SIGNATURE, never its name. A renamed download
 * and a browser's ` (3)` suffix are the same export; two banks both call it
 * `statement.csv`.
 */
function RememberMapping({ jobId }: { jobId: string }) {
  const [saved, setSaved] = useState(false)
  const properties = api.dataImport.getMappableProperties.useQuery({ jobId })
  const saveMapping = api.banking.bankingImport.saveMapping.useMutation()
  const job = api.dataImport.getJob.useQuery({ jobId })

  const columns = properties.data ?? []
  if (columns.length === 0) return null

  const handleSave = async () => {
    try {
      await saveMapping.mutateAsync({
        headers: columns.map((column) => column.visibleName),
        columns: columns.map((column) => ({
          columnIndex: column.columnIndex,
          targetFieldKey: column.targetType === 'skip' ? null : column.targetFieldKey,
          resolutionType: column.resolutionType,
          isIdentifier: isMatchRole(column.identityRole ?? undefined),
        })),
        label: job.data?.importMapping.title ?? null,
      })
      setSaved(true)
    } catch (error) {
      toastError({
        title: 'The mapping could not be remembered',
        description: error instanceof Error ? error.message : 'An error occurred',
      })
    }
  }

  return (
    <div className='flex items-center gap-2'>
      <Button
        variant='outline'
        size='sm'
        loading={saveMapping.isPending}
        disabled={saved}
        onClick={() => void handleSave()}>
        <BookmarkCheck />
        {saved ? 'Remembered for this header' : 'Remember for this header'}
      </Button>
      <span className='text-muted-foreground text-xs'>
        The next file with the same columns prefills this mapping.
      </span>
    </div>
  )
}
