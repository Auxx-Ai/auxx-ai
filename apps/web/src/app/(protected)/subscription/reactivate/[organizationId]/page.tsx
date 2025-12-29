// apps/web/src/app/(protected)/subscription/reactivate/[organizationId]/page.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Button } from '@auxx/ui/components/button'
import { Alert, AlertDescription, AlertIcon, AlertTitle } from '@auxx/ui/components/alert'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Clock, AlertTriangle, CheckCircle2, Building } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

/** Reactivation page for expired trial organizations */
export default function ReactivatePage() {
  const params = useParams()
  const router = useRouter()
  const organizationId = params.organizationId as string

  // Fetch organization and subscription details
  const {
    data: orgDetails,
    isLoading: orgLoading,
    error: orgError,
  } = api.billing.getReactivationDetails.useQuery({ organizationId })

  const [timeRemaining, setTimeRemaining] = useState<string>('')

  // Update countdown timer
  useEffect(() => {
    if (!orgDetails?.deletionScheduledDate) return

    const updateTimer = () => {
      const distance = formatDistanceToNow(new Date(orgDetails.deletionScheduledDate!), {
        addSuffix: true,
      })
      setTimeRemaining(distance)
    }

    updateTimer()
    const interval = setInterval(updateTimer, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [orgDetails?.deletionScheduledDate])

  // Handle plan selection - redirect to convert flow with pre-filled data
  const handleSelectPlan = () => {
    // Store selected org and plan in session storage
    sessionStorage.setItem('reactivation-organization-id', organizationId)
    sessionStorage.setItem(
      'subscription-convert-state',
      JSON.stringify({
        currentStep: 1,
        completedSteps: [],
        selectedPlan: null, // Will be loaded by convert provider
        addons: { seats: orgDetails?.currentSeats || 1 },
        billingCycle: orgDetails?.lastBillingCycle || 'MONTHLY',
      })
    )

    // Redirect to conversion flow
    router.push('/subscription/convert/addons')
  }

  // Loading state
  if (orgLoading) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-0 h-full">
        <div className="flex w-full max-w-2xl flex-col items-center space-y-5 px-6 mx-auto">
          <Card className="w-full shadow-md shadow-black/20 border-transparent">
            <CardHeader>
              <Skeleton className="h-8 w-64 mx-auto" />
              <Skeleton className="h-4 w-96 mx-auto mt-2" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Error states
  if (orgError || !orgDetails) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-0 h-full">
        <div className="flex w-full max-w-2xl flex-col items-center space-y-5 px-6 mx-auto">
          <Card className="w-full shadow-md shadow-black/20 border-transparent">
            <CardHeader className="text-center">
              <div className="mx-auto mb-5 size-14 border flex items-center justify-center rounded-2xl bg-muted text-destructive">
                <AlertTriangle className="size-8" />
              </div>
              <CardTitle>Unable to Load Organization</CardTitle>
              <CardDescription>
                {orgError?.message ||
                  'The organization could not be found or you do not have access.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button asChild variant="outline" className="w-full">
                <Link href="/app/dashboard">Go to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Not eligible for reactivation
  if (!orgDetails.isEligibleForReactivation) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-0 h-full">
        <div className="flex w-full max-w-2xl flex-col items-center space-y-5 px-6 mx-auto">
          <Card className="w-full shadow-md shadow-black/20 border-transparent">
            <CardHeader className="text-center">
              <div className="mx-auto mb-5 size-14 border flex items-center justify-center rounded-2xl bg-muted text-green-600">
                <CheckCircle2 className="size-8" />
              </div>
              <CardTitle>{orgDetails.organizationName} is Active</CardTitle>
              <CardDescription>
                This organization already has an active subscription and doesn&apos;t need
                reactivation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button asChild className="w-full">
                <Link href="/app/dashboard">Go to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Main reactivation UI
  const urgencyColor =
    orgDetails.hoursUntilDeletion && orgDetails.hoursUntilDeletion <= 24 ? 'destructive' : 'warning'
  const isUrgent = orgDetails.hoursUntilDeletion && orgDetails.hoursUntilDeletion <= 24

  return (
    <div className="flex items-center justify-center flex-1 min-h-0 h-full py-8">
      <div className="flex w-full max-w-3xl flex-col items-center space-y-5 px-6 mx-auto">
        {/* Urgency Alert */}
        <Alert variant={urgencyColor} className="w-full">
          <AlertIcon icon={Clock} />
          <div className="flex flex-col gap-0">
            <AlertTitle>
              {isUrgent ? '⏰ URGENT: ' : '⚠️ '}Account Scheduled for Deletion
            </AlertTitle>
            <AlertDescription>
              {orgDetails.organizationName} will be permanently deleted {timeRemaining}
            </AlertDescription>
          </div>
        </Alert>

        {/* Main Card */}
        <Card className="w-full shadow-md shadow-black/20 border-transparent">
          <CardHeader className="text-center">
            <div className="mx-auto mb-5 size-14 border flex items-center justify-center rounded-2xl bg-muted text-primary-500">
              <Building className="size-8" />
            </div>
            <CardTitle>Reactivate {orgDetails.organizationName}</CardTitle>
            <CardDescription>
              Your trial has ended. Upgrade now to keep your data and continue using Auxx.ai
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* What Will Be Lost */}
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <h3 className="font-semibold text-destructive mb-3 flex items-center gap-2">
                <AlertTriangle className="size-5" />
                Without action, you&apos;ll lose:
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground ml-7">
                <li>• All support tickets and conversations</li>
                <li>• Email integrations (Gmail, Outlook)</li>
                <li>• Team members and their access</li>
                <li>• All uploaded files and attachments</li>
                <li>• Custom workflows and automations</li>
                <li>• Analytics and reporting data</li>
              </ul>
            </div>

            {/* Current Organization Stats */}
            {orgDetails.stats && (
              <div className="bg-muted/50 rounded-lg p-4 grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-primary">
                    {orgDetails.stats.totalTickets}
                  </div>
                  <div className="text-xs text-muted-foreground">Tickets</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-primary">
                    {orgDetails.stats.totalMembers}
                  </div>
                  <div className="text-xs text-muted-foreground">Team Members</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-primary">
                    {orgDetails.stats.totalIntegrations}
                  </div>
                  <div className="text-xs text-muted-foreground">Integrations</div>
                </div>
              </div>
            )}

            {/* CTA Buttons */}
            <div className="space-y-3">
              <Button onClick={handleSelectPlan} className="w-full" size="lg">
                Reactivate with Pro Plan
              </Button>
              <Button asChild variant="outline" className="w-full" size="lg">
                <Link href="/subscription/convert/explore">View All Plans</Link>
              </Button>
            </div>

            {/* Help Text */}
            <p className="text-xs text-center text-muted-foreground">
              Need help deciding?{' '}
              <a href="mailto:sales@auxx.ai" className="text-primary hover:underline">
                Talk to our sales team
              </a>
            </p>
          </CardContent>
        </Card>

        {/* Additional Info */}
        <Card className="w-full shadow-none bg-white/10 backdrop-blur-sm border">
          <CardContent className="pt-6">
            <div className="text-sm text-center space-y-2">
              <p className="text-muted-foreground">Questions about billing or need more time?</p>
              <div className="flex gap-3 justify-center">
                <a href="mailto:support@auxx.ai" className="text-primary hover:underline text-sm">
                  Contact Support
                </a>
                <span className="text-muted-foreground">•</span>
                <a
                  href="https://auxx.ai/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline text-sm">
                  View Pricing
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
