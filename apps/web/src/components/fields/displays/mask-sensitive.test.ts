// apps/web/src/components/fields/displays/mask-sensitive.test.ts

import { describe, expect, it } from 'vitest'
import { maskSensitive } from './mask-sensitive'

describe('maskSensitive', () => {
  it('keeps the last four characters of an EIN', () => {
    expect(maskSensitive('12-3456789')).toBe('••••••6789')
  })

  it('keeps the last four characters of an SSN', () => {
    expect(maskSensitive('123-45-6789')).toBe('•••••••6789')
  })

  // The one case where keeping the tail would reveal the whole value.
  it('masks a value of exactly four characters entirely', () => {
    expect(maskSensitive('6789')).toBe('••••')
  })

  it('masks a shorter value entirely', () => {
    expect(maskSensitive('89')).toBe('••')
  })

  it('returns an empty string unchanged', () => {
    expect(maskSensitive('')).toBe('')
  })

  it('preserves length, so the mask does not hint at a shorter secret', () => {
    expect(maskSensitive('123456789012345')).toHaveLength(15)
  })
})
