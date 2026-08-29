// packages/lib/src/postings/__tests__/post-entry.int.test.ts
//
// DB-backed tests (vitest.integration.config.ts -> auxx_test) for the four
// claims `post-entry.test.ts` structurally CANNOT make.
//
// The unit tests run against a hand-written in-memory fake whose claim insert
// holds a JavaScript mutex. That fake was built to model `ON CONFLICT DO
// NOTHING` against an uncommitted tuple, and it proves `postEntry` CONVERGES -
// one row, one `already_posted`, both callers carrying the same id. It proves
// nothing whatsoever about Postgres, because the mutex is the thing being
// trusted and the mutex is mine.
//
// That gap used to be covered twice over: the brief's section 7 also asked for
// a real month to be previewed and posted in a browser. That drive has been
// deferred to a separate UI task (there is no ledger screen to drive yet), so
// this file is now the ONLY proof that the double-post defence actually holds.
//
// 🛑 The brief said "#1975 already proved this index that way - reuse the
// harness." It did not. `packages/database/src/tests/gl-posting-schema.test.ts`
// asserts the index's SHAPE out of `getTableConfig` and says so in its own
// header: "The live-database counterpart (the index actually rejecting a
// concurrent duplicate) belongs to the claim path in
// packages/lib/src/postings/." This file is that counterpart.
//
// The four claims:
//
//   1. **The claim under genuine concurrency.** Two connections out of the test
//      pool, both posting the same `(org, type, period, revision)`. Exactly one
//      row, one fresh post, one `already_posted`, one shared `glPostingId`.
//   2. **The 23505 catch firing for real.** `ON CONFLICT (org, type, period,
//      revision)` handles conflicts on THAT index and no other, so a collision
//      on `GlPosting_org_docNumber_key` still raises out of a statement with an
//      `ON CONFLICT` clause sitting right there.
//   3. **Both CHECK constraints, live** - and specifically that the friendly
//      pre-validation in `postEntry` and the constraint AGREE, rather than only
//      testing the path that never reaches Postgres.
//   4. **A reversal pair end to end**, with `verifyBooksBalance` green over it.
//
// Everything under test is real: real migrations, the registry's own
// `gl_account` definition and fields, the default chart seeded through
// `UnifiedCrudHandler`, real `GlRoleAssignment` rows and the production org
// cache falling back to its in-memory layer.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, asc, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── The two queue-backed externals, mocked OFF ───────────────────────────────
//
// ⚠️ Not decoration. `publisher.publishLater` and `enqueueDuplicateScan` are
// BullMQ writes, and BullMQ's default `maxRetriesPerRequest: null` means a
// command issued against an unreachable Redis never settles - so the suite
// HANGS rather than fails. Both sit under the chart seeder's
// `UnifiedCrudHandler` writes, and neither is part of any claim below.
// `complete-build-transaction.int.test.ts` does exactly this, for exactly this.

vi.mock('../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})

vi.mock('../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../dedup/enqueue-scan')>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})

import { createEntityDefinitions } from '../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../seed/entity-seeder/create-fields'
import type { EntityDefMap } from '../../seed/entity-seeder/types'
import { seedDefaultChartOfAccounts } from '../../seed/gl-account-chart'
import { postEntry } from '../post-entry'
import { reverseEntry } from '../reverse-entry'
import type { BuiltEntry } from '../types'
import { verifyBooksBalance } from '../verify-balance'

const db = () => getTestDb() as unknown as Database

const OPEN = { lockedThroughMonth: null }

interface LedgerFixture {
  organizationId: string
  userId: string
}

/**
 * An organization with the registry's own `gl_account` definition, the seeded
 * default chart, and a `GlRoleAssignment` per role.
 *
 * Only `gl_account`'s fields are materialised. `createAllFields` keys off the
 * map it is handed and the registry carries ~1,000 fields across every def, so
 * narrowing it is the difference between a fast fixture and a slow one -
 * repeated per test, because `per-test-setup` truncates every table after each.
 * Nothing here reads a field on any other definition.
 */
