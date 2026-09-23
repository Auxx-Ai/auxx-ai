// packages/lib/src/accounting/sales/credit-memos/__tests__/input-wake.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  wakeSources: vi.fn(async (_db: unknown, _org: string, _input: unknown) => ({
    isErr: () => false,
  })),
}))

vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/database')>()),
  database: {},
}))
vi.mock('../../../work-items/wake', () => ({ wakeSources: h.wakeSources }))

import type { FieldChangeRef } from '../../../../field-hooks/types'
import { wakeIssueOnMoneyPendingChange } from '../input-wake'

const ref = (systemAttribute: string, newValue?: unknown) =>
  ({
    recordId: 'def_cm:cm_1',
    organizationId: 'org_1',
    userId: 'user_1',
    field: { systemAttribute },
    newValue,
  }) as unknown as FieldChangeRef

beforeEach(() => vi.clearAllMocks())

describe('wakeIssueOnMoneyPendingChange (101 E9)', () => {
  it("wakes the memo's issue work when the money settles", async () => {
    await wakeIssueOnMoneyPendingChange(ref('credit_memo_money_pending', false))

    expect(h.wakeSources).toHaveBeenCalledWith(expect.anything(), 'org_1', {
      sourceKind: 'credit_memo',
      sourceIds: ['cm_1'],
      stage: 'issue',
    })
  })

  it('wakes on the sync lane, where the value is not carried', async () => {
    await wakeIssueOnMoneyPendingChange(ref('credit_memo_money_pending'))

    expect(h.wakeSources).toHaveBeenCalledOnce()
  })

  it('stands down when the flag was set, and on any other field', async () => {
    await wakeIssueOnMoneyPendingChange(ref('credit_memo_money_pending', true))
    await wakeIssueOnMoneyPendingChange(ref('credit_memo_note', 'x'))

    expect(h.wakeSources).not.toHaveBeenCalled()
  })
})
