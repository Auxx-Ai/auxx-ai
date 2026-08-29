// packages/lib/src/postings/__tests__/post-entry.test.ts
//
// The poster is the one place a journal entry can be written twice, and a
// double-posted entry has no invoice and no payment to reconcile against - it
// is not noticed until a close does not tie out. So almost every test here is
// either a convergence test or a refusal test, and the refusals all assert the
// same second thing: **that nothing was written**.
//
// ⚠️ **What the concurrency test here does and does not prove.** The database is
// an in-memory fake whose claim insert holds a mutex and re-checks the claim
// tuple inside it - which is what `ON CONFLICT DO NOTHING` does against an
// uncommitted tuple, and it makes the loser's path deterministic. It proves
// `postEntry` CONVERGES: exactly one row, exactly one `already_posted`, no
// second claim. It does NOT prove Postgres's index behaviour.
//
// 🛑 The brief said "#1975 already proved this index that way - reuse the
// harness." It did not. `packages/database/src/tests/gl-posting-schema.test.ts`
// asserts the index's SHAPE from `getTableConfig` and says so in its own header:
// "The live-database counterpart (the index actually rejecting a concurrent
// duplicate) belongs to the claim path in packages/lib/src/postings/." There is
// no live-Postgres harness to reuse. One is owed as a `post-entry.int.test.ts`
// under `vitest.integration.config.ts`, which is the only config that does not
// mock `@auxx/database`.
//
// The fake is hand-written rather than a chainable spy for the reason
// `resolve-roles.test.ts` gives: this module issues several distinct reads and
// writes across three tables and each has to answer differently.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ fields: new Map<string, string>() }))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.has(a) ? { id: h.fields.get(a) } : null])),
    }),
  }),
}))

import { err, ok, type Result } from 'neverthrow'
import { postEntry, previewEntry } from '../post-entry'
import {
  __resetAccountingProvidersForTests,
  registerAccountingProvider,
  setConnectedProviderResolver,
} from '../provider'
import type { BuiltEntry, PostEntryInput, PostEntryResult } from '../types'
import { ProviderPostError } from '../types'

const ORG = 'org_1'
const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'

// ── The fake database ──────────────────────────────────────────────────────

interface PostingRow {
  id: string
  organizationId: string
  postingType: string
  periodKey: string
  revision: number
  status: string
  txnDate: string
  docNumber: string
  currency: string
  totalMinor: number
  draft: Record<string, unknown>
  requestId: string
  providerId: string | null
  providerEntryId: string | null
  postedAt: Date | null
  postedByUserId: string | null
  failureReason: string | null
  attempts: number
  reversesId: string | null
}

interface LineRow {
  organizationId: string
  glPostingId: string
  lineNumber: number
  accountCode: string
  accountRole: string | null
  accountName: string | null
  direction: string
  amountMinor: number
  memo: string | null
  sourceType: string
  sourceId: string
}

interface Account {
  id: string
  code: string
  name: string
  accountType: string
  isActive?: boolean
}

interface Chart {
  role: string
  account?: Account
}

/**
 * Walk a Drizzle `SQL` condition and collect the literal values it binds.
 *
 * Under `src/test/setup.ts` every `schema.X.y` is `undefined`, so a condition
 * carries its VALUES and not its columns - which is exactly enough to answer
 * "which row does this `WHERE` name", since the ids under test are distinctive.
 */
function boundValues(condition: unknown): string[] {
  const out: string[] = []
  const visit = (node: unknown): void => {
    if (node == null) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node === 'string') {
      out.push(node)
      return
    }
    if (typeof node === 'object') {
      const record = node as Record<string, unknown>
      if ('queryChunks' in record) visit(record.queryChunks)
      else if ('value' in record) visit(record.value)
    }
  }
  visit(condition)
  return out
}

class UniqueViolation extends Error {
  readonly code = '23505'
  constructor(readonly constraint: string) {
    super(`duplicate key value violates unique constraint "${constraint}"`)
  }
}

