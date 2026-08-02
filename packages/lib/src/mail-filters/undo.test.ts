// packages/lib/src/mail-filters/undo.test.ts
// Reversing one firing (D9). The two failure modes that matter are both about
// what undo must NOT do:
//
//  • a NULL `undo` blob is "not reversible", never "nothing to reverse" — the
//    claim row is written before execution, so that shape means the actions may
//    well have run and we cannot say what they changed;
//  • the blob is NOT a full snapshot to replay. `captureUndoState` records
//    status/assignee/inbox whenever anything reversible is present and leaves
//    `tagIds` empty when no tag action ran, so replaying it wholesale would
//    delete every tag on the thread after a status-only firing.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSchemaMock } from '../test/database-mock'
import type { MailFilterActionOutcome, MailFilterRunRow, MailFilterUndoState } from './types'

const h = vi.hoisted(() => ({
  getRun: vi.fn(),
  markUndone: vi.fn(),
  update: vi.fn(),
  tagBulk: vi.fn(),
  setReadStatus: vi.fn(),
  getThreadTagIds: vi.fn(),
  toInboxRecordId: vi.fn(),
  thread: {
    id: 'thr_1',
    status: 'ARCHIVED' as string | null,
    assigneeId: 'usr_bot' as string | null,
    inboxId: 'ibx_2' as string | null,
  } as Record<string, unknown> | undefined,
}))

// Partial mocks only — a full replacement of `drizzle-orm` kills the file at
// COLLECTION. `@auxx/database` keeps the shared setup's SHAPE (memoized table
// proxy, `undefined` columns) and only swaps `database`, which this module
// never touches anyway (the db is passed in).
vi.mock('@auxx/database', async () => ({
  database: {},
  schema: createSchemaMock(),
}))
vi.mock('./queries', () => ({ getMailFilterRunById: h.getRun }))
vi.mock('./runs', () => ({ markMailFilterRunUndone: h.markUndone }))
vi.mock('../threads/thread-mutation.service', () => ({
  ThreadMutationService: class {
    update = h.update
    tagThreadsBulk = h.tagBulk
  },
}))
vi.mock('../threads/unread-service', () => ({
  UnreadService: class {
    setReadStatus = h.setReadStatus
  },
}))
vi.mock('../field-values/relationship-queries', () => ({ getThreadTagIds: h.getThreadTagIds }))
vi.mock('../inbox-record-ids', () => ({ toInboxRecordId: h.toInboxRecordId }))
vi.mock('../cache', () => ({
  requireCachedEntityDefId: async (_org: string, key: string) => `def_${key}`,
  getOrgCache: () => ({
    get: async () => [
      { id: 'ibx_1', isPersonal: true, ownerUserId: 'usr_owner' },
      { id: 'ibx_2', isPersonal: false, ownerUserId: null },
    ],
  }),
}))

import { undoMailFilterRun } from './undo'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const UNDO: MailFilterUndoState = {
  status: 'OPEN',
  assigneeId: null,
  inboxId: 'ibx_1',
  tagIds: ['tag_keep', 'tag_old'],
  read: false,
}

function outcome(type: MailFilterActionOutcome['type'], status: 'ok' | 'skipped' = 'ok') {
  return { actionIndex: 0, type, status } as MailFilterActionOutcome
}

function run(overrides: Partial<MailFilterRunRow> = {}): MailFilterRunRow {
  return {
    id: 'run_1',
    organizationId: 'org_1',
    filterId: 'flt_1',
    threadId: 'thr_1',
    messageId: 'msg_1',
    outcomes: [],
    status: 'ok',
    undo: UNDO,
    undoneAt: null,
    source: 'live',
    firedAt: new Date(),
    ...overrides,
  }
}

/** `db.select().from().where().limit()` yielding the current thread row. */
const db = {
  select: () => db,
  from: () => db,
  where: () => db,
  limit: async () => (h.thread ? [h.thread] : []),
} as never

async function withRun(row: MailFilterRunRow) {
  const { ok } = await import('neverthrow')
  h.getRun.mockResolvedValue(ok(row))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.markUndone.mockResolvedValue(true)
  h.update.mockResolvedValue({})
  h.tagBulk.mockResolvedValue({ created: 0, skipped: 0, errors: [] })
  h.setReadStatus.mockResolvedValue(undefined)
  h.getThreadTagIds.mockResolvedValue([])
  h.toInboxRecordId.mockResolvedValue('personal_inbox:ibx_1')
  h.thread = { id: 'thr_1', status: 'ARCHIVED', assigneeId: 'usr_bot', inboxId: 'ibx_2' }
})

// ─────────────────────────────────────────────────────────────────────────────

describe('undoMailFilterRun — the two guards', () => {
  it('is a NO-OP once undoneAt is set (a second click is a double-click)', async () => {
    await withRun(run({ undoneAt: new Date(), outcomes: [outcome('set-status')] }))

    const result = await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({ undone: false, restored: [], skipped: [] })
    expect(h.update).not.toHaveBeenCalled()
    expect(h.markUndone).not.toHaveBeenCalled()
  })

  it('ERRORS when the undo blob is NULL — never reports a silent success', async () => {
    // The claim row is inserted BEFORE execution and `undo` is written by the
    // post-execution UPDATE, so this is a run that died mid-flight: the actions
    // may well have landed and there is no record of the prior state. Reporting
    // "nothing to reverse" here would tell the user their mail was restored.
    await withRun(run({ undo: null, status: 'failed' }))

    const result = await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/cannot be undone/i)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.markUndone).not.toHaveBeenCalled()
  })
})

