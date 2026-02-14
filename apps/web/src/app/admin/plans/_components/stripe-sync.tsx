// apps/web/src/app/admin/plans/_components/stripe-sync.tsx
/**
 * Component for syncing plan to Stripe
 */
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/**
 * Stripe sync component props
 */
interface StripeSyncProps {
  planId: string
  plan: any
}

/**
 * Component for syncing plan to Stripe
 */
export function StripeSync({ planId, plan }: StripeSyncProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const syncToStripe = api.admin.plans.syncToStripe.useMutation({
    onSuccess: (data) => {
      utils.admin.plans.getById.invalidate({ id: planId })
      utils.admin.plans.getAll.invalidate()
      toast.success('Synced to Stripe', {
        description: `Created product ${data.stripeProductId}`,
      })
    },
    onError: (error) => {
      toastError({
        title: 'Failed to sync to Stripe',
        description: error.message,
      })
    },
  })

  /**
   * Handle sync to Stripe
   */
  const handleSync = async () => {
    // Show warning if plan already has Stripe IDs (prices will be recreated)
    if (plan.stripeProductId) {
      const confirmed = await confirm({
        title: 'Re-sync plan to Stripe?',
        description:
          'This will create NEW price objects in Stripe and mark the old ones as inactive. Existing subscriptions will not be affected. Continue?',
        confirmText: 'Sync',
        cancelText: 'Cancel',
      })

      if (!confirmed) return
    }

    await syncToStripe.mutateAsync({ id: planId })
  }

  // Don't show button for custom pricing or free plans
  if (plan.isCustomPricing) {
    return (
      <span className='text-xs text-muted-foreground'>Custom pricing plans cannot be synced</span>
    )
  }

  if (plan.isFree && plan.monthlyPrice === 0 && plan.annualPrice === 0) {
    return <span className='text-xs text-muted-foreground'>Free plans cannot be synced</span>
  }

  return (
    <>
      <ConfirmDialog />
      <Button
        variant='outline'
        size='sm'
        onClick={handleSync}
        loading={syncToStripe.isPending}
        loadingText='Syncing...'>
        <RefreshCw />
        {plan.stripeProductId ? 'Re-sync to Stripe' : 'Sync to Stripe'}
      </Button>
    </>
  )
}
