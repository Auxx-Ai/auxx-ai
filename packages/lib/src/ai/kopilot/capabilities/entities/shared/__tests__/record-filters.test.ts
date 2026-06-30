// packages/lib/src/ai/kopilot/capabilities/entities/shared/__tests__/record-filters.test.ts

import { FieldType } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import type { Resource } from '../../../../../../resources/registry/types'
import { validateFilters } from '../record-filters'

// Minimal resource with one DATETIME field, enough to exercise date-value validation.
const resource = {
  id: 'def-1',
  label: 'Contact',
  plural: 'Contacts',
  fields: [
    {
      id: 'created_at',
      key: 'created_at',
      systemAttribute: 'created_at',
      label: 'Created',
      fieldType: FieldType.DATETIME,
    },
  ],
} as unknown as Resource

describe('validateFilters — date value shape', () => {
  it('rejects a relative-token value on `after` (the now-30d hallucination)', () => {
    const { valid, warnings } = validateFilters(
      [{ field: 'created_at', operator: 'after', value: 'now-30d' }],
      resource
    )
    expect(valid).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.kind).toBe('invalid_value')
  })

  it('rejects a non-numeric value on `within_days`', () => {
    const { valid, warnings } = validateFilters(
      [{ field: 'created_at', operator: 'within_days', value: 'now-30d' }],
      resource
    )
    expect(valid).toHaveLength(0)
    expect(warnings[0]?.kind).toBe('invalid_value')
  })

  it('accepts `within_days` with a numeric value (the correct "last 30 days" shape)', () => {
    const { valid, warnings } = validateFilters(
      [{ field: 'created_at', operator: 'within_days', value: 30 }],
      resource
    )
    expect(valid).toHaveLength(1)
    expect(warnings).toHaveLength(0)
  })

  it('accepts `after` with an absolute ISO date', () => {
    const { valid, warnings } = validateFilters(
      [{ field: 'created_at', operator: 'after', value: '2026-05-30' }],
      resource
    )
    expect(valid).toHaveLength(1)
    expect(warnings).toHaveLength(0)
  })

  it('accepts no-value date operators like `this_month`', () => {
    const { valid } = validateFilters([{ field: 'created_at', operator: 'this_month' }], resource)
    expect(valid).toHaveLength(1)
  })
})
