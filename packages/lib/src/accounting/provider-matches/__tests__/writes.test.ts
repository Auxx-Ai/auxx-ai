// packages/lib/src/accounting/provider-matches/__tests__/writes.test.ts

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'

const state = vi.hoisted(() => ({
  entry: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  adopt: vi.fn(),
  workItem: vi.fn(),
}))

vi.mock('../adopt', () => ({ adoptVendorPayment: state.adopt }))
vi.mock('../../work-items/write', () => ({ upsertWorkItem: state.workItem }))
vi.mock('../../ledger/post/ledger-accepted', () => ({ didLedgerAccept: vi.fn() }))
vi.mock('../../ledger/post/reverse-entry', () => ({ reverseEntry: vi.fn() }))
vi.mock('../../ledger/reads/list-postings', () => ({ findLiveSubjectPosting: vi.fn() }))

import { acceptProviderMatch } from '../writes'

/** `select` answers the entry read, then the debit-total read; `update` records its `set`. */
function fakeDb(): Database {
  const answers = [() => (state.entry ? [state.entry] : []), () => [{ total: '12500' }]]
  let call = 0
  const select = () => {
    const rows = answers[call++]!()
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'limit']) chain[method] = () => chain
    // biome-ignore lint/suspicious/noThenProperty: a drizzle builder is thenable
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve)
    return chain
  }
  const update = () => ({
    set: (values: Record<string, unknown>) => {
      state.updates.push(values)
      return { where: async () => undefined }
    },
  })
  return { select, update } as unknown as Database
}

const input = { organizationId: 'org_1', entryId: 'entry_1', actorUserId: 'user_1' }

beforeEach(() => {
  state.entry = {
    id: 'entry_1',
    providerTxnType: 'Check',
    providerTxnId: '900',
    docNumber: '1042',
    txnDate: '2026-09-22',
    matchState: 'suggested',
    matchReason: 'pays_bill',
    matchedKind: 'vendor_bill',
    matchedId: 'bill_1',
  }
  state.updates = []
  state.adopt.mockReset()
  state.workItem.mockReset()
  state.workItem.mockResolvedValue(ok(undefined))
})

describe('accepting a pays_bill suggestion', () => {
  it('changes no ledger: asks for the bill to be paid there and settles on the bill', async () => {
    const result = await acceptProviderMatch(fakeDb(), input)
    expect(result.isOk()).toBe(true)
    expect(state.adopt).not.toHaveBeenCalled()
    expect(state.workItem).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      expect.objectContaining({
        sourceKind: 'provider_ledger_entry',
        sourceId: 'entry_1',
        reasonCode: 'PROVIDER_BILL_LEFT_OPEN',
        externalRef: 'Check 1042',
        detail: { matchedKind: 'vendor_bill', matchedId: 'bill_1' },
      })
    )
    expect(state.updates.at(-1)).toMatchObject({
      matchState: 'matched',
      matchReason: 'pays_bill',
      matchedKind: 'vendor_bill',
      matchedId: 'bill_1',
      matchedBy: 'user_1',
    })
  })

  it('leaves the suggestion open when the work item cannot be written', async () => {
    state.workItem.mockResolvedValue(err(new UnprocessableEntityError('no')))
    const result = await acceptProviderMatch(fakeDb(), input)
    expect(result.isErr()).toBe(true)
    expect(state.updates).toEqual([])
  })
})
