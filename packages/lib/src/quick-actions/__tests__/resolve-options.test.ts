// packages/lib/src/quick-actions/__tests__/resolve-options.test.ts

import type { DynamicSelectHint } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { mapResolverOutputToOptions } from '../resolve-options'

const STRIPE_HINT: DynamicSelectHint = {
  optionsFrom: 'list_stripe_charges_for_customer',
  itemsPath: 'charges',
  valuePath: 'chargeId',
  labelTemplate: '{amount} {currency} · {status}',
  sublabelTemplate: '{description}',
  emptyHint: 'No Stripe customer linked to this contact',
}

const SAMPLE = {
  charges: [
    {
      chargeId: 'ch_1',
      amount: 2400,
      currency: 'usd',
      status: 'succeeded',
      description: 'Order #1042',
    },
    {
      chargeId: 'ch_2',
      amount: 999,
      currency: 'usd',
      status: 'refunded',
      description: 'Order #1043',
    },
  ],
  truncated: false,
}

describe('mapResolverOutputToOptions', () => {
  it('maps items at itemsPath through value/label/sublabel templates', () => {
    const { options, disabledHint } = mapResolverOutputToOptions(SAMPLE, STRIPE_HINT)
    expect(disabledHint).toBeNull()
    expect(options).toEqual([
      { value: 'ch_1', label: '2400 usd · succeeded', sublabel: 'Order #1042' },
      { value: 'ch_2', label: '999 usd · refunded', sublabel: 'Order #1043' },
    ])
  })

  it('returns the emptyHint when nothing resolves', () => {
    expect(mapResolverOutputToOptions({ charges: [] }, STRIPE_HINT)).toEqual({
      options: [],
      disabledHint: 'No Stripe customer linked to this contact',
    })
  })

  it('locally filters by query across value, label, and sublabel', () => {
    const byStatus = mapResolverOutputToOptions(SAMPLE, STRIPE_HINT, 'refunded')
    expect(byStatus.options.map((o) => o.value)).toEqual(['ch_2'])

    const byValue = mapResolverOutputToOptions(SAMPLE, STRIPE_HINT, 'ch_1')
    expect(byValue.options.map((o) => o.value)).toEqual(['ch_1'])

    const byDescription = mapResolverOutputToOptions(SAMPLE, STRIPE_HINT, '1042')
    expect(byDescription.options.map((o) => o.value)).toEqual(['ch_1'])
  })

  it('drops rows missing the value path', () => {
    const data = {
      charges: [
        { amount: 100 },
        { chargeId: 'ch_ok', amount: 200, currency: 'usd', status: 'paid' },
      ],
    }
    const { options } = mapResolverOutputToOptions(data, STRIPE_HINT)
    expect(options.map((o) => o.value)).toEqual(['ch_ok'])
  })

  it('treats the output as the array when no itemsPath is set', () => {
    const hint: DynamicSelectHint = { ...STRIPE_HINT, itemsPath: undefined }
    const { options } = mapResolverOutputToOptions(SAMPLE.charges, hint)
    expect(options.map((o) => o.value)).toEqual(['ch_1', 'ch_2'])
  })

  it('falls back to the value when the label template renders empty', () => {
    const hint: DynamicSelectHint = {
      optionsFrom: 'x',
      valuePath: 'id',
      labelTemplate: '{missing}',
    }
    const { options } = mapResolverOutputToOptions([{ id: 'abc' }], hint)
    expect(options).toEqual([{ value: 'abc', label: 'abc', sublabel: undefined }])
  })
})