function createFakeDb(chart: Chart[]) {
  const postings: PostingRow[] = []
  const lines: LineRow[] = []
  let seq = 0

  /** Set by a conflicting claim so the follow-up SELECT reads that row. */
  let claimLookup: ((row: PostingRow) => boolean) | null = null
  /** Awaited inside the claim's critical section, to interleave two runs. */
  let beforeClaimCommit: (() => Promise<void>) | null = null
  /** Makes the outcome-stamping UPDATE fail, to model a crash after the push. */
  let updateThrows = false

  // One mutex, standing in for the index tuple two concurrent claims contend
  // on. Without it the second run's key check reads a table the first has not
  // written to yet and both insert - which is the defect under test.
  let lock: Promise<void> = Promise.resolve()
  async function withClaimLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = lock
    let release = (): void => {}
    lock = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }

  const thenable = (get: () => unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.where = () => chain
    chain.limit = () => chain
    chain.orderBy = () => chain
    // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => get())
        .then(resolve, reject)
    return chain
  }

  const accounts = chart.filter((entry) => entry.account).map((entry) => entry.account as Account)

  async function runClaim(values: Record<string, unknown>): Promise<unknown[]> {
    return withClaimLock(async () => {
      if (beforeClaimCommit) await beforeClaimCommit()

      const duplicate = postings.find(
        (row) =>
          row.organizationId === values.organizationId &&
          row.postingType === values.postingType &&
          row.periodKey === values.periodKey &&
          row.revision === values.revision
      )
      if (duplicate) {
        // ON CONFLICT (org, type, period, revision) DO NOTHING: no row back.
        claimLookup = (row) => row === duplicate
        return []
      }

      // 🛑 The OTHER unique indexes are NOT covered by that ON CONFLICT target,
      // so they still raise 23505 out of a statement with an ON CONFLICT clause
      // sitting right there. Modelled here so the poster's catch is exercised.
      if (
        postings.some(
          (row) =>
            row.organizationId === values.organizationId && row.docNumber === values.docNumber
        )
      ) {
        throw new UniqueViolation('GlPosting_org_docNumber_key')
      }

      seq += 1
      const claimed = values as unknown as Omit<PostingRow, 'id'>
      const row: PostingRow = {
        ...claimed,
        id: `post_${seq}`,
        postedAt: claimed.postedAt ?? null,
        failureReason: claimed.failureReason ?? null,
        attempts: claimed.attempts ?? 0,
        providerEntryId: claimed.providerEntryId ?? null,
        providerId: claimed.providerId ?? null,
      }
      postings.push(row)
      return [{ id: row.id, docNumber: row.docNumber, requestId: row.requestId }]
    })
  }

  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),

    select: () => ({
      from: (table: unknown) => {
        if (table === schema.GlRoleAssignment) {
          return thenable(() =>
            chart.map((entry) => ({
              role: entry.role,
              glAccountId: entry.account?.id ?? `missing_${entry.role}`,
              markedUnused: false,
            }))
          )
        }
        if (table === schema.EntityInstance) {
          return thenable(() => accounts.map((account) => ({ id: account.id })))
        }
        if (table === schema.FieldValue) {
          return thenable(() =>
            accounts.flatMap((account) => [
              { entityId: account.id, fieldId: CODE_FIELD, valueText: account.code },
              { entityId: account.id, fieldId: NAME_FIELD, valueText: account.name },
              { entityId: account.id, fieldId: TYPE_FIELD, optionId: account.accountType },
              {
                entityId: account.id,
                fieldId: ACTIVE_FIELD,
                valueBoolean: account.isActive ?? true,
              },
            ])
          )
        }
        if (table === schema.GlPosting) {
          return thenable(() => {
            const filter = claimLookup
            claimLookup = null
            return filter ? postings.filter(filter) : [...postings]
          })
        }
        if (table === schema.GlPostingLine) {
          return thenable(() => [...lines])
        }
        return thenable(() => [])
      },
    }),

    insert: (table: unknown) => {
      let captured: unknown
      const chain: Record<string, unknown> = {}
      chain.values = (value: unknown) => {
        captured = value
        return chain
      }
      chain.onConflictDoNothing = () => chain
      const run = async (): Promise<unknown[]> => {
        if (table === schema.GlPosting) {
          return runClaim(captured as Record<string, unknown>)
        }
        lines.push(...(captured as LineRow[]))
        return []
      }
      chain.returning = () => thenable2(run)
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        run().then(resolve, reject)
      return chain
    },

    update: (table: unknown) => {
      let values: Record<string, unknown> = {}
      let condition: unknown
      const chain: Record<string, unknown> = {}
      chain.set = (next: Record<string, unknown>) => {
        values = next
        return chain
      }
      chain.where = (next: unknown) => {
        condition = next
        return chain
      }
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => {
            if (table !== schema.GlPosting) return
            if (updateThrows) throw new Error('connection terminated')
            const named = boundValues(condition)
            for (const row of postings) {
              if (!named.includes(row.id)) continue
              for (const [key, value] of Object.entries(values)) {
                if (key === 'attempts' && typeof value !== 'number') row.attempts += 1
                else (row as unknown as Record<string, unknown>)[key] = value
              }
            }
          })
          .then(resolve, reject)
      return chain
    },
  }

  function thenable2(run: () => Promise<unknown[]>) {
    return {
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        run().then(resolve, reject),
    }
  }

  return {
    db: db as never,
    postings,
    lines,
    setBeforeClaimCommit: (fn: (() => Promise<void>) | null) => {
      beforeClaimCommit = fn
    },
    setUpdateThrows: (value: boolean) => {
      updateThrows = value
    },
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const GRNI: Account = {
  id: 'acct_grni',
  code: '2160',
  name: 'Goods Received Not Invoiced',
  accountType: 'liability',
}
const RAW: Account = {
  id: 'acct_raw',
  code: '1310',
  name: 'Raw Materials Inventory',
  accountType: 'asset',
}

const FULL_CHART: Chart[] = [
  { role: 'grni', account: GRNI },
  { role: 'inventory_raw_materials', account: RAW },
]

function receiptEntry(overrides: Partial<BuiltEntry> = {}): BuiltEntry {
  return {
    postingType: 'receipt',
    periodKey: '2026-08-18',
    txnDate: '2026-08-18',
    lines: [
      {
        accountRole: 'inventory_raw_materials',
        direction: 'debit',
        amount: 125_000,
        sourceType: 'stock_movement',
        sourceId: 'mv_1',
        sortOrder: 0,
      },
      {
        accountRole: 'grni',
        direction: 'credit',
        amount: 125_000,
        sourceType: 'stock_movement',
        sourceId: 'mv_1',
        sortOrder: 1,
      },
    ],
    totalDebit: 125_000,
    totalCredit: 125_000,
    ...overrides,
  }
}

const OPEN = { lockedThroughMonth: null }

beforeEach(() => {
  h.fields = new Map([
    ['gl_account_code', CODE_FIELD],
    ['gl_account_name', NAME_FIELD],
    ['gl_account_type', TYPE_FIELD],
    ['gl_account_is_active', ACTIVE_FIELD],
  ])
  __resetAccountingProvidersForTests()
})

/** A provider that records what it was handed and answers however the test says. */
function stubProvider(
  answer: (input: PostEntryInput) => Result<PostEntryResult, Error>,
  id = 'stub'
) {
  const seen: PostEntryInput[] = []
  registerAccountingProvider(id, async () => ({
    id,
    resolveAccount: async (_org: string, code: string) => ok(code),
    postEntry: async (input: PostEntryInput) => {
      seen.push(input)
      return answer(input)
    },
  }))
  setConnectedProviderResolver(async () => id)
  return seen
}

// ── An org with nothing connected ──────────────────────────────────────────

describe('an organization with no accounting provider', () => {
  it('builds, balances, claims and persists the entry, and reports not_connected', async () => {
    const fake = createFakeDb(FULL_CHART)

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      actorUserId: 'user_1',
    })

    // `not_connected` is a first-class outcome, not a degraded one: decision P1
    // says the ledger is ours whether or not anything is connected.
    expect(result.status).toBe('not_connected')
    expect(result.providerId).toBe('none')
    expect(result.providerEntryId).toBeUndefined()
    expect(result.docNumber).toBe('AUXX-RCP-20260818')
    expect(result.glPostingId).toBeDefined()

    expect(fake.postings).toHaveLength(1)
    const row = fake.postings[0]!
    // Marked `posted`, not left `pending`: there is nothing in flight and
    // nothing for a heal to find, so `pending` would park it in the retry
    // queue forever.
    expect(row.status).toBe('posted')
    expect(row.postedAt).toBeInstanceOf(Date)
    expect(row.providerId).toBe('none')
    expect(row.providerEntryId).toBeNull()
    expect(row.currency).toBe('USD')
    expect(row.totalMinor).toBe(125_000)
    expect(row.revision).toBe(0)
    expect(row.reversesId).toBeNull()
    expect(row.postedByUserId).toBe('user_1')
    expect(row.requestId).toHaveLength(50)
  })

  it('writes both lines with 1-based numbers and a snapshot of code, role and name', async () => {
    const fake = createFakeDb(FULL_CHART)
    await postEntry(fake.db, { organizationId: ORG, entry: receiptEntry(), lock: OPEN })

    expect(fake.lines).toHaveLength(2)
    expect(fake.lines.map((line) => line.lineNumber)).toEqual([1, 2])
    expect(fake.lines[0]).toMatchObject({
      lineNumber: 1,
      accountCode: '1310',
      accountRole: 'inventory_raw_materials',
      accountName: 'Raw Materials Inventory',
      direction: 'debit',
      amountMinor: 125_000,
      sourceType: 'stock_movement',
      sourceId: 'mv_1',
    })
    expect(fake.lines[1]).toMatchObject({
      lineNumber: 2,
      accountCode: '2160',
      accountRole: 'grni',
      direction: 'credit',
    })
  })

  it('stores the built entry AND the resolved lines as the draft audit record', async () => {
    const fake = createFakeDb(FULL_CHART)
    await postEntry(fake.db, { organizationId: ORG, entry: receiptEntry(), lock: OPEN })

    const draft = fake.postings[0]!.draft as {
      v: number
      entry: BuiltEntry
      resolvedLines: { accountRole: string; accountCode: string }[]
    }
    expect(draft.v).toBe(1)
    expect(draft.entry.lines).toHaveLength(2)
    // Rebuilding the resolved lines from the subledger later gives a different
    // answer once the subledger moves, which is the property a ledger must not
    // have. So they are stored, not hinted at.
    expect(draft.resolvedLines.map((line) => line.accountCode).sort()).toEqual(['1310', '2160'])
  })
})

