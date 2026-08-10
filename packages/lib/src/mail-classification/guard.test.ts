// packages/lib/src/mail-classification/guard.test.ts
// The §3.1 exit ladder. Two properties are pinned per exit: the RIGHT reason
// comes back, and nothing more expensive than that exit ran.
//
// The ordering is the whole point (C8) — an org that never opts in must issue
// ZERO queries — so several tests assert on the DB-call count rather than only
// on the returned reason.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  orgCacheGet: vi.fn(),
  getEligibleClassificationTags: vi.fn(),
  getThreadTagIds: vi.fn(),
}))

vi.mock('../cache', () => ({
  getOrgCache: () => ({ get: h.orgCacheGet }),
}))
vi.mock('./labels', () => ({
  getEligibleClassificationTags: h.getEligibleClassificationTags,
}))
vi.mock('../field-values/relationship-queries', () => ({
  getThreadTagIds: h.getThreadTagIds,
}))

import { guardClassification } from './guard'

/**
 * A `db` whose `select()` chain resolves the next queued row set. `select` is a
 * spy, so "did this exit run before any query?" is assertable.
 */
function createDb(rowSets: unknown[][]) {
  let index = 0
  const select = vi.fn(() => {
    const result = Promise.resolve(rowSets[index++] ?? [])
    const step: Record<string, unknown> = {}
    step.from = () => step
    step.where = () => step
    step.limit = () => result
    step.then = (onOk: unknown, onErr: unknown) => result.then(onOk as never, onErr as never)
    return step
  })
  return { select } as never as Parameters<typeof guardClassification>[0]['db'] & {
    select: typeof select
  }
}

const LABELS = [{ tagId: 'tag_billing', title: 'Billing', description: 'Invoices' }]

const base = {
  organizationId: 'org_1',
  messageId: 'msg_1',
  threadId: 'thr_1',
  from: 'a@b.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.orgCacheGet.mockResolvedValue({ mailClassificationInboxIds: ['ibx_1'] })
  h.getEligibleClassificationTags.mockResolvedValue(LABELS)
  h.getThreadTagIds.mockResolvedValue([])
})

describe('guardClassification — exit 1: hard machine mail', () => {
  it('exits on the payload field alone, with no cache read and no query', async () => {
    const db = createDb([])
    const gate = await guardClassification({ ...base, db, machineMailTier: 'hard' })

    expect(gate).toEqual({ proceed: false, reason: 'machine-mail' })
    expect(h.orgCacheGet).not.toHaveBeenCalled()
    expect(db.select).not.toHaveBeenCalled()
  })

  it('does NOT exit on soft-tier machine mail (OOO / list mail is still categorisable)', async () => {
    const db = createDb([
      [{ inboxId: 'ibx_1' }],
      [{ subject: 's', textPlain: 'b', metadata: null }],
    ])
    const gate = await guardClassification({ ...base, db, machineMailTier: 'soft' })

    expect(gate.proceed).toBe(true)
  })
})

describe('guardClassification — exit 2: no thread', () => {
  it('exits on the payload field alone', async () => {
    const db = createDb([])
    const gate = await guardClassification({ ...base, db, threadId: undefined })

    expect(gate).toEqual({ proceed: false, reason: 'no-thread' })
    expect(h.orgCacheGet).not.toHaveBeenCalled()
    expect(db.select).not.toHaveBeenCalled()
  })
})

describe('guardClassification — exit 3: inbox not opted in', () => {
  it('an org with an EMPTY opt-in list pays zero queries (C8)', async () => {
    h.orgCacheGet.mockResolvedValue({ mailClassificationInboxIds: [] })
    const db = createDb([])

    const gate = await guardClassification({ ...base, db })

    expect(gate).toEqual({ proceed: false, reason: 'inbox-not-opted-in' })
    expect(db.select).not.toHaveBeenCalled()
    expect(h.getEligibleClassificationTags).not.toHaveBeenCalled()
  })

  it('a missing setting reads as opted out, not as opted in', async () => {
    h.orgCacheGet.mockResolvedValue({})
    const db = createDb([])

    expect(await guardClassification({ ...base, db })).toEqual({
      proceed: false,
      reason: 'inbox-not-opted-in',
    })
    expect(db.select).not.toHaveBeenCalled()
  })

  it('a thread in an inbox that is NOT on the list exits before the tag lookup', async () => {
    const db = createDb([[{ inboxId: 'ibx_other' }]])

    const gate = await guardClassification({ ...base, db })

    expect(gate).toEqual({ proceed: false, reason: 'inbox-not-opted-in' })
    expect(db.select).toHaveBeenCalledTimes(1)
    expect(h.getEligibleClassificationTags).not.toHaveBeenCalled()
  })
})

