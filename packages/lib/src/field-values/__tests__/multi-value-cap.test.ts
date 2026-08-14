// packages/lib/src/field-values/__tests__/multi-value-cap.test.ts

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../errors'
import { type FieldValueContext, validateAndConvertValue } from '../field-value-helpers'
import { FieldValueValidator } from '../field-value-validator'
import { MAX_MULTI_VALUES } from '../primary-value'
import type { CachedField } from '../types'

const ctx = {
  db: {} as never,
  organizationId: 'org-1',
  fieldCache: new Map(),
  batchRelationshipValidationCache: new Map(),
  validator: new FieldValueValidator(),
} as unknown as FieldValueContext

const multiEmailField = {
  id: 'field-email-1',
  type: 'EMAIL',
  options: { multi: true },
} as unknown as CachedField

const emails = (n: number) => Array.from({ length: n }, (_, i) => `user${i}@example.com`)

describe('validateAndConvertValue — MAX_MULTI_VALUES cap', () => {
  it(`accepts exactly ${MAX_MULTI_VALUES} values`, async () => {
    const result = await validateAndConvertValue(
      ctx,
      emails(MAX_MULTI_VALUES),
      'EMAIL',
      multiEmailField
    )
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[]).length).toBe(MAX_MULTI_VALUES)
  })

  it(`rejects the ${MAX_MULTI_VALUES + 1}th value`, async () => {
    await expect(
      validateAndConvertValue(ctx, emails(MAX_MULTI_VALUES + 1), 'EMAIL', multiEmailField)
    ).rejects.toThrow(BadRequestError)
  })

  it('normalizes (lowercases) each array element on the way through', async () => {
    const result = await validateAndConvertValue(
      ctx,
      ['Alice@Example.COM', 'BOB@X.io'],
      'EMAIL',
      multiEmailField
    )
    expect(result).toEqual([
      { type: 'text', value: 'alice@example.com' },
      { type: 'text', value: 'bob@x.io' },
    ])
  })
})