// ── Convergence ────────────────────────────────────────────────────────────

describe('the claim', () => {
  it('converges on already_posted for a second run and writes no second row', async () => {
    const fake = createFakeDb(FULL_CHART)
    const first = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })
    const second = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })

    expect(second.status).toBe('already_posted')
    expect(second.glPostingId).toBe(first.glPostingId)
    expect(second.docNumber).toBe(first.docNumber)
    expect(second.providerId).toBe('none')
    expect(fake.postings).toHaveLength(1)
    // A second run must not append a second set of lines to the same header.
    expect(fake.lines).toHaveLength(2)
  })

  it('mints the same requestId on both runs - no run salt', async () => {
    const fake = createFakeDb(FULL_CHART)
    const seen = stubProvider(() =>
      ok({ status: 'posted', externalId: 'qb_1', providerId: 'stub' })
    )

    await postEntry(fake.db, { organizationId: ORG, entry: receiptEntry(), lock: OPEN })
    const firstKey = seen[0]!.idempotencyKey

    // A different fake, so the second run claims rather than converging - which
    // is the case where a differing key would go unnoticed.
    const other = createFakeDb(FULL_CHART)
    await postEntry(other.db, { organizationId: ORG, entry: receiptEntry(), lock: OPEN })

    expect(seen[1]!.idempotencyKey).toBe(firstKey)
    // And it is the value the row was claimed with, read back rather than
    // recomputed at the call site.
    expect(firstKey).toBe(fake.postings[0]!.requestId)
  })

  it('lets exactly one of two concurrent runs claim the period', async () => {
    const fake = createFakeDb(FULL_CHART)

    // Yield inside the claim's critical section. Without the mutex both runs
    // would read an empty table here and both would insert.
    fake.setBeforeClaimCommit(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const [a, b] = await Promise.all([
      postEntry(fake.db, { organizationId: ORG, entry: receiptEntry(), lock: OPEN }),
      postEntry(fake.db, { organizationId: ORG, entry: receiptEntry(), lock: OPEN }),
    ])

    expect(fake.postings).toHaveLength(1)
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual(['already_posted', 'not_connected'])
    // The loser learns the winner's row rather than being told to retry.
    expect(a.glPostingId).toBe(b.glPostingId)
    expect(a.glPostingId).toBe(fake.postings[0]!.id)
  })

  it('surfaces a 23505 on an index the ON CONFLICT target does not cover', async () => {
    const fake = createFakeDb(FULL_CHART)
    await postEntry(fake.db, { organizationId: ORG, entry: receiptEntry(), lock: OPEN })

    // A DIFFERENT claim tuple that mints the SAME document number:
    // `buildDocNumber` strips hyphens, so '20260818' and '2026-08-18' compact
    // to one string while the claim's third column sees two. The ON CONFLICT
    // target therefore does not match and GlPosting_org_docNumber_key raises
    // 23505 out of a statement that has an ON CONFLICT clause sitting there.
    const collision = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry({ periodKey: '20260818' }),
      lock: OPEN,
    })

    expect(collision.status).toBe('error')
    expect(collision.failureClass).toBe('data')
    expect(collision.retryable).toBe(false)
    expect(collision.error).toContain('AUXX-RCP-20260818')
    expect(collision.error).toContain('already used')
    expect(fake.postings).toHaveLength(1)
  })
})

