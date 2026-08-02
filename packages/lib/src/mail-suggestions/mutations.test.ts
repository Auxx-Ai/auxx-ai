// packages/lib/src/mail-suggestions/mutations.test.ts
// The write path: a rerun UPSERTS evidence rather than duplicating the card, a
// decided row is never reopened by that upsert, and dismissal is a ROW.
//
// Hand-rolled `db` — these functions take `db` as their first parameter, so
// nothing here needs the database module replaced (the shared `src/test/setup.ts`
// proxy stays in place, per the lib-test rule about never fully replacing
// `@auxx/database`).

import { describe, expect, it, vi } from 'vitest'
import {
  dismissMailSuggestion,
  markMailSuggestionAccepted,
  pruneStaleMailSuggestions,
  upsertMailSuggestion,
} from './mutations'
import type { MailSuggestionDraft } from './types'

const draft: MailSuggestionDraft = {
  inboxId: 'ibx_1',
  userId: null,
  kind: 'unsubscribe',
  subjectKey: 'list:news.acme.com',
  evidence: {
    windowDays: 90,
    messageCount: 34,
    threadCount: 12,
    unreadRate: 1,
    manualArchiveRate: 0,
    everReplied: false,
    sampleThreadIds: [],
    unsubscribeMethod: 'one-click',
    listId: 'news.acme.com',
    senderDomain: 'acme.com',
    senderAuthenticated: true,
    historyDays: 60,
    filteredThreadCount: 0,
  },
  proposedConditions: [],
  proposedActions: [{ type: 'set-status', status: 'ARCHIVED' }],
  score: 34,
}

const row = {
  id: 'sug_1',
  organizationId: 'org_1',
  inboxId: 'ibx_1',
  userId: null,
  kind: 'unsubscribe',
  subjectKey: 'list:news.acme.com',
  evidence: draft.evidence,
  proposedConditions: [],
  proposedActions: draft.proposedActions,
  status: 'new',
  dismissedAt: null,
  acceptedAt: null,
  acceptedFilterId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

/** `.set(values)` spy whose recorded argument stays typed for the assertions. */
function updateSpy() {
  return vi.fn((_values: Record<string, unknown>) => ({
    where: () => ({ returning: async () => [row] }),
  }))
}

function insertDb(returned: unknown[]) {
  const calls: { onConflict?: Record<string, unknown> } = {}
  const chain = {
    values: vi.fn(() => chain),
    onConflictDoUpdate: vi.fn((config: Record<string, unknown>) => {
      calls.onConflict = config
      return chain
    }),
    returning: vi.fn(async () => returned),
  }
  return { db: { insert: vi.fn(() => chain) } as never, chain, calls }
}

describe('upsertMailSuggestion — a rerun refreshes, never duplicates', () => {
  it('conflicts on the full five-column key so the weekly sweep updates in place', async () => {
    const { db, calls } = insertDb([row])
    const result = await upsertMailSuggestion(db, 'org_1', draft)

    expect(result.isOk()).toBe(true)
    // (organizationId, inboxId, userId, kind, subjectKey) — declared NULLS NOT
    // DISTINCT on the table so the org-level (userId IS NULL) shared-inbox rows
    // collapse too. A shorter target would duplicate every shared card weekly.
    expect((calls.onConflict?.target as unknown[]).length).toBe(5)
  })

  it('refreshes only evidence and the proposal — never status', async () => {
    const { db, calls } = insertDb([row])
    await upsertMailSuggestion(db, 'org_1', draft)
    const set = calls.onConflict?.set as Record<string, unknown>
    expect(Object.keys(set).sort()).toEqual([
      'evidence',
      'proposedActions',
      'proposedConditions',
      'updatedAt',
    ])
    expect(set).not.toHaveProperty('status')
    expect(set).not.toHaveProperty('dismissedAt')
  })

  it('guards the UPDATE with status = new so a decided row is untouched', async () => {
    const { db, calls } = insertDb([row])
    await upsertMailSuggestion(db, 'org_1', draft)
    // Without `setWhere` a rerun would rewrite a dismissed row's evidence and,
    // with it, any hope of the dismissal meaning anything (invariant 7).
    expect(calls.onConflict?.setWhere).toBeDefined()
  })

  it('returns null when the conflicting row was decided and left alone', async () => {
    const { db } = insertDb([])
    const result = await upsertMailSuggestion(db, 'org_1', draft)
    expect(result._unsafeUnwrap()).toBeNull()
  })
})

describe('pruneStaleMailSuggestions — the cap holds across runs', () => {
  it('deletes only `new` rows, and only ones this sweep did not re-propose', async () => {
    const where = vi.fn(async () => [{ id: 'a' }, { id: 'b' }])
    const chain = { where: vi.fn(() => ({ returning: where })) }
    const db = { delete: vi.fn(() => chain) } as never

    const result = await pruneStaleMailSuggestions(db, 'org_1', {
      inboxId: 'ibx_1',
      userId: null,
      keepSubjectKeys: ['list:a'],
    })

    expect(result._unsafeUnwrap()).toBe(2)
    expect(chain.where).toHaveBeenCalledTimes(1)
  })

  it('still runs when the sweep produced nothing — the whole inbox clears', async () => {
    const chain = { where: vi.fn(() => ({ returning: async () => [{ id: 'a' }] })) }
    const db = { delete: vi.fn(() => chain) } as never
    const result = await pruneStaleMailSuggestions(db, 'org_1', {
      inboxId: 'ibx_1',
      userId: 'usr_1',
      keepSubjectKeys: [],
    })
    expect(result._unsafeUnwrap()).toBe(1)
  })
})

describe('dismissMailSuggestion — a row, not a delete (invariant 7)', () => {
  it('writes status dismissed and never calls delete', async () => {
    const set = updateSpy()
    const del = vi.fn()
    const db = { update: vi.fn(() => ({ set })), delete: del } as never

    const result = await dismissMailSuggestion(db, 'org_1', 'sug_1')

    expect(result.isOk()).toBe(true)
    expect(del).not.toHaveBeenCalled()
    expect(set.mock.calls[0]?.[0]).toMatchObject({ status: 'dismissed' })
    expect(set.mock.calls[0]?.[0]).toHaveProperty('dismissedAt')
  })

  it('is a NotFound when the id is not in this org', async () => {
    const db = {
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    } as never
    const result = await dismissMailSuggestion(db, 'org_1', 'sug_missing')
    expect(result._unsafeUnwrapErr().message).toMatch(/not found/i)
  })
})

describe('markMailSuggestionAccepted', () => {
  it('records the filter the acceptance produced', async () => {
    const set = updateSpy()
    const db = { update: vi.fn(() => ({ set })) } as never
    await markMailSuggestionAccepted(db, 'org_1', 'sug_1', 'flt_9')
    expect(set.mock.calls[0]?.[0]).toMatchObject({
      status: 'accepted',
      acceptedFilterId: 'flt_9',
    })
  })
})
