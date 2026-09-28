// apps/web/src/components/subscriptions/usage-limit-dialog.tsx
'use client'

import { Database } from 'lucide-react'
import { create } from 'zustand'
import { api } from '~/trpc/react'
import { LimitReachedDialog } from './limit-reached-dialog'

interface UsageLimitState {
  metric: string | null
  description: string
}

const useUsageLimitStore = create<UsageLimitState>(() => ({ metric: null, description: '' }))

const TITLES: Record<string, string> = { records: 'Records limit reached' }

/** Opens the upgrade dialog for a plan-limit 403 (`data.usageLimit`); false for any other error. */
export function showUsageLimitDialog(error: unknown): boolean {
  const usageLimit = (error as { data?: { usageLimit?: { metric: string } } } | null)?.data
    ?.usageLimit
  if (!usageLimit) return false
  useUsageLimitStore.setState({
    metric: usageLimit.metric,
    description: error instanceof Error ? error.message : 'Upgrade your plan to continue.',
  })
  return true
}

/** Mounted once in the app shell; renders whatever `showUsageLimitDialog` opened. */
export function UsageLimitDialogHost() {
  const metric = useUsageLimitStore((s) => s.metric)
  const description = useUsageLimitStore((s) => s.description)
  const utils = api.useUtils()

  return (
    <LimitReachedDialog
      open={metric !== null}
      onOpenChange={(open) => {
        if (open) return
        useUsageLimitStore.setState({ metric: null })
        // The refusal recounted server-side; pull the banner up to date.
        if (metric === 'records') void utils.usage.getRecords.invalidate()
      }}
      icon={Database}
      title={(metric && TITLES[metric]) ?? 'Plan limit reached'}
      description={description}
    />
  )
}
