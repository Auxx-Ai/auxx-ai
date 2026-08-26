// packages/lib/src/custom-fields/__tests__/to-stored-field-options.test.ts

import { describe, expect, it } from 'vitest'
import { toStoredFieldOptions } from '../field-options'

/**
 * `toStoredFieldOptions` is the patch -> stored narrowing. Its whole job is the
 * `allowNewOptions` sentinel: `null` means "revert to the type default" and must
 * CLEAR the key, because the stored flag is tri-state (absent inherits, true /
 * false are decisions) and a stored `null` would be a fourth state.
 *
 * These mirror `updateCustomField`'s own rule — see
 * `update-field-allow-new-options.test.ts` for the writer side.
 */
describe('toStoredFieldOptions', () => {
  it('returns undefined for an absent patch', () => {
    expect(toStoredFieldOptions(undefined)).toBeUndefined()
    expect(toStoredFieldOptions(null)).toBeUndefined()
  })

  it('wraps a bare array patch as the option list', () => {
    const options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]
    expect(toStoredFieldOptions(options)).toEqual({ options })
  })

  it('CLEARS allowNewOptions when the patch sends the null sentinel', () => {
    const result = toStoredFieldOptions({
      options: [{ value: 'a', label: 'A' }],
      allowNewOptions: null,
    })
    expect(result).toEqual({ options: [{ value: 'a', label: 'A' }] })
    expect(result).not.toHaveProperty('allowNewOptions')
  })

  it('keeps an explicit false — it is a decision, not an absence', () => {
    const result = toStoredFieldOptions({ allowNewOptions: false })
    expect(result).toEqual({ allowNewOptions: false })
  })

  it('keeps an explicit true', () => {
    expect(toStoredFieldOptions({ allowNewOptions: true })).toEqual({ allowNewOptions: true })
  })

  it('leaves the key absent when the patch never addressed it', () => {
    const result = toStoredFieldOptions({ decimals: 2 })
    expect(result).toEqual({ decimals: 2 })
    expect(result).not.toHaveProperty('allowNewOptions')
  })

  it('preserves every sibling block while clearing the sentinel', () => {
    const result = toStoredFieldOptions({
      options: [{ value: 'a', label: 'A' }],
      ai: { enabled: true },
      allowNewOptions: null,
    })
    expect(result).toEqual({ options: [{ value: 'a', label: 'A' }], ai: { enabled: true } })
  })

  it('does not mutate the caller’s patch', () => {
    const patch = { options: [{ value: 'a', label: 'A' }], allowNewOptions: null }
    toStoredFieldOptions({ ...patch })
    expect(patch.allowNewOptions).toBeNull()
  })
})
