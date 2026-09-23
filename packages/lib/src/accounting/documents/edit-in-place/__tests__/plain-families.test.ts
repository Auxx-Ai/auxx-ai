// packages/lib/src/accounting/documents/edit-in-place/__tests__/plain-families.test.ts
//
// The lane through the three families with no ledger (66 U5/U7): Edit opens on
// a locked document only, Save closes the edit and posts nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: { status: 'sent', label: 'Q-0007' } as { status: string; label: string } | null,
  editStamp: null as { openedAt: string; byUserId: string } | null,
  captureRecordSnapshot: vi.fn(async (_db: unknown, _input: unknown) => ({
    openedAt: '2026-09-22',
    byUserId: 'user_1',
  })),
  deleteEditSnapshot: vi.fn(),
  publishRecordEditStamp: vi.fn(),
  reverseEntry: vi.fn(),
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../../database/src/db/schema/index')
  const enums = await import('../../../../../../database/src/enums')
  return { schema, ...enums, database: {}, withAccountingCommitLock: vi.fn(async () => {}) }
})
vi.mock('../../../../cache', () => ({ getCachedEntityDefId: async () => 'def_1' }))
vi.mock('../../../../entity-instances/edit-snapshot', () => ({
  readEditStamp: async () => h.editStamp,
  captureRecordSnapshot: h.captureRecordSnapshot,
  restoreRecordSnapshot: vi.fn(),
  deleteEditSnapshot: h.deleteEditSnapshot,
  publishRecordEditStamp: h.publishRecordEditStamp,
}))
vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../lock-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lock-state')>()),
  readDocumentLockState: async () => h.state,
}))

import type { Database } from '@auxx/database'
import { BadRequestError } from '../../../../errors'
import { openDocumentEdit } from '../open'
import { saveDocumentEdit } from '../save'

const db = {} as Database
const input = (family: 'quote' | 'purchase_order' | 'order') => ({
  organizationId: 'org_1',
  userId: 'user_1',
  family,
  entityInstanceId: 'ei_1',
})

beforeEach(() => {
  vi.clearAllMocks()
  h.state = { status: 'sent', label: 'Q-0007' }
  h.editStamp = null
})

describe('Edit', () => {
  it('opens a sent quote, an issued purchase order and a shipped order', async () => {
    for (const [family, status] of [
      ['quote', 'sent'],
      ['purchase_order', 'issued'],
      ['order', 'shipped'],
    ] as const) {
      h.state = { status, label: 'N-1' }
      await openDocumentEdit(db, input(family))
    }
    expect(h.captureRecordSnapshot).toHaveBeenCalledTimes(3)
    expect(h.captureRecordSnapshot.mock.calls[2]?.[1]).toMatchObject({
      children: ['lineItems', 'taxLines'],
    })
  })

  it.each([
    ['quote', 'draft', 'already editable'],
    ['quote', 'approved', 'has been approved'],
    ['purchase_order', 'closed', 'is not edited'],
    ['order', 'open', 'already editable'],
    ['order', 'synced', 'managed by its sales channel'],
    ['order', 'cancelled', 'cancelled'],
  ] as const)('refuses a %s that is %s', async (family, status, words) => {
    h.state = { status, label: 'N-1' }
    const error = await openDocumentEdit(db, input(family)).catch((e) => e)
    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toContain(words)
    expect(h.captureRecordSnapshot).not.toHaveBeenCalled()
  })
})

describe('Save', () => {
  it('closes the edit and touches no ledger', async () => {
    h.editStamp = { openedAt: '2026-09-22', byUserId: 'user_1' }
    const result = await saveDocumentEdit(db, input('quote'))
    expect(result).toEqual({ outcome: 'saved', docNumber: null, edit: null })
    expect(h.deleteEditSnapshot).toHaveBeenCalledWith(db, 'org_1', 'ei_1')
    expect(h.publishRecordEditStamp).toHaveBeenCalledWith(expect.objectContaining({ edit: null }))
    expect(h.reverseEntry).not.toHaveBeenCalled()
  })

  it('refuses when no edit is open', async () => {
    await expect(saveDocumentEdit(db, input('order'))).rejects.toThrow('Press Edit first')
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })
})
