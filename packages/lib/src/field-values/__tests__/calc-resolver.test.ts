// packages/lib/src/field-values/__tests__/calc-resolver.test.ts

import { toResourceFieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'

vi.mock('../field-value-helpers', () => ({
  getField: vi.fn(),
}))
vi.mock('../field-value-queries', () => ({
  batchGetValues: vi.fn(),
}))

import { resolveCalcForRecord } from '../calc-resolver'
import { getField } from '../field-value-helpers'
import { batchGetValues } from '../field-value-queries'

const mockedGetField = getField as unknown as ReturnType<typeof vi.fn>
const mockedBatchGetValues = batchGetValues as unknown as ReturnType<typeof vi.fn>

const ctx = {
  db: {} as any,
  organizationId: 'org-1',
  fieldCache: new Map(),
} as any

const recordId = toRecordId('order', 'rec-1')

describe('resolveCalcForRecord', () => {
  beforeEach(() => {
    mockedGetField.mockReset()
    mockedBatchGetValues.mockReset()
  })

  it('computes a direct CALC: add({a},{b}) with NUMBER sources', async () => {
    mockedGetField.mockResolvedValueOnce({
      id: 'calc-1',
      type: 'CALC',
      options: {
        calc: {
          expression: 'add({a}, {b})',
          sourceFields: { a: 'fid-a', b: 'fid-b' },
          resultFieldType: 'NUMBER',
        },
      },
    })
    mockedBatchGetValues.mockResolvedValueOnce({
      values: [
        {
          recordId,
          fieldRef: toResourceFieldId('order', 'fid-a'),
          value: { type: 'number', value: 1 },
          fieldType: 'NUMBER',
        },
        {
          recordId,
          fieldRef: toResourceFieldId('order', 'fid-b'),
          value: { type: 'number', value: 2 },
          fieldType: 'NUMBER',
        },
      ],
    })

    const result = await resolveCalcForRecord(ctx, { recordId, calcFieldId: 'calc-1' })

    expect(result.value).toBe(3)
    expect(result.display).toBe('3')
    expect(result.resultFieldType).toBe('NUMBER')
  })

  it('returns blank for disabled CALC', async () => {
    mockedGetField.mockResolvedValueOnce({
      id: 'calc-2',
      type: 'CALC',
      options: {
        calc: {
          expression: 'add({a},{b})',
          sourceFields: { a: 'fid-a', b: 'fid-b' },
          resultFieldType: 'NUMBER',
          disabled: true,
        },
      },
    })

    const result = await resolveCalcForRecord(ctx, { recordId, calcFieldId: 'calc-2' })
    expect(result.display).toBe('')
    expect(result.value).toBeNull()
  })

  it('returns blank for non-CALC field', async () => {
    mockedGetField.mockResolvedValueOnce({
      id: 'fid-a',
      type: 'NUMBER',
      options: {},
    })

    const result = await resolveCalcForRecord(ctx, { recordId, calcFieldId: 'fid-a' })
    expect(result.display).toBe('')
    expect(result.value).toBeNull()
    expect(result.resultFieldType).toBeNull()
  })

  it('caps recursion at MAX_CALC_DEPTH', async () => {
    const result = await resolveCalcForRecord(ctx, { recordId, calcFieldId: 'calc-deep' }, 99)
    expect(result.display).toBe('')
    expect(result.value).toBeNull()
  })

  it('resolves nested CALC → CALC → NUMBER', async () => {
    // Outer calc references inner-calc as source `a`
    mockedGetField.mockImplementation(async (_ctx: any, fieldId: string) => {
      if (fieldId === 'outer-calc') {
        return {
          id: 'outer-calc',
          type: 'CALC',
          options: {
            calc: {
              expression: 'add({a}, {b})',
              sourceFields: { a: 'inner-calc', b: 'fid-b' },
              resultFieldType: 'NUMBER',
            },
          },
        }
      }
      if (fieldId === 'inner-calc') {
        return {
          id: 'inner-calc',
          type: 'CALC',
          options: {
            calc: {
              expression: 'multiply({x}, {y})',
              sourceFields: { x: 'fid-x', y: 'fid-y' },
              resultFieldType: 'NUMBER',
            },
          },
        }
      }
      throw new Error(`unexpected getField: ${fieldId}`)
    })

    mockedBatchGetValues.mockImplementation(async (_ctx: any, params: any) => {
      const refs = params.fieldReferences as string[]
      // Outer calc batch
      if (refs.includes(toResourceFieldId('order', 'inner-calc'))) {
        return {
          values: [
            {
              recordId,
              fieldRef: toResourceFieldId('order', 'inner-calc'),
              value: null,
              fieldType: 'CALC',
            },
            {
              recordId,
              fieldRef: toResourceFieldId('order', 'fid-b'),
              value: { type: 'number', value: 4 },
              fieldType: 'NUMBER',
            },
          ],
        }
      }
      // Inner calc batch
      return {
        values: [
          {
            recordId,
            fieldRef: toResourceFieldId('order', 'fid-x'),
            value: { type: 'number', value: 3 },
            fieldType: 'NUMBER',
          },
          {
            recordId,
            fieldRef: toResourceFieldId('order', 'fid-y'),
            value: { type: 'number', value: 5 },
            fieldType: 'NUMBER',
          },
        ],
      }
    })

    const result = await resolveCalcForRecord(ctx, { recordId, calcFieldId: 'outer-calc' })
    // inner = 3 * 5 = 15; outer = 15 + 4 = 19
    expect(result.value).toBe(19)
    expect(result.display).toBe('19')
  })
})
