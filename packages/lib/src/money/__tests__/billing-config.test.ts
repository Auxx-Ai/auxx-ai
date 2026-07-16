// packages/lib/src/money/__tests__/billing-config.test.ts

import { describe, expect, it } from 'vitest'
import {
  assertBillingConfigurationCompatible,
  isBillingConfigurationCompatible,
} from '../billing-config'

describe('work-order billing configuration', () => {
  it.each([
    ['fixed_contract', 'on_completion'],
    ['fixed_contract', 'as_needed'],
    ['fixed_contract', 'custom_schedule'],
    ['per_visit', 'per_visit_completed'],
    ['per_visit', 'on_completion'],
    ['per_visit', 'as_needed'],
    ['per_visit', 'custom_schedule'],
    ['recurring_flat', 'as_needed'],
    ['recurring_flat', 'custom_schedule'],
  ] as const)('accepts %s with %s', (basis, timing) => {
    expect(isBillingConfigurationCompatible(basis, timing)).toBe(true)
    expect(() => assertBillingConfigurationCompatible(basis, timing)).not.toThrow()
  })

  it.each([
    ['fixed_contract', 'per_visit_completed'],
    ['recurring_flat', 'per_visit_completed'],
    ['recurring_flat', 'on_completion'],
  ] as const)('rejects %s with %s', (basis, timing) => {
    expect(isBillingConfigurationCompatible(basis, timing)).toBe(false)
    expect(() => assertBillingConfigurationCompatible(basis, timing)).toThrow()
  })

  it('treats unknown persisted values as incompatible instead of crashing projection repair', () => {
    expect(isBillingConfigurationCompatible('fixed' as never, 'as_needed')).toBe(false)
    expect(isBillingConfigurationCompatible('per_visit', 'unknown' as never)).toBe(false)
  })
})
