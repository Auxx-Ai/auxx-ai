// packages/lib/src/record-rules/capture-field-changes.test.ts
// Shared bulk-writer capture: subscribed-key intersection, output-key normalization
// (uuid AND systemAttribute write keys land under `systemAttribute ?? id` — the key the
// consumer looks rules up by), written-value normalization into the stored space,
// old-value read (update) vs none (create), zero-cost when unsubscribed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedFieldMap: vi.fn(),
  batchGetExistingFieldValues: vi.fn(),
  flattenTypedFieldValue: vi.fn((v: unknown) =>
    v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v
  ),
  createFieldValueContext: vi.fn(() => ({ batchRelationshipValidationCache: new Map() })),
  // Pass-through by default; individual tests override to simulate real normalization.
  validateAndConvertValue: vi.fn(async (_ctx: unknown, raw: unknown) => raw),
}))

vi.mock('../cache', () => ({ getCachedFieldMap: h.getCachedFieldMap }))
vi.mock('../field-values/batch-existing-values', () => ({
  batchGetExistingFieldValues: h.batchGetExistingFieldValues,
}))
vi.mock('../field-values/field-value-helpers', () => ({
  flattenTypedFieldValue: h.flattenTypedFieldValue,
  createFieldValueContext: h.createFieldValueContext,
  validateAndConvertValue: h.validateAndConvertValue,
}))

import { captureCreateFieldChanges, captureUpdateFieldChanges } from './capture-field-changes'

// fld_a: plain custom field (key===id, no systemAttribute); fld_email: system field.
function fieldMap() {
  return new Map<string, any>([
    ['fld_a', { id: 'fld_a', systemAttribute: null, type: 'TEXT', options: null }],
    ['fld_email', { id: 'fld_email', systemAttribute: 'email', type: 'TEXT', options: null }],
    ['fld_x', { id: 'fld_x', systemAttribute: null, type: 'TEXT', options: null }],
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getCachedFieldMap.mockResolvedValue(fieldMap())
  h.batchGetExistingFieldValues.mockResolvedValue(new Map())
  h.validateAndConvertValue.mockImplementation(async (_ctx: unknown, raw: unknown) => raw)
})

describe('captureUpdateFieldChanges', () => {
  it('returns null and issues no query when nothing subscribed', async () => {
    const out = await captureUpdateFieldChanges(
      {} as never,
      'org',
      'def',
      'i1',
      { fld_a: 'v' },
      new Set() // no subscriptions
    )
    expect(out).toBeNull()
    expect(h.batchGetExistingFieldValues).not.toHaveBeenCalled()
  })

  it('returns null when subscribed fields are not among the written keys', async () => {
    const out = await captureUpdateFieldChanges(
      {} as never,
      'org',
      'def',
      'i1',
      { fld_x: 'v' }, // written, but fld_x not subscribed
      new Set(['fld_a'])
    )
    expect(out).toBeNull()
    expect(h.batchGetExistingFieldValues).not.toHaveBeenCalled()
  })

  it('captures {o,n} for subscribed written fields, mapping systemAttribute → row id', async () => {
    h.batchGetExistingFieldValues.mockResolvedValue(
      new Map([
        [
          'i1',
          new Map([
            ['fld_a', 'old-a'],
            ['fld_email', 'old@e'],
          ]),
        ],
      ])
    )
    const out = await captureUpdateFieldChanges(
      {} as never,
      'org',
      'def',
      'i1',
      { fld_a: 'new-a', email: 'new@e', fld_x: 'ignored' },
      new Set(['fld_a', 'fld_email'])
    )
    expect(out).toEqual({
      fld_a: { o: 'old-a', n: 'new-a' },
      email: { o: 'old@e', n: 'new@e' }, // written by systemAttribute key, resolved to fld_email
    })
    // Only the two subscribed row ids were read.
    expect(h.batchGetExistingFieldValues).toHaveBeenCalledTimes(1)
    expect(h.batchGetExistingFieldValues.mock.calls[0]?.[2].sort()).toEqual(['fld_a', 'fld_email'])
  })

  // F1 regression: the connector sink keys its writeSet by the CustomField UUID even
  // for systemAttribute-carrying fields. The manifest entry must land under the
  // consumer's output key (`systemAttribute ?? id`), NOT the raw write key — this is
  // the test that would have caught the "native rules never fire on sync" bug.
  it('stores a uuid-keyed write of a system field under its systemAttribute output key', async () => {
    h.batchGetExistingFieldValues.mockResolvedValue(
      new Map([['i1', new Map([['fld_email', 'old@e']])]])
    )
    const out = await captureUpdateFieldChanges(
      {} as never,
      'org',
      'def',
      'i1',
      { fld_email: 'new@e' }, // written by UUID (the connector-sink key shape)
      new Set(['fld_email'])
    )
    expect(out).toEqual({ email: { o: 'old@e', n: 'new@e' } })
  })

  // F4: `n` is run through the write path's validators into the stored value space.
  it('normalizes the written value through validateAndConvertValue', async () => {
    h.validateAndConvertValue.mockImplementation(async () => ({
      type: 'date',
      value: '2026-07-01T00:00:00.000Z',
    }))
    h.batchGetExistingFieldValues.mockResolvedValue(new Map([['i1', new Map()]]))
    const out = await captureUpdateFieldChanges(
      {} as never,
      'org',
      'def',
      'i1',
      { fld_a: '2026-07-01' },
      new Set(['fld_a'])
    )
    expect(out).toEqual({ fld_a: { o: null, n: '2026-07-01T00:00:00.000Z' } })
  })

  it('falls back to the raw value when normalization rejects it', async () => {
    h.validateAndConvertValue.mockRejectedValue(new Error('invalid'))
    h.batchGetExistingFieldValues.mockResolvedValue(new Map([['i1', new Map()]]))
    const out = await captureUpdateFieldChanges(
      {} as never,
      'org',
      'def',
      'i1',
      { fld_a: 'not-a-date' },
      new Set(['fld_a'])
    )
    expect(out).toEqual({ fld_a: { o: null, n: 'not-a-date' } })
  })
})

describe('captureCreateFieldChanges', () => {
  it('captures subscribed written fields with no o, no DB read', async () => {
    const out = await captureCreateFieldChanges(
      'org',
      'def',
      { fld_a: 'v', email: 'e', fld_x: 'skip' },
      new Set(['fld_a', 'fld_email'])
    )
    expect(out).toEqual({ fld_a: { n: 'v' }, email: { n: 'e' } })
    expect(h.batchGetExistingFieldValues).not.toHaveBeenCalled()
  })

  it('stores uuid-keyed system-field writes under the systemAttribute output key', async () => {
    const out = await captureCreateFieldChanges(
      'org',
      'def',
      { fld_email: 'e' },
      new Set(['fld_email'])
    )
    expect(out).toEqual({ email: { n: 'e' } })
  })

  it('returns null when unsubscribed', async () => {
    expect(await captureCreateFieldChanges('org', 'def', { fld_a: 'v' }, new Set())).toBeNull()
  })
})
