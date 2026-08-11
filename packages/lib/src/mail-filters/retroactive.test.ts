// packages/lib/src/mail-filters/retroactive.test.ts
// Phase 3 "Reach" (§7). Four properties, and invariant 5 is the headline:
//
//  • the preview compiles through the SAME builder as the fire path — the whole
//    dividend of dropping the in-memory tier;
//  • the preview is BOUNDED and says so (`capped`);
//  • the backfill writes `source: 'retroactive'`, which is what keeps its claim
//    key distinct from the live firing on the same message;
//  • the backfill is scoped to the filter's inbox and never silently truncates —
//    including the `run-agent` / `run-workflow` actions it withholds (D18),
//    which are counted into the report rather than quietly dropped.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConditionGroup } from '../conditions/types'
import type { JobContext } from '../jobs/types'
import { SYSTEM_VISIBILITY } from '../permissions/visibility/context'
import type { CachedMailFilter, MailFilterRow } from './types'

// ── Mocks ────────────────────────────────────────────────────────────────────
// Partial mocks only. `drizzle-orm` and the `@auxx/database` schema proxy stay
// as the shared setup installs them — a full replacement of either kills the
// file at COLLECTION as the import graph grows.

const h = vi.hoisted(() => ({
  /** One stable object, so "is the SAME predicate embedded?" is a `===` test. */
  predicate: undefined as unknown,
  build: vi.fn(),
  fire: vi.fn(),
  getFilter: vi.fn(),
  pages: [] as Record<string, unknown>[][],
  pageIndex: 0,
  captured: { where: undefined as unknown, limits: [] as number[] },
}))

vi.mock('../mail-query/condition-query-builder', async () => {
  const { sql } = await import('drizzle-orm')
  h.predicate = sql`MAIL_FILTER_PREDICATE`
  h.build.mockImplementation(() => h.predicate)
  // Both exports delegate to the SAME spy: `buildFilterPredicate` reads the
  // diagnostics (a filter whose conditions all drop must fail closed), and the
  // call-count/argument assertions below are about the compilation itself, which
  // is one thing either way.
  return {
    buildConditionGroupsQuery: h.build,
    buildConditionGroupsQueryWithDiagnostics: (...args: unknown[]) => ({
      sql: h.build(...args),
      requestedConditions: 0,
      droppedConditions: [],
      allConditionsDropped: false,
    }),
  }
})

vi.mock('./engine', () => ({ fireMailFilters: h.fire }))
vi.mock('./queries', () => ({ getMailFilterById: h.getFilter }))
vi.mock('../cache', () => ({
  getOrgCache: () => ({
    get: async () => [{ id: 'ibx_1', isPersonal: false, ownerUserId: null }],
  }),
}))
// Same SHAPE as the shared setup's mock (memoized table proxy, columns
// `undefined` — Drizzle columns are unassertable under vitest), with the
// `database` export swapped for a paging stub the backfill can be driven with.
vi.mock('@auxx/database', async () => {
  const { createSchemaMock } = await import('../test/database-mock')
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder,
    from: () => builder,
    where: (clause: unknown) => {
      h.captured.where = clause
      return builder
    },
    orderBy: () => builder,
    limit: async (n: number) => {
      h.captured.limits.push(n)
      return h.pages[h.pageIndex++] ?? []
    },
  })
  return { database: builder, schema: createSchemaMock() }
})

import { matchFilters } from './evaluate'
import {
  assertBackfillable,
  findPendingRetroactivePrompt,
  mailFilterRetroactiveApplyJob,
  PREVIEW_MATCH_COUNT_CAP,
  previewMatchCount,
} from './retroactive'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const conditions: ConditionGroup[] = [
  {
    id: 'grp_1',
    logicalOperator: 'AND',
    conditions: [{ id: 'c1', fieldId: 'from', operator: 'is', value: 'news@example.com' }],
  } as unknown as ConditionGroup,
]

