// packages/lib/src/mail-classification/retroactive.test.ts
// What is worth pinning about a bulk path that spends money:
//   • the ONE predicate the preview and the run share (07 invariant 10), and the
//     `IS DISTINCT FROM 'hard'` trap inside it (07 invariant 4);
//   • ONE inference per THREAD, on the FIRST INBOUND message (07 invariant 2);
//   • sample mode applies nothing, marks nothing, re-runs no filters
//     (07 invariants 9 and 3);
//   • the exit-5 bypass is a run parameter and cannot reach the opt-in exits
//     (07 invariants 5 and 6).

import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getOrgCache: vi.fn(),
  getEligibleClassificationTags: vi.fn(),
  guardClassification: vi.fn(),
  classifyMessage: vi.fn(),
  applyClassificationTag: vi.fn(),
  markMessageClassified: vi.fn(),
  rerunFilters: vi.fn(),
  queueAdd: vi.fn(),
  queueGetJob: vi.fn(),
  jobRemove: vi.fn(),
  jobGetState: vi.fn(),
}))

vi.mock('../cache', () => ({ getOrgCache: h.getOrgCache }))
vi.mock('./labels', () => ({ getEligibleClassificationTags: h.getEligibleClassificationTags }))
vi.mock('./guard', () => ({ guardClassification: h.guardClassification }))
vi.mock('./classify', () => ({ classifyMessage: h.classifyMessage }))
vi.mock('./apply', () => ({
  applyClassificationTag: h.applyClassificationTag,
  markMessageClassified: h.markMessageClassified,
}))
vi.mock('./rerun-filters', () => ({ rerunMailFiltersAfterClassification: h.rerunFilters }))
vi.mock('../jobs/queues', () => ({
  getQueue: () => ({ add: h.queueAdd, getJob: h.queueGetJob }),
}))
vi.mock('../jobs/queues/types', () => ({ Queues: { maintenanceQueue: 'maintenance' } }))

import type { Database } from '@auxx/database'
import type { MailReclassifyRange } from './client'
import {
  buildReclassifyWhere,
  countReclassifiableThreads,
  enqueueMailReclassifySample,
  findPendingClassificationPrompt,
  mailReclassifySampleJobId,
  resolveReclassifyWindow,
  runMailReclassifySample,
  selectReclassifyThreadPage,
} from './retroactive'

const ORG = 'org_1'
const INBOX = 'ibx_1'
const NOW = new Date('2026-08-10T12:00:00.000Z')

const LABELS = [
  { tagId: 'tag_billing', title: 'Billing', description: 'Money questions' },
  { tagId: 'tag_support', title: 'Support', description: 'Help with a product' },
  { tagId: 'tag_account', title: 'Account', description: 'Logins and profiles' },
]

/** Render a SQL fragment to text so the predicate itself can be asserted. */
function render(fragment: SQL) {
  return new PgDialect().sqlToQuery(fragment)
}

function makeDb(rowsByCall: unknown[][]) {
  let call = 0
  const execute = vi.fn(async (_fragment: SQL) => ({ rows: rowsByCall[call++] ?? [] }))
  return { execute } as unknown as Database & { execute: typeof execute }
}

/** The SQL a fake db was actually asked to run, rendered. */
function queryAt(db: ReturnType<typeof makeDb>, index = 0) {
  const fragment = db.execute.mock.calls[index]?.[0]
  if (!fragment) throw new Error('no query was executed')
  return render(fragment)
}

function threadRow(n: number): Record<string, unknown> {
  return {
    threadId: `thr_${n}`,
    cursorAt: `2026-08-0${n} 10:00:00`,
    messageId: `msg_first_${n}`,
    tier: null,
    subject: `Subject ${n}`,
    textPlain: `Body ${n}`,
    from: `sender${n}@example.com`,
  }
}

const window30 = () =>
  resolveReclassifyWindow({ kind: 'days', days: 30 }, { now: NOW })._unsafeUnwrap()

