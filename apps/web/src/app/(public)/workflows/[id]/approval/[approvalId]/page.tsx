// apps/web/src/app/(public)/workflows/[id]/approval/[approvalId]/page.tsx
'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import Loader from '@auxx/ui/components/loader'
import { toastError } from '@auxx/ui/components/toast'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle, Clock, LogIn, XCircle } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { use, useState } from 'react'
import { useSession } from '~/auth/auth-client'
import { ColorfulBg } from '~/components/global/login/colorful-bg'
import { Logo } from '~/components/global/login/logo'
import { sanitizeHtml } from '~/lib/sanitize'
import { api } from '~/trpc/react'

interface ApprovalPageProps {
  params: Promise<{ id: string; approvalId: string }>
}

export default function PublicApprovalPage({ params }: ApprovalPageProps) {
  const { approvalId } = use(params)
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const token = searchParams.get('token')
  const action = searchParams.get('action') as 'approve' | 'deny' | null
  const { data: session, isPending: isSessionLoading } = useSession()

  // Token-based flow (no session check needed)
  if (token) {
    return (
      <ColorfulBg>
        <ApprovalPageContent approvalId={approvalId} token={token} preselectedAction={action} />
      </ColorfulBg>
    )
  }

  // Loading session — must check before session/sign-in to avoid flash
  if (isSessionLoading) {
    return (
      <ColorfulBg>
        <PageShell>
          <Loader
            variant='translucent'
            size='lg'
            title='Loading...'
            subtitle='Fetching approval details'
          />
        </PageShell>
      </ColorfulBg>
    )
  }

  // Authenticated flow
  if (session) {
    return (
      <ColorfulBg>
        <AuthenticatedApprovalContent approvalId={approvalId} preselectedAction={action} />
      </ColorfulBg>
    )
  }

  // Not logged in, no token — show sign-in prompt
  const returnTo = encodeURIComponent(`${pathname}?${searchParams.toString()}`)
  return (
    <ColorfulBg>
      <PageShell>
        <Logo />
        <Card variant='translucent' className='w-full max-w-md border-transparent px-4 py-3'>
          <CardHeader className='items-center text-center mt-6'>
            <LogIn className='mb-2 size-8 text-muted-foreground' />
            <CardTitle>Sign in to continue</CardTitle>
            <CardDescription>
              You need to be signed in to respond to this approval request.
            </CardDescription>
          </CardHeader>
          <CardFooter className='flex justify-center mt-6'>
            <Button asChild variant='translucent'>
              <Link href={`/login?returnTo=${returnTo}`}>Sign in</Link>
            </Button>
          </CardFooter>
        </Card>
      </PageShell>
    </ColorfulBg>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10'>
      <div className='flex w-full max-w-md flex-col items-center gap-4'>{children}</div>
    </div>
  )
}