async function seedLedgerOrg(): Promise<LedgerFixture> {
  const org = await createTestOrganization()
  const user = await createTestUser({ name: 'Bookkeeper' })

  // The chart seeder resolves a system user for its writes.
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, org.id))

  const entityDefMap = await createEntityDefinitions(db(), org.id)
  const glAccountDef = entityDefMap.get('gl_account')
  if (!glAccountDef) throw new Error('fixture: no gl_account entity definition was seeded')

  const narrowed: EntityDefMap = new Map([['gl_account', glAccountDef]])
  await createAllFields(db(), org.id, narrowed)

  const seeded = await seedDefaultChartOfAccounts(db(), org.id, glAccountDef.id)
  if (seeded.created === 0) throw new Error('fixture: the default chart seeded no accounts')
  if (seeded.rolesAssigned === 0) throw new Error('fixture: no posting roles were assigned')

  return { organizationId: org.id, userId: user.id }
}

/**
 * A balanced two-line receipt entry: raw materials debited, GRNI credited.
 * Both roles are in the seeded default chart, so both resolve for real.
 */
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

let f: LedgerFixture

beforeEach(async () => {
  f = await seedLedgerOrg()
})

/** Every `GlPosting` row in the fixture org, oldest claim first. */
async function postings() {
  return db()
    .select()
    .from(schema.GlPosting)
    .where(eq(schema.GlPosting.organizationId, f.organizationId))
    .orderBy(asc(schema.GlPosting.createdAt), asc(schema.GlPosting.revision))
}

async function lines(glPostingId?: string) {
  const rows = await db()
    .select()
    .from(schema.GlPostingLine)
    .where(eq(schema.GlPostingLine.organizationId, f.organizationId))
    .orderBy(asc(schema.GlPostingLine.lineNumber))
  return glPostingId ? rows.filter((row) => row.glPostingId === glPostingId) : rows
}

// ── 1. The claim, against the real index ───────────────────────────────────

describe('the claim under genuine concurrency', () => {
  it('lets exactly one of two connections claim the period', async () => {
    // Two `postEntry` calls started together take two connections out of the
    // test pool, so both reach the INSERT before either commits. The loser
    // BLOCKS on the winner's uncommitted index tuple, resumes when it commits,
    // gets no row back from ON CONFLICT DO NOTHING and reads the winner's row
    // in the same transaction.
    //
    // 🛑 The assertion holds under either schedule. If the two happen to
    // serialize, the second still converges through `already_posted` - which is
    // the point: there is no interleaving in which two rows exist.
    const [a, b] = await Promise.all([
      postEntry(db(), { organizationId: f.organizationId, entry: receiptEntry(), lock: OPEN }),
      postEntry(db(), { organizationId: f.organizationId, entry: receiptEntry(), lock: OPEN }),
    ])

    const rows = await postings()
    expect(rows).toHaveLength(1)

    expect([a.status, b.status].sort()).toEqual(['already_posted', 'not_connected'])
    expect(a.glPostingId).toBe(b.glPostingId)
    expect(a.glPostingId).toBe(rows[0]!.id)
    expect(a.docNumber).toBe('AUXX-RCP-20260818')
    expect(b.docNumber).toBe('AUXX-RCP-20260818')

    // The loser must not append a second pair of legs to the winner's header.
    expect(await lines()).toHaveLength(2)
  })

  it('survives four concurrent runs of the same period', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        postEntry(db(), { organizationId: f.organizationId, entry: receiptEntry(), lock: OPEN })
      )
    )

    expect(await postings()).toHaveLength(1)
    expect(results.filter((r) => r.status === 'not_connected')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'already_posted')).toHaveLength(3)
    expect(new Set(results.map((r) => r.glPostingId)).size).toBe(1)
    expect(await lines()).toHaveLength(2)
  })

  it('converges on a sequential second run', async () => {
    const first = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry(),
      lock: OPEN,
    })
    const second = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry(),
      lock: OPEN,
    })

    expect(first.status).toBe('not_connected')
    expect(second.status).toBe('already_posted')
    expect(second.glPostingId).toBe(first.glPostingId)
    expect(await postings()).toHaveLength(1)

    // The claimed `requestId` is what a retry pushes under, so it must be
    // stable and it must be the row's own value - no run salt.
    const [row] = await postings()
    expect(row!.requestId).toHaveLength(50)
  })
})

