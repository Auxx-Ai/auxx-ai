// apps/homepage/src/lib/billing-period-context.tsx
'use client'
import { createContext, type ReactNode, useContext, useState } from 'react'

// Prices live in the plain ~/lib/pricing module (single source of truth); re-exported here so
// existing client consumers keep importing them from the billing-period context.
export { ANNUAL_DISCOUNT, PLAN_PRICES } from './pricing'

export type BillingPeriod = 'monthly' | 'annually'

type BillingPeriodContextValue = {
  billingPeriod: BillingPeriod
  setBillingPeriod: (period: BillingPeriod) => void
}

const BillingPeriodContext = createContext<BillingPeriodContextValue | null>(null)

export function BillingPeriodProvider({ children }: { children: ReactNode }) {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('annually')
  return (
    <BillingPeriodContext.Provider value={{ billingPeriod, setBillingPeriod }}>
      {children}
    </BillingPeriodContext.Provider>
  )
}

export function useBillingPeriod(): BillingPeriodContextValue {
  const ctx = useContext(BillingPeriodContext)
  if (!ctx) throw new Error('useBillingPeriod must be used within BillingPeriodProvider')
  return ctx
}
