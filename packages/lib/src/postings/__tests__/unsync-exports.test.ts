// packages/lib/src/postings/__tests__/unsync-exports.test.ts
//
// The five steps of plans/accounting/tasks/60-un-syncing-from-the-provider.md
// §5.1, and the two invariants that make un-sync safe:
//
// 🛑 E4, delete first and reset second. `saveWithdrawal` is the only writer of
// `exportStatus` here, and the assertion that it is NOT called on every refusing
// and every uncertain path is the point of this file. A row that says *held*
// while a copy still sits in the provider is how the same entry gets delivered
// twice.
//
// 🛑 §2.4, an unknown outcome changes nothing. Recovery is a readback, and the
// readback finding the copy already gone is what lets a second press finish the
// job without a second blind delete.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  readUnsyncTarget: vi.fn(),
  readRemoteJournal: vi.fn(),
  claimUnsyncOperation: vi.fn(),
  markUnsyncSending: vi.fn(),
  markUnsyncFailed: vi.fn(),
  saveWithdrawal: vi.fn(),
  resolveAccountingProvider: vi.fn(),
  withdrawObject: vi.fn(),
}))

vi.mock('../unsync/reads', () => ({
  readUnsyncTarget: h.readUnsyncTarget,
  readRemoteJournal: h.readRemoteJournal,
}))
vi.mock('../unsync/writes', () => ({
  claimUnsyncOperation: h.claimUnsyncOperation,
  markUnsyncSending: h.markUnsyncSending,
  markUnsyncFailed: h.markUnsyncFailed,
  saveWithdrawal: h.saveWithdrawal,
  unsyncOperationKey: (epoch: number) => `unsync:${epoch}`,
}))
vi.mock('../provider', () => ({ resolveAccountingProvider: h.resolveAccountingProvider }))

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { unsyncExports } from '../unsync'

const ORG = 'org_1'
const db = {} as Database

const target = (overrides: Record<string, unknown> = {}) => ({
  glPostingId: 'gl_a',
  docNumber: 'GL-2026-09-001',
  deliveryId: 'del_1',
  bookId: 'book_1',
  attemptEpoch: 0,
  objectId: 'obj_1',
  externalId: '184',
  remoteVersion: '3',
  ...overrides,
})

const operation = { id: 'op_1', organizationId: ORG, attempts: 0 }

function eligible(overrides: Record<string, unknown> = {}) {
  const value = target(overrides)
  h.readUnsyncTarget.mockResolvedValue({
    eligible: true,
    docNumber: value.docNumber,
    target: value,
  })
  return value
}

const run = (force?: boolean) =>
  unsyncExports(db, { organizationId: ORG, glPostingIds: ['gl_a'], ...(force ? { force } : {}) })

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveAccountingProvider.mockResolvedValue({
    id: 'quickbooks',
    withdrawObject: h.withdrawObject,
  })
  h.claimUnsyncOperation.mockResolvedValue({ kind: 'claimed', operation, token: 'lease_1' })
  h.readRemoteJournal.mockResolvedValue(
    ok({ present: true, remoteVersion: '3', raw: { id: '184' } })
  )
  h.withdrawObject.mockResolvedValue(
    ok({ status: 'withdrawn', externalId: '184', providerId: 'quickbooks' })
  )
  eligible()
})