/** Token-based approval flow (no auth required) */
function ApprovalPageContent({
  approvalId,
  token,
  preselectedAction,
}: {
  approvalId: string
  token: string
  preselectedAction: 'approve' | 'deny' | null
}) {
  const [submitted, setSubmitted] = useState(false)

  const {
    data: approval,
    isLoading,
    error,
  } = api.approval.getByToken.useQuery({ approvalId, token })

  const approveByToken = api.approval.approveByToken.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => toastError({ title: 'Failed to approve', description: err.message }),
  })

  const denyByToken = api.approval.denyByToken.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => toastError({ title: 'Failed to deny', description: err.message }),
  })

  if (isLoading) {
    return (
      <PageShell>
        <Loader
          variant='translucent'
          size='lg'
          title='Loading...'
          subtitle='Fetching approval details'
        />
      </PageShell>
    )
  }

  if (error || !approval) {
    return (
      <PageShell>
        <Logo />
        <Card variant='translucent' className='w-full max-w-md border-transparent px-4 py-3'>
          <CardHeader className='items-center text-center'>
            <XCircle className='mb-2 size-8 text-destructive' />
            <CardTitle>Invalid Link</CardTitle>
            <CardDescription>
              {error?.message || 'This approval link is invalid or has expired.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <Logo />
      <ApprovalCard
        approval={approval}
        isPending={approveByToken.isPending || denyByToken.isPending}
        submitted={submitted}
        preselectedAction={preselectedAction}
        onApprove={() => approveByToken.mutate({ approvalId, token })}
        onDeny={() => denyByToken.mutate({ approvalId, token })}
      />
    </PageShell>
  )
}

/** Authenticated approval flow (session required) */
function AuthenticatedApprovalContent({
  approvalId,
  preselectedAction,
}: {
  approvalId: string
  preselectedAction: 'approve' | 'deny' | null
}) {
  const [submitted, setSubmitted] = useState(false)

  const {
    data: approval,
    isLoading,
    error,
  } = api.approval.getApprovalDetails.useQuery({ id: approvalId })

  const approve = api.approval.approve.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => toastError({ title: 'Failed to approve', description: err.message }),
  })

  const deny = api.approval.deny.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => toastError({ title: 'Failed to deny', description: err.message }),
  })

  if (isLoading) {
    return (
      <PageShell>
        <Loader
          variant='translucent'
          size='lg'
          title='Loading...'
          subtitle='Fetching approval details'
        />
      </PageShell>
    )
  }

  if (error || !approval) {
    return (
      <PageShell>
        <Logo />
        <Card variant='translucent' className='w-full max-w-md border-transparent px-4 py-3'>
          <CardHeader className='items-center text-center'>
            <XCircle className='mb-2 size-8 text-destructive' />
            <CardTitle>Not Found</CardTitle>
            <CardDescription>
              {error?.message || 'This approval request was not found or you do not have access.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <Logo />
      <ApprovalCard
        approval={approval}
        isPending={approve.isPending || deny.isPending}
        submitted={submitted}
        preselectedAction={preselectedAction}
        onApprove={() => approve.mutate({ id: approvalId })}
        onDeny={() => deny.mutate({ id: approvalId })}
      />
    </PageShell>
  )
}

/** Shared approval card UI */
function ApprovalCard({
  approval,
  isPending,
  submitted,
  preselectedAction,
  onApprove,
  onDeny,
}: {
  approval: any
  isPending: boolean
  submitted: boolean
  preselectedAction: 'approve' | 'deny' | null
  onApprove: () => void
  onDeny: () => void
}) {
  const hasResponded = approval.status !== 'pending' || submitted
  const isExpired = approval.expiresAt ? new Date(approval.expiresAt) < new Date() : false

  const statusIcon = submitted ? (
    preselectedAction === 'deny' ? (
      <XCircle className='mb-2 size-8 text-red-400' />
    ) : (
      <CheckCircle className='mb-2 size-8 text-green-400' />
    )
  ) : approval.status === 'approved' ? (
    <CheckCircle className='mb-2 size-8 text-green-400' />
  ) : approval.status === 'denied' ? (
    <XCircle className='mb-2 size-8 text-red-400' />
  ) : approval.status === 'timeout' || isExpired ? (
    <Clock className='mb-2 size-8 text-orange-400' />
  ) : null

  return (
    <Card variant='translucent' className='w-full max-w-md border-transparent px-4 py-3'>
      <CardHeader className='items-center text-center'>
        {statusIcon}
        <CardTitle>
          {submitted
            ? preselectedAction === 'deny'
              ? 'Request Denied'
              : 'Request Approved'
            : 'Approval Required'}
        </CardTitle>
        <CardDescription>
          {approval.workflowName ?? 'Workflow'} — {approval.nodeName ?? approval.nodeId}
        </CardDescription>
      </CardHeader>

      <CardContent className='space-y-4'>
        {/* Already responded */}
        {!submitted && hasResponded && (
          <Alert variant='translucent'>
            <AlertDescription>This request has already been {approval.status}.</AlertDescription>
          </Alert>
        )}

        {/* Submitted confirmation */}
        {submitted && (
          <Alert variant='translucent'>
            <AlertDescription>
              Your response has been recorded. The workflow will continue.
            </AlertDescription>
          </Alert>
        )}

        {/* Expired */}
        {isExpired && !hasResponded && (
          <Alert variant='destructive'>
            <AlertDescription>This approval request has expired.</AlertDescription>
          </Alert>
        )}

        {/* Message */}
        {approval.message && (
          <div className='rounded-lg bg-white/5 p-4'>
            <p className='mb-1 text-xs font-medium uppercase tracking-wider text-white/60'>
              Message
            </p>
            <div
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(approval.message) }}
              className='prose prose-sm prose-invert max-w-none'
            />
          </div>
        )}

        {/* Expiration info */}
        {!hasResponded && !isExpired && approval.expiresAt && (
          <p className='text-center text-sm text-white/60'>
            Expires {formatDistanceToNow(new Date(approval.expiresAt), { addSuffix: true })}
          </p>
        )}

        {/* Action buttons */}
        {!hasResponded && !isExpired && (
          <div className='flex gap-3'>
            <Button onClick={onApprove} loading={isPending} variant='default' className='flex-1'>
              Approve
            </Button>
            <Button onClick={onDeny} loading={isPending} variant='translucent' className='flex-1'>
              Deny
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