// ── Refusals, and that none of them write ──────────────────────────────────

describe('refusals', () => {
  it('refuses a month-end inventory posting that carries no assertions', async () => {
    const fake = createFakeDb(FULL_CHART)
    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry({ postingType: 'month_end_inventory', periodKey: '2026-08' }),
      lock: OPEN,
    })

    // A month-end entry ASSERTS a balance rather than accumulating one, so the
    // next close reads its opening figures out of this row's draft. Written
    // without them it would hold the period - nothing can repair a claimed
    // period - and leave the next month computing a delta from nothing. That
    // entry balances perfectly, which is why this door exists.
    expect(result.status).toBe('error')
    expect(result.failureClass).toBe('data')
    expect(result.retryable).toBe(false)
    expect(result.error).toContain('assertions')
    // Refused BEFORE the claim: nothing holds the period.
    expect(fake.postings).toHaveLength(0)
    expect(fake.lines).toHaveLength(0)
  })

  it('accepts a month-end inventory posting WITH assertions, and stores them verbatim', async () => {
    const fake = createFakeDb(FULL_CHART)
    const snapshot = {
      balances: { inventory_raw_materials: 0, inventory_wip: 0, inventory_finished_goods: 0 },
      activityTotals: { absorbedLabor: 0, absorbedOverhead: 0, inventoryAdjustments: 0 },
    }
    await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry({ postingType: 'month_end_inventory', periodKey: '2026-08' }),
      lock: OPEN,
      assertions: { kind: 'month_end_inventory', before: snapshot, after: snapshot },
    })

    const draft = fake.postings[0]!.draft as { assertions?: { kind: string } }
    expect(draft.assertions?.kind).toBe('month_end_inventory')
  })

  it('refuses a closed period and writes nothing', async () => {
    const fake = createFakeDb(FULL_CHART)
    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: { lockedThroughMonth: '2026-08' },
    })

    expect(result.status).toBe('period_closed')
    expect(result.failureClass).toBe('configuration')
    expect(result.retryable).toBe(false)
    expect(result.error).toContain('2026-08')
    // Absent `glPostingId` is the caller's signal that nothing was written.
    expect(result.glPostingId).toBeUndefined()
    expect(fake.postings).toHaveLength(0)
    expect(fake.lines).toHaveLength(0)
  })

  it('names every unmapped role at once, and writes nothing', async () => {
    const fake = createFakeDb([{ role: 'grni' }, { role: 'inventory_raw_materials' }])
    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })

    expect(result.status).toBe('account_unmapped')
    expect(result.failureClass).toBe('configuration')
    expect(result.retryable).toBe(false)
    // A bookkeeper fixing a close needs the list, not a treasure hunt.
    expect(result.error).toContain('grni')
    expect(result.error).toContain('inventory_raw_materials')
    expect(result.glPostingId).toBeUndefined()
    expect(fake.postings).toHaveLength(0)
  })

  it('names both totals and the dollar difference on an imbalance, and writes nothing', async () => {
    const fake = createFakeDb(FULL_CHART)
    const unbalanced = receiptEntry()
    unbalanced.lines[0]!.amount = 1_234_000
    unbalanced.lines[1]!.amount = 1_230_000

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: unbalanced,
      lock: OPEN,
    })

    expect(result.status).toBe('unbalanced')
    expect(result.failureClass).toBe('data')
    // Read at 11pm on the 3rd. Both sides and the gap, in dollars.
    expect(result.error).toContain('$12,340.00')
    expect(result.error).toContain('$12,300.00')
    expect(result.error).toContain('$40.00')
    expect(fake.postings).toHaveLength(0)
  })

  it('refuses a revision above 0 that names nothing, and a revision 0 that does', async () => {
    const fake = createFakeDb(FULL_CHART)

    const orphanReversal = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      revision: 1,
    })
    expect(orphanReversal.status).toBe('error')
    expect(orphanReversal.error).toContain('must name the posting it reverses')

    const originalWithParent = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      reversesId: 'post_9',
    })
    expect(originalWithParent.status).toBe('error')
    expect(fake.postings).toHaveLength(0)
  })
})

