// apps/web/src/app/(public)/accept-invitation/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Loader2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useSession } from '~/auth/auth-client'
import { api } from '~/trpc/react'

export default function AcceptInvitationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { data: session, isPending: isSessionLoading } = useSession()

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processed, setProcessed] = useState(false) // Prevent multiple calls

  const acceptMutation = api.member.acceptInvitation.useMutation({
    onSuccess: () => {
      // Success! Redirect to the app dashboard
      router.push('/app')
    },
    onError: (err) => {
      setError(err.message || 'Failed to accept invitation.')
      toastError({ title: 'Invitation Error', description: err.message })
      setIsLoading(false)
    },
  })

  useEffect(() => {
    // Prevent duplicate calls (React StrictMode can double-invoke effects)
    if (processed || acceptMutation.isPending) return

    // Still waiting for session info
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

    // User not logged in, redirect to login, preserving the token
    if (!session) {
      const loginUrl = `/login?callbackUrl=${encodeURIComponent(
        `/accept-invitation?token=${token}`
      )}`
      router.push(loginUrl)
      return // Stop further processing
    }

    // User is logged in, token exists, session loaded, not yet processed
    setIsLoading(true)
    setError(null)
    setProcessed(true) // Mark as processed to prevent re-trigger
    acceptMutation.mutate({ token })
  }, [token, router, processed, acceptMutation, session, isSessionLoading])

  // Render different states
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
        <Button onClick={() => router.push('/app')}>Go to Dashboard</Button>
      </div>
    )
  }

  // Could also show a success message before redirect triggers in onSuccess
  // Or handle redirect entirely client side after success state update

  return (
    <div className='flex min-h-screen flex-col items-center justify-center gap-4'>
      <Loader2 className='h-8 w-8 animate-spin text-primary' />
      <p className='text-muted-foreground'>Checking session...</p>
      {/* Fallback / initial loading state */}
    </div>
  )
}
