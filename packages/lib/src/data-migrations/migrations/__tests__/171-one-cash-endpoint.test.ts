// packages/lib/src/data-migrations/migrations/__tests__/171-one-cash-endpoint.test.ts
//
// The branch's one per-org migration. Two things are pinned here: that it is
// registered (an unregistered migration runs nowhere), and the option
// re-materialisation rule, which is the half that cannot be appended to.

import { describe, expect, it } from 'vitest'
import { VendorBillStatus } from '../../../resources/registry/enum-values'
import { PER_ORG_MIGRATIONS } from '../../registry'
import { migration171OneCashEndpoint, rematerialiseStatusOptions } from '../171-one-cash-endpoint'

const MIGRATION_ID = '171-one-cash-endpoint'

/** The eight-value list every org seeded before 73 D1. */
const LEGACY_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'awaiting_receipt', label: 'Awaiting Receipt' },
  { value: 'matched', label: 'Matched' },
  { value: 'exception', label: 'Exception' },
  { value: 'posted', label: 'Posted' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
]

describe('migration 171', () => {
  it('is registered in PER_ORG_MIGRATIONS', () => {
    expect(PER_ORG_MIGRATIONS.map((m) => m.id)).toContain(MIGRATION_ID)
    expect(migration171OneCashEndpoint.id).toBe(MIGRATION_ID)
  })

  it('is the only migration carrying this id', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
  })
})

describe('rematerialiseStatusOptions', () => {
  it('drops the two money values and keeps the six lifecycle ones', () => {
    const next = rematerialiseStatusOptions(LEGACY_OPTIONS, VendorBillStatus.values)
    expect(next?.map((option) => option.value)).toEqual([
      'draft',
      'awaiting_receipt',
      'matched',
      'exception',
      'posted',
      'void',
    ])
  })

  it("keeps an org's own label on a value it edited", () => {
    const next = rematerialiseStatusOptions(
      LEGACY_OPTIONS.map((o) => (o.value === 'exception' ? { ...o, label: 'Query' } : o)),
      VendorBillStatus.values
    )
    expect(next?.find((option) => option.value === 'exception')?.label).toBe('Query')
  })

  it('keeps an option the org added itself, at the end', () => {
    const next = rematerialiseStatusOptions(
      [...LEGACY_OPTIONS, { value: 'on_hold', label: 'On hold' }],
      VendorBillStatus.values
    )
    expect(next?.at(-1)?.value).toBe('on_hold')
  })

  it('is a no-op once the list already matches', () => {
    expect(rematerialiseStatusOptions(VendorBillStatus.values, VendorBillStatus.values)).toBeNull()
  })
})