function filterRow(overrides: Partial<MailFilterRow> = {}): MailFilterRow {
  return {
    id: 'flt_1',
    organizationId: 'org_1',
    inboxId: 'ibx_1',
    name: 'Newsletters',
    order: 0,
    stopProcessing: false,
    enabled: true,
    conditions,
    actions: [{ type: 'set-status', status: 'ARCHIVED' }],
    createdByUserId: 'usr_1',
    templateKey: null,
    lastFiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function cachedFilter(): CachedMailFilter {
  const row = filterRow()
  return {
    id: row.id,
    inboxId: row.inboxId,
    name: row.name,
    order: row.order,
    stopProcessing: row.stopProcessing,
    enabled: row.enabled,
    conditions: row.conditions,
    actions: row.actions,
    templateKey: row.templateKey,
  }
}

/** `db.execute` returning one bounded-count row. */
function countingDb(count: number) {
  const execute = vi.fn().mockResolvedValue({ rows: [{ count }] })
  return { db: { execute } as never, execute }
}

/** `db.execute` returning raw rows (the UNION ALL fire path). */
function rowsDb(rows: { fid: string }[] = []) {
  const execute = vi.fn().mockResolvedValue({ rows })
  return { db: { execute } as never, execute }
}

/** Walk a Drizzle SQL tree for a chunk by REFERENCE. */
function containsChunk(node: unknown, target: unknown): boolean {
  if (node === target) return true
  if (Array.isArray(node)) return node.some((child) => containsChunk(child, target))
  if (node && typeof node === 'object' && 'queryChunks' in node) {
    return containsChunk((node as { queryChunks: unknown }).queryChunks, target)
  }
  return false
}

/** Every bound value in a Drizzle SQL tree, however it is wrapped. */
function collectValues(node: unknown, out: unknown[] = []): unknown[] {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectValues(child, out)
    return out
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if ('queryChunks' in obj) collectValues(obj.queryChunks, out)
    if ('value' in obj) collectValues(obj.value, out)
  }
  return out
}

function jobCtx(data: Record<string, unknown>, cancelled = false) {
  return {
    data,
    isCancelled: () => cancelled,
  } as unknown as JobContext<never>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.build.mockImplementation(() => h.predicate)
  h.pages = []
  h.pageIndex = 0
  h.captured = { where: undefined, limits: [] }
  h.fire.mockResolvedValue({ suppressAutomations: false, firedFilterIds: ['flt_1'] })
  h.getFilter.mockImplementation(async () => {
    const { ok } = await import('neverthrow')
    return ok(filterRow())
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('invariant 5 — the preview uses the SAME evaluator as the fire path', () => {
  it('compiles both through condition-query-builder, differing ONLY in the principal', async () => {
    const viewer = { userId: 'usr_1' } as never

    const { db: fireDb } = rowsDb()
    await matchFilters(fireDb, 'org_1', 'thr_1', [cachedFilter()])

    const { db: previewDb } = countingDb(3)
    await previewMatchCount(previewDb, 'org_1', 'ibx_1', conditions, viewer)

    expect(h.build).toHaveBeenCalledTimes(2)
    const [fireCall, previewCall] = h.build.mock.calls

    // Same conditions object, same org — literally the same compilation input.
    expect(fireCall?.[0]).toBe(conditions)
    expect(previewCall?.[0]).toBe(conditions)
    expect(fireCall?.[1]).toBe('org_1')
    expect(previewCall?.[1]).toBe('org_1')

    // The ONE deliberate difference (§7): the engine has no user, the preview
    // is the requesting user — which is why the preview is a lower bound.
    expect(fireCall?.[2]).toBe(SYSTEM_VISIBILITY)
    expect(previewCall?.[2]).toBe(viewer)
  })

  it('embeds the compiled predicate in BOTH emitted statements, in the WHERE position', async () => {
    const { db: fireDb, execute: fireExec } = rowsDb()
    await matchFilters(fireDb, 'org_1', 'thr_1', [cachedFilter()])

    const { db: previewDb, execute: previewExec } = countingDb(1)
    await previewMatchCount(previewDb, 'org_1', 'ibx_1', conditions, SYSTEM_VISIBILITY)

    expect(containsChunk(fireExec.mock.calls[0]?.[0], h.predicate)).toBe(true)
    expect(containsChunk(previewExec.mock.calls[0]?.[0], h.predicate)).toBe(true)
  })

  it('reports a lower bound, never an exact count', async () => {
    const { db } = countingDb(7)
    const result = await previewMatchCount(db, 'org_1', 'ibx_1', conditions, SYSTEM_VISIBILITY)
    expect(result.lowerBound).toBe(true)
  })
})

describe('previewMatchCount — bounded work (§6.5)', () => {
  it('clamps at the cap and reports capped', async () => {
    const { db } = countingDb(PREVIEW_MATCH_COUNT_CAP + 1)
    await expect(
      previewMatchCount(db, 'org_1', 'ibx_1', conditions, SYSTEM_VISIBILITY)
    ).resolves.toMatchObject({ count: PREVIEW_MATCH_COUNT_CAP, capped: true })
  })

  it('reports the exact count below the cap', async () => {
    const { db } = countingDb(12)
    await expect(
      previewMatchCount(db, 'org_1', 'ibx_1', conditions, SYSTEM_VISIBILITY)
    ).resolves.toMatchObject({ count: 12, capped: false })
  })

  it('honours an explicit cap and asks for cap + 1 so "more" is knowable', async () => {
    const { db, execute } = countingDb(11)
    const result = await previewMatchCount(db, 'org_1', 'ibx_1', conditions, SYSTEM_VISIBILITY, {
      cap: 10,
    })
    expect(result).toMatchObject({ count: 10, capped: true })
    // The LIMIT is cap + 1 — one probe row past the ceiling, no second query.
    expect(collectValues(execute.mock.calls[0]?.[0])).toContain(11)
  })

  it('scopes the count to the filter’s inbox — never the whole mailbox', async () => {
    const { db, execute } = countingDb(1)
    await previewMatchCount(db, 'org_1', 'ibx_42', conditions, SYSTEM_VISIBILITY)
    expect(collectValues(execute.mock.calls[0]?.[0])).toContain('ibx_42')
  })
})

describe('the retroactive backfill (§7, invariant 10)', () => {
  const data = { organizationId: 'org_1', filterId: 'flt_1' }

  it('writes source: retroactive — the discriminator that avoids the live-run collision', async () => {
    h.pages = [
      [
        {
          id: 'thr_1',
          inboxId: 'ibx_1',
          status: 'OPEN',
          assigneeId: null,
          latestMessageId: 'msg_9',
        },
      ],
    ]

    await mailFilterRetroactiveApplyJob(jobCtx(data))

    expect(h.fire).toHaveBeenCalledTimes(1)
    const call = h.fire.mock.calls[0]?.[0]
    expect(call.source).toBe('retroactive')
    // The claim key is (filterId, messageId, source) and a per-thread backfill
    // row has to borrow the thread's LATEST message id — which is exactly why
    // `source` is in the key. Same filter, same message, different source ⇒ a
    // DISTINCT row, so `ON CONFLICT DO NOTHING` cannot silently discard the
    // retroactive outcome and its undo blob.
    expect(call.messageId).toBe('msg_9')
    expect(call.threadId).toBe('thr_1')
  })

  it('runs through the ENGINE, not a private executor', async () => {
    h.pages = [
      [
        {
          id: 'thr_1',
          inboxId: 'ibx_1',
          status: 'OPEN',
          assigneeId: null,
          latestMessageId: 'msg_9',
        },
      ],
    ]
    await mailFilterRetroactiveApplyJob(jobCtx(data))
    // Claim → execute → complete lives in `fireMailFilters`; bypassing it would
    // reintroduce the double-reply this feature's claim protocol prevents.
    expect(h.fire).toHaveBeenCalled()
    expect(h.fire.mock.calls[0]?.[0].filters).toHaveLength(1)
    expect(h.fire.mock.calls[0]?.[0].filters[0].id).toBe('flt_1')
  })

  it('respects containment — the selection is scoped to the filter’s own inbox', async () => {
    h.pages = [[]]
    await mailFilterRetroactiveApplyJob(jobCtx(data))
    // §4.4: only threads whose `inboxId` equals the filter's are even selected.
    expect(collectValues(h.captured.where)).toContain('ibx_1')
    // …and it is the same compiled predicate the fire path uses.
    expect(containsChunk(h.captured.where, h.predicate)).toBe(true)
  })

  it('pages, and reports what it covered', async () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `thr_${i}`,
        inboxId: 'ibx_1',
        status: 'OPEN',
        assigneeId: null,
        latestMessageId: `msg_${i}`,
      }))
    h.pages = [page(2), page(1)]

    const report = await mailFilterRetroactiveApplyJob(jobCtx({ ...data, pageSize: 2 }))

    expect(report).toMatchObject({ covered: 3, pages: 2, termination: 'complete' })
  })

  it('stops at the thread ceiling and SAYS SO — never a silent truncate', async () => {
    const page = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `thr_${offset + i}`,
        inboxId: 'ibx_1',
        status: 'OPEN',
        assigneeId: null,
        latestMessageId: `msg_${offset + i}`,
      }))
    h.pages = [page(2, 0), page(2, 2), page(2, 4)]

    const report = await mailFilterRetroactiveApplyJob(
      jobCtx({ ...data, pageSize: 2, maxThreads: 4 })
    )

    expect(report).toMatchObject({ covered: 4, termination: 'max-threads' })
    expect(h.fire).toHaveBeenCalledTimes(4)
  })

  it('counts (rather than hides) a thread with no message to claim on', async () => {
    h.pages = [
      [
        { id: 'thr_1', inboxId: 'ibx_1', status: 'OPEN', assigneeId: null, latestMessageId: null },
        { id: 'thr_2', inboxId: 'ibx_1', status: 'OPEN', assigneeId: null, latestMessageId: 'm2' },
      ],
    ]

    const report = await mailFilterRetroactiveApplyJob(jobCtx(data))

    expect(report).toMatchObject({ covered: 2, skippedNoMessage: 1 })
    expect(h.fire).toHaveBeenCalledTimes(1)
  })

  it('counts the escape-hatch actions it withheld, per executed thread (D18)', async () => {
    // The executor skips `run-agent` / `run-workflow` on a retroactive run; the
    // job has to SAY how many, or a filter that "did nothing" on the backfill
    // looks like a filter that matched nothing. Invariant 10 applies to skipped
    // actions as much as to truncated pages.
    const { ok } = await import('neverthrow')
    h.getFilter.mockResolvedValue(
      ok(
        filterRow({
          actions: [
            { type: 'set-status', status: 'ARCHIVED' },
            { type: 'run-agent', agentId: 'agt_1', agentTriggerId: 'trg_1' },
            { type: 'run-workflow', workflowAppId: 'wfa_1' },
          ],
        })
      )
    )
    h.pages = [
      [
        { id: 'thr_1', inboxId: 'ibx_1', status: 'OPEN', assigneeId: null, latestMessageId: 'm1' },
        { id: 'thr_2', inboxId: 'ibx_1', status: 'OPEN', assigneeId: null, latestMessageId: 'm2' },
      ],
    ]

    const report = await mailFilterRetroactiveApplyJob(jobCtx(data))

    // Two escape hatches × two fired threads.
    expect(report).toMatchObject({ fired: 2, skippedEscapeHatchActions: 4 })
  })

  it('counts nothing for a filter with no escape hatch', async () => {
    h.pages = [
      [{ id: 'thr_1', inboxId: 'ibx_1', status: 'OPEN', assigneeId: null, latestMessageId: 'm1' }],
    ]

    const report = await mailFilterRetroactiveApplyJob(jobCtx(data))

    expect(report).toMatchObject({ fired: 1, skippedEscapeHatchActions: 0 })
  })

  it('refuses to mass-mutate for a DISABLED filter', async () => {
    const { ok } = await import('neverthrow')
    h.getFilter.mockResolvedValue(ok(filterRow({ enabled: false })))

    await expect(mailFilterRetroactiveApplyJob(jobCtx(data))).resolves.toEqual({
      skipped: 'filter-disabled',
    })
    expect(h.fire).not.toHaveBeenCalled()
  })
})