describe('unsyncExports', () => {
  it('withdraws a delivered entry, proving absence before it resets anything', async () => {
    // The second readback answers absent, which is what authorizes step 5.
    h.readRemoteJournal
      .mockResolvedValueOnce(ok({ present: true, remoteVersion: '3', raw: { id: '184' } }))
      .mockResolvedValueOnce(ok({ present: false, remoteVersion: null, raw: null }))

    const result = await run()

    expect(result._unsafeUnwrap()).toMatchObject({ withdrawn: 1, refused: 0, failed: 0 })
    expect(h.withdrawObject).toHaveBeenCalledWith({
      orgId: ORG,
      objectType: 'journal',
      externalId: '184',
      remoteVersion: '3',
    })
    // Two reads around one delete: compare, then prove.
    expect(h.readRemoteJournal).toHaveBeenCalledTimes(2)
    expect(h.saveWithdrawal).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        deliveryId: 'del_1',
        glPostingId: 'gl_a',
        externalObjectId: 'obj_1',
        outcome: expect.objectContaining({ status: 'withdrawn' }),
      })
    )
    expect(h.markUnsyncFailed).not.toHaveBeenCalled()
  })

  it('keys the withdrawal at the epoch after the delivery’s own', async () => {
    eligible({ attemptEpoch: 2 })
    h.readRemoteJournal.mockResolvedValue(ok({ present: false, remoteVersion: null, raw: null }))

    await run()

    expect(h.claimUnsyncOperation).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ operationKey: 'unsync:3' })
    )
  })

  it('passes an eligibility refusal (R1-R4) through as the row’s reason', async () => {
    h.readUnsyncTarget.mockResolvedValue({
      eligible: false,
      docNumber: 'GL-2026-09-001',
      reason: 'GL-2026-09-001 was never sent, so there is nothing to remove.',
    })

    const result = await run()

    expect(result._unsafeUnwrap()).toMatchObject({ withdrawn: 0, refused: 1, failed: 0 })
    expect(result._unsafeUnwrap().outcomes[0]?.message).toContain('was never sent')
    // 🛑 E4: nothing was opened, nothing was sent, nothing was reset.
    expect(h.claimUnsyncOperation).not.toHaveBeenCalled()
    expect(h.withdrawObject).not.toHaveBeenCalled()
    expect(h.saveWithdrawal).not.toHaveBeenCalled()
  })

  it('R5: refuses an entry edited in the provider since we sent it, and says it is forcible', async () => {
    h.readRemoteJournal.mockResolvedValue(ok({ present: true, remoteVersion: '7', raw: {} }))

    const result = await run()

    const outcome = result._unsafeUnwrap().outcomes[0]
    expect(outcome).toMatchObject({ status: 'refused', forcible: true })
    expect(outcome?.message).toBe(
      'Somebody edited GL-2026-09-001 in QuickBooks after we sent it. Removing it discards that edit.'
    )
    expect(h.withdrawObject).not.toHaveBeenCalled()
    expect(h.saveWithdrawal).not.toHaveBeenCalled()
    expect(h.markUnsyncFailed).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ state: 'blocked' })
    )
  })

  it('R5: `force` completes it, sending the version just read and not the stored one', async () => {
    // 🛑 The stored `3` would be refused by the provider as stale; the whole
    // point of *Un-sync anyway* is to discard the edit, which needs `7`.
    h.readRemoteJournal
      .mockResolvedValueOnce(ok({ present: true, remoteVersion: '7', raw: {} }))
      .mockResolvedValueOnce(ok({ present: false, remoteVersion: null, raw: null }))

    const result = await run(true)

    expect(result._unsafeUnwrap()).toMatchObject({ withdrawn: 1 })
    expect(h.withdrawObject).toHaveBeenCalledWith(expect.objectContaining({ remoteVersion: '7' }))
  })

  it('R6: reports the provider’s own refusal verbatim and leaves the row alone', async () => {
    h.withdrawObject.mockResolvedValue(
      err(new UnprocessableEntityError('The period is closed in QuickBooks.'))
    )

    const result = await run()

    const value = result._unsafeUnwrap()
    expect(value).toMatchObject({ withdrawn: 0, refused: 1, failed: 0 })
    expect(value.outcomes[0]?.message).toBe('The period is closed in QuickBooks.')
    // A clean refusal removed nothing, so the operation is blocked, not uncertain.
    expect(h.markUnsyncFailed).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ state: 'blocked' })
    )
    expect(h.saveWithdrawal).not.toHaveBeenCalled()
  })

  it('§2.4: a delete of unknown outcome lands `uncertain` and changes nothing', async () => {
    h.withdrawObject.mockRejectedValue(new Error('Response timeout'))

    const result = await run()

    const value = result._unsafeUnwrap()
    expect(value).toMatchObject({ withdrawn: 0, refused: 0, failed: 1 })
    expect(value.outcomes[0]).toMatchObject({ status: 'uncertain', message: 'Response timeout' })
    expect(h.markUnsyncFailed).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ state: 'uncertain' })
    )
    // 🛑 The posting keeps its *Synced* badge: the copy may still be there.
    expect(h.saveWithdrawal).not.toHaveBeenCalled()
  })

  it('§2.4 recovery: a second press finds the copy gone and finishes without deleting again', async () => {
    h.readRemoteJournal.mockResolvedValue(ok({ present: false, remoteVersion: null, raw: null }))

    const result = await run()

    expect(result._unsafeUnwrap()).toMatchObject({ withdrawn: 1 })
    // 🛑 No second blind delete. The readback IS the recovery.
    expect(h.withdrawObject).not.toHaveBeenCalled()
    expect(h.markUnsyncSending).not.toHaveBeenCalled()
    expect(h.saveWithdrawal).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ outcome: expect.objectContaining({ status: 'already_gone' }) })
    )
  })

  it('treats a still-present copy after an accepted delete as uncertain, not as done', async () => {
    h.readRemoteJournal.mockResolvedValue(ok({ present: true, remoteVersion: '3', raw: {} }))

    const result = await run()

    expect(result._unsafeUnwrap().outcomes[0]?.status).toBe('uncertain')
    expect(h.saveWithdrawal).not.toHaveBeenCalled()
  })

  it('does not reset anything when the comparison read itself fails', async () => {
    h.readRemoteJournal.mockResolvedValue(err(new Error('QuickBooks is not connected')))

    const result = await run()

    expect(result._unsafeUnwrap()).toMatchObject({ withdrawn: 0, failed: 1 })
    expect(h.withdrawObject).not.toHaveBeenCalled()
    expect(h.saveWithdrawal).not.toHaveBeenCalled()
  })

  it('reports an entry another withdrawal already holds the lease on', async () => {
    h.claimUnsyncOperation.mockResolvedValue({ kind: 'busy' })

    const result = await run()

    expect(result._unsafeUnwrap().outcomes[0]?.message).toContain('already being removed')
    expect(h.withdrawObject).not.toHaveBeenCalled()
  })

  it('de-dupes the selection, so one entry is withdrawn once', async () => {
    h.readRemoteJournal.mockResolvedValue(ok({ present: false, remoteVersion: null, raw: null }))

    const result = await unsyncExports(db, {
      organizationId: ORG,
      glPostingIds: ['gl_a', 'gl_a'],
    })

    expect(result._unsafeUnwrap().withdrawn).toBe(1)
    expect(h.saveWithdrawal).toHaveBeenCalledTimes(1)
  })

  it('does not let one refusal stop the rest of the batch', async () => {
    // The case this exists for is a mapping wrong across hundreds of rows (E6).
    h.readUnsyncTarget
      .mockResolvedValueOnce({ eligible: false, docNumber: 'GL-a', reason: 'Refused.' })
      .mockResolvedValueOnce({
        eligible: true,
        docNumber: 'GL-b',
        target: target({ glPostingId: 'gl_b' }),
      })
    h.readRemoteJournal.mockResolvedValue(ok({ present: false, remoteVersion: null, raw: null }))

    const result = await unsyncExports(db, {
      organizationId: ORG,
      glPostingIds: ['gl_a', 'gl_b'],
    })

    expect(result._unsafeUnwrap()).toMatchObject({ withdrawn: 1, refused: 1, failed: 0 })
    expect(result._unsafeUnwrap().outcomes).toHaveLength(2)
  })

  it('never throws: a read that blows up is one row’s error, not the batch’s', async () => {
    h.readUnsyncTarget.mockRejectedValue(new Error('Lock timeout'))

    const result = await run()

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().outcomes[0]).toMatchObject({
      status: 'error',
      message: 'Lock timeout',
    })
  })
})
