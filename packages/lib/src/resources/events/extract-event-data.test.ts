// packages/lib/src/resources/events/extract-event-data.test.ts
//
// C5 pinning test (multi-email plan, LOCKED): outbound event/webhook payloads
// emit multi-value arrays VERBATIM — no scalar projection, no versioning
// dance. `extractEventData` must pass an `options.multi` field's array
// through untouched; a future "helpful" primary-only projection here would be
// a silent contract change for every webhook/app-trigger consumer.

import { describe, expect, it } from 'vitest'
import { extractEventData } from './extract-event-data'

const FIELDS = [
  { id: 'field-email-uuid', systemAttribute: 'primary_email' },
  { id: 'field-name-uuid', systemAttribute: 'first_name' },
  { id: 'field-no-attr-uuid', systemAttribute: null },
]

describe('extractEventData — multi-value arrays emit verbatim', () => {
  it('passes an array value through untouched (same reference, no projection)', () => {
    const emails = ['a@x.com', 'b@x.com']
    const eventData = extractEventData('contact', FIELDS, {
      'field-email-uuid': emails,
      'field-name-uuid': 'Ada',
    })

    expect(eventData.primary_email).toBe(emails)
    expect(eventData.primary_email).toEqual(['a@x.com', 'b@x.com'])
    expect(eventData.first_name).toBe('Ada')
  })

  it('keeps a one-element array as an array — the shape is not count-dependent', () => {
    const eventData = extractEventData('contact', FIELDS, {
      'field-email-uuid': ['a@x.com'],
    })

    expect(eventData.primary_email).toEqual(['a@x.com'])
  })

  it('resolves values keyed by systemAttribute as well as fieldId', () => {
    const eventData = extractEventData('contact', FIELDS, {
      primary_email: ['a@x.com', 'b@x.com'],
    })

    expect(eventData.primary_email).toEqual(['a@x.com', 'b@x.com'])
  })

  it('skips fields without a systemAttribute and undefined values', () => {
    const eventData = extractEventData('contact', FIELDS, {
      'field-no-attr-uuid': 'ignored',
    })

    expect(eventData).toEqual({})
  })
})
