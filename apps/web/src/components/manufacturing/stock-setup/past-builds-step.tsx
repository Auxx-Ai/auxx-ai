// apps/web/src/components/manufacturing/stock-setup/past-builds-step.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { BackflushPanel } from '~/components/manufacturing/builds/backflush-panel'
import { UndoBackflushPanel } from '~/components/manufacturing/builds/undo-backflush-panel'
import { api } from '~/trpc/react'
import { FixAccountsCard } from './fix-accounts-card'
import type { StockSetupStatus } from './use-stock-setup'

const BUILD_MODE_HREF = '/app/inventory/general'

interface PastBuildsStepProps {
  status: StockSetupStatus | undefined
  onChanged: () => void
}

/** Step 2 (plans/mrp/17 §5.2): backflush all history, or skip it (D5). */
export function PastBuildsStep({ status, onChanged }: PastBuildsStepProps) {
  const hasBuilds = api.builds.hasBackflushBuilds.useQuery()
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

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6'>
      <FixAccountsCard onFixed={onChanged} />

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

      {hasBuilds.data && (
        <section
          className='mt-4 flex flex-col gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-4 text-sm'
          data-testid='undo-past-builds-section'>
          <div className='font-medium'>Changed a parts list?</div>
          <p className='text-muted-foreground'>
            If a parts list was wrong — a wrong part, or the wrong quantity per unit — past builds
            used up the wrong parts.{' '}
            <span className='font-medium text-foreground'>Undo past builds</span> removes every
            build recorded from past sales, so you can record them again with the corrected list. It
            runs in the background and takes a while (about an hour for 25,000 builds).
          </p>
          <UndoBackflushPanel
            onDone={() => {
              void hasBuilds.refetch()
              onChanged()
            }}
          />
        </section>
      )}
    </div>
  )
}
