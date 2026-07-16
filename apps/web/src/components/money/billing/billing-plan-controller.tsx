// apps/web/src/components/money/billing/billing-plan-controller.tsx

'use client'

import {
  BILLING_BASIS_LABELS,
  BILLING_TIMING_LABELS,
  COMPATIBLE_BILLING_TIMINGS,
} from '@auxx/lib/money/client'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import {
  CalendarCheck,
  ClipboardList,
  ListChecks,
  ReceiptText,
  Repeat2,
  UserRoundCog,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { BillingBasis, BillingTiming } from './types'

/** Basis descriptions/icons — labels themselves come from the shared `@auxx/lib/money/client`
 * matrix so this UI copy can't drift from the billing tab's plan summary. */
const BASIS_DESCRIPTIONS: Record<BillingBasis, string> = {
  fixed_contract: 'Invoice the agreed contract once or progressively.',
  per_visit: 'Each completed visit uses the work order lines as its default price.',
  recurring_flat: 'Charge one standing amount per billing period, independent of visits.',
}
const BASIS_ICONS: Record<BillingBasis, ReactNode> = {
  fixed_contract: <ReceiptText />,
  per_visit: <ListChecks />,
  recurring_flat: <Repeat2 />,
}
const BASIS_ORDER: BillingBasis[] = ['fixed_contract', 'per_visit', 'recurring_flat']

const TIMING_ICONS: Record<BillingTiming, ReactNode> = {
  per_visit_completed: <CalendarCheck />,
  on_completion: <ClipboardList />,
  as_needed: <UserRoundCog />,
  custom_schedule: <CalendarCheck />,
}
const TIMING_ORDER: BillingTiming[] = [
  'per_visit_completed',
  'on_completion',
  'as_needed',
  'custom_schedule',
]

interface BillingPlanControllerProps {
  basis: BillingBasis
  timing: BillingTiming
  onBasisChange: (basis: BillingBasis) => void
  onTimingChange: (timing: BillingTiming) => void
  compact?: boolean
}

/** Controlled billing basis/timing input shared by work-order create and edit flows. */
export function BillingPlanController({
  basis,
  timing,
  onBasisChange,
  onTimingChange,
  compact = false,
}: BillingPlanControllerProps) {
  const changeBasis = (value: BillingBasis) => {
    onBasisChange(value)
    if (!COMPATIBLE_BILLING_TIMINGS[value].includes(timing)) {
      onTimingChange(COMPATIBLE_BILLING_TIMINGS[value][0]!)
    }
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      <fieldset className='space-y-2'>
        <legend className='mb-2 text-sm font-medium'>Billing basis</legend>
        <RadioGroup
          value={basis}
          onValueChange={(value) => changeBasis(value as BillingBasis)}
          className={compact ? 'grid gap-2 sm:grid-cols-3' : undefined}>
          {BASIS_ORDER.map((value) => (
            <RadioGroupItemCard
              key={value}
              value={value}
              label={BILLING_BASIS_LABELS[value]}
              description={compact ? undefined : BASIS_DESCRIPTIONS[value]}
              icon={BASIS_ICONS[value]}
            />
          ))}
        </RadioGroup>
      </fieldset>
      <fieldset className='space-y-2'>
        <legend className='mb-2 text-sm font-medium'>Invoice timing</legend>
        <RadioGroup
          value={timing}
          onValueChange={(value) => onTimingChange(value as BillingTiming)}
          className='grid grid-cols-2 gap-2'>
          {TIMING_ORDER.filter((value) => COMPATIBLE_BILLING_TIMINGS[basis].includes(value)).map(
            (value) => (
              <RadioGroupItemCard
                key={value}
                value={value}
                label={BILLING_TIMING_LABELS[value]}
                icon={TIMING_ICONS[value]}
              />
            )
          )}
        </RadioGroup>
      </fieldset>
    </div>
  )
}
