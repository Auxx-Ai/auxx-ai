// apps/web/src/app/admin/organizations/[id]/_components/trial-management-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { addDays, format } from 'date-fns'
import { Calendar, CheckCircle, Clock } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface TrialManagementSectionProps {
  organizationId: string
  organizationName: string | null
  subscription: {
    trialEnd: Date | null
    hasTrialEnded: boolean
    status: string
    trialConversionStatus: string | null
  } | null
}

/**
 * Trial management section for admin billing actions
 */
export function TrialManagementSection({
  organizationId,
  organizationName,
  subscription,
}: TrialManagementSectionProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [extendDays, setExtendDays] = useState('7')
  const [reason, setReason] = useState('')
  const utils = api.useUtils()

  const endTrial = api.admin.billing.endTrial.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
      setReason('')
    },
    onError: (error) => toastError({ title: 'Failed to end trial', description: error.message }),
  })

  const extendTrial = api.admin.billing.extendTrial.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
      setExtendDays('7')
      setReason('')
    },
    onError: (error) => toastError({ title: 'Failed to extend trial', description: error.message }),
  })

  const convertTrial = api.admin.billing.convertTrialToPaid.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
    },
    onError: (error) =>
      toastError({ title: 'Failed to convert trial', description: error.message }),
  })

  /**
   * Handle end trial immediately
   */
  const handleEndTrial = async () => {
    const confirmed = await confirm({
      title: 'End Trial Immediately?',
      description: `This will immediately end the trial for "${organizationName}". They will need to upgrade to continue using the service.`,
      confirmText: 'End Trial',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      endTrial.mutate({ organizationId, reason: reason || undefined })
    }
  }

  /**
   * Handle extend trial
   */
  const handleExtendTrial = async () => {
    const days = parseInt(extendDays, 10) || 7
    const newEndDate = addDays(new Date(), days)

    const confirmed = await confirm({
      title: 'Extend Trial Period?',
      description: `This will extend the trial for "${organizationName}" to ${format(newEndDate, 'PPP')}.`,
      confirmText: 'Extend Trial',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      extendTrial.mutate({
        organizationId,
        newEndDate,
        reason: reason || undefined,
      })
    }
  }

  /**
   * Handle convert trial to paid
   */
  const handleConvertToPaid = async () => {
    const confirmed = await confirm({
      title: 'Convert Trial to Paid?',
      description: `This will convert "${organizationName}" from trial to paid status without requiring payment. Use this for special cases or manual conversions.`,
      confirmText: 'Convert to Paid',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      convertTrial.mutate({
        organizationId,
        skipPayment: true,
      })
    }
  }

  const isOnTrial = subscription?.status === 'trialing' && !subscription?.hasTrialEnded
  const hasTrialEnded = subscription?.hasTrialEnded

  return (
    <>
      <ConfirmDialog />
      <Card>
        <CardHeader>
          <CardTitle>Trial Management</CardTitle>
          <CardDescription>Manage trial period and conversion status</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {/* Current Trial Status */}
          <div className='p-4 rounded-lg border bg-muted/50'>
            <div className='grid grid-cols-3 gap-4'>
              <div>
                <div className='text-sm font-medium text-muted-foreground mb-1'>Trial Status</div>
                <div className='flex items-center gap-2'>
                  {isOnTrial ? (
                    <>
                      <Clock className='size-4 text-blue-500' />
                      <span className='font-medium text-blue-500'>Active</span>
                    </>
                  ) : hasTrialEnded ? (
                    <>
                      <CheckCircle className='size-4 text-green-500' />
                      <span className='font-medium text-green-500'>Ended</span>
                    </>
                  ) : (
                    <span className='font-medium text-muted-foreground'>N/A</span>
                  )}
                </div>
              </div>
              <div>
                <div className='text-sm font-medium text-muted-foreground mb-1'>Trial End Date</div>
                <div className='font-medium'>
                  {subscription?.trialEnd ? format(subscription.trialEnd, 'PPP') : '-'}
                </div>
              </div>
              <div>
                <div className='text-sm font-medium text-muted-foreground mb-1'>
                  Conversion Status
                </div>
                <div className='font-medium'>{subscription?.trialConversionStatus || '-'}</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          {isOnTrial && (
            <>
              {/* End Trial Immediately */}
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium mb-1'>End Trial Immediately</h4>
                  <p className='text-sm text-muted-foreground'>
                    Force trial to end now, requiring organization to upgrade
                  </p>
                </div>
                <div className='space-y-3'>
                  <div>
                    <Label htmlFor='end-reason'>Reason (Optional)</Label>
                    <Textarea
                      id='end-reason'
                      placeholder='Why are you ending this trial early?'
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <Button
                    variant='destructive'
                    onClick={handleEndTrial}
                    loading={endTrial.isPending}>
                    End Trial Now
                  </Button>
                </div>
              </div>

              <div className='border-t' />

              {/* Extend Trial */}
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium mb-1'>Extend Trial Period</h4>
                  <p className='text-sm text-muted-foreground'>
                    Give customer more time to evaluate the product
                  </p>
                </div>
                <div className='space-y-3'>
                  <div>
                    <Label htmlFor='extend-days'>Extend by (days)</Label>
                    <Input
                      id='extend-days'
                      type='number'
                      min='1'
                      max='365'
                      value={extendDays}
                      onChange={(e) => setExtendDays(e.target.value)}
                      placeholder='7'
                    />
                    <p className='text-xs text-muted-foreground mt-1'>
                      New end date:{' '}
                      {format(addDays(new Date(), parseInt(extendDays, 10) || 7), 'PPP')}
                    </p>
                  </div>
                  <div>
                    <Label htmlFor='extend-reason'>Reason (Optional)</Label>
                    <Textarea
                      id='extend-reason'
                      placeholder='Why are you extending this trial?'
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <Button onClick={handleExtendTrial} loading={extendTrial.isPending}>
                    <Calendar />
                    Extend Trial
                  </Button>
                </div>
              </div>

              <div className='border-t' />

              {/* Convert to Paid */}
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium mb-1'>Convert Trial to Paid</h4>
                  <p className='text-sm text-muted-foreground'>
                    Manually convert trial to paid without payment (admin override)
                  </p>
                </div>
                <Button
                  variant='outline'
                  onClick={handleConvertToPaid}
                  loading={convertTrial.isPending}>
                  <CheckCircle />
                  Convert to Paid
                </Button>
              </div>
            </>
          )}

          {!isOnTrial && (
            <div className='text-center py-8 text-muted-foreground'>
              Organization is not currently on trial
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
