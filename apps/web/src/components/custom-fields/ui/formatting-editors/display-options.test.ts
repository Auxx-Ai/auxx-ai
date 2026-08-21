// apps/web/src/components/custom-fields/ui/formatting-editors/display-options.test.ts

import { displayOptionsSchema } from '@auxx/types/custom-field'
import { describe, expect, it } from 'vitest'
import { formatDisplayOptions, parseDisplayOptions } from './index'

/**
 * Regression guard for the duplicated whitelist.
 *
 * These two functions filter display options in BOTH directions — `parse` on
 * load, `format` on save. They used to filter against a hand-maintained
 * web-local copy of the canonical key list, so any option the canonical schema
 * gained but the copy did not simply evaporated: the switch flipped, marked the
 * form dirty, saved, and the key never reached tRPC. Reopen, and it was off.
 * Indistinguishable from "this toggle doesn't work".
 *
 * The list is derived from the schema now, so the failure mode is gone rather
 * than patched for one key.
 */
describe('display option key list', () => {
  it('covers every canonical display option except the nested ai block', () => {
    const canonical = Object.keys(displayOptionsSchema.shape).filter((k) => k !== 'ai')
    for (const key of canonical) {
      const round = formatDisplayOptions({ [key]: 'x' } as never)
      expect(round, `formatDisplayOptions dropped "${key}"`).toHaveProperty(key)
      expect(
        parseDisplayOptions({ [key]: 'x' } as never),
        `parseDisplayOptions dropped "${key}"`
      ).toHaveProperty(key)
    }
  })

  it('round-trips the CURRENCY options through save and load', () => {
    const options = {
      currencyCode: 'JPY',
      currencyDisplay: 'code',
      useGrouping: false,
    } as const
    expect(parseDisplayOptions(formatDisplayOptions(options) as never)).toEqual(options)
  })

  it('keeps `decimals: undefined` out rather than stamping a default', () => {
    // Undefined means "derive from the currency code". Round-tripping it as 2
    // freezes a JPY column at two decimals.
    expect(formatDisplayOptions({ currencyCode: 'JPY', decimals: undefined })).not.toHaveProperty(
      'decimals'
    )
  })

  it('never carries the nested ai block — custom-field-form owns that', () => {
    expect(formatDisplayOptions({ ai: { enabled: true } } as never)).not.toHaveProperty('ai')
  })
})
