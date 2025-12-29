// apps/web/src/app/(protected)/app/workflows/[workflowId]/approval/[approvalId]/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Button } from '@auxx/ui/components/button'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { formatDistanceToNow } from 'date-fns'
import { sanitizeHtml } from '~/lib/sanitize'

interface ApprovalPageProps {
  params: {
    workflowId: string
    approvalId: string
  }
}

/**
 * Page for handling manual confirmation approval requests
 */
export default function ApprovalPage({ params }: ApprovalPageProps) {
  const router = useRouter()

  // Fetch approval request data
  const {
    data: approval,
    isLoading,
    error,
  } = api.workflow.getApprovalRequest.useQuery({
    approvalId: params.approvalId,
  })

  // Approve mutation
  const approveMutation = api.workflow.approveRequest.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Request approved',
        description: 'The workflow will now continue with the approved path.',
      })
      router.push('/app/workflows')
    },
    onError: (error) => {
      toastError({
        title: 'Failed to approve',
        description: error.message,
      })
    },
  })

  // Deny mutation
  const denyMutation = api.workflow.denyRequest.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Request denied',
        description: 'The workflow will now continue with the denied path.',
      })
      router.push('/app/workflows')
    },
    onError: (error) => {
      toastError({
        title: 'Failed to deny',
        description: error.message,
      })
    },
  })

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  // Error state
  if (error || !approval) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Alert variant="destructive">
          <AlertDescription>{error?.message || 'Approval request not found'}</AlertDescription>
        </Alert>
      </div>
    )
  }

  // Check status
  const hasResponded = approval.status !== 'pending'
  const isExpired = approval.expiresAt ? new Date(approval.expiresAt) < new Date() : false

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Approval Required</CardTitle>
              <CardDescription>
                {approval.workflowName} - {approval.nodeName}
              </CardDescription>
            </div>
            {approval.status === 'approved' && <CheckCircle className="h-6 w-6 text-green-500" />}
            {approval.status === 'denied' && <XCircle className="h-6 w-6 text-red-500" />}
            {approval.status === 'timeout' && <Clock className="h-6 w-6 text-orange-500" />}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Status message */}
          {hasResponded && (
            <Alert>
              <AlertDescription>
                This request has already been {approval.status}.
                {approval.responses?.[0] && (
                  <span className="block mt-1">
                    By {approval.responses[0].user.name}{' '}
                    {formatDistanceToNow(new Date(approval.responses[0].respondedAt))} ago
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {isExpired && !hasResponded && (
            <Alert variant="destructive">
              <AlertDescription>This approval request has expired.</AlertDescription>
            </Alert>
          )}

          {/* Custom message */}
          {approval.message && (
            <div className="p-4 bg-muted rounded-lg">
              <h3 className="font-medium mb-2">Message</h3>
              <div
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(approval.message) }}
                className="prose prose-sm max-w-none"
              />
            </div>
          )}

          {/* Workflow context */}
          {approval.includeWorkflowContext && approval.workflowContext && (
            <div>
              <h3 className="font-medium mb-2">Workflow Context</h3>
              <pre className="p-3 bg-muted rounded text-sm overflow-auto max-h-64">
                {JSON.stringify(approval.workflowContext, null, 2)}
              </pre>
            </div>
          )}

          {/* Expiration info */}
          {!hasResponded && !isExpired && approval.expiresAt && (
            <div className="text-sm text-muted-foreground">
              Expires {formatDistanceToNow(new Date(approval.expiresAt), { addSuffix: true })}
            </div>
          )}
          {!hasResponded && !approval.expiresAt && (
            <div className="text-sm text-muted-foreground">
              No expiration - this request will remain active until responded to
            </div>
          )}

          {/* Action buttons */}
          {!hasResponded && !isExpired && (
            <div className="flex gap-3">
              <Button
                onClick={() =>
                  approveMutation.mutate({
                    approvalId: params.approvalId,
                    message: '', // Optional message support could be added
                  })
                }
                loading={approveMutation.isPending}
                variant="default"
                className="flex-1">
                Approve
              </Button>
              <Button
                onClick={() =>
                  denyMutation.mutate({
                    approvalId: params.approvalId,
                    message: '', // Optional message support could be added
                  })
                }
                loading={denyMutation.isPending}
                variant="outline"
                className="flex-1">
                Deny
              </Button>
            </div>
          )}

          {/* Back button */}
          <Button onClick={() => router.push('/app/workflows')} variant="ghost" className="w-full">
            Back to Workflows
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