// ── The build/payout period key ────────────────────────────────────────────

describe('a posting whose period key is an id, not a date', () => {
  // `build` keys on `build.number` and `payout` on the payout id, deliberately:
  // two builds in one day would otherwise collide into one entry. Those keys do
  // not parse, and `isPeriodLocked` short-circuits while nothing is closed - so
  // this is invisible until an org closes its FIRST month.
  const buildEntryFixture = (): BuiltEntry =>
    receiptEntry({ postingType: 'build', periodKey: 'BLD-0007', txnDate: '2026-09-04' })

  it('does not throw once a lock exists, and evaluates the lock against txnDate', async () => {
    const fake = createFakeDb(FULL_CHART)
    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: buildEntryFixture(),
      lock: { lockedThroughMonth: '2026-08' },
    })

    expect(result.status).toBe('not_connected')
    expect(result.docNumber).toBe('AUXX-BLD-BLD0007')
    expect(fake.postings).toHaveLength(1)
  })

  it('still refuses when the txnDate falls in a closed month', async () => {
    const fake = createFakeDb(FULL_CHART)
    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry({ postingType: 'build', periodKey: 'BLD-0008', txnDate: '2026-07-30' }),
      lock: { lockedThroughMonth: '2026-08' },
    })

    expect(result.status).toBe('period_closed')
    expect(fake.postings).toHaveLength(0)
  })

  it('refuses rather than posting blind when neither key can be read as a period', async () => {
    const fake = createFakeDb(FULL_CHART)
    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry({ postingType: 'build', periodKey: 'BLD-0009', txnDate: 'not-a-date' }),
      lock: { lockedThroughMonth: '2026-08' },
    })

    // NOT `period_closed`: telling a bookkeeper to reopen a month that was
    // never the problem is worse than telling them the key is wrong.
    expect(result.status).toBe('error')
    expect(result.failureClass).toBe('configuration')
    expect(fake.postings).toHaveLength(0)
  })
})

