// app/(protected)/app/settings/plans/_components/cancel-subscription-dialog.tsx
'use client'

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
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useAnalytics } from '~/hooks/use-analytics'
import { useDehydratedOrganization } from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

/**
 * cancelReasons
 * Lists the available dropdown options for cancellation reasons.
 */
const cancelReasons = [
  { value: 'too-expensive', label: 'Too expensive' },
  { value: 'missing-features', label: 'Missing features I need' },
  { value: 'switching', label: 'Switching to another service' },
  { value: 'temporary', label: 'Just needed it temporarily' },
  { value: 'other', label: 'Other reason' },
] as const

/**
 * CancelSubscriptionDialog
 * Renders a dialog for ending the current subscription and collecting feedback.
 * If subscription is already canceled, shows a restore button instead.
 */
export function CancelSubscriptionDialog() {
  const router = useRouter()
  const utils = api.useUtils()
  const posthog = useAnalytics()
  const [reason, setReason] = useState<string>('')
  const [feedback, setFeedback] = useState<string>('')
  const [confirmationText, setConfirmationText] = useState<string>('')
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false)

  const { organizationId } = useOrganizationIdContext()
  const organization = useDehydratedOrganization(organizationId)
  const subscription = organization?.subscription

  const { data: subscriptionData, isLoading } = api.billing.getCurrentSubscription.useQuery()
  console.log(subscriptionData)
  const cancelSubscription = api.billing.cancelSubscription.useMutation({
    onSuccess: () => {
      setIsDialogOpen(false)
      utils.billing.getCurrentSubscription.invalidate()
      router.push('/app/settings/plans')
    },
    onError: (error) => {
      toastError({
        title: 'Error canceling subscription',
        description: error.message,
      })
    },
  })

  const restoreSubscription = api.billing.restoreSubscription.useMutation({
    onSuccess: () => {
      utils.billing.getCurrentSubscription.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Error restoring subscription',
        description: error.message,
      })
    },
  })

  /**
   * handleCancel
   * Confirms the cancellation request with the backend.
   */
  const handleCancel = () => {
    posthog?.capture('subscription_cancelled', {
      plan: subscription?.plan ?? 'unknown',
      reason: reason || undefined,
    })
    cancelSubscription.mutate()
  }

  /**
   * handleRestore
   * Restores a previously canceled subscription.
   */
  const handleRestore = () => {
    restoreSubscription.mutate()
  }

  /**
   * handleReturnToBilling
   * Returns the user to the billing settings page and closes the dialog.
   */
  const handleReturnToBilling = () => {
    setIsDialogOpen(false)
    router.push('/app/settings/plans')
  }

  /**
   * handleDialogChange
   * Syncs dialog open state and clears form fields when the dialog closes.
   */
  const handleDialogChange = (open: boolean) => {
    setIsDialogOpen(open)
    if (!open) {
      setReason('')
      setFeedback('')
      setConfirmationText('')
    }
  }

  let dialogHeader: ReactNode = null
  let dialogBody: ReactNode = null
  let dialogFooter: ReactNode = null

  if (isLoading) {
    dialogHeader = (
      <DialogHeader>
        <DialogTitle className='flex items-center'>
          <Loader2 className='mr-2 h-5 w-5 animate-spin' />
          Loading subscription details...
        </DialogTitle>
      </DialogHeader>
    )
  } else if (!subscription) {
    dialogHeader = (
      <DialogHeader>
        <DialogTitle>No Active Subscription</DialogTitle>
        <DialogDescription>You don't have an active subscription to cancel.</DialogDescription>
      </DialogHeader>
    )
    dialogFooter = (
      <DialogFooter>
        <Button onClick={handleReturnToBilling}>Return to Billing</Button>
      </DialogFooter>
    )
  } else if (subscription.status === 'canceled') {
    dialogHeader = (
      <DialogHeader>
        <DialogTitle>Subscription Already Canceled</DialogTitle>
        <DialogDescription>
          Your subscription has already been canceled and will end on{' '}
          {subscription.periodEnd
            ? format(new Date(subscription.periodEnd), 'MMMM d, yyyy')
            : 'the end of your current billing period'}
          .
        </DialogDescription>
      </DialogHeader>
    )
    dialogFooter = (
      <DialogFooter>
        <Button onClick={handleReturnToBilling}>Return to Billing</Button>
      </DialogFooter>
    )
  } else {
    dialogHeader = (
      <DialogHeader>
        <DialogTitle className='flex items-center'>Cancel Your Subscription</DialogTitle>
        <DialogDescription>
          Your subscription will remain active until the end of your current billing period on{' '}
          {subscription.periodEnd
            ? format(new Date(subscription.periodEnd), 'MMMM d, yyyy')
            : 'the end of your current billing period'}
          .
        </DialogDescription>
      </DialogHeader>
    )
    dialogBody = (
      <div className='space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='cancel-reason'>Why are you canceling?</Label>
          <Select
            value={reason || undefined}
            onValueChange={setReason}
            disabled={cancelSubscription.isPending}>
            <SelectTrigger id='cancel-reason'>
              <SelectValue placeholder='Select a reason' />
            </SelectTrigger>
            <SelectContent>
              {cancelReasons.map((cancelReason) => (
                <SelectItem key={cancelReason.value} value={cancelReason.value}>
                  {cancelReason.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='feedback'>Additional feedback (optional)</Label>
          <Input
            id='feedback'
            placeholder='Tell us how we could improve...'
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            disabled={cancelSubscription.isPending}
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='cancel-confirmation'>
            Please type "Cancel subscription" below to confirm cancellation.
          </Label>
          <Input
            id='cancel-confirmation'
            placeholder='Cancel subscription'
            value={confirmationText}
            onChange={(event) => setConfirmationText(event.target.value)}
            disabled={cancelSubscription.isPending}
            autoComplete='off'
          />
        </div>
      </div>
    )
    dialogFooter = (
      <DialogFooter>
        <Button variant='outline' size='sm' onClick={handleReturnToBilling}>
          Keep My Subscription
        </Button>
        <Button
          variant='destructive'
          size='sm'
          onClick={handleCancel}
          loading={cancelSubscription.isPending}
          loadingText='Processing...'
          disabled={!reason || confirmationText.trim() !== 'Cancel subscription'}>
          Cancel Subscription
        </Button>
      </DialogFooter>
    )
  }

  // If subscription is canceled (cancelAtPeriodEnd is true), show restore button
  if (subscription?.cancelAtPeriodEnd) {
    return (
      <Button
        size='sm'
        onClick={handleRestore}
        loading={restoreSubscription.isPending}
        loadingText='Restoring...'
        disabled={isLoading}>
        Restore subscription
      </Button>
    )
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
      <DialogTrigger asChild>
        <Button variant='outline' size='sm' disabled={isLoading}>
          Cancel subscription
        </Button>
      </DialogTrigger>
      <DialogContent size='md' position='tc'>
        {dialogHeader}
        {dialogBody}
        {dialogFooter}
      </DialogContent>
    </Dialog>
  )
}
