// apps/web/src/app/(protected)/app/settings/plans/_components/demo-billing-cycle-guard.tsx
'use client'

import type { ReactNode } from 'react'
import { useDemo } from '~/hooks/use-demo'

/** Hides children when the current org is a demo account */
export function DemoBillingCycleGuard({ children }: { children: ReactNode }) {
  const { isDemo } = useDemo()
  if (isDemo) return null
  return children
}