describe('assertBackfillable', () => {
  it('rejects a disabled filter', () => {
    expect(assertBackfillable(filterRow({ enabled: false })).isErr()).toBe(true)
  })

  it('rejects a filter whose only action is suppress-automations', () => {
    const row = filterRow({ actions: [{ type: 'suppress-automations' }] })
    expect(assertBackfillable(row).isErr()).toBe(true)
  })

  it('rejects a filter made only of actions the backfill refuses to run (D18)', () => {
    // Every action here is withheld on a retroactive run, so applying it would
    // page the whole mailbox to write run rows whose every outcome is `skipped`.
    const row = filterRow({
      actions: [
        { type: 'suppress-automations' },
        { type: 'run-agent', agentId: 'agt_1', agentTriggerId: 'trg_1' },
        { type: 'run-workflow', workflowAppId: 'wfa_1' },
      ],
    })
    expect(assertBackfillable(row).isErr()).toBe(true)
  })

  it('accepts a filter that pairs an escape hatch with a real mail action', () => {
    const row = filterRow({
      actions: [
        { type: 'run-agent', agentId: 'agt_1', agentTriggerId: 'trg_1' },
        { type: 'set-status', status: 'ARCHIVED' },
      ],
    })
    expect(assertBackfillable(row).isOk()).toBe(true)
  })

  it('accepts an enabled filter with a real action', () => {
    expect(assertBackfillable(filterRow()).isOk()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

/**
 * §7.10 (`07-mail-reclassification-plan.md`) — the banner mounts in a fixed slot
 * for EVERY mail view and names the inbox it is about, so which candidate wins
 * is user-visible. Without a preference it asked about whichever inbox sorted
 * first, and this banner's button MUTATES: a mistargeted one puts a bulk
 * assign/archive over a whole mailbox's history one click away from someone who
 * was reading a different mailbox.
 *
 * A REORDER, never a filter, and never a grant — it is applied to the caller's
 * already-authorized candidate list.
 */
describe('findPendingRetroactivePrompt — the viewed inbox goes first (§7.10)', () => {
  const INBOX_A = 'ibx_a'
  const INBOX_B = 'ibx_b'

  /**
   * The three reads the prompt makes, in order: enabled filters (`select`),
   * prior retroactive runs (`selectDistinct`), live channels (`select`). Then one
   * `execute` per surviving candidate, IN ITERATION ORDER — so queueing counts
   * rather than keying them by inbox is what makes the order observable.
   */
  function promptDb(inboxIds: string[], counts: number[]) {
    const selectResults = [
      inboxIds.map((inboxId, i) => ({ id: `flt_${i}`, inboxId })),
      // `PROVIDER_CAPABILITIES` is keyed by `IntegrationProviderType`, whose
      // values are lowercase (`google`), not the `ChannelProvider` spellings.
      inboxIds.map((inboxId) => ({ inboxId, provider: 'google' })),
    ]
    let selectCall = 0
    const chain = (rows: unknown[]) => {
      const c: Record<string, unknown> = {}
      Object.assign(c, {
        from: () => c,
        innerJoin: () => c,
        where: () => c,
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(ok, err),
      })
      return c
    }
    let countCall = 0
    return {
      select: () => chain(selectResults[selectCall++] ?? []),
      selectDistinct: () => chain([]),
      execute: async () => ({ rows: [{ count: counts[countCall++] ?? 0 }] }),
    } as never
  }

  it('asks about the viewed inbox when it has threads', async () => {
    const prompt = await findPendingRetroactivePrompt(
      promptDb([INBOX_A, INBOX_B], [7, 7]),
      'org_1',
      [INBOX_A, INBOX_B],
      { preferredInboxId: INBOX_B }
    )

    expect(prompt).toMatchObject({ inboxId: INBOX_B })
  })

  // The preference is not a scope — a view whose own inbox has nothing pending
  // must still surface the inbox that does, or §2.9's discovery argument fails.
  it('falls back to another candidate when the viewed inbox has nothing', async () => {
    const prompt = await findPendingRetroactivePrompt(
      promptDb([INBOX_A, INBOX_B], [0, 7]),
      'org_1',
      [INBOX_A, INBOX_B],
      { preferredInboxId: INBOX_B }
    )

    expect(prompt).toMatchObject({ inboxId: INBOX_A })
  })

  // ⚠️ The preference must never widen the answer — `candidateInboxIds` is the
  // caller's authorized set, and an id outside it is inert, not an oracle.
  it('ignores an inbox that was not already a candidate', async () => {
    const prompt = await findPendingRetroactivePrompt(
      promptDb([INBOX_A, INBOX_B], [7, 7]),
      'org_1',
      [INBOX_A, INBOX_B],
      { preferredInboxId: 'ibx_not_mine' }
    )

    expect(prompt).toMatchObject({ inboxId: INBOX_A })
  })

  // Search, drafts and all-inboxes span inboxes and pass nothing.
  it('still asks when no inbox is being viewed', async () => {
    const prompt = await findPendingRetroactivePrompt(
      promptDb([INBOX_A, INBOX_B], [7, 7]),
      'org_1',
      [INBOX_A, INBOX_B]
    )

    expect(prompt).toMatchObject({ inboxId: INBOX_A })
  })
})