describe('undoMailFilterRun — restores each reversible field', () => {
  it('restores status, assignee and inbox in ONE service update', async () => {
    await withRun(
      run({ outcomes: [outcome('set-status'), outcome('assign'), outcome('move-inbox')] })
    )

    const result = await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(h.update).toHaveBeenCalledTimes(1)
    const [recordId, updates] = h.update.mock.calls[0] ?? []
    expect(recordId).toBe('thread:thr_1')
    expect(updates).toEqual({
      status: 'OPEN',
      assigneeId: null,
      inboxId: 'personal_inbox:ibx_1',
    })
    expect(result._unsafeUnwrap().restored).toEqual(['status', 'assignee', 'inbox'])
  })

  it('restores tags by DIFFING against what the thread carries now', async () => {
    h.getThreadTagIds.mockResolvedValue(['tag_keep', 'tag_added_by_filter'])
    await withRun(run({ outcomes: [outcome('add-tag')] }))

    const result = await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(h.tagBulk).toHaveBeenCalledTimes(2)
    // `tag_old` was on the thread before the filter and is gone now → re-add.
    expect(h.tagBulk).toHaveBeenCalledWith(['def_thread:thr_1'], ['def_tag:tag_old'], 'add')
    // `tag_added_by_filter` was not → remove. (`tagThreadsBulk('set')` early
    // returns on an empty list, so the empty-target case has to be a remove.)
    expect(h.tagBulk).toHaveBeenCalledWith(
      ['def_thread:thr_1'],
      ['def_tag:tag_added_by_filter'],
      'remove'
    )
    expect(result._unsafeUnwrap().restored).toContain('tags')
  })

  it('restores read state on a personal inbox, through UnreadService', async () => {
    h.thread = { id: 'thr_1', status: 'OPEN', assigneeId: null, inboxId: 'ibx_1' }
    await withRun(run({ outcomes: [outcome('set-read')] }))

    const result = await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(h.setReadStatus).toHaveBeenCalledWith(['thr_1'], false, 'usr_owner')
    expect(result._unsafeUnwrap().restored).toContain('read')
  })

  it('skips read state on a shared inbox — the scalar blob cannot round-trip it', async () => {
    await withRun(run({ undo: { ...UNDO, inboxId: 'ibx_2' }, outcomes: [outcome('set-read')] }))

    const result = await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(h.setReadStatus).not.toHaveBeenCalled()
    expect(result._unsafeUnwrap().skipped).toEqual([
      { field: 'read', reason: 'read state is per-user and only restorable on a personal inbox' },
    ])
  })

  it('stamps undoneAt LAST, after the thread state is back', async () => {
    const order: string[] = []
    h.update.mockImplementation(async () => {
      order.push('update')
      return {}
    })
    h.markUndone.mockImplementation(async () => {
      order.push('stamp')
      return true
    })
    await withRun(run({ outcomes: [outcome('set-status')] }))

    await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(order).toEqual(['update', 'stamp'])
  })

  it('reports undone: false when a concurrent reversal already stamped it', async () => {
    h.markUndone.mockResolvedValue(false)
    await withRun(run({ outcomes: [outcome('set-status')] }))

    const result = await undoMailFilterRun(db, 'org_1', 'run_1')
    expect(result._unsafeUnwrap().undone).toBe(false)
  })
})

describe('undoMailFilterRun — the blob is not a snapshot to replay', () => {
  it('does NOT touch tags when no tag action ran', async () => {
    // `captureUndoState` leaves `tagIds: []` when no tag action was present, so
    // a wholesale replay would strip every tag off the thread.
    h.getThreadTagIds.mockResolvedValue(['tag_a', 'tag_b'])
    await withRun(run({ undo: { ...UNDO, tagIds: [] }, outcomes: [outcome('set-status')] }))

    await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(h.tagBulk).not.toHaveBeenCalled()
    expect(h.getThreadTagIds).not.toHaveBeenCalled()
  })

  it('does NOT revert an assignment the filter never made', async () => {
    // A human assigned the thread after a status-only firing. Undoing the
    // status must leave their assignment alone.
    await withRun(run({ outcomes: [outcome('set-status')] }))

    await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(h.update).toHaveBeenCalledWith('thread:thr_1', { status: 'OPEN' })
  })

  it('ignores an action that was SKIPPED — it provably wrote nothing', async () => {
    await withRun(run({ outcomes: [outcome('set-status'), outcome('assign', 'skipped')] }))

    await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(h.update).toHaveBeenCalledWith('thread:thr_1', { status: 'OPEN' })
  })

  it('writes nothing for a field already back at its old value', async () => {
    h.thread = { id: 'thr_1', status: 'OPEN', assigneeId: null, inboxId: 'ibx_1' }
    await withRun(run({ outcomes: [outcome('set-status'), outcome('assign')] }))

    const result = await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(h.update).not.toHaveBeenCalled()
    expect(result._unsafeUnwrap()).toMatchObject({ undone: true, restored: [] })
  })
})

describe('undoMailFilterRun — missing thread', () => {
  it('reports not found rather than stamping a reversal that never happened', async () => {
    h.thread = undefined
    await withRun(run({ outcomes: [outcome('set-status')] }))

    const result = await undoMailFilterRun(db, 'org_1', 'run_1')

    expect(result.isErr()).toBe(true)
    expect(h.markUndone).not.toHaveBeenCalled()
  })
})
