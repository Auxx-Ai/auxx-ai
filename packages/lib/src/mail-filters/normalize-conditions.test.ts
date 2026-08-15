// packages/lib/src/mail-filters/normalize-conditions.test.ts

import { describe, expect, it } from 'vitest'
import type { ConditionGroup } from '../conditions/types'
import { normalizePhoneConditionValues } from './normalize-conditions'

function groups(
  fieldId: string,
  operator: string,
  value: unknown,
  second?: { fieldId: string; operator: string; value: unknown }
): ConditionGroup[] {
  return [
    {
      id: 'g1',
      logicalOperator: 'AND',
      conditions: [
        { id: 'c1', fieldId, operator: operator as never, value },
        ...(second
          ? [
              {
                id: 'c2',
                fieldId: second.fieldId,
                operator: second.operator as never,
                value: second.value,
              },
            ]
          : []),
      ],
    },
  ]
}

const firstValue = (result: ConditionGroup[]) => result[0]?.conditions[0]?.value

describe('normalizePhoneConditionValues', () => {
  it('rewrites a national-format number to E.164 on an exact operator', () => {
    // The whole point: ingest stores `+15102055536`, so the raw typed value
    // saves fine, previews 0 and never fires — with nothing in the logs.
    expect(firstValue(normalizePhoneConditionValues(groups('from', 'is', '(510) 205-5536')))).toBe(
      '+15102055536'
    )
  })

  it('normalizes on every exact operator and every address field', () => {
    for (const fieldId of ['from', 'to', 'sender']) {
      for (const operator of ['is', 'is not', 'in', 'not in']) {
        expect(
          firstValue(normalizePhoneConditionValues(groups(fieldId, operator, '510-205-5536'))),
          `${fieldId} ${operator}`
        ).toBe('+15102055536')
      }
    }
  })

  it('leaves an already-normalized number untouched', () => {
    expect(firstValue(normalizePhoneConditionValues(groups('from', 'is', '+15102055536')))).toBe(
      '+15102055536'
    )
  })

  it('keeps an international number in its own country code', () => {
    expect(firstValue(normalizePhoneConditionValues(groups('to', 'is', '+49 30 901820')))).toBe(
      '+4930901820'
    )
  })

  it('leaves FRAGMENT operators verbatim — `starts with +1510` is an area-code rule', () => {
    for (const operator of ['contains', 'not contains', 'starts with', 'ends with']) {
      expect(
        firstValue(normalizePhoneConditionValues(groups('from', operator, '+1510'))),
        operator
      ).toBe('+1510')
    }
  })

  it('leaves email addresses and opaque handles alone', () => {
    expect(firstValue(normalizePhoneConditionValues(groups('from', 'is', 'ada@acme.com')))).toBe(
      'ada@acme.com'
    )
    expect(firstValue(normalizePhoneConditionValues(groups('from', 'is', '61540983712345')))).toBe(
      '61540983712345'
    )
  })

  it('leaves non-address fields alone even when the value looks like a number', () => {
    expect(
      firstValue(normalizePhoneConditionValues(groups('subject', 'is', '(510) 205-5536')))
    ).toBe('(510) 205-5536')
  })

  it('normalizes each member of a multi-value condition independently', () => {
    const result = normalizePhoneConditionValues(
      groups('from', 'in', ['(510) 205-5536', 'ada@acme.com', '+4930901820'])
    )
    expect(firstValue(result)).toEqual(['+15102055536', 'ada@acme.com', '+4930901820'])
  })

  it('leaves every other condition in the group untouched', () => {
    const result = normalizePhoneConditionValues(
      groups('from', 'is', '(510) 205-5536', {
        fieldId: 'subject',
        operator: 'contains',
        value: 'invoice',
      })
    )
    expect(result[0]?.conditions[1]).toEqual({
      id: 'c2',
      fieldId: 'subject',
      operator: 'contains',
      value: 'invoice',
    })
  })

  it('does not mutate the input', () => {
    const input = groups('from', 'is', '(510) 205-5536')
    const before = JSON.stringify(input)
    normalizePhoneConditionValues(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