describe('guardClassification — exit 4: no eligible tags', () => {
  it('exits before loading the message when the label set is empty (C8, second half)', async () => {
    h.getEligibleClassificationTags.mockResolvedValue([])
    const db = createDb([[{ inboxId: 'ibx_1' }]])

    const gate = await guardClassification({ ...base, db })

    expect(gate).toEqual({ proceed: false, reason: 'no-eligible-tags' })
    // Only the thread query ran — the message was never loaded.
    expect(db.select).toHaveBeenCalledTimes(1)
    expect(h.getThreadTagIds).not.toHaveBeenCalled()
  })
})

describe('guardClassification — exit 5: already classified (C9)', () => {
  it('exits when the metadata marker is present, before the tag read', async () => {
    const db = createDb([
      [{ inboxId: 'ibx_1' }],
      [
        {
          subject: 's',
          textPlain: 'b',
          metadata: { mailClassification: { at: 'x', tagId: null, confidence: 0.1 } },
        },
      ],
    ])

    const gate = await guardClassification({ ...base, db })

    expect(gate).toEqual({ proceed: false, reason: 'already-classified' })
    expect(h.getThreadTagIds).not.toHaveBeenCalled()
  })

  it('unrelated metadata (machineMail, headers) does NOT count as classified', async () => {
    const db = createDb([
      [{ inboxId: 'ibx_1' }],
      [{ subject: 's', textPlain: 'b', metadata: { machineMail: { tier: 'soft' } } }],
    ])

    expect((await guardClassification({ ...base, db })).proceed).toBe(true)
  })
})

describe('guardClassification — exit 6: a rule already answered (§3.1.1)', () => {
  it('exits when the thread already carries an ELIGIBLE tag', async () => {
    h.getThreadTagIds.mockResolvedValue(['tag_billing'])
    const db = createDb([
      [{ inboxId: 'ibx_1' }],
      [{ subject: 's', textPlain: 'b', metadata: null }],
    ])

    const gate = await guardClassification({ ...base, db })

    expect(gate).toEqual({ proceed: false, reason: 'thread-already-categorised' })
  })

  it('⚠️ an UNRELATED user tag (VIP, P1) does NOT count as categorised', async () => {
    h.getThreadTagIds.mockResolvedValue(['tag_vip', 'tag_p1'])
    const db = createDb([
      [{ inboxId: 'ibx_1' }],
      [{ subject: 's', textPlain: 'b', metadata: null }],
    ])

    const gate = await guardClassification({ ...base, db })

    expect(gate.proceed).toBe(true)
  })
})

describe('guardClassification — the resolved context', () => {
  it('carries the inbox, the labels and the truncatable message parts', async () => {
    const db = createDb([
      [{ inboxId: 'ibx_1' }],
      [{ subject: 'Refund please', textPlain: 'body text', metadata: null }],
    ])

    const gate = await guardClassification({ ...base, db })

    expect(gate).toEqual({
      proceed: true,
      context: {
        organizationId: 'org_1',
        messageId: 'msg_1',
        threadId: 'thr_1',
        inboxId: 'ibx_1',
        labels: LABELS,
        message: { subject: 'Refund please', from: 'a@b.com', textPlain: 'body text' },
      },
    })
  })

  it('a vanished message is a skip, never a throw', async () => {
    const db = createDb([[{ inboxId: 'ibx_1' }], []])

    expect((await guardClassification({ ...base, db })).proceed).toBe(false)
  })
})
