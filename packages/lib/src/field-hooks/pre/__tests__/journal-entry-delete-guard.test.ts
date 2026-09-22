// packages/lib/src/field-hooks/pre/__tests__/journal-entry-delete-guard.test.ts
//
// The generic `record.delete` reaches a journal entry by id (91 D5): an unposted,
// lines-bearing entry deletes - its lines go through the cascade - and a posted or
// reversed one is refused, naming reversal.

import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ postingStatus: null as string | null }))

vi.mock('@auxx/database', () => ({ database: {} }))
vi.mock('../../../accounting/ledger/reads/read-posting', () => ({
  readPostingHeader: async () => (h.postingStatus ? { status: h.postingStatus } : null),
}))

import { ConflictError } from '../../../errors'
import type { EntityPreDeleteEvent } from '../../types'
import { guardJournalEntryDelete } from '../journal-entry-delete-guard'

function event(values: Record<string, unknown>): EntityPreDeleteEvent {
  return {
    recordId: 'def_je:je_1' as RecordId,
    entityDefinitionId: 'def_je',
    entityType: 'journal_entry',
    entitySlug: 'journal-entries',
    values: { journal_entry_number: ['JNL-0007'], journal_entry_lines: ['l1', 'l2'], ...values },
    organizationId: 'org_1',
    userId: 'user_1',
    bypass: new Set(),
  }
}

beforeEach(() => {
  h.postingStatus = null
})

describe('guardJournalEntryDelete', () => {
  it('lets an unposted entry with lines through', async () => {
    await expect(guardJournalEntryDelete(event({}))).resolves.toBeUndefined()
  })

  it('lets through a pointer whose posting is gone (a reset ledger)', async () => {
    await expect(
      guardJournalEntryDelete(event({ journal_entry_gl_posting_id: ['post_gone'] }))
    ).resolves.toBeUndefined()
  })

  it.each(['posted', 'reversed'])('refuses a %s entry, naming reversal', async (status) => {
    h.postingStatus = status
    const attempt = guardJournalEntryDelete(event({ journal_entry_gl_posting_id: ['post_1'] }))
    await expect(attempt).rejects.toThrow(ConflictError)
    await expect(
      guardJournalEntryDelete(event({ journal_entry_gl_posting_id: ['post_1'] }))
    ).rejects.toThrow(/JNL-0007 is .* and cannot be deleted/)
  })
})
