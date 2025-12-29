// apps/web/src/app/admin/organizations/[id]/_components/subscription-management-section.tsx
'use client'

import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Badge } from '@auxx/ui/components/badge'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { format } from 'date-fns'
import { Ban, RefreshCw, AlertCircle, DollarSign } from 'lucide-react'

interface SubscriptionManagementSectionProps {
  organizationId: string
  organizationName: string | null
  subscription: {
    id: string
    status: string
    plan: string
    canceledAt: Date | null
    cancelAtPeriodEnd: boolean
    periodEnd: Date | null
    creditsBalance: number
  } | null
}

/**
 * Subscription management section for admin billing actions
 */
export function SubscriptionManagementSection({
  organizationId,
  organizationName,
  subscription,
}: SubscriptionManagementSectionProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [cancelReason, setCancelReason] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [statusChangeReason, setStatusChangeReason] = useState('')
  const [creditAmount, setCreditAmount] = useState('')
  const [creditReason, setCreditReason] = useState('')
  const utils = api.useUtils()

  const cancelImmediate = api.admin.billing.cancelImmediately.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
      setCancelReason('')
    },
    onError: (error) =>
      toastError({ title: 'Failed to cancel subscription', description: error.message }),
  })

  const reactivate = api.admin.billing.reactivateSubscription.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
    },
    onError: (error) =>
      toastError({ title: 'Failed to reactivate subscription', description: error.message }),
  })

  const forceStatus = api.admin.billing.forceStatusChange.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
      setNewStatus('')
      setStatusChangeReason('')
    },
    onError: (error) =>
      toastError({ title: 'Failed to change status', description: error.message }),
  })

  const applyCredit = api.admin.billing.applyCreditAdjustment.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
      setCreditAmount('')
      setCreditReason('')
    },
    onError: (error) => toastError({ title: 'Failed to apply credit', description: error.message }),
  })

  /**
   * Handle cancel subscription immediately
   */
  const handleCancelImmediate = async () => {
    const confirmed = await confirm({
      title: 'Cancel Subscription Immediately?',
      description: `This will cancel the subscription for "${organizationName}" right now, not at the period end. The organization will lose access immediately.`,
      confirmText: 'Cancel Now',
      cancelText: 'Go Back',
      destructive: true,
    })

    if (confirmed) {
      cancelImmediate.mutate({
        organizationId,
        reason: cancelReason || undefined,
      })
    }
  }

  /**
   * Handle reactivate subscription
   */
  const handleReactivate = async () => {
    const confirmed = await confirm({
      title: 'Reactivate Subscription?',
      description: `This will restore the subscription for "${organizationName}". The organization will regain access.`,
      confirmText: 'Reactivate',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      reactivate.mutate({ organizationId })
    }
  }

  /**
   * Handle force status change
   */
  const handleForceStatus = async () => {
    if (!newStatus || !statusChangeReason || statusChangeReason.length < 10) {
      toastError({
        title: 'Missing information',
        description: 'Please select a new status and provide a reason (at least 10 characters)',
      })
      return
    }

    const confirmed = await confirm({
      title: 'Force Status Change?',
      description: `This will manually override the subscription status to "${newStatus}". This is a powerful action that should only be used to fix issues.`,
      confirmText: 'Change Status',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      forceStatus.mutate({
        organizationId,
        newStatus,
        reason: statusChangeReason,
      })
    }
  }

  /**
   * Handle apply credit adjustment
   */
  const handleApplyCredit = async () => {
    const amount = parseInt(creditAmount)
    if (isNaN(amount) || !creditReason || creditReason.length < 10) {
      toastError({
        title: 'Missing information',
        description: 'Please enter a valid credit amount and reason (at least 10 characters)',
      })
      return
    }

    const confirmed = await confirm({
      title: 'Apply Credit Adjustment?',
      description: `This will ${amount > 0 ? 'add' : 'deduct'} ${Math.abs(amount)} credits ${amount > 0 ? 'to' : 'from'} "${organizationName}". Current balance: ${subscription?.creditsBalance || 0}`,
      confirmText: 'Apply Credit',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      applyCredit.mutate({
        organizationId,
        amount,
        reason: creditReason,
      })
    }
  }

  if (!subscription) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No subscription found
        </CardContent>
      </Card>
    )
  }

  const isCanceled = subscription.status === 'canceled' || !!subscription.canceledAt
  const isActive = subscription.status === 'active' || subscription.status === 'ACTIVE'

  return (
    <>
      <ConfirmDialog />
      <Card>
        <CardHeader>
          <CardTitle>Subscription Management</CardTitle>
          <CardDescription>
            Cancel, reactivate, or manually override subscription status
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Status */}
          <div className="p-4 rounded-lg border bg-muted/50">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">
                  Subscription Status
                </div>
                <Badge
                  variant={isActive ? 'default' : isCanceled ? 'destructive' : 'outline'}
                  className="uppercase">
                  {subscription.status}
                </Badge>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Current Plan</div>
                <div className="font-medium">{subscription.plan}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">
                  Period End Date
                </div>
                <div className="font-medium">
                  {subscription.periodEnd ? format(subscription.periodEnd, 'PPP') : '-'}
                </div>
              </div>
            </div>
            {subscription.cancelAtPeriodEnd && (
              <div className="mt-4 pt-4 border-t flex items-center gap-2 text-amber-600">
                <AlertCircle className="size-4" />
                <span className="text-sm font-medium">Subscription will cancel at period end</span>
              </div>
            )}
          </div>

          {/* Cancel or Reactivate */}
          {!isCanceled ? (
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium mb-1">Cancel Subscription Immediately</h4>
                <p className="text-sm text-muted-foreground">
                  Terminate subscription right now, not at period end
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="cancel-reason">Reason (Optional)</Label>
                  <Textarea
                    id="cancel-reason"
                    placeholder="Why are you canceling this subscription?"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    rows={2}
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={handleCancelImmediate}
                  loading={cancelImmediate.isPending}>
                  <Ban />
                  Cancel Immediately
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium mb-1">Reactivate Subscription</h4>
                <p className="text-sm text-muted-foreground">Restore a canceled subscription</p>
              </div>
              <Button onClick={handleReactivate} loading={reactivate.isPending}>
                <RefreshCw />
                Reactivate Subscription
              </Button>
            </div>
          )}

          <div className="border-t" />

          {/* Force Status Change */}
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium mb-1">Force Status Change</h4>
              <p className="text-sm text-muted-foreground">
                Manually override subscription status (use with caution)
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="new-status">New Status</Label>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select new status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                    <SelectItem value="canceled">Canceled</SelectItem>
                    <SelectItem value="past_due">Past Due</SelectItem>
                    <SelectItem value="incomplete">Incomplete</SelectItem>
                    <SelectItem value="trialing">Trialing</SelectItem>
                    <SelectItem value="TRIALING">TRIALING</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="status-reason">
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="status-reason"
                  placeholder="Why are you changing the status? (minimum 10 characters)"
                  value={statusChangeReason}
                  onChange={(e) => setStatusChangeReason(e.target.value)}
                  rows={2}
                />
              </div>
              <Button
                variant="outline"
                onClick={handleForceStatus}
                loading={forceStatus.isPending}
                disabled={!newStatus || !statusChangeReason || statusChangeReason.length < 10}>
                <AlertCircle />
                Force Status Change
              </Button>
            </div>
          </div>

          <div className="border-t" />

          {/* Credit Adjustment */}
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium mb-1">Apply Credit Adjustment</h4>
              <p className="text-sm text-muted-foreground">
                Add or deduct credits (current balance: {subscription.creditsBalance})
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="credit-amount">Credit Amount</Label>
                <input
                  id="credit-amount"
                  type="number"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                  placeholder="Enter amount (positive to add, negative to deduct)"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="credit-reason">
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="credit-reason"
                  placeholder="Why are you adjusting credits? (minimum 10 characters)"
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  rows={2}
                />
              </div>
              <Button
                variant="outline"
                onClick={handleApplyCredit}
                loading={applyCredit.isPending}
                disabled={!creditAmount || !creditReason || creditReason.length < 10}>
                <DollarSign />
                Apply Credit
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