// ── The provider ───────────────────────────────────────────────────────────

describe('the provider outcome', () => {
  it('records a successful push on the row in one update', async () => {
    const fake = createFakeDb(FULL_CHART)
    stubProvider(() => ok({ status: 'posted', externalId: 'qb_77', providerId: 'stub' }))

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })

    expect(result.status).toBe('posted')
    expect(result.providerEntryId).toBe('qb_77')
    const row = fake.postings[0]!
    expect(row.status).toBe('posted')
    // GlPosting_posted_check is `status <> 'posted' OR postedAt IS NOT NULL`,
    // so these two cannot be separate statements.
    expect(row.postedAt).toBeInstanceOf(Date)
    expect(row.providerEntryId).toBe('qb_77')
  })

  it('passes healed and already_posted through untouched - both are successes', async () => {
    for (const status of ['healed', 'already_posted'] as const) {
      // The manager caches a provider instance by id, so re-registering under
      // the same id inside the loop would keep the FIRST answer.
      __resetAccountingProvidersForTests()
      const fake = createFakeDb(FULL_CHART)
      stubProvider(() => ok({ status, externalId: 'qb_9', providerId: 'stub' }))
      const result = await postEntry(fake.db, {
        organizationId: ORG,
        entry: receiptEntry(),
        lock: OPEN,
      })
      expect(result.status).toBe(status)
      expect(fake.postings[0]!.status).toBe('posted')
    }
  })

  it('routes a classified provider fault and marks the row failed', async () => {
    const fake = createFakeDb(FULL_CHART)
    stubProvider(() =>
      err(
        new ProviderPostError('Rate limited', {
          failureClass: 'transport',
          providerId: 'stub',
          faultCode: '429',
        })
      )
    )

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })

    expect(result.status).toBe('error')
    expect(result.failureClass).toBe('transport')
    expect(result.retryable).toBe(true)
    expect(result.error).toContain('429')
    // The claim, the lines and the requestId all survive: a retry reuses them.
    const row = fake.postings[0]!
    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(1)
    expect(row.failureReason).toContain('Rate limited')
    expect(fake.lines).toHaveLength(2)
  })

  it('never retries a configuration or data fault the adapter classified', async () => {
    const fake = createFakeDb(FULL_CHART)
    stubProvider(() =>
      err(new ProviderPostError('Imbalanced', { failureClass: 'data', providerId: 'stub' }))
    )

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })
    expect(result.failureClass).toBe('data')
    expect(result.retryable).toBe(false)
  })

  it('treats an UNCLASSIFIED provider error as not retryable', async () => {
    const fake = createFakeDb(FULL_CHART)
    stubProvider(() => err(new Error('socket hang up')))

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })

    // The worst case behind an unclassified throw is "the entry WAS accepted and
    // the connection dropped". Auto-retrying that is safe only if the adapter
    // has its own idempotency ladder, and the core cannot assume one exists.
    // A human clicking Post again is the cheaper half of the trade.
    expect(result.failureClass).toBe('transport')
    expect(result.retryable).toBe(false)
    expect(fake.postings[0]!.status).toBe('failed')
  })

  it('still reports the posting when the outcome stamp itself fails', async () => {
    const fake = createFakeDb(FULL_CHART)
    stubProvider(() => ok({ status: 'posted', externalId: 'qb_55', providerId: 'stub' }))
    fake.setUpdateThrows(true)

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })

    // The provider has ALREADY accepted the entry. Reporting `error` with no
    // `glPostingId` would tell the caller nothing was written, about a row that
    // is sitting in a general ledger.
    expect(result.status).toBe('posted')
    expect(result.glPostingId).toBe('post_1')
    expect(result.providerEntryId).toBe('qb_55')
    // The row stays `pending`: claimed, pushed, unconfirmed - which is exactly
    // what the adapter's document-number heal repairs on the next attempt.
    expect(fake.postings[0]!.status).toBe('pending')
  })

  it('never throws, whatever the provider does', async () => {
    const fake = createFakeDb(FULL_CHART)
    registerAccountingProvider('explodes', async () => ({
      id: 'explodes',
      resolveAccount: async (_org: string, code: string) => ok(code),
      postEntry: async () => {
        throw new Error('boom')
      },
    }))
    setConnectedProviderResolver(async () => 'explodes')

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })
    expect(result.status).toBe('error')
    expect(result.error).toContain('boom')
  })
})

