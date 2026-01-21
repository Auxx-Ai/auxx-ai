'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
// import { useSession } from 'next-auth/react' // Or your auth hook
import { api } from '~/trpc/react'
import { Button } from '@auxx/ui/components/button'
import { Loader2 } from 'lucide-react'
import { toastError } from '@auxx/ui/components/toast'
import { useSession } from '~/auth/auth-client'

export default function AcceptInvitationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { data: session } = useSession() // Use your auth hook

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processed, setProcessed] = useState(false) // Prevent multiple calls

  const acceptMutation = api.member.acceptInvitation.useMutation({
    onSuccess: (data) => {
      // Success! Redirect to the app dashboard or specific org page
      // Assumes session context/default org updates automatically or is refreshed
      router.push('/app') // Adjust redirect as needed
      // Maybe show a success toast *before* redirecting if preferred
    },
    onError: (err) => {
      setError(err.message || 'Failed to accept invitation.')
      toastError({ title: 'Invitation Error', description: err.message })
      setIsLoading(false)
    },
  })

  useEffect(() => {
    if (processed) return // Don't process again

    // if (sessionStatus === 'loading') {
    //   // Still waiting for session info
    //   setIsLoading(true)
    //   return
    // }

    if (!token) {
      setError('Invalid invitation link: No token provided.')
      setIsLoading(false)
      setProcessed(true)
      return
    }

    // if (sessionStatus === 'unauthenticated') {
    //   // User not logged in, redirect to login, preserving the token
    //   const loginUrl = `/login?callbackUrl=${encodeURIComponent(
    //     `/accept-invitation?token=${token}`
    //   )}`
    //   router.push(loginUrl)
    //   // No need to set loading false here, redirect happens
    //   return // Stop further processing
    // }

    // if (sessionStatus === 'authenticated') {
    //   // User is logged in, token exists, session loaded, not yet processed
    //   setIsLoading(true)
    //   setError(null)
    //   setProcessed(true) // Mark as processed to prevent re-trigger
    //   acceptMutation.mutate({ token })
    // }
  }, [token, router, processed, acceptMutation]) // Add dependencies

  // Render different states
  if (isLoading && !error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Processing invitation...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
        <h1 className="text-2xl font-semibold text-destructive">Invitation Error</h1>
        <p className="text-red-600">{error}</p>
        <Button onClick={() => router.push('/app')}>Go to Dashboard</Button>
      </div>
    )
  }

  // Could also show a success message before redirect triggers in onSuccess
  // Or handle redirect entirely client side after success state update

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-muted-foreground">Checking session...</p>
      {/* Fallback / initial loading state */}
    </div>
  )
}
