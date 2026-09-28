// apps/web/src/components/manufacturing/stock-setup/past-builds-step.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { BackflushPanel } from '~/components/manufacturing/builds/backflush-panel'
import { UndoBackflushPanel } from '~/components/manufacturing/builds/undo-backflush-panel'
import { api } from '~/trpc/react'
import type { StockSetupStatus } from './use-stock-setup'

const BUILD_MODE_HREF = '/app/inventory/general'

interface PastBuildsStepProps {
  status: StockSetupStatus | undefined
  onChanged: () => void
}

/** Step 2 (plans/mrp/17 §5.2): backflush all history, or skip it (D5). */
export function PastBuildsStep({ status, onChanged }: PastBuildsStepProps) {
  const drift = api.builds.backflushKindDrift.useQuery()
  const setFlag = api.purchasing.setStockSetupFlag.useMutation()

  const setSkipped = async (value: boolean) => {
    try {
      await setFlag.mutateAsync({ flag: 'buildsSkipped', value })
      onChanged()
    } catch (error) {
      toastError({ title: 'Error saving the step', description: (error as Error).message })
    }
  }

  const covered = status?.unbuiltPartCount === 0
  const skipped = !covered && (status?.buildsSkipped ?? false)
  const driftCount = drift.data?.partCount ?? 0

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6'>
      {driftCount > 0 && (
        <UndoBackflushPanel
          onDone={() => {
            void drift.refetch()
            onChanged()
          }}
        />
      )}

      {covered ? (
        <div className='flex flex-col gap-2 rounded-lg border px-4 py-6 text-sm'>
          <span className='flex items-center gap-2'>
            <CheckCircle2 className='size-4 text-good-500' />
            All past sales are covered.
          </span>
          <Link
            href={BUILD_MODE_HREF}
            className='text-muted-foreground underline-offset-2 hover:text-foreground hover:underline'>
            Keep this up to date? Choose how builds are recorded from now on →
          </Link>
        </div>
      ) : (
        <>
          {skipped && (
            <div className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-4 py-3 text-sm'>
              <span className='text-muted-foreground'>
                Skipped. Sales of made parts stay unbuilt, and their parts show no usage before
                today.
              </span>
              <Button
                variant='ghost'
                size='sm'
                loading={setFlag.isPending}
                loadingText='Saving...'
                onClick={() => void setSkipped(false)}>
                Don't skip
              </Button>
            </div>
          )}
          <BackflushPanel />
          {!skipped && (
            <div className='flex flex-col gap-1 border-t pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4'>
              <span className='text-muted-foreground text-xs'>
                Sales of made parts stay unbuilt, and their parts show no usage before today.
              </span>
              <Button
                variant='ghost'
                size='sm'
                className='shrink-0'
                loading={setFlag.isPending}
                loadingText='Saving...'
                onClick={() => void setSkipped(true)}>
                Skip, count without past builds
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
