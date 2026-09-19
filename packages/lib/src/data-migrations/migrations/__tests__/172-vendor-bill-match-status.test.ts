// packages/lib/src/data-migrations/migrations/__tests__/172-vendor-bill-match-status.test.ts
//
// 73 D1's second half. Two things are pinned: that the migration is registered,
// and the option re-materialisation rule, which is the half that cannot be
// appended to.

import { describe, expect, it } from 'vitest'
import { VendorBillStatus } from '../../../resources/registry/enum-values'
import { PER_ORG_MIGRATIONS } from '../../registry'
import {
  migration172VendorBillMatchStatus,
  rematerialiseLifecycleOptions,
} from '../172-vendor-bill-match-status'

const MIGRATION_ID = '172-vendor-bill-match-status'

/** The six-value list every org carries after 171 and before this. */
const POST_171_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'awaiting_receipt', label: 'Awaiting Receipt' },
  { value: 'matched', label: 'Matched' },
  { value: 'exception', label: 'Exception' },
  { value: 'posted', label: 'Posted' },
  { value: 'void', label: 'Void' },
]

describe('migration 172', () => {
  it('is registered in PER_ORG_MIGRATIONS', () => {
    expect(PER_ORG_MIGRATIONS.map((m) => m.id)).toContain(MIGRATION_ID)
    expect(migration172VendorBillMatchStatus.id).toBe(MIGRATION_ID)
  })

  it('is the only migration carrying this id', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
  })

  it('runs after 171, which shrinks the same option set first', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('171-one-cash-endpoint'))
  })
})

describe('rematerialiseLifecycleOptions', () => {
  it('drops the three verdict values and keeps the three lifecycle ones', () => {
    const next = rematerialiseLifecycleOptions(POST_171_OPTIONS, VendorBillStatus.values)
    expect(next?.map((option) => option.value)).toEqual(['draft', 'posted', 'void'])
  })

  it("keeps an org's own label on a value it edited", () => {
    const next = rematerialiseLifecycleOptions(
      POST_171_OPTIONS.map((o) => (o.value === 'posted' ? { ...o, label: 'In the books' } : o)),
      VendorBillStatus.values
    )
    expect(next?.find((option) => option.value === 'posted')?.label).toBe('In the books')
  })

  it('keeps an option the org added itself, at the end', () => {
    const next = rematerialiseLifecycleOptions(
      [...POST_171_OPTIONS, { value: 'on_hold', label: 'On hold' }],
      VendorBillStatus.values
    )
    expect(next?.at(-1)?.value).toBe('on_hold')
  })

  it('is a no-op once the list already matches', () => {
    expect(
      rematerialiseLifecycleOptions(VendorBillStatus.values, VendorBillStatus.values)
    ).toBeNull()
  })
})
