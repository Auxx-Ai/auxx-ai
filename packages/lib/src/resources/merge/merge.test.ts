// packages/lib/src/resources/merge/merge.test.ts

import type { TypedFieldValueInput } from '@auxx/types/field-value'
import { describe, expect, it } from 'vitest'
import { formatToRawValue } from '../../field-values/formatter'
import { MAX_MULTI_VALUES } from '../../field-values/primary-value'
import { mergeFieldValue } from './client'

const MULTI_EMAIL = { fieldType: 'EMAIL' as const, fieldOptions: { multi: true } }

describe('mergeFieldValue — multi-value union cap (D3)', () => {
  it('clamps a 2×6 email union to MAX_MULTI_VALUES with target-first preference', () => {
    const targetValue = Array.from({ length: 6 }, (_, i) => `target${i}@x.com`)
    const sourceValues = [Array.from({ length: 6 }, (_, i) => `source${i}@x.com`)]

    const result = mergeFieldValue({ targetValue, sourceValues, ...MULTI_EMAIL })

    const merged = result.value as string[]
    expect(merged).toHaveLength(MAX_MULTI_VALUES)
    // Target values were pushed first, so the clamp drops SOURCE overflow:
    // all 6 target values survive, and the target's primary stays index 0.
    expect(merged.slice(0, 6)).toEqual(targetValue)
    expect(merged[0]).toBe('target0@x.com')
    expect(merged.slice(6)).toEqual(sourceValues[0]!.slice(0, 4))
    expect(result.wasModified).toBe(true)
  })

  it('clamps after dedupe, not before — duplicates do not eat cap slots', () => {
    const targetValue = Array.from({ length: 5 }, (_, i) => `target${i}@x.com`)
    // First 5 source values duplicate the target (different case), then 5 new.
    const sourceValues = [
      [
        ...targetValue.map((v) => v.toUpperCase()),
        ...Array.from({ length: 5 }, (_, i) => `source${i}@x.com`),
      ],
    ]

    const result = mergeFieldValue({ targetValue, sourceValues, ...MULTI_EMAIL })

    const merged = result.value as string[]
    expect(merged).toHaveLength(MAX_MULTI_VALUES)
    expect(merged.slice(0, 5)).toEqual(targetValue)
    expect(merged.slice(5)).toEqual(sourceValues[0]!.slice(5))
  })

  it('dedupes EMAIL case-insensitively, keeping the target casing', () => {
    const result = mergeFieldValue({
      targetValue: ['A@x.com'],
      sourceValues: [['a@x.com'], ['A@X.COM']],
      ...MULTI_EMAIL,
    })

    expect(result.value).toEqual(['A@x.com'])
    expect(result.wasModified).toBe(false)
  })

  it('keeps non-EMAIL multi dedupe case-sensitive', () => {
    const result = mergeFieldValue({
      targetValue: ['Alpha'],
      sourceValues: [['alpha']],
      fieldType: 'TEXT',
      fieldOptions: { multi: true },
    })

    expect(result.value).toEqual(['Alpha', 'alpha'])
    expect(result.wasModified).toBe(true)
  })

  it('preview parity: scalar-shaped store value merges to the same union as the server array shape', () => {
    // The server's batchGetValues always hands mergeFieldValue arrays for
    // options.multi fields; the client store may hold a single TypedFieldValue
    // for a one-value field. `formatToRawValue` with fieldOptions wraps that
    // scalar so both paths merge identical shapes.
    const typed = (value: string): TypedFieldValueInput => ({ type: 'text', value })
    const fieldOptions = { multi: true }

    const clientTarget = formatToRawValue(typed('primary@x.com'), 'EMAIL', fieldOptions)
    const serverTarget = formatToRawValue([typed('primary@x.com')], 'EMAIL', fieldOptions)
    expect(clientTarget).toEqual(serverTarget)

    const sources = [
      formatToRawValue([typed('alias@x.com'), typed('PRIMARY@x.com')], 'EMAIL', fieldOptions),
    ]

    const viaClient = mergeFieldValue({
      targetValue: clientTarget,
      sourceValues: sources,
      fieldType: 'EMAIL',
      fieldOptions,
    })
    const viaServer = mergeFieldValue({
      targetValue: serverTarget,
      sourceValues: sources,
      fieldType: 'EMAIL',
      fieldOptions,
    })

    expect(viaClient.value).toEqual(['primary@x.com', 'alias@x.com'])
    expect(viaClient).toEqual(viaServer)
  })
})
