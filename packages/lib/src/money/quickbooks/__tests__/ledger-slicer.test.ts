// packages/lib/src/money/quickbooks/__tests__/ledger-slicer.test.ts
//
// QuickBooks' half of the slicer seam (brief 55 §4.9): the month walk, the
// cursor that carries its own range end, and Intuit's range echo.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveQuickbooksContext = vi.fn()
vi.mock('../invoke-quickbooks-tool', () => ({
  resolveQuickbooksContext: (...a: unknown[]) => resolveQuickbooksContext(...a),
}))

const { QUICKBOOKS_LEDGER_SLICER } = await import('../ledger-slicer')

const callTool = vi.fn()

function ledgerFor(from: string, to: string) {
  return { from, to, currency: 'USD', hasData: true, lines: [] }
}

beforeEach(() => {
  callTool.mockReset()
  resolveQuickbooksContext.mockReset()
  resolveQuickbooksContext.mockResolvedValue({ connected: true, context: { callTool } })
})

describe('the month walk', () => {
  it('reads the first month of the range and points at the next one', async () => {
    callTool.mockResolvedValueOnce(ledgerFor('2026-01-01', '2026-01-31'))

    const cursor = QUICKBOOKS_LEDGER_SLICER.firstCursor({ from: '2026-01-01', to: '2026-03-15' })
    const batch = await QUICKBOOKS_LEDGER_SLICER.fetchBatch('org_1', cursor)

    expect(callTool).toHaveBeenCalledWith('get_quickbooks_general_ledger', {
      from: '2026-01-01',
      to: '2026-01-31',
      accountingMethod: 'Accrual',
    })
    const value = batch._unsafeUnwrap()
    expect(value?.hasMore).toBe(true)
    // 🛑 The range end rides on the cursor: it is the only thing the core
    // persists, so a resumed chain has to be able to find its own end.
    expect(value?.nextCursor).toEqual({ kind: 'token', value: '2026-02-01..2026-03-15' })
  })

  it('clips the last month to the end of the range and reports no more', async () => {
    callTool.mockResolvedValueOnce(ledgerFor('2026-03-01', '2026-03-15'))

    const batch = await QUICKBOOKS_LEDGER_SLICER.fetchBatch('org_1', {
      kind: 'token',
      value: '2026-03-01..2026-03-15',
    })

    expect(callTool).toHaveBeenCalledWith('get_quickbooks_general_ledger', {
      from: '2026-03-01',
      to: '2026-03-15',
      accountingMethod: 'Accrual',
    })
    const value = batch._unsafeUnwrap()
    expect(value?.hasMore).toBe(false)
    expect(value?.nextCursor).toBeUndefined()
  })

  it('answers null when nothing is connected - never an empty batch', async () => {
    resolveQuickbooksContext.mockResolvedValue({ connected: false })

    const batch = await QUICKBOOKS_LEDGER_SLICER.fetchBatch('org_1', {
      kind: 'token',
      value: '2026-01-01..2026-01-31',
    })

    // An empty `lines` array reads as "the accountant posted nothing that
    // month", which is a real and ordinary state. Null says which.
    expect(batch._unsafeUnwrap()).toBeNull()
  })
})

describe('the range echo', () => {
  it('🛑 THROWS on a range the provider did not answer for', async () => {
    // Intuit silently ignores some date parameters. A narrower echo leaves a
    // hole in the ledger; a wider one applies the `missing` test over dates the
    // call did not cover. And it throws rather than returning `err`, because
    // `err` is the retriable channel and a relabelled range will relabel again.
    callTool.mockResolvedValueOnce(ledgerFor('2026-01-01', '2026-12-31'))

    await expect(
      QUICKBOOKS_LEDGER_SLICER.fetchBatch('org_1', {
        kind: 'token',
        value: '2026-01-01..2026-01-31',
      })
    ).rejects.toThrow('2026-01-01..2026-12-31')
  })
})

describe('an upstream failure', () => {
  it('comes back as `err`, which the source maps to a held cursor', async () => {
    callTool.mockRejectedValueOnce(new Error('socket hang up'))

    const batch = await QUICKBOOKS_LEDGER_SLICER.fetchBatch('org_1', {
      kind: 'token',
      value: '2026-01-01..2026-01-31',
    })

    expect(batch.isErr()).toBe(true)
    expect(batch._unsafeUnwrapErr().message).toContain('socket hang up')
  })
})
