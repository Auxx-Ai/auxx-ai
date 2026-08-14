// apps/web/src/components/apps/host/data-handlers/unwrap-value.test.ts
//
// C6 (multi-email plan): the app-host `record.data` shape contract. For
// `options.multi` fields the unwrapped value is STABLY `string[]` — never
// count-dependent. The count-dependent scalar-for-one/array-for-two shape is
// the exact template the Stripe link dialog bug was written from
// (`record.data.primary_email as string`).

import type { TypedFieldValue } from '@auxx/types/field-value'
import { describe, expect, it } from 'vitest'
import { unwrapValue } from './unwrap-value'

const email = (value: string): TypedFieldValue =>
  ({ type: 'text', value }) as unknown as TypedFieldValue

describe('unwrapValue — app-host record.data shape', () => {
  describe('options.multi fields (stable string[])', () => {
    it('returns [] for no value', () => {
      expect(unwrapValue(null, 'EMAIL', { multi: true })).toEqual([])
    })

    it('returns a one-element array for a single value — never a scalar', () => {
      expect(unwrapValue(email('a@x.com'), 'EMAIL', { multi: true })).toEqual(['a@x.com'])
      expect(unwrapValue([email('a@x.com')], 'EMAIL', { multi: true })).toEqual(['a@x.com'])
    })

    it('returns all values for multiple rows, in order', () => {
      expect(unwrapValue([email('a@x.com'), email('b@x.com')], 'EMAIL', { multi: true })).toEqual([
        'a@x.com',
        'b@x.com',
      ])
    })
  })

  describe('single-value fields (historic behavior unchanged)', () => {
    it('returns null for no value', () => {
      expect(unwrapValue(null, 'EMAIL')).toBeNull()
      expect(unwrapValue(null, 'EMAIL', {})).toBeNull()
    })

    it('returns a scalar for a single value', () => {
      expect(unwrapValue(email('a@x.com'), 'EMAIL')).toBe('a@x.com')
    })

    it('returns an array only for multiple rows', () => {
      expect(unwrapValue([email('a@x.com'), email('b@x.com')], 'EMAIL')).toEqual([
        'a@x.com',
        'b@x.com',
      ])
    })
  })
})