// ── 2. The 23505 the ON CONFLICT target does not cover ─────────────────────

describe('a unique violation on an index the claim does not infer', () => {
  it('turns a real GlPosting_org_docNumber_key collision into a typed refusal', async () => {
    await postEntry(db(), { organizationId: f.organizationId, entry: receiptEntry(), lock: OPEN })

    // `buildDocNumber` strips hyphens, so '2026-08-18' and '20260818' are two
    // DISTINCT claim tuples that mint one document number. The claim's ON
    // CONFLICT target therefore does not match, the statement proceeds, and
    // GlPosting_org_docNumber_key raises 23505 out of an INSERT that has an ON
    // CONFLICT clause sitting right there.
    const collision = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry({ periodKey: '20260818' }),
      lock: OPEN,
    })

    // It must not escape as an anonymous 500 naming a constraint nobody has
    // heard of, and `postEntry` must not throw.
    expect(collision.status).toBe('error')
    expect(collision.failureClass).toBe('data')
    expect(collision.retryable).toBe(false)
    expect(collision.error).toContain('AUXX-RCP-20260818')
    expect(collision.error).toContain('already used')

    // The failed claim rolled back whole: no orphan header, no orphan lines.
    expect(await postings()).toHaveLength(1)
    expect(await lines()).toHaveLength(2)
  })
})

// ── 3. The two CHECK constraints, live ─────────────────────────────────────

/**
 * Assert that a statement was refused by a named constraint.
 *
 * 🛑 `rejects.toThrow(/GlPosting_reversal_check/)` does NOT work here, and it
 * fails in the dangerous direction: Drizzle wraps the driver error in a
 * `DrizzleQueryError` whose message is `Failed query: insert into ...`, so the
 * constraint name is nowhere in it and a regex over the message would only ever
 * match by accident. The SQLSTATE and the constraint are on `error.cause` -
 * which is exactly the shape `post-entry.ts`'s `uniqueViolationConstraint`
 * reads, so asserting it here also pins the assumption that handler is built on.
 */
async function expectConstraintViolation(
  statement: Promise<unknown>,
  constraint: string,
  sqlState = '23514'
): Promise<void> {
  let caught: unknown
  try {
    await statement
  } catch (error) {
    caught = error
  }
  expect(caught, `expected ${constraint} to reject this statement`).toBeDefined()
  const cause = (caught as { cause?: { code?: string; constraint?: string } }).cause
  expect(cause?.code).toBe(sqlState)
  expect(cause?.constraint).toBe(constraint)
}

/** The columns a bare `GlPosting` INSERT cannot omit. */
function rawPosting(overrides: Record<string, unknown>) {
  return {
    organizationId: f.organizationId,
    postingType: 'receipt' as const,
    periodKey: '2026-09',
    txnDate: '2026-09-01',
    docNumber: `AUXX-RCP-RAW${Math.floor(Math.random() * 100_000)}`,
    totalMinor: 1,
    draft: { v: 1 },
    requestId: 'raw-request-id',
    ...overrides,
  }
}

describe('GlPosting_posted_check', () => {
  it('is satisfied because markPosted sets status and postedAt in ONE update', async () => {
    const result = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry(),
      lock: OPEN,
      actorUserId: f.userId,
    })
    expect(result.status).toBe('not_connected')

    const [row] = await postings()
    expect(row!.status).toBe('posted')
    expect(row!.postedAt).not.toBeNull()
    expect(row!.postedByUserId).toBe(f.userId)
  })

  it('rejects the two-statement version of that same update', async () => {
    // The proof that the single UPDATE is not merely tidy. This is exactly what
    // `markPosted` would issue first if it were split in two, and Postgres
    // refuses it - so a split implementation cannot reach production quietly.
    const [claimed] = await db()
      .insert(schema.GlPosting)
      .values(rawPosting({ status: 'pending' }))
      .returning({ id: schema.GlPosting.id })

    await expectConstraintViolation(
      db().execute(sql`update "GlPosting" set "status" = 'posted' where "id" = ${claimed!.id}`),
      'GlPosting_posted_check'
    )

    // And the row is untouched, so a caller cannot half-apply it either.
    const [row] = await postings()
    expect(row!.status).toBe('pending')
  })
})

