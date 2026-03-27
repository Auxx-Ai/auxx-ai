// apps/web/src/components/workflow/dialogs/human-confirmation-dialog.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { format, formatDistanceToNow } from 'date-fns'
import { AlertTriangle, CheckCircle, Clock, MessageSquare, Trash2, XCircle } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface HumanConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedApprovalId?: string
}

/**
 * Dialog for managing human confirmation approval requests
 */
export const HumanConfirmationDialog: React.FC<HumanConfirmationDialogProps> = ({
  open,
  onOpenChange,
  selectedApprovalId,
}) => {
  const [selectedId, setSelectedId] = useState<string | undefined>(selectedApprovalId)
  const [comment, setComment] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()

  // Auto-select the approval ID when dialog opens
  useEffect(() => {
    if (selectedApprovalId && open) {
      setSelectedId(selectedApprovalId)
    }
  }, [selectedApprovalId, open])

  // Fetch pending requests
  const {
    data: approvalRequests,
    isLoading: requestsLoading,
    refetch: refetchRequests,
  } = api.approval.getPendingRequests.useQuery(undefined, {
    enabled: open,
    refetchOnWindowFocus: false,
  })

  // Fetch selected request details
  const {
    data: selectedRequest,
    isLoading: detailsLoading,
    error: detailsError,
  } = api.approval.getApprovalDetails.useQuery(
    { id: selectedId! },
    {
      enabled: !!selectedId && open,
      refetchOnWindowFocus: false,
      retry: false, // Don't retry on authorization errors
    }
  )

  const utils = api.useUtils()

  const invalidateNotifications = () => {
    utils.notification.getNotifications.invalidate()
    utils.notification.getUnreadCount.invalidate()
  }

  // Mutations
  const approveMutation = api.approval.approve.useMutation({
    onSuccess: (result) => {
      toastSuccess({
        title: 'Approved',
        description: result.message || 'Workflow approved successfully',
      })
      refetchRequests()
      invalidateNotifications()
      setComment('')
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Error approving', description: error.message })
    },
  })

  const denyMutation = api.approval.deny.useMutation({
    onSuccess: (result) => {
      toastSuccess({
        title: 'Denied',
        description: result.message || 'Workflow denied successfully',
      })
      refetchRequests()
      invalidateNotifications()
      setComment('')
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Error denying', description: error.message })
    },
  })

  const cleanupMutation = api.approval.cleanupOrphaned.useMutation({
    onSuccess: (result) => {
      toastSuccess({ title: 'Cleanup Complete', description: result.message })
      refetchRequests()
      invalidateNotifications()
    },
    onError: (error) => {
      toastError({ title: 'Error cleaning up', description: error.message })
    },
  })

  const handleApprove = async () => {
    if (!selectedId) return

    const confirmed = await confirm({
      title: 'Approve Request?',
      description: 'This will approve the manual confirmation and continue the workflow.',
      confirmText: 'Approve',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      approveMutation.mutate({ id: selectedId, comment: comment || undefined })
    }
  }

  const handleDeny = async () => {
    if (!selectedId) return

    const confirmed = await confirm({
      title: 'Deny Request?',
      description: 'This will deny the manual confirmation and stop the workflow.',
      confirmText: 'Deny',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      denyMutation.mutate({ id: selectedId, comment: comment || undefined })
    }
  }

  const handleCleanup = async () => {
    const confirmed = await confirm({
      title: 'Clean Up Orphaned Requests?',
      description:
        'This will remove approval requests for workflows that have stopped, failed, or completed.',
      confirmText: 'Clean Up',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      cleanupMutation.mutate()
    }
  }

  const isPending = approveMutation.isPending || denyMutation.isPending || cleanupMutation.isPending

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size='xxl'>
          <DialogHeader>
            <div className='flex items-center justify-between'>
              <div>
                <DialogTitle>Manual Confirmation Requests</DialogTitle>
                <DialogDescription>
                  Review and respond to pending manual confirmation requests
                </DialogDescription>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={handleCleanup}
                disabled={cleanupMutation.isPending}
                loading={cleanupMutation.isPending}
                loadingText='Cleaning...'>
                <Trash2 />
                Clean Up Stopped
              </Button>
            </div>
          </DialogHeader>

          <div className='flex h-full gap-2 items-start'>
            {/* Left Panel: Requests List */}
            <div className='w-1/3 border-r pr-4'>
              <div className='mb-4'>
                <h3 className='font-medium text-sm text-muted-foreground'>
                  Pending Requests ({approvalRequests?.length || 0})
                </h3>
              </div>

              <ScrollArea className='h-[calc(100%-2rem)]'>
                {requestsLoading ? (
                  <div className='space-y-3'>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className='p-3 border rounded-lg'>
                        <Skeleton className='h-4 w-full mb-2' />
                        <Skeleton className='h-3 w-2/3 mb-1' />
                        <Skeleton className='h-3 w-1/2' />
                      </div>
                    ))}
                  </div>
                ) : approvalRequests?.length === 0 ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant='icon'>
                        <CheckCircle />
                      </EmptyMedia>
                      <EmptyTitle>No pending requests</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className='space-y-2'>
                    {approvalRequests?.map((request) => (
                      <div
                        key={request.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors hover:bg-gray-50 ${
                          selectedId === request.id ? 'bg-blue-50 border-blue-200' : ''
                        }`}
                        onClick={() => setSelectedId(request.id)}>
                        <div className='space-y-2'>
                          <div className='flex items-start justify-between'>
                            <h4 className='font-medium text-sm truncate'>
                              {request.workflowName || 'Untitled Workflow'}
                            </h4>
                            <Badge variant='secondary' className='text-xs'>
                              {request.status}
                            </Badge>
                          </div>

                          {request.message && (
                            <p className='text-xs text-muted-foreground line-clamp-2'>
                              {request.message}
                            </p>
                          )}

                          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                            <Clock className='h-3 w-3' />
                            <span>
                              Expires{' '}
                              {request.expiresAt
                                ? formatDistanceToNow(new Date(request.expiresAt), {
                                    addSuffix: true,
                                  })
                                : 'No expiration'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Right Panel: Request Details */}
            <div className='flex-1 flex flex-col'>
              {!selectedId ? (
                <div className='flex flex-col items-center justify-center flex-1'>
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant='icon'>
                        <MessageSquare />
                      </EmptyMedia>
                      <EmptyTitle>Select a request</EmptyTitle>
                      <EmptyDescription>Select a request to view details</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </div>
              ) : detailsLoading ? (
                <div className='space-y-4'>
                  <Skeleton className='h-6 w-1/2' />
                  <Skeleton className='h-20 w-full' />
                  <Skeleton className='h-4 w-1/3' />
                  <Skeleton className='h-32 w-full' />
                </div>
              ) : selectedRequest ? (
                <div className='flex-1 flex flex-col space-y-3'>
                  {/* Request Header */}
                  <div className='space-y-3'>
                    <div className='flex items-start justify-between'>
                      <div>
                        <h3 className='text-lg font-semibold'>
                          {selectedRequest.workflowName || 'Untitled Workflow'}
                        </h3>
                        <p className='text-sm text-muted-foreground'>
                          Node: {selectedRequest.nodeName}
                        </p>
                      </div>
                      <Badge
                        variant={selectedRequest.status === 'pending' ? 'default' : 'secondary'}
                        className='capitalize'>
                        {selectedRequest.status}
                      </Badge>
                    </div>

                    {selectedRequest.message && (
                      <div className='p-2 bg-gray-50 rounded-lg'>
                        <h4 className='font-medium text-sm mb-1'>Message</h4>
                        <p className='text-sm'>{selectedRequest.message}</p>
                      </div>
                    )}
                  </div>

                  {/* Request Metadata */}
                  <div className=' space-y-3'>
                    <div className='grid grid-cols-2 gap-4 text-sm'>
                      <div>
                        <span className='text-muted-foreground'>Created:</span>
                        <p className='font-medium'>
                          {selectedRequest.createdAt
                            ? format(new Date(selectedRequest.createdAt), 'MMM d, yyyy h:mm a')
                            : 'Unknown'}
                        </p>
                      </div>
                      <div>
                        <span className='text-muted-foreground'>Expires:</span>
                        <p className='font-medium'>
                          {selectedRequest.expiresAt
                            ? format(new Date(selectedRequest.expiresAt), 'MMM d, yyyy h:mm a')
                            : 'No expiration'}
                        </p>
                      </div>
                    </div>

                    {selectedRequest.expiresAt &&
                      new Date(selectedRequest.expiresAt) < new Date() && (
                        <div className='flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg'>
                          <AlertTriangle className='h-4 w-4 text-red-500' />
                          <span className='text-sm text-red-700'>This request has expired</span>
                        </div>
                      )}
                  </div>

                  <Separator className='' />

                  {/* Comment Section */}
                  <div className=''>
                    <label className='block text-sm font-medium mb-1'>Comment (optional)</label>
                    <Textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder='Add a comment about your decision...'
                      rows={3}
                      disabled={isPending}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className='flex justify-end gap-3 mt-auto'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => onOpenChange(false)}
                      disabled={isPending}>
                      Cancel
                    </Button>
                    <Button
                      variant='destructive'
                      size='sm'
                      onClick={handleDeny}
                      disabled={
                        isPending ||
                        (selectedRequest.expiresAt
                          ? new Date(selectedRequest.expiresAt) < new Date()
                          : false)
                      }
                      loading={denyMutation.isPending}
                      loadingText='Denying...'>
                      <XCircle />
                      Deny
                    </Button>
                    <Button
                      onClick={handleApprove}
                      size='sm'
                      disabled={
                        isPending ||
                        (selectedRequest.expiresAt
                          ? new Date(selectedRequest.expiresAt) < new Date()
                          : false)
                      }
                      loading={approveMutation.isPending}
                      loadingText='Approving...'>
                      <CheckCircle />
                      Approve
                    </Button>
                  </div>
                </div>
              ) : (
                <div className='flex flex-col items-center justify-center flex-1'>
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant='icon'>
                        <AlertTriangle />
                      </EmptyMedia>
                      <EmptyTitle>Request not found</EmptyTitle>
                      <EmptyDescription>Request not found or access denied</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </>
  )
}
