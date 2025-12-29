// app/(protected)/app/settings/plans/_components/credit-balance.tsx
'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { PiggyBank } from 'lucide-react'
import { api } from '~/trpc/react'
import { Skeleton } from '@auxx/ui/components/skeleton'

type CreditBalanceProps = { balance?: number }

export function CreditBalance({ balance }: CreditBalanceProps) {
  const { data: subscription, isLoading } = api.billing.getCurrentSubscription.useQuery(undefined, {
    enabled: balance === undefined,
  })

  const credits = balance !== undefined ? balance : subscription?.creditsBalance

  if (isLoading) {
    return (
      <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900">
        <PiggyBank className="h-4 w-4 text-green-600 dark:text-green-300" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1 h-4 w-72" />
      </Alert>
    )
  }

  if (!credits || credits <= 0) {
    return null
  }

  const formattedCredits = (credits / 100).toFixed(2)

  return (
    <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900">
      <PiggyBank className="h-4 w-4 text-green-600 dark:text-green-300" />
      <AlertTitle>Credits Balance: ${formattedCredits}</AlertTitle>
      <AlertDescription className="text-green-700 dark:text-green-300">
        These credits will be automatically applied to your next invoice
      </AlertDescription>
    </Alert>
  )
}