describe('GlPosting_reversal_check', () => {
  it('agrees with postEntry pre-validation: a revision above 0 must name an original', async () => {
    // The friendly half. `postEntry` refuses before touching Postgres.
    const refused = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry(),
      lock: OPEN,
      revision: 1,
    })
    expect(refused.status).toBe('error')
    expect(refused.error).toContain('must name the posting it reverses')
    expect(refused.glPostingId).toBeUndefined()
    expect(await postings()).toHaveLength(0)

    // The constraint half. The same shape, written directly, is rejected by
    // Postgres - which is what makes the pre-validation a better message rather
    // than the only defence.
    await expectConstraintViolation(
      db()
        .insert(schema.GlPosting)
        .values(rawPosting({ revision: 1, reversesId: null })),
      'GlPosting_reversal_check'
    )
  })

  it('agrees with postEntry pre-validation: revision 0 must name nothing', async () => {
    const original = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry(),
      lock: OPEN,
    })

    const refused = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry({ periodKey: '2026-08-19', txnDate: '2026-08-19' }),
      lock: OPEN,
      reversesId: original.glPostingId,
    })
    expect(refused.status).toBe('error')
    expect(refused.error).toContain('Revision 0 is the original')
    expect(await postings()).toHaveLength(1)

    await expectConstraintViolation(
      db()
        .insert(schema.GlPosting)
        .values(rawPosting({ revision: 0, reversesId: original.glPostingId })),
      'GlPosting_reversal_check'
    )
  })

  it('accepts a reversal whose reversesId is in the INSERT', async () => {
    const original = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry(),
      lock: OPEN,
    })

    // The only shape the constraint permits for revision > 0, written as one
    // statement. Inserting first and linking afterwards is not merely untidy:
    // the first half of it is the row above, and Postgres refuses it.
    await expect(
      db()
        .insert(schema.GlPosting)
        .values(rawPosting({ revision: 1, reversesId: original.glPostingId }))
    ).resolves.toBeDefined()
  })
})

// ── 4. A reversal pair, end to end ─────────────────────────────────────────

describe('a reversal pair', () => {
  it('claims revision 1, flips the original, and leaves the books balanced', async () => {
    const original = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry(),
      lock: OPEN,
      actorUserId: f.userId,
    })
    expect(original.status).toBe('not_connected')

    const reversal = await reverseEntry(db(), {
      organizationId: f.organizationId,
      glPostingId: original.glPostingId as string,
      lock: OPEN,
      actorUserId: f.userId,
    })
    expect(reversal.status).toBe('not_connected')

    const rows = await postings()
    expect(rows).toHaveLength(2)

    const first = rows.find((row) => row.id === original.glPostingId)!
    const second = rows.find((row) => row.id === reversal.glPostingId)!

    // The original is terminal. The reversal is an ordinary posted entry.
    expect(first.status).toBe('reversed')
    expect(second.status).toBe('posted')
    expect(second.postedAt).not.toBeNull()

    expect(second.revision).toBe(1)
    expect(second.reversesId).toBe(first.id)
    expect(second.docNumber).toBe('AUXX-RCP-20260818-R1')
    // Same period and same accounting date: `revision` is what distinguishes
    // the pair, NOT a ':rev' suffix on the period key.
    expect(second.periodKey).toBe(first.periodKey)
    expect(second.txnDate).toBe(first.txnDate)

    // Opposite legs, same accounts, same audit pair.
    const originalLines = await lines(first.id)
    const reversalLines = await lines(second.id)
    expect(originalLines.map((l) => [l.accountCode, l.direction])).toEqual([
      ['1310', 'debit'],
      ['2160', 'credit'],
    ])
    expect(reversalLines.map((l) => [l.accountCode, l.direction])).toEqual([
      ['1310', 'credit'],
      ['2160', 'debit'],
    ])
    expect(reversalLines.every((l) => l.sourceId === 'mv_1')).toBe(true)

    // The sweep, over the pair. A reversal pair is two entries that each tie on
    // their own, not one net-zero entry - `verifyBooksBalance` counts both.
    const report = await verifyBooksBalance(db(), f.organizationId)
    expect(report.isOk()).toBe(true)
    expect(report._unsafeUnwrap()).toMatchObject({
      balanced: true,
      postingsChecked: 2,
      discrepancies: [],
    })
  })

  it('refuses to reverse the same entry twice', async () => {
    const original = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry(),
      lock: OPEN,
    })
    await reverseEntry(db(), {
      organizationId: f.organizationId,
      glPostingId: original.glPostingId as string,
      lock: OPEN,
    })

    const again = await reverseEntry(db(), {
      organizationId: f.organizationId,
      glPostingId: original.glPostingId as string,
      lock: OPEN,
    })

    // The original is `reversed` now, so it refuses at the door rather than
    // claiming revision 2 and doubling the correction.
    expect(again.status).toBe('error')
    expect(again.error).toContain('reversed')
    expect(await postings()).toHaveLength(2)
  })

  it('leaves the original untouched when the reversal refuses at the period lock', async () => {
    const original = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry(),
      lock: OPEN,
    })

    const refused = await reverseEntry(db(), {
      organizationId: f.organizationId,
      glPostingId: original.glPostingId as string,
      lock: { lockedThroughMonth: '2026-08' },
    })

    expect(refused.status).toBe('period_closed')
    const rows = await postings()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('posted')
  })
})

