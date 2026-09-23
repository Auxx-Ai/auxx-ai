// packages/lib/src/inventory/costing/__tests__/cost-writer.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ inserted: [] as unknown[] }))

vi.mock('@auxx/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@auxx/database')>()
  return {
    ...actual,
    database: {
      execute: vi.fn(async () => {}),
      insert: () => ({
        values: (rows: unknown[]) => {
          h.inserted.push(...rows)
          return { onConflictDoUpdate: async () => {} }
        },
      }),
    },
  }
})

import type { RecordId } from '@auxx/types/resource'
import { writeCostValues } from '../cost-writer'

beforeEach(() => {
  h.inserted = []
})

describe('writeCostValues - first insert of a RATE field', () => {
  it('stores a sub-cent cost at the field precision rather than rejecting it at 2 places', async () => {
    await writeCostValues('org_1', 'part_def', [
      {
        recordId: 'part_def:part_1' as RecordId,
        fieldId: 'f_part_cost',
        fieldType: 'CURRENCY',
        value: { type: 'number', value: 1423.2 },
        rowId: null,
        currencyOptions: { decimals: 5, currencyCode: 'USD' },
      },
      {
        recordId: 'part_def:part_1' as RecordId,
        fieldId: 'f_part_cost_source',
        fieldType: 'SINGLE_SELECT',
        value: { type: 'option', optionId: 'vendor' },
        rowId: null,
      },
    ])

    expect(h.inserted).toEqual([
      expect.objectContaining({ fieldId: 'f_part_cost', valueNumber: 1423.2 }),
      expect.objectContaining({ fieldId: 'f_part_cost_source', optionId: 'vendor' }),
    ])
  })
})
