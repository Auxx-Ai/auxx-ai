// apps/build/src/app/invitations/accept/page.tsx
'use client'

import { WEBAPP_URL } from '@auxx/config/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Loader2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { useSession } from '~/hooks/use-session'
import { api } from '~/trpc/react'

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className='flex min-h-screen flex-col items-center justify-center gap-4'>
          <Loader2 className='h-8 w-8 animate-spin text-primary' />
          <p className='text-muted-foreground'>Loading...</p>
        </div>
      }>
      <AcceptInvitationContent />
    </Suspense>
  )
}

function AcceptInvitationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { session, isLoading: isSessionLoading } = useSession()

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processed, setProcessed] = useState(false)

  const acceptInvitation = api.members.acceptInvitation.useMutation({
    onSuccess: (data) => {
      if (data.slug) {
        router.push(`/${data.slug}`)
      } else {
        router.push('/')
      }
    },
    onError: (err) => {
      setError(err.message || 'Failed to accept invitation.')
      toastError({ title: 'Invitation Error', description: err.message })
      setIsLoading(false)
    },
  })

  useEffect(() => {
    if (processed || acceptInvitation.isPending) return

    if (isSessionLoading) {
      setIsLoading(true)
      return
    }

    if (!token) {
      setError('Invalid invitation link: No token provided.')
      setIsLoading(false)
      setProcessed(true)
      return
    }

    // User not logged in — redirect to login, preserving the token
    if (!session) {
      const returnTo = `/invitations/accept?token=${token}`
      window.location.href = `${WEBAPP_URL}/login?callbackApp=build&returnTo=${encodeURIComponent(returnTo)}`
      return
    }

    // User is logged in, token exists, session loaded, not yet processed
    setIsLoading(true)
    setError(null)
    setProcessed(true)
    acceptInvitation.mutate({ token })
  }, [token, processed, acceptInvitation, session, isSessionLoading])

  if (isLoading && !error) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center gap-4'>
        <Loader2 className='h-8 w-8 animate-spin text-primary' />
        <p className='text-muted-foreground'>Processing invitation...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center'>
        <h1 className='text-2xl font-semibold text-destructive'>Invitation Error</h1>
        <p className='text-red-600'>{error}</p>
        <Button onClick={() => router.push('/')}>Go to Dashboard</Button>
      </div>
    )
  }

  return (
    <div className='flex min-h-screen flex-col items-center justify-center gap-4'>
      <Loader2 className='h-8 w-8 animate-spin text-primary' />
      <p className='text-muted-foreground'>Checking session...</p>
    </div>
  )
}
