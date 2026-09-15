// packages/lib/src/import/__tests__/execute-batch-bulk.test.ts
import { describe, expect, it, vi } from 'vitest'
import {
  type BatchRecord,
  type ExecuteBatchContext,
  executeBatch,
  orderedBulkCreateResults,
} from '../execution/execute-batch'

const records: BatchRecord[] = [0, 1, 2].map((rowIndex) => ({
  rowIndex,
  planRowId: `row-${rowIndex}`,
  data: { standardFields: { name: `row-${rowIndex}` }, customFields: {} },
}))
function context(over: Partial<ExecuteBatchContext> = {}): ExecuteBatchContext {
  return {
    organizationId: 'org',
    userId: 'user',
    entityDefinitionId: 'def',
    strategy: 'create',
    createRecord: vi.fn(async () => ({ id: 'fallback' })),
    updateRecord: vi.fn(async () => ({ id: 'updated' })),
    ...over,
  }
}
describe('import bulk per-row receipts', () => {
  it('restores original row order after a failed middle row', () => {
    expect(
      orderedBulkCreateResults(3, {
        created: [{ id: 'A' }, { id: 'C' }],
        errors: [{ index: 1, error: 'invalid' }],
      })
    ).toEqual([{ id: 'A' }, { error: 'invalid' }, { id: 'C' }])
  })
  it('reports missing receipts explicitly without guessing an identity', () => {
    expect(orderedBulkCreateResults(2, { created: [{ id: 'A' }], errors: [] })).toEqual([
      { id: 'A' },
      { error: 'Bulk create returned no result' },
    ])
  })
  it('retains committed successes when one row fails', async () => {
    const ctx = context({
      bulkCreate: async () => [{ id: 'A' }, { error: 'invalid' }, { id: 'C' }],
    })
    const result = await executeBatch(records, ctx)
    expect(result).toMatchObject({
      succeeded: 2,
      failed: 1,
      results: [
        { rowIndex: 0, instanceId: 'A' },
        { rowIndex: 1, success: false, error: 'invalid' },
        { rowIndex: 2, instanceId: 'C' },
      ],
    })
    expect(ctx.createRecord).not.toHaveBeenCalled()
  })
  it('uses ordinary row recovery after an atomic batch rejection', async () => {
    const ctx = context({
      bulkCreate: async () => {
        throw new Error('batch rolled back')
      },
    })
    expect(await executeBatch(records, ctx)).toMatchObject({ succeeded: 3, failed: 0 })
    expect(ctx.createRecord).toHaveBeenCalledTimes(3)
  })
  it('does not replay committed rows when progress delivery throws', async () => {
    const ctx = context({
      bulkCreate: async () => [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      onProgress: () => {
        throw new Error('progress failed')
      },
    })
    await expect(executeBatch(records, ctx)).rejects.toThrow('progress failed')
    expect(ctx.createRecord).not.toHaveBeenCalled()
  })
  it('updates remain ordinary record writes even if batch creation is available', async () => {
    const bulkCreate = vi.fn()
    const ctx = context({ strategy: 'update', bulkCreate })
    await executeBatch(
      records.map((r, index) => ({ ...r, existingRecordId: `existing-${index}` })),
      ctx
    )
    expect(bulkCreate).not.toHaveBeenCalled()
    expect(ctx.updateRecord).toHaveBeenCalledTimes(3)
  })
})
