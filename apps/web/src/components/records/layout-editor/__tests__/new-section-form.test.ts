// apps/web/src/components/records/layout-editor/__tests__/new-section-form.test.ts

import { describe, expect, it } from 'vitest'
import { firstSelected } from '../new-section-form'

// `select-input-field.tsx` calls `onChange(selected: string[])` for BOTH modes,
// so a single-select still reports an array. Reading it as a string dropped
// every pick on the floor: the popover closed and the trigger stayed empty,
// with no error anywhere.
describe('firstSelected', () => {
  it('reads a single-select pick out of the array it arrives in', () => {
    expect(firstSelected(['edf_work_order:contact'])).toBe('edf_work_order:contact')
  })

  it('treats an empty array as a cleared selection', () => {
    expect(firstSelected([])).toBe('')
  })

  it('still accepts a bare string, so a future scalar caller keeps working', () => {
    expect(firstSelected('edf_quote:contact')).toBe('edf_quote:contact')
  })

  it('refuses anything else rather than coercing it into an id', () => {
    expect(firstSelected(null)).toBe('')
    expect(firstSelected(undefined)).toBe('')
    expect(firstSelected([{ id: 'x' }])).toBe('')
    expect(firstSelected(42)).toBe('')
  })
})
