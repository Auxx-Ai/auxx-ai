// packages/lib/src/field-values/ai-autofill/__tests__/reference-resolver.test.ts

import { fieldRefToKey, toResourceFieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'

vi.mock('../../field-value-helpers', () => ({
  getField: vi.fn(),
  batchGetRelatedDisplayNames: vi.fn(),
}))
vi.mock('../../field-value-queries', () => ({
  batchGetValues: vi.fn(),
}))
vi.mock('../../calc-resolver', () => ({
  resolveCalcForRecord: vi.fn(),
}))

import { resolveCalcForRecord } from '../../calc-resolver'
import { batchGetRelatedDisplayNames, getField } from '../../field-value-helpers'
import { batchGetValues } from '../../field-value-queries'
import { resolveReferences } from '../reference-resolver'

const mockedGetField = getField as unknown as ReturnType<typeof vi.fn>
const mockedBatchGetValues = batchGetValues as unknown as ReturnType<typeof vi.fn>
const mockedBatchGetRelatedDisplayNames = batchGetRelatedDisplayNames as unknown as ReturnType<
  typeof vi.fn
>
const mockedResolveCalcForRecord = resolveCalcForRecord as unknown as ReturnType<typeof vi.fn>

const ctx = {
  db: {} as any,
  organizationId: 'org-1',
  fieldCache: new Map(),
} as any

const recordId = toRecordId('contact', 'rec-1')

describe('resolveReferences', () => {
  beforeEach(() => {
    mockedGetField.mockReset()
    mockedBatchGetValues.mockReset()
    mockedBatchGetRelatedDisplayNames.mockReset()
    mockedResolveCalcForRecord.mockReset()

    // Default: nothing is an AI field
    mockedGetField.mockResolvedValue({ id: 'x', type: 'TEXT', options: null })
  })

  it('resolves a CALC reference to its computed display value', async () => {
    mockedBatchGetValues.mockResolvedValueOnce({
      values: [
        {
          recordId,
          fieldRef: toResourceFieldId('contact', 'calc-1'),
          value: null,
          fieldType: 'CALC',
        },
      ],
    })
    mockedResolveCalcForRecord.mockResolvedValueOnce({
      value: 42,
      display: '$42.00',
      resultFieldType: 'CURRENCY',
    })

    const out = await resolveReferences(ctx, { recordId, fieldKeys: ['calc-1'] })
    expect(out.get('calc-1')?.displayValue).toBe('$42.00')
    expect(out.get('calc-1')?.fieldType).toBe('CURRENCY')
    expect(mockedResolveCalcForRecord).toHaveBeenCalledWith(ctx, {
      recordId,
      calcFieldId: 'calc-1',
    })
  })

  it('resolves a top-level RELATIONSHIP to displayName', async () => {
    mockedBatchGetValues.mockResolvedValueOnce({
      values: [
        {
          recordId,
          fieldRef: toResourceFieldId('contact', 'rel-company'),
          // formatToDisplayValue for relationship returns the RecordId string
          value: { type: 'relationship', recordId: 'company:abc123' },
          fieldType: 'RELATIONSHIP',
        },
      ],
    })
    mockedBatchGetRelatedDisplayNames.mockResolvedValueOnce(new Map([['abc123', 'Acme Corp']]))

    const out = await resolveReferences(ctx, { recordId, fieldKeys: ['rel-company'] })
    expect(out.get('rel-company')?.displayValue).toBe('Acme Corp')
  })

  it('joins has_many RELATIONSHIP displayNames with comma', async () => {
    mockedBatchGetValues.mockResolvedValueOnce({
      values: [
        {
          recordId,
          fieldRef: toResourceFieldId('contact', 'rel-tags'),
          value: [
            { type: 'relationship', recordId: 'tag:t1' },
            { type: 'relationship', recordId: 'tag:t2' },
          ],
          fieldType: 'RELATIONSHIP',
        },
      ],
    })
    mockedBatchGetRelatedDisplayNames.mockResolvedValueOnce(
      new Map([
        ['t1', 'VIP'],
        ['t2', 'Newsletter'],
      ])
    )

    const out = await resolveReferences(ctx, { recordId, fieldKeys: ['rel-tags'] })
    expect(out.get('rel-tags')?.displayValue).toBe('VIP, Newsletter')
  })

  it('resolves a multi-hop FieldPath key (a:b::c:d)', async () => {
    const pathKey = fieldRefToKey([
      toResourceFieldId('contact', 'rel-company'),
      toResourceFieldId('company', 'industry'),
    ])

    mockedBatchGetValues.mockResolvedValueOnce({
      values: [
        {
          recordId,
          fieldRef: [
            toResourceFieldId('contact', 'rel-company'),
            toResourceFieldId('company', 'industry'),
          ],
          value: { type: 'text', value: 'Manufacturing' },
          fieldType: 'TEXT',
        },
      ],
    })

    const out = await resolveReferences(ctx, { recordId, fieldKeys: [pathKey] })
    expect(out.get(pathKey)?.displayValue).toBe('Manufacturing')
    expect(out.get(pathKey)?.fieldType).toBe('TEXT')
  })

  it('returns empty string for unresolvable refs', async () => {
    mockedBatchGetValues.mockResolvedValueOnce({ values: [] })
    const out = await resolveReferences(ctx, { recordId, fieldKeys: ['missing'] })
    expect(out.get('missing')?.displayValue).toBe('')
    expect(out.get('missing')?.fieldType).toBeNull()
  })

  it('passes plain fieldId through scoped to record entity', async () => {
    mockedBatchGetValues.mockResolvedValueOnce({
      values: [
        {
          recordId,
          fieldRef: toResourceFieldId('contact', 'email'),
          value: { type: 'text', value: 'a@b.com' },
          fieldType: 'EMAIL',
        },
      ],
    })

    const out = await resolveReferences(ctx, { recordId, fieldKeys: ['email'] })
    expect(out.get('email')?.displayValue).toBe('a@b.com')
  })
})