// ── The org with nothing connected, against real rows ──────────────────────

describe('an organization with no accounting provider', () => {
  it('persists a complete, resolved, balanced entry and reports not_connected', async () => {
    const result = await postEntry(db(), {
      organizationId: f.organizationId,
      entry: receiptEntry(),
      lock: OPEN,
    })

    expect(result.status).toBe('not_connected')
    expect(result.providerId).toBe('none')

    const [row] = await postings()
    expect(row!.currency).toBe('USD')
    expect(row!.totalMinor).toBe(125_000)
    expect(row!.providerId).toBe('none')
    // NULL, which is why GlPosting_org_provider_entry_key is a partial index -
    // an org with no provider would otherwise collide with itself on the second
    // entry it ever posts.
    expect(row!.providerEntryId).toBeNull()

    const written = await lines(row!.id)
    expect(written.map((l) => l.lineNumber)).toEqual([1, 2])
    // The role, the resolved code and the name snapshot all land - the code
    // came from this org's own seeded chart, not from a constant.
    expect(written[0]).toMatchObject({
      accountRole: 'inventory_raw_materials',
      accountCode: '1310',
      direction: 'debit',
      amountMinor: 125_000,
    })
    expect(written[0]!.accountName).toBeTruthy()

    const report = await verifyBooksBalance(db(), f.organizationId)
    expect(report._unsafeUnwrap().balanced).toBe(true)
  })

  it('refuses an unmapped role against a real chart, and writes nothing', async () => {
    // `payroll_clearing` is in the vocabulary and in the default chart, so
    // deleting its assignment models the real condition: an org that has not
    // mapped the role a builder emitted.
    await db()
      .delete(schema.GlRoleAssignment)
      .where(
        and(
          eq(schema.GlRoleAssignment.organizationId, f.organizationId),
          eq(schema.GlRoleAssignment.role, 'payroll_clearing')
        )
      )

    const entry = receiptEntry({
      lines: [
        {
          accountRole: 'inventory_raw_materials',
          direction: 'debit',
          amount: 5_000,
          sourceType: 'stock_movement',
          sourceId: 'mv_2',
          sortOrder: 0,
        },
        {
          accountRole: 'payroll_clearing',
          direction: 'credit',
          amount: 5_000,
          sourceType: 'stock_movement',
          sourceId: 'mv_2',
          sortOrder: 1,
        },
      ],
      totalDebit: 5_000,
      totalCredit: 5_000,
    })

    const result = await postEntry(db(), {
      organizationId: f.organizationId,
      entry,
      lock: OPEN,
    })

    expect(result.status).toBe('account_unmapped')
    expect(result.error).toContain('payroll_clearing')
    expect(result.glPostingId).toBeUndefined()
    expect(await postings()).toHaveLength(0)
  })
})
