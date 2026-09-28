// apps/web/src/components/manufacturing/stock-setup/fix-accounts-card.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { fixAccountsCopy } from './fix-accounts-copy'

/** Parts whose past movements carry the account of a kind they no longer have (plans/mrp/17 §5.2). */
export function FixAccountsCard() {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const drift = api.builds.movementAccountDrift.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const fix = api.builds.fixMovementAccounts.useMutation()

  const data = drift.data
  if (!data || data.parts.length === 0) return null
  const copy = fixAccountsCopy(data)

  const handleFix = async () => {
    const confirmed = await confirm({
      title: 'Fix accounts?',
      description: copy.confirm,
      confirmText: 'Fix accounts',
      cancelText: 'Cancel',
    })
    if (!confirmed) return
    try {
      await fix.mutateAsync({})
    } catch (error) {
      toastError({ title: 'Error fixing accounts', description: (error as Error).message })
    }
    // A restamp moves accounts only; nothing in the stock setup status reads them.
    void utils.builds.movementAccountDrift.invalidate()
  }

  return (
    <div
      className='flex flex-col gap-3 rounded-lg border px-4 py-4 text-sm'
      data-testid='fix-accounts-card'>
      <ConfirmDialog />
      <div className='font-medium'>{copy.title}</div>
      <p className='text-muted-foreground'>
        {copy.lead} <span className='font-medium text-foreground'>Fix accounts</span> {copy.tail}
      </p>
      {copy.posted && <p className='text-muted-foreground'>{copy.posted}</p>}
      <div>
        <Button size='sm' loading={fix.isPending} loadingText='Fixing…' onClick={handleFix}>
          Fix accounts
        </Button>
      </div>
    </div>
  )
}