beforeEach(() => {
  vi.clearAllMocks()
  h.getOrgCache.mockReturnValue({
    get: vi.fn(async () => ({ mailClassificationInboxIds: [INBOX] })),
  })
  h.getEligibleClassificationTags.mockResolvedValue(LABELS)
  h.guardClassification.mockImplementation((input: { messageId: string; threadId: string }) =>
    Promise.resolve({
      proceed: true,
      context: {
        organizationId: ORG,
        messageId: input.messageId,
        threadId: input.threadId,
        inboxId: INBOX,
        labels: LABELS,
        message: { subject: 's', from: 'a@b.com', textPlain: 'b' },
      },
    })
  )
  h.classifyMessage.mockResolvedValue({
    tagId: 'tag_billing',
    confidence: 0.9,
    model: 'gpt-x',
    inferred: true,
  })
  h.queueGetJob.mockResolvedValue(null)
  h.queueAdd.mockResolvedValue({ id: 'job' })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveReclassifyWindow — the presets (§2.4 axis 1)', () => {
  it('defaults land on a 30-day window measured from the injected clock', () => {
    const w = resolveReclassifyWindow({ kind: 'days', days: 30 }, { now: NOW })._unsafeUnwrap()

    expect(w.since?.toISOString()).toBe('2026-07-11T12:00:00.000Z')
    expect(w.until).toBeNull()
    expect(w.maxThreads).toBe(5000)
  })

  for (const days of [7, 30, 90]) {
    it(`the ${days}-day preset resolves to exactly ${days} days back`, () => {
      const w = resolveReclassifyWindow({ kind: 'days', days }, { now: NOW })._unsafeUnwrap()
      expect(NOW.getTime() - (w.since?.getTime() ?? 0)).toBe(days * 86_400_000)
    })
  }

  for (const threads of [100, 500, 1000]) {
    it(`the ${threads}-thread preset bounds the COUNT, not the dates`, () => {
      const w = resolveReclassifyWindow({ kind: 'threads', threads }, { now: NOW })._unsafeUnwrap()

      expect(w.since).toBeNull()
      expect(w.until).toBeNull()
      expect(w.maxThreads).toBe(threads)
      expect(w.limitSource).toBe('range')
    })
  }

  it('a thread preset beyond the hard cap is clamped, and says the CAP is why', () => {
    const w = resolveReclassifyWindow({ kind: 'threads', threads: 99_999 })._unsafeUnwrap()

    expect(w.maxThreads).toBe(5000)
    expect(w.limitSource).toBe('cap')
  })

  it('all-time is unbounded in dates and bounded by the hard cap', () => {
    const w = resolveReclassifyWindow({ kind: 'all-time' })._unsafeUnwrap()

    expect(w.since).toBeNull()
    expect(w.maxThreads).toBe(5000)
    expect(w.limitSource).toBe('cap')
  })

  it('a custom range carries both bounds', () => {
    const w = resolveReclassifyWindow({
      kind: 'custom',
      sinceIso: '2026-01-01T00:00:00.000Z',
      untilIso: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()

    expect(w.since?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(w.until?.toISOString()).toBe('2026-02-01T00:00:00.000Z')
  })

  it('rejects a backwards custom range rather than counting zero threads', () => {
    const result = resolveReclassifyWindow({
      kind: 'custom',
      sinceIso: '2026-02-01T00:00:00.000Z',
      untilIso: '2026-01-01T00:00:00.000Z',
    })
    expect(result.isErr()).toBe(true)
  })

  it('rejects nonsense day and thread counts', () => {
    expect(resolveReclassifyWindow({ kind: 'days', days: 0 }).isErr()).toBe(true)
    expect(resolveReclassifyWindow({ kind: 'threads', threads: -5 }).isErr()).toBe(true)
    expect(resolveReclassifyWindow({ kind: 'custom', sinceIso: 'not a date' }).isErr()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('buildReclassifyWhere — the scoping predicate (§2.4)', () => {
  const base = {
    organizationId: ORG,
    inboxId: INBOX,
    window: window30(),
    eligibleTagIds: LABELS.map((l) => l.tagId),
  }

  // ⚠️ 07 INVARIANT 4. `machineMailTier` is NULL on ~84% of the corpus because
  // detection only went live 2026-07-15 — NULL means NOT EVALUATED, not human.
  // A `tier IS NULL` predicate would silently exclude nearly every thread worth
  // classifying and would look like "nothing to do".
  it('excludes hard-tier machine mail with IS DISTINCT FROM, never with IS NULL', () => {
    const { sql: text } = render(buildReclassifyWhere({ ...base, mode: 'fill-gaps' }))

    expect(text).toContain(`fm."tier" IS DISTINCT FROM 'hard'`)
    expect(text).not.toContain('fm."tier" IS NULL')
  })

  it('always scopes to one org, one inbox, and drops merged threads', () => {
    const { sql: text } = render(buildReclassifyWhere({ ...base, mode: 'fill-gaps' }))

    expect(text).toContain('t."organizationId" = $1')
    expect(text).toContain('t."inboxId" = $2')
    expect(text).toContain('t."mergedIntoThreadId" IS NULL')
  })

  it('fill-gaps excludes marked messages AND already-categorised threads', () => {
    const { sql: text, params } = render(buildReclassifyWhere({ ...base, mode: 'fill-gaps' }))

    expect(text).toContain('fm."metadata" ->')
    expect(text).toContain('IS NULL')
    expect(text).toContain('NOT EXISTS')
    expect(text).toContain(`cf."systemAttribute" = 'thread_tags'`)
    expect(params).toContain('mailClassification')
    for (const label of LABELS) expect(params).toContain(label.tagId)
  })

  // R4 — the two modes have very different cost profiles and must not be blurred.
  it('re-classify drops BOTH of those exclusions, which is what makes it pay twice', () => {
    const { sql: text } = render(buildReclassifyWhere({ ...base, mode: 're-classify' }))

    expect(text).not.toContain('fm."metadata" ->')
    expect(text).not.toContain('NOT EXISTS')
    // …but it still honours the machine-mail exclusion, which is not a mode.
    expect(text).toContain(`fm."tier" IS DISTINCT FROM 'hard'`)
  })

  it('a date window binds both bounds as UTC text, not as a raw Date', () => {
    const window = resolveReclassifyWindow({
      kind: 'custom',
      sinceIso: '2026-01-01T00:00:00.000Z',
      untilIso: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    const { sql: text, params } = render(
      buildReclassifyWhere({ ...base, window, mode: 'fill-gaps' })
    )

    expect(text).toContain('t."lastMessageAt" >=')
    expect(text).toContain('t."lastMessageAt" <')
    expect(params).toContain('2026-01-01T00:00:00.000Z')
    expect(params).toContain('2026-02-01T00:00:00.000Z')
  })

  it('an all-time window adds no date bound at all', () => {
    const window = resolveReclassifyWindow({ kind: 'all-time' })._unsafeUnwrap()
    const { sql: text } = render(buildReclassifyWhere({ ...base, window, mode: 'fill-gaps' }))

    expect(text).not.toContain('t."lastMessageAt" >=')
    expect(text).not.toContain('t."lastMessageAt" <')
  })

  // Keyset, not OFFSET: the run mutates the very columns the fill-gaps predicate
  // reads, so an offset window would slide underneath itself.
  it('a cursor becomes a descending row comparison, not an offset', () => {
    const { sql: text, params } = render(
      buildReclassifyWhere({
        ...base,
        mode: 'fill-gaps',
        cursor: { at: '2026-08-01 10:00:00', threadId: 'thr_9' },
      })
    )

    expect(text).toContain('(t."lastMessageAt", t."id") <')
    expect(text).not.toContain('OFFSET')
    expect(params).toContain('thr_9')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('countReclassifiableThreads — the preview (§2.5)', () => {
  const input = {
    organizationId: ORG,
    inboxId: INBOX,
    range: { kind: 'days', days: 30 } as MailReclassifyRange,
    mode: 'fill-gaps' as const,
    now: NOW,
  }

  // ⚠️ 07 INVARIANT 6 — a re-run is a way to catch up, not a way in.
  it('refuses an inbox that never opted in', async () => {
    h.getOrgCache.mockReturnValue({ get: vi.fn(async () => ({ mailClassificationInboxIds: [] })) })
    const db = makeDb([[{ count: 5 }]])

    const result = await countReclassifiableThreads(db, input)

    expect(result.isErr()).toBe(true)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('refuses an org with no eligible categories', async () => {
    h.getEligibleClassificationTags.mockResolvedValue([])
    const db = makeDb([[{ count: 5 }]])

    const result = await countReclassifiableThreads(db, input)

    expect(result.isErr()).toBe(true)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('reports the count and the eligible label count', async () => {
    const db = makeDb([[{ count: 412 }]])

    const result = (await countReclassifiableThreads(db, input))._unsafeUnwrap()

    expect(result).toMatchObject({
      count: 412,
      capped: false,
      mode: 'fill-gaps',
      eligibleTagCount: 3,
    })
  })

  // ⚠️ 07 INVARIANT 8 — a capped run says what it capped. Silent truncation
  // reads as "covered everything".
  it('flags the cap instead of silently truncating', async () => {
    const db = makeDb([[{ count: 11 }]])

    const result = (await countReclassifiableThreads(db, { ...input, cap: 10 }))._unsafeUnwrap()

    expect(result).toMatchObject({ count: 10, capped: true, cap: 10 })
  })

  // ⚠️ 07 INVARIANT 10 — the number in the confirm is what the user agreed to
  // spend on, so the preview compiles the SAME predicate the run pages over.
  it('counts through buildReclassifyWhere, bounded by LIMIT cap + 1', async () => {
    const db = makeDb([[{ count: 3 }]])

    await countReclassifiableThreads(db, { ...input, cap: 100 })

    const { sql: text, params } = queryAt(db)
    expect(text).toContain(`fm."tier" IS DISTINCT FROM 'hard'`)
    expect(text).toContain('JOIN LATERAL')
    expect(params).toContain(101)
  })

  it('a thread preset caps the count at the preset, not at the hard cap', async () => {
    const db = makeDb([[{ count: 101 }]])

    const result = (
      await countReclassifiableThreads(db, {
        ...input,
        range: { kind: 'threads', threads: 100 },
      })
    )._unsafeUnwrap()

    expect(result).toMatchObject({ count: 100, capped: true, cap: 100 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('selectReclassifyThreadPage — one row per thread (§2.3)', () => {
  it('pairs each thread with its FIRST INBOUND message and a keyset cursor', async () => {
    const db = makeDb([[threadRow(1), threadRow(2)]])

    const rows = await selectReclassifyThreadPage(db, {
      organizationId: ORG,
      inboxId: INBOX,
      window: window30(),
      mode: 'fill-gaps',
      eligibleTagIds: [],
      limit: 50,
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      threadId: 'thr_1',
      messageId: 'msg_first_1',
      from: 'sender1@example.com',
    })
    expect(rows[1]?.cursor).toEqual({ at: '2026-08-02 10:00:00', threadId: 'thr_2' })
  })

  // ⚠️ 07 INVARIANT 8 — newest first, always. A run that dies halfway must have
  // covered the part that mattered.
  it('selects newest first, one message per thread', async () => {
    const db = makeDb([[]])

    await selectReclassifyThreadPage(db, {
      organizationId: ORG,
      inboxId: INBOX,
      window: window30(),
      mode: 'fill-gaps',
      eligibleTagIds: [],
      limit: 50,
    })

    const { sql: text } = queryAt(db)
    expect(text).toContain('ORDER BY t."lastMessageAt" DESC, t."id" DESC')
    // The lateral is what makes "one inference per thread" true in SQL rather
    // than in a loop that could drift.
    expect(text).toContain('JOIN LATERAL')
    expect(text).toContain(`m."isInbound" = true`)
    expect(text).toContain('LIMIT 1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('runMailReclassifySample — sample mode (§2.11)', () => {
  const input = {
    organizationId: ORG,
    inboxId: INBOX,
    range: { kind: 'days', days: 30 } as MailReclassifyRange,
    mode: 'fill-gaps' as const,
    now: NOW,
    threadDelayMs: 0,
  }

  // ⚠️ 07 INVARIANT 2 / R3 — the unit is the THREAD. Per-message would spend an
  // inference per message to produce one tag per thread.
  it('spends exactly ONE inference per thread, on that thread’s first inbound message', async () => {
    const db = makeDb([[threadRow(1), threadRow(2), threadRow(3)]])

    await runMailReclassifySample(db, input)

    expect(h.classifyMessage).toHaveBeenCalledTimes(3)
    const messageIds = h.classifyMessage.mock.calls.map(
      (call) => (call[1] as { messageId: string }).messageId
    )
    expect(messageIds).toEqual(['msg_first_1', 'msg_first_2', 'msg_first_3'])
  })

  // ⚠️ 07 INVARIANT 9 — a marker would silently disqualify the sampled threads
  // from the real run that follows. ⚠️ 07 INVARIANT 3 / R2 — the filter re-run
  // is mandatory on the LIVE path and this is the deliberate exception.
  it('applies nothing, marks nothing, and re-runs no filters', async () => {
    const db = makeDb([[threadRow(1), threadRow(2)]])

    const report = (await runMailReclassifySample(db, input))._unsafeUnwrap()

    expect(h.applyClassificationTag).not.toHaveBeenCalled()
    expect(h.markMessageClassified).not.toHaveBeenCalled()
    expect(h.rerunFilters).not.toHaveBeenCalled()
    expect(report.applied).toBe(false)
  })

  it('reports the distribution, including labels the model never chose', async () => {
    const db = makeDb([[threadRow(1), threadRow(2), threadRow(3), threadRow(4)]])
    h.classifyMessage
      .mockResolvedValueOnce({ tagId: 'tag_billing', confidence: 0.9, inferred: true })
      .mockResolvedValueOnce({ tagId: 'tag_billing', confidence: 0.7, inferred: true })
      .mockResolvedValueOnce({ tagId: 'tag_support', confidence: 0.8, inferred: true })
      .mockResolvedValueOnce({
        tagId: null,
        confidence: 0.2,
        reason: 'below-threshold',
        inferred: true,
      })

    const report = (await runMailReclassifySample(db, input))._unsafeUnwrap()

    expect(report.selected).toBe(4)
    expect(report.inferred).toBe(4)
    expect(report.classified).toBe(3)
    expect(report.abstained).toBe(1)
    expect(report.abstentionRate).toBeCloseTo(0.25)
    // ⚠️ The zero row IS the finding (§3.3 / 06 Q1) — a label never chosen in a
    // sample is a label to merge. It must render, not be filtered out.
    expect(report.labels).toEqual([
      { tagId: 'tag_billing', title: 'Billing', count: 2, meanConfidence: 0.8 },
      { tagId: 'tag_support', title: 'Support', count: 1, meanConfidence: 0.8 },
      { tagId: 'tag_account', title: 'Account', count: 0, meanConfidence: 0 },
    ])
  })

  it('splits abstention by reason and keeps it OUT of the guard-exit tally', async () => {
    const db = makeDb([[threadRow(1), threadRow(2)]])
    h.classifyMessage
      .mockResolvedValueOnce({
        tagId: null,
        confidence: 0.1,
        reason: 'no-category',
        inferred: true,
      })
      .mockResolvedValueOnce({
        tagId: null,
        confidence: 0.5,
        reason: 'below-threshold',
        inferred: true,
      })

    const report = (await runMailReclassifySample(db, input))._unsafeUnwrap()

    expect(report.abstainedByReason).toEqual({ 'no-category': 1, 'below-threshold': 1 })
    expect(report.skipped).toEqual({})
    expect(report.inferred).toBe(2)
  })

  it('a failed call is a skip that never reached the model, not an abstention', async () => {
    const db = makeDb([[threadRow(1), threadRow(2)]])
    h.classifyMessage
      .mockResolvedValueOnce({ tagId: null, confidence: 0, reason: 'unavailable', inferred: false })
      .mockResolvedValueOnce({ tagId: 'tag_billing', confidence: 0.9, inferred: true })

    const report = (await runMailReclassifySample(db, input))._unsafeUnwrap()

    expect(report.skipped).toEqual({ unavailable: 1 })
    expect(report.abstained).toBe(0)
    expect(report.inferred).toBe(1)
    // §2.11: say the sample was smaller than asked, rather than implying 100.
    expect(report.selected).toBe(2)
  })

  it('honours the guard, and counts every exit it hits', async () => {
    const db = makeDb([[threadRow(1), threadRow(2)]])
    h.guardClassification
      .mockResolvedValueOnce({ proceed: false, reason: 'machine-mail' })
      .mockResolvedValueOnce({ proceed: false, reason: 'already-classified' })

    const report = (await runMailReclassifySample(db, input))._unsafeUnwrap()

    expect(h.classifyMessage).not.toHaveBeenCalled()
    expect(report.skipped).toEqual({ 'machine-mail': 1, 'already-classified': 1 })
    expect(report.inferred).toBe(0)
  })

  it('passes the selected message’s tier and sender straight to the guard', async () => {
    const db = makeDb([[{ ...threadRow(1), tier: 'soft' }]])

    await runMailReclassifySample(db, input)

    expect(h.guardClassification).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg_first_1',
        threadId: 'thr_1',
        machineMailTier: 'soft',
        from: 'sender1@example.com',
      })
    )
  })

  it('stops between threads when cancelled — nothing is committed, so it is safe', async () => {
    const db = makeDb([[threadRow(1), threadRow(2), threadRow(3)]])
    let seen = 0
    const isCancelled = () => {
      seen += 1
      return seen > 2
    }

    const report = (await runMailReclassifySample(db, { ...input, isCancelled }))._unsafeUnwrap()

    expect(h.classifyMessage).toHaveBeenCalledTimes(2)
    expect(report.inferred).toBe(2)
  })

  it('asks for at most the sample size (§2.11 — ~100 threads, not the backlog)', async () => {
    const db = makeDb([[]])

    await runMailReclassifySample(db, { ...input, sampleSize: 100 })

    expect(queryAt(db).params).toContain(100)
  })

  it('refuses to sample an inbox that never opted in (invariant 6)', async () => {
    h.getOrgCache.mockReturnValue({ get: vi.fn(async () => ({ mailClassificationInboxIds: [] })) })
    const db = makeDb([[threadRow(1)]])

    const result = await runMailReclassifySample(db, input)

    expect(result.isErr()).toBe(true)
    expect(h.classifyMessage).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('runMailReclassifySample — the exit-5 bypass is a run parameter (§2.6)', () => {
  const base = {
    organizationId: ORG,
    inboxId: INBOX,
    range: { kind: 'all-time' } as MailReclassifyRange,
    now: NOW,
    threadDelayMs: 0,
  }

  // ⚠️ 07 INVARIANT 5 — the guard's default stays "classify once, ever". The
  // bypass lives in the run, and only re-classify mode asks for it.
  for (const reason of ['already-classified', 'thread-already-categorised'] as const) {
    it(`re-classify bypasses "${reason}" and pays again, on purpose`, async () => {
      const db = makeDb([[threadRow(1)]])
      h.guardClassification.mockResolvedValue({ proceed: false, reason })

      const report = (
        await runMailReclassifySample(db, { ...base, mode: 're-classify' })
      )._unsafeUnwrap()

      expect(h.classifyMessage).toHaveBeenCalledTimes(1)
      expect(report.inferred).toBe(1)
    })

    it(`fill-gaps honours "${reason}" and never double-bills`, async () => {
      const db = makeDb([[threadRow(1)]])
      h.guardClassification.mockResolvedValue({ proceed: false, reason })

      const report = (
        await runMailReclassifySample(db, { ...base, mode: 'fill-gaps' })
      )._unsafeUnwrap()

      expect(h.classifyMessage).not.toHaveBeenCalled()
      expect(report.skipped).toEqual({ [reason]: 1 })
    })
  }

  // ⚠️ 07 INVARIANT 6 — a re-run cannot be used to bypass the opt-in, and a
  // hard-tier bounce is never worth an inference in either mode.
  for (const reason of [
    'machine-mail',
    'no-thread',
    'inbox-not-opted-in',
    'no-eligible-tags',
  ] as const) {
    it(`re-classify does NOT bypass "${reason}"`, async () => {
      const db = makeDb([[threadRow(1)]])
      h.guardClassification.mockResolvedValue({ proceed: false, reason })

      const report = (
        await runMailReclassifySample(db, { ...base, mode: 're-classify' })
      )._unsafeUnwrap()

      expect(h.classifyMessage).not.toHaveBeenCalled()
      expect(report.skipped).toEqual({ [reason]: 1 })
    })
  }

  it('the bypassed context still carries the run’s labels and the selected message', async () => {
    const db = makeDb([[threadRow(1)]])
    h.guardClassification.mockResolvedValue({ proceed: false, reason: 'already-classified' })

    await runMailReclassifySample(db, { ...base, mode: 're-classify' })

    expect(h.classifyMessage.mock.calls[0]?.[1]).toMatchObject({
      organizationId: ORG,
      messageId: 'msg_first_1',
      threadId: 'thr_1',
      inboxId: INBOX,
      labels: LABELS,
      message: { subject: 'Subject 1', from: 'sender1@example.com', textPlain: 'Body 1' },
    })
  })

  it('a throwing guard skips one thread instead of failing the whole sample', async () => {
    const db = makeDb([[threadRow(1), threadRow(2)]])
    h.guardClassification.mockRejectedValueOnce(new Error('db down'))

    const report = (
      await runMailReclassifySample(db, { ...base, mode: 'fill-gaps' })
    )._unsafeUnwrap()

    expect(report.skipped).toEqual({ error: 1 })
    expect(report.inferred).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('enqueueMailReclassifySample — the queue contract (§2.2)', () => {
  const data = {
    organizationId: ORG,
    inboxId: INBOX,
    range: { kind: 'days', days: 30 } as MailReclassifyRange,
    mode: 'fill-gaps' as const,
  }

  it('uses a deterministic jobId so a double-click collapses into one run', async () => {
    await enqueueMailReclassifySample(data)

    expect(h.queueAdd).toHaveBeenCalledWith(
      'mailReclassifySampleJob',
      data,
      expect.objectContaining({ jobId: mailReclassifySampleJobId(ORG, INBOX) })
    )
  })

  // ⚠️ The queue default is `attempts: 5`. A retry re-spends the whole sample —
  // the bulk equivalent of the C9 double-billing bug.
  it('pins attempts to 1 and keeps the finished job so its report can be read', async () => {
    await enqueueMailReclassifySample(data)

    const opts = h.queueAdd.mock.calls[0]?.[2] as { attempts: number; removeOnComplete: unknown }
    expect(opts.attempts).toBe(1)
    expect(opts.removeOnComplete).not.toBe(true)
  })

  it('returns the in-flight run rather than queueing a second one', async () => {
    h.queueGetJob.mockResolvedValue({
      getState: async () => 'active',
      remove: h.jobRemove,
    })

    const result = (await enqueueMailReclassifySample(data))._unsafeUnwrap()

    expect(result.deduplicated).toBe(true)
    expect(h.queueAdd).not.toHaveBeenCalled()
    expect(h.jobRemove).not.toHaveBeenCalled()
  })

  // ⚠️ The jobId is keyed on (org, inbox) and carries NO scope, so a collapse
  // says nothing about whether the running job matches what was asked for. The
  // caller has to be able to tell — without this the router would write an audit
  // row for a run at a scope that never executed.
  it('reports the scope of the run it collapsed into', async () => {
    const inFlight = { ...data, range: { kind: 'all-time' } as MailReclassifyRange }
    h.queueGetJob.mockResolvedValue({
      getState: async () => 'active',
      data: inFlight,
      remove: h.jobRemove,
    })

    const result = (
      await enqueueMailReclassifySample({ ...data, mode: 're-classify' })
    )._unsafeUnwrap()

    expect(result.running).toEqual({ range: { kind: 'all-time' }, mode: 'fill-gaps' })
  })

  // A job old enough to predate this field, or one BullMQ hands back with its
  // payload reaped, must not fabricate a scope — `undefined` is the honest answer
  // and the router treats it as "cannot prove a mismatch".
  it('omits the scope when the in-flight job carries no readable data', async () => {
    h.queueGetJob.mockResolvedValue({ getState: async () => 'waiting', remove: h.jobRemove })

    const result = (await enqueueMailReclassifySample(data))._unsafeUnwrap()

    expect(result.deduplicated).toBe(true)
    expect(result.running).toBeUndefined()
  })

  // §3.3's loop is sample → fix the vocabulary → sample again. A completed job
  // left in place would make BullMQ hand back the stale report.
  it('clears a COMPLETED run so the same scope can be re-sampled', async () => {
    h.queueGetJob.mockResolvedValue({
      getState: async () => 'completed',
      remove: h.jobRemove.mockResolvedValue(undefined),
    })

    const result = (await enqueueMailReclassifySample(data))._unsafeUnwrap()

    expect(h.jobRemove).toHaveBeenCalledTimes(1)
    expect(h.queueAdd).toHaveBeenCalledTimes(1)
    expect(result.deduplicated).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The banner mounts in a fixed slot for EVERY mail view and names the inbox it
 * is about, so which candidate wins is user-visible: without a preference it
 * asked about whichever inbox sorted first, which reads — to someone sitting in
 * a different mailbox — as a claim about the mail on screen.
 *
 * A REORDER, never a filter, and never a grant: it lands after the caller's
 * authorized candidate list has already been narrowed.
 */
describe('findPendingClassificationPrompt — the viewed inbox goes first (§3.4)', () => {
  const INBOX_B = 'ibx_2'

  /** `db.select()` for the synced-channel probe + `db.execute()` for the counts. */
  function promptDb(syncedInboxIds: string[], countsByInbox: Record<string, number>) {
    const rows = syncedInboxIds.map((inboxId) => ({ inboxId }))
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(ok, err),
    })
    // The count query renders the inbox id inline, so the fake reads it back out
    // of the SQL rather than relying on call order.
    const execute = vi.fn(async (fragment: SQL) => {
      const sql = render(fragment)
      const params = JSON.stringify(sql.params)
      const inboxId = Object.keys(countsByInbox).find((id) => params.includes(id))
      return { rows: [{ count: inboxId ? (countsByInbox[inboxId] ?? 0) : 0 }] }
    })
    return { select: () => chain, execute } as unknown as Database
  }

  beforeEach(() => {
    h.getOrgCache.mockReturnValue({
      get: vi.fn(async () => ({ mailClassificationInboxIds: [INBOX, INBOX_B] })),
    })
  })

  it('asks about the viewed inbox when it has a backlog', async () => {
    const db = promptDb([INBOX, INBOX_B], { [INBOX]: 40, [INBOX_B]: 900 })

    const prompt = await findPendingClassificationPrompt(db, ORG, [INBOX, INBOX_B], {
      preferredInboxId: INBOX_B,
    })

    expect(prompt).toMatchObject({ inboxId: INBOX_B, threadCount: 900 })
  })

  // The preference is not a scope — a view whose own inbox is already clean
  // should still surface the inbox that is not.
  it('falls back to another candidate when the viewed inbox has none', async () => {
    const db = promptDb([INBOX, INBOX_B], { [INBOX]: 40, [INBOX_B]: 0 })

    const prompt = await findPendingClassificationPrompt(db, ORG, [INBOX, INBOX_B], {
      preferredInboxId: INBOX_B,
    })

    expect(prompt).toMatchObject({ inboxId: INBOX, threadCount: 40 })
  })

  // ⚠️ The preference must never widen the answer. `candidateInboxIds` is the
  // caller's authorized set; an id outside it is inert, not an existence oracle.
  it('ignores an inbox the caller was not already a candidate for', async () => {
    const db = promptDb([INBOX], { [INBOX]: 40, ibx_other: 900 })

    const prompt = await findPendingClassificationPrompt(db, ORG, [INBOX], {
      preferredInboxId: 'ibx_other',
    })

    expect(prompt).toMatchObject({ inboxId: INBOX })
  })

  // Search, drafts and all-inboxes span inboxes and pass nothing — discovery
  // must not depend on standing in the right mailbox.
  it('still asks when no inbox is being viewed', async () => {
    const db = promptDb([INBOX, INBOX_B], { [INBOX]: 40, [INBOX_B]: 900 })

    const prompt = await findPendingClassificationPrompt(db, ORG, [INBOX, INBOX_B])

    expect(prompt).toMatchObject({ inboxId: INBOX })
  })
})
