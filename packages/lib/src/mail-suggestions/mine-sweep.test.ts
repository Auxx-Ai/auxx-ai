// packages/lib/src/mail-suggestions/mine-sweep.test.ts
// The per-inbox sweep: whose read state counts, whose `userId` the card carries,
// and that a group falling below threshold has its card retired rather than
// left behind (which is what makes the five-per-inbox cap hold across runs).
//
// `./queries` and `./mutations` are replaced — they are this module's OWN
// collaborators, not a shared infrastructure mock, so the lib-test rule about
// `@auxx/database` / `@auxx/logger` / `drizzle-orm` does not apply.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listSuppressed: vi.fn(),
  upsert: vi.fn(),
  prune: vi.fn(),
}))

vi.mock('./queries', () => ({ listSuppressedSubjectKeys: h.listSuppressed }))
vi.mock('./mutations', () => ({
  upsertMailSuggestions: h.upsert,
  pruneStaleMailSuggestions: h.prune,
}))

import { mineInboxSuggestions } from './mine'

const NOW = new Date('2026-08-01T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

const qualifyingRow = {
  subject_key: 'list:news.acme.com',
  list_id: 'news.acme.com',
  sender_domain: 'acme.com',
  message_count: 34,
  thread_count: 12,
  read_thread_count: 0,
  manual_archived_thread_count: 0,
  filtered_thread_count: 0,
  ever_replied: false,
  sender_authenticated: true,
  unsubscribe_meta: { httpUrl: 'https://acme.com/u', oneClick: true },
  first_seen_at: new Date(NOW.getTime() - 60 * DAY),
  last_seen_at: NOW,
  sample_thread_ids: ['thr_1'],
  top_tag_id: null,
  top_tag_thread_count: 0,
  top_assignee_id: null,
  top_assignee_thread_count: 0,
}

/** Hand-rolled `db` — `mineInboxSuggestions` only ever calls `execute` on it. */
function makeDb(rows: Record<string, unknown>[]) {
  const execute = vi.fn(async () => ({ rows }))
  return { db: { execute } as never, execute }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.listSuppressed.mockResolvedValue(ok(new Set<string>()))
  h.upsert.mockResolvedValue(ok(1))
  h.prune.mockResolvedValue(ok(0))
})

describe('mineInboxSuggestions', () => {
  it('addresses a SHARED inbox card to nobody (userId null)', async () => {
    const { db } = makeDb([qualifyingRow])
    const result = await mineInboxSuggestions(
      db,
      'org_1',
      { id: 'ibx_1', isPersonal: false, ownerUserId: null },
      NOW
    )

    expect(result.isOk()).toBe(true)
    const drafts = h.upsert.mock.calls[0]?.[2] as { userId: string | null }[]
    expect(drafts[0]?.userId).toBeNull()
  })

  it('addresses a PERSONAL inbox card to its owner — read state is per user', async () => {
    const { db } = makeDb([qualifyingRow])
    await mineInboxSuggestions(
      db,
      'org_1',
      { id: 'ibx_2', isPersonal: true, ownerUserId: 'usr_7' },
      NOW
    )
    const drafts = h.upsert.mock.calls[0]?.[2] as { userId: string | null }[]
    expect(drafts[0]?.userId).toBe('usr_7')
  })

  it('skips a personal inbox with no owner — there is nobody to address', async () => {
    const { db, execute } = makeDb([qualifyingRow])
    const result = await mineInboxSuggestions(
      db,
      'org_1',
      { id: 'ibx_3', isPersonal: true, ownerUserId: null },
      NOW
    )
    expect(result._unsafeUnwrap()).toMatchObject({ groups: 0, written: 0 })
    expect(execute).not.toHaveBeenCalled()
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('prunes the `new` cards this sweep did not re-propose', async () => {
    const { db } = makeDb([qualifyingRow])
    await mineInboxSuggestions(
      db,
      'org_1',
      { id: 'ibx_1', isPersonal: false, ownerUserId: null },
      NOW
    )
    // Without this the cap is only per-run: week 1's five cards and week 2's
    // different five would accumulate into ten (invariant 12).
    expect(h.prune).toHaveBeenCalledWith(db, 'org_1', {
      inboxId: 'ibx_1',
      userId: null,
      keepSubjectKeys: ['list:news.acme.com'],
    })
  })

  it('clears the inbox when nothing qualifies any more', async () => {
    const { db } = makeDb([])
    await mineInboxSuggestions(
      db,
      'org_1',
      { id: 'ibx_1', isPersonal: false, ownerUserId: null },
      NOW
    )
    expect(h.prune).toHaveBeenCalledWith(db, 'org_1', {
      inboxId: 'ibx_1',
      userId: null,
      keepSubjectKeys: [],
    })
  })

  it('feeds the suppression set from the dismissed/accepted rows', async () => {
    h.listSuppressed.mockResolvedValue(ok(new Set(['list:news.acme.com'])))
    const { db } = makeDb([qualifyingRow])
    await mineInboxSuggestions(
      db,
      'org_1',
      { id: 'ibx_1', isPersonal: false, ownerUserId: null },
      NOW
    )
    const drafts = h.upsert.mock.calls[0]?.[2] as unknown[]
    expect(drafts).toEqual([])
  })

  it('turns a database failure into an err rather than throwing at the caller', async () => {
    const db = {
      execute: vi.fn(async () => {
        throw new Error('connection reset')
      }),
    } as never
    const result = await mineInboxSuggestions(
      db,
      'org_1',
      { id: 'ibx_1', isPersonal: false, ownerUserId: null },
      NOW
    )
    expect(result._unsafeUnwrapErr().message).toBe('connection reset')
  })
})
