// packages/lib/src/field-values/__tests__/buffered-old-value-flatten.test.ts
//
// plans/events/10 §7 item 2. `bufferFieldChange` stores `o` as
// `flattenTypedFieldValue(oldValue)`, so a derive replayed from the committed scope sees
// the flat scalar, not the typed envelope. The three old-value readers in §5
// (`enrollInvoiceReminderOnSent`, `reanchorInvoiceOnDueDateChange`,
// `prefillContactOnVendorChange`) read SELECT and RELATIONSHIP old values; these pin what
// they get. Covered at the flatten level — the buffer helper itself is private.

import type { TypedFieldValue } from '@auxx/types'
import { describe, expect, it } from 'vitest'
import { flattenTypedFieldValue } from '../field-value-helpers'

describe('flattenTypedFieldValue — what a buffered `o` carries', () => {
  it('reduces a SINGLE_SELECT envelope to its optionId', () => {
    const stored = { type: 'option', optionId: 'opt_sent' } as unknown as TypedFieldValue
    expect(flattenTypedFieldValue(stored)).toBe('opt_sent')
  })

  it('reduces a RELATIONSHIP envelope to its recordId', () => {
    const stored = {
      type: 'relationship',
      recordId: 'def_vendor:ven_1',
    } as unknown as TypedFieldValue
    expect(flattenTypedFieldValue(stored)).toBe('def_vendor:ven_1')
  })

  it('maps a multi-value relationship array element-wise', () => {
    const stored = [
      { type: 'relationship', recordId: 'def_line:line_1' },
      { type: 'relationship', recordId: 'def_line:line_2' },
    ] as unknown as TypedFieldValue[]
    expect(flattenTypedFieldValue(stored)).toEqual(['def_line:line_1', 'def_line:line_2'])
  })

  it('an empty field flattens to null, which is what a create write reports', () => {
    expect(flattenTypedFieldValue(null)).toBeNull()
  })
})