// ── Preview ────────────────────────────────────────────────────────────────

describe('previewEntry', () => {
  it('persists nothing', async () => {
    const fake = createFakeDb(FULL_CHART)
    const preview = await previewEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })

    expect(fake.postings).toHaveLength(0)
    expect(fake.lines).toHaveLength(0)
    expect(preview.docNumber).toBe('AUXX-RCP-20260818')
    expect(preview.totalMinor).toBe(125_000)
    expect(preview.lines.map((line) => line.accountCode)).toEqual(['1310', '2160'])
    expect(preview.lines[0]!.accountName).toBe('Raw Materials Inventory')
    expect(preview.blockedBy).toBeUndefined()
  })

  it('still shows the lines it would post when the period is closed', async () => {
    const fake = createFakeDb(FULL_CHART)
    const preview = await previewEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: { lockedThroughMonth: '2026-08' },
    })

    expect(preview.blockedBy?.status).toBe('period_closed')
    // The whole point of a preview is seeing the entry before it lands.
    expect(preview.lines).toHaveLength(2)
    expect(fake.postings).toHaveLength(0)
  })

  it('reports the same refusal postEntry would, for an unmapped role', async () => {
    const fake = createFakeDb([
      { role: 'grni', account: GRNI },
      { role: 'inventory_raw_materials' },
    ])
    const preview = await previewEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
    })

    expect(preview.blockedBy?.status).toBe('account_unmapped')
    expect(preview.blockedBy?.error).toContain('inventory_raw_materials')
    expect(preview.lines).toHaveLength(0)
  })
})
