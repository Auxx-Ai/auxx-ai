// apps/homepage/src/lib/billing-period-context.tsx
'use client'
import { createContext, type ReactNode, useContext, useState } from 'react'

export type BillingPeriod = 'monthly' | 'annually'

export const ANNUAL_DISCOUNT = 0.3

export const PLAN_PRICES = {
  free: { monthly: 0, annually: 0 },
  starter: { monthly: 20, annually: Math.round(20 * (1 - ANNUAL_DISCOUNT)) },
  growth: { monthly: 50, annually: Math.round(50 * (1 - ANNUAL_DISCOUNT)) },
} as const

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
