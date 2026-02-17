// apps/web/src/app/admin/organizations/[id]/_components/organization-access-section.tsx
'use client'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@auxx/ui/components/accordion'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { AlertTriangle, Ban, CheckCircle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface OrganizationAccessSectionProps {
  organizationId: string
  organizationName: string | null
  disabledAt: Date | null
  disabledReason: string | null
  subscription: {
    deletionScheduledDate: Date | null
    deletionReason: string | null
  } | null
}

/**
 * Organization access management section for admin billing actions
 */
export function OrganizationAccessSection({
  organizationId,
  organizationName,
  disabledAt,
  disabledReason,
  subscription,
}: OrganizationAccessSectionProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [reason, setReason] = useState('')
  const utils = api.useUtils()

  const disableOrg = api.admin.billing.disableOrganization.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
      setReason('')
    },
    onError: (error) =>
      toastError({ title: 'Failed to disable organization', description: error.message }),
  })

  const enableOrg = api.admin.billing.enableOrganization.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
    },
    onError: (error) =>
      toastError({ title: 'Failed to enable organization', description: error.message }),
  })

  const cancelDeletion = api.admin.billing.cancelScheduledDeletion.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
    },
    onError: (error) =>
      toastError({ title: 'Failed to cancel deletion', description: error.message }),
  })

  /**
   * Handle disable organization
   */
  const handleDisable = async () => {
    if (!reason || reason.length < 10) {
      toastError({
        title: 'Reason required',
        description:
          'Please provide a reason (at least 10 characters) for disabling this organization',
      })
      return
    }

    const confirmed = await confirm({
      title: 'Disable Organization?',
      description: `This will immediately suspend access for "${organizationName}". Members will not be able to use the platform until it is re-enabled.`,
      confirmText: 'Disable',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      disableOrg.mutate({ organizationId, reason })
    }
  }

  /**
   * Handle enable organization
   */
  const handleEnable = async () => {
    const confirmed = await confirm({
      title: 'Enable Organization?',
      description: `This will restore access for "${organizationName}". Members will be able to use the platform again.`,
      confirmText: 'Enable',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      enableOrg.mutate({ organizationId })
    }
  }

  /**
   * Handle cancel scheduled deletion
   */
  const handleCancelDeletion = async () => {
    const confirmed = await confirm({
      title: 'Cancel Scheduled Deletion?',
      description: `This will cancel the scheduled deletion for "${organizationName}". The organization will not be automatically deleted.`,
      confirmText: 'Cancel Deletion',
      cancelText: 'Go Back',
    })

    if (confirmed) {
      cancelDeletion.mutate({ organizationId })
    }
  }

  const isDisabled = !!disabledAt
  const hasDeletionScheduled = !!subscription?.deletionScheduledDate

  return (
    <>
      <ConfirmDialog />
      <Card>
        <CardHeader>
          <CardTitle>Organization Access</CardTitle>
          <CardDescription>
            Suspend or restore organization access, manage scheduled deletions
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {/* Current Status */}
          <div className='p-4 rounded-lg border bg-muted/50'>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <div className='text-sm font-medium text-muted-foreground mb-1'>Access Status</div>
                <div className='flex items-center gap-2'>
                  {isDisabled ? (
                    <>
                      <Ban className='size-4 text-red-500' />
                      <Badge variant='destructive'>Disabled</Badge>
                    </>
                  ) : (
                    <>
                      <CheckCircle className='size-4 text-green-500' />
                      <Badge variant='outline'>Active</Badge>
                    </>
                  )}
                </div>
              </div>
              {isDisabled && (
                <div>
                  <div className='text-sm font-medium text-muted-foreground mb-1'>Disabled At</div>
                  <div className='font-medium'>{format(disabledAt, 'PPP p')}</div>
                </div>
              )}
            </div>
            {isDisabled && disabledReason && (
              <div className='mt-4 pt-4 border-t'>
                <div className='text-sm font-medium text-muted-foreground mb-1'>Reason</div>
                <div className='text-sm'>{disabledReason}</div>
              </div>
            )}
          </div>

          {/* Deletion Warning */}
          {hasDeletionScheduled && (
            <div className='p-4 rounded-lg border border-destructive bg-destructive/5'>
              <div className='flex items-start gap-3'>
                <AlertTriangle className='size-5 text-destructive mt-0.5' />
                <div className='flex-1 space-y-2'>
                  <div>
                    <div className='font-medium text-destructive'>Deletion Scheduled</div>
                    <div className='text-sm text-muted-foreground'>
                      This organization is scheduled for deletion on{' '}
                      {format(subscription.deletionScheduledDate!, 'PPP p')}
                    </div>
                  </div>
                  {subscription.deletionReason && (
                    <div className='text-sm'>
                      <span className='font-medium'>Reason:</span> {subscription.deletionReason}
                    </div>
                  )}
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleCancelDeletion}
                    loading={cancelDeletion.isPending}>
                    <Trash2 />
                    Cancel Scheduled Deletion
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <Accordion type='single' collapsible className='rounded-lg border'>
            {!isDisabled ? (
              <AccordionItem value='disable' className='border-b px-4 last:border-b-0'>
                <AccordionTrigger>Disable Organization</AccordionTrigger>
                <AccordionContent className='space-y-3'>
                  <p className='text-sm text-muted-foreground'>
                    Suspend access for policy violations or payment issues
                  </p>
                  <div>
                    <Label htmlFor='disable-reason'>
                      Reason <span className='text-destructive'>*</span>
                    </Label>
                    <Textarea
                      id='disable-reason'
                      placeholder='Why are you disabling this organization? (minimum 10 characters)'
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                    />
                    <p className='text-xs text-muted-foreground mt-1'>
                      This reason will be logged and visible to admins
                    </p>
                  </div>
                  <Button
                    variant='destructive'
                    size='sm'
                    onClick={handleDisable}
                    loading={disableOrg.isPending}
                    disabled={!reason || reason.length < 10}>
                    <Ban />
                    Disable Organization
                  </Button>
                </AccordionContent>
              </AccordionItem>
            ) : (
              <AccordionItem value='enable' className='border-b px-4 last:border-b-0'>
                <AccordionTrigger>Enable Organization</AccordionTrigger>
                <AccordionContent className='space-y-3'>
                  <p className='text-sm text-muted-foreground'>
                    Restore access after suspension has been resolved
                  </p>
                  <Button size='sm' onClick={handleEnable} loading={enableOrg.isPending}>
                    <CheckCircle />
                    Enable Organization
                  </Button>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </CardContent>
      </Card>
    </>
  )
}
