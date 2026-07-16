// apps/web/src/components/dispatch/ui/work-order-editor.tsx

'use client'

import { COMPATIBLE_BILLING_TIMINGS } from '@auxx/lib/money/client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EntityInstanceForm,
  type EntityInstanceFormProps,
} from '~/components/custom-fields/ui/entity-instance/entity-instance-form'
import {
  EntityInstanceDialog,
  type EntityInstanceDialogProps,
} from '~/components/custom-fields/ui/entity-instance-dialog'
import { BillingPlanController } from '~/components/money/billing/billing-plan-controller'
import type { BillingBasis, BillingTiming } from '~/components/money/billing/types'

const BILLING_BASES = new Set<BillingBasis>(['fixed_contract', 'per_visit', 'recurring_flat'])
const BILLING_TIMINGS = new Set<BillingTiming>([
  'per_visit_completed',
  'on_completion',
  'as_needed',
  'custom_schedule',
])

function initialBilling(
  requestedBasis: unknown,
  requestedTiming: unknown
): {
  basis: BillingBasis
  timing: BillingTiming
} {
  const basis = BILLING_BASES.has(requestedBasis as BillingBasis)
    ? (requestedBasis as BillingBasis)
    : 'per_visit'
  const timing =
    BILLING_TIMINGS.has(requestedTiming as BillingTiming) &&
    COMPATIBLE_BILLING_TIMINGS[basis].includes(requestedTiming as BillingTiming)
      ? (requestedTiming as BillingTiming)
      : COMPATIBLE_BILLING_TIMINGS[basis][0]!
  return { basis, timing }
}

function useWorkOrderCreateExtension(
  open: boolean,
  presetValues?: Record<string, unknown>
): NonNullable<EntityInstanceFormProps['createExtension']> {
  const presetBasis = presetValues?.work_order_pricing_model
  const presetTiming = presetValues?.work_order_invoice_timing
  const initial = useMemo(
    () => initialBilling(presetBasis, presetTiming),
    [presetBasis, presetTiming]
  )
  const [basis, setBasis] = useState(initial.basis)
  const [timing, setTiming] = useState(initial.timing)
  const reset = useCallback(() => {
    setBasis(initial.basis)
    setTiming(initial.timing)
  }, [initial])

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  return useMemo(
    () => ({
      content: (
        <section className='mt-4 rounded-xl border bg-primary-50 p-3'>
          <div className='mb-3'>
            <div className='text-sm font-medium'>Billing</div>
            <div className='text-xs text-muted-foreground'>
              Choose how this work order will become ready to invoice.
            </div>
          </div>
          <BillingPlanController
            compact
            basis={basis}
            timing={timing}
            onBasisChange={setBasis}
            onTimingChange={setTiming}
          />
        </section>
      ),
      values: {
        work_order_pricing_model: basis,
        work_order_invoice_timing: timing,
      },
      isDirty: basis !== initial.basis || timing !== initial.timing,
      onReset: reset,
    }),
    [basis, initial, reset, timing]
  )
}

/** Work-order-specific dialog composed around the generic entity form. */
export function WorkOrderEditorDialog(props: EntityInstanceDialogProps) {
  const createExtension = useWorkOrderCreateExtension(props.open, props.presetValues)
  return (
    <EntityInstanceDialog
      {...props}
      createExtension={props.recordId ? undefined : createExtension}
    />
  )
}

/** Work-order create form for non-dialog hosts such as the command palette. */
export function WorkOrderEntityInstanceForm(props: EntityInstanceFormProps) {
  const createExtension = useWorkOrderCreateExtension(props.open, props.presetValues)
  return (
    <EntityInstanceForm {...props} createExtension={props.recordId ? undefined : createExtension} />
  )
}
