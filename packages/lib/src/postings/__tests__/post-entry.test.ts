// packages/lib/src/postings/__tests__/post-entry.test.ts
//
// The poster is the one place a journal entry can be written twice, and a
// double-posted entry has no invoice and no payment to reconcile against - it
// is not noticed until a close does not tie out. So most of this file is either
// a convergence test or a refusal test, and the refusals assert the same second
// thing: **that nothing was written**.
//
// ⚠️ The database is an in-memory fake whose `GlPostingSource` insert holds a
// mutex and re-checks the claim tuple inside it - what `ON CONFLICT DO NOTHING`
// does against an uncommitted tuple. It proves `postEntry` CONVERGES: one
// posting, one `already_posted`, the loser's row rolled back. It does NOT prove
// Postgres's partial-index behaviour; that is owed as an integration test.

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../accounting-commit-lock', () => ({ withAccountingCommitLock: vi.fn() }))

const h = vi.hoisted(() => ({
  fields: new Map<string, string>(),
  lockedThroughMonth: null as string | null,
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.has(a) ? { id: h.fields.get(a) } : null])),
    }),
  }),
}))

import { listPostingsForSource } from '../list-postings'
import { postDraft, postEntry, postEntryInTx } from '../post-entry'
import { __resetAccountingProvidersForTests, setConnectedProviderResolver } from '../provider'
import { reverseEntry } from '../reverse-entry'
import type { BuiltEntry, GlPostingSourceInput } from '../types'

const ORG = 'org_1'
const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'

interface Account {
  id: string
  code: string | null
  name: string
  accountType: string
}

// ── The fake database ──────────────────────────────────────────────────────

/**
 * Walk a Drizzle condition and collect the literal values it binds.
 *
 * Under `src/test/setup.ts` every `schema.X.y` is `undefined`, so a condition
 * carries its VALUES and not its columns - enough to answer "which row does
 * this WHERE name", since the ids under test are distinctive.
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
  // Drop the SQL scaffolding the walk also collects - `'('`, `' and '`, `''`.
  // What is left is the literals, which is what a row is matched against.
  return out.filter((value) => /^[A-Za-z0-9_.:-]+$/.test(value))
}

type Row = Record<string, unknown>

function createFakeDb(chart: Array<{ role: string; account: Account }>) {
  const postings: Row[] = []
  const lines: Row[] = []
  let sources: Row[] = []
  let seq = 0
  /** Awaited inside the claim's critical section, to interleave two runs. */
  let beforeClaim: (() => Promise<void>) | null = null

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

  const accounts = chart.map((entry) => entry.account)

  const thenable = (get: () => unknown[], filtered = false) => {
    let condition: unknown
    const chain: Record<string, unknown> = {}
    chain.where = (next: unknown) => {
      condition = next
      return chain
    }
    chain.limit = () => chain
    chain.orderBy = () => chain
    chain.for = () => chain
    // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          if (!filtered) return get()
          const named = boundValues(condition)
          return get().filter((row) => matches(row as Row, named))
        })
        .then(resolve, reject)
    return chain
  }

  /**
   * A row matches when every literal the WHERE bound is one of its own.
   *
   * ⚠️ AND semantics, so an `inArray` over SEVERAL ids would match none. Every
   * read here binds at most one.
   */
  function matches(row: Row, named: string[]): boolean {
    if (named.length === 0) return true
    const own = new Set(Object.values(row).filter((v) => typeof v === 'string') as string[])
    return named.every((value) => own.has(value) || value === ORG)
  }

  /** The partial unique index: one live subject per (org, kind, id, occurrence). */
  function claimHolder(values: Row): Row | undefined {
    return sources.find(
      (row) =>
        row.linkRole === 'subject' &&
        row.organizationId === values.organizationId &&
        row.sourceKind === values.sourceKind &&
        row.sourceId === values.sourceId &&
        row.occurrence === values.occurrence
    )
  }

  /**
   * Rows this statement's transaction wrote, so a rollback removes exactly
   * those - a whole-table snapshot cannot, because two claims are in flight at
   * once and one would undo the other's committed row.
   */
  type Journal = Array<{ table: Row[]; row: Row }>

  const makeDb = (journal: Journal | null): Record<string, unknown> => {
    const db = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const own: Journal = []
        try {
          const result = await fn(makeDb(own))
          // A nested call is a SAVEPOINT: its rows survive its own release and
          // are still the OUTER transaction's to roll back.
          if (journal) journal.push(...own)
          return result
        } catch (error) {
          for (const { table, row } of own) {
            const at = table.indexOf(row)
            if (at >= 0) table.splice(at, 1)
          }
          throw error
        }
      },
      execute: async () => ({ rows: [] }),

      select: () => ({
        from: (table: unknown) => {
          if (table === schema.OrganizationSetting) {
            return thenable(() =>
              h.lockedThroughMonth
                ? [{ key: 'ledger.lockedThroughMonth', value: h.lockedThroughMonth }]
                : []
            )
          }
          if (table === schema.GlRoleAssignment) {
            return thenable(() =>
              chart.map((entry) => ({
                role: entry.role,
                glAccountId: entry.account.id,
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
                { entityId: account.id, fieldId: ACTIVE_FIELD, valueBoolean: true },
              ])
            )
          }
          if (table === schema.GlPosting) return thenable(() => [...postings], true)
          if (table === schema.GlPostingLine) return thenable(() => [...lines], true)
          if (table === schema.GlPostingSource) return thenable(() => [...sources], true)
          return thenable(() => [])
        },
        // `selectDistinct` is unused by this lane now; kept so a stray call is loud.
      }),

      insert: (table: unknown) => {
        let captured: unknown
        const chain: Record<string, unknown> = {}
        let conflictGuarded = false
        chain.values = (value: unknown) => {
          captured = value
          return chain
        }
        chain.onConflictDoNothing = () => {
          conflictGuarded = true
          return chain
        }
        const run = async (): Promise<unknown[]> => {
          if (table === schema.GlPosting) {
            seq += 1
            const row: Row = { ...(captured as Row), id: `post_${seq}` }
            postings.push(row)
            journal?.push({ table: postings, row })
            return [{ id: row.id, docNumber: row.docNumber, requestId: row.requestId }]
          }
          if (table === schema.GlPostingSource) {
            const values = Array.isArray(captured) ? (captured as Row[]) : [captured as Row]
            const written: unknown[] = []
            for (const value of values) {
              const row: Row = { occurrence: 'original', ...value }
              if (conflictGuarded) {
                const held = await withClaimLock(async () => {
                  if (beforeClaim) await beforeClaim()
                  const holder = claimHolder(row)
                  if (holder) return holder
                  seq += 1
                  row.id = `src_${seq}`
                  sources.push(row)
                  journal?.push({ table: sources, row })
                  return null
                })
                if (held) continue
              } else {
                seq += 1
                row.id = `src_${seq}`
                sources.push(row)
                journal?.push({ table: sources, row })
              }
              written.push({ id: row.id })
            }
            return written
          }
          for (const row of captured as Row[]) {
            lines.push(row)
            journal?.push({ table: lines, row })
          }
          return []
        }
        chain.returning = () => ({
          // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            run().then(resolve, reject),
        })
        // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
        chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          run().then(resolve, reject)
        return chain
      },

      update: (table: unknown) => {
        let values: Row = {}
        let condition: unknown
        const chain: Record<string, unknown> = {}
        chain.set = (next: Row) => {
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
              const named = boundValues(condition)
              for (const row of postings) {
                if (!named.includes(row.id as string)) continue
                for (const [key, value] of Object.entries(values)) {
                  // `jsonb_set` on `built` arrives as an SQL chunk; the fake
                  // records the doc number the same way the column would.
                  row[key] = key === 'built' ? row.built : value
                }
              }
            })
            .then(resolve, reject)
        return chain
      },

      delete: (table: unknown) => {
        const chain: Record<string, unknown> = {}
        let condition: unknown
        chain.where = (next: unknown) => {
          condition = next
          return chain
        }
        // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
        chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve()
            .then(() => {
              if (table !== schema.GlPostingSource) return
              // Column-aware, unlike `matches`: the reversal's OWN subject row
              // carries the original's id in `sourceId`, so a value-only match
              // would delete the claim this reversal just took.
              const named = boundValues(condition)
              sources = sources.filter(
                (row) =>
                  !(
                    named.includes(row.glPostingId as string) &&
                    named.includes(row.linkRole as string)
                  )
              )
            })
            .then(resolve, reject)
        return chain
      },
    }
    return db
  }

  return {
    db: makeDb(null) as never,
    get postings() {
      return postings
    },
    get lines() {
      return lines
    },
    get sources() {
      return sources
    },
    setBeforeClaim: (fn: (() => Promise<void>) | null) => {
      beforeClaim = fn
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
const CHART = [
  { role: 'grni', account: GRNI },
  { role: 'inventory_raw_materials', account: RAW },
]

const SUBJECT: GlPostingSourceInput = {
  sourceKind: 'goods_receipt',
  sourceId: 'rcpt_1',
  linkRole: 'subject',
}
const PARENT: GlPostingSourceInput = {
  sourceKind: 'purchase_order',
  sourceId: 'po_1',
  linkRole: 'parent',
}

function receiptEntry(overrides: Partial<BuiltEntry> = {}): BuiltEntry {
  return {
    postingType: 'inventory_movement',
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
  h.lockedThroughMonth = null
  h.fields = new Map([
    ['gl_account_code', CODE_FIELD],
    ['gl_account_name', NAME_FIELD],
    ['gl_account_type', TYPE_FIELD],
    ['gl_account_is_active', ACTIVE_FIELD],
  ])
  __resetAccountingProvidersForTests()
  setConnectedProviderResolver(async () => null)
})

// ── Draft mode ─────────────────────────────────────────────────────────────

describe('postEntry in draft mode', () => {
  it('writes the row, its lines and its non-subject links, and takes no claim', async () => {
    const fake = createFakeDb(CHART)

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'draft',
      sources: [SUBJECT, PARENT],
    })

    expect(result.status).toBe('drafted')
    expect(result.glPostingId).toBeDefined()
    expect(result.docNumber).toBeUndefined()

    const [row] = fake.postings
    expect(row?.status).toBe('draft')
    // 🛑 A draft has no document number and no claim. Both are what posting adds.
    expect(row?.docNumber).toBeNull()
    expect(row?.postedAt).toBeNull()
    expect(fake.lines).toHaveLength(2)
    expect(fake.sources.map((s) => s.linkRole)).toEqual(['parent'])
  })

  it('refuses a closed period before writing anything', async () => {
    const fake = createFakeDb(CHART)
    h.lockedThroughMonth = '2026-08'

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'draft',
      sources: [SUBJECT],
    })

    expect(result.status).toBe('period_closed')
    expect(fake.postings).toHaveLength(0)
    expect(fake.sources).toHaveLength(0)
  })
})

// ── The in-transaction poster (MIGRATION follow-up 2) ──────────────────────

/** `db.transaction`, typed for the fake - `Database` is `never` under the mock. */
function inTx<T>(db: never, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return (db as unknown as Database).transaction(fn)
}

describe('postEntryInTx', () => {
  it("writes the entry into the CALLER's transaction, and owes the export back", async () => {
    const fake = createFakeDb(CHART)

    const result = await inTx(fake.db, (tx) =>
      postEntryInTx(tx, {
        organizationId: ORG,
        entry: receiptEntry(),
        lock: OPEN,
        mode: 'post',
        sources: [SUBJECT],
      })
    )

    expect(result.status).toBe('posted')
    // 🛑 The push is NOT made here: a network call inside an open transaction
    // holds the claim's index tuple for the length of an HTTP round trip.
    expect(result.pendingExport?.glPostingId).toBe(result.glPostingId)
    expect(fake.postings).toHaveLength(1)
  })

  it("🛑 rolls back with the caller's transaction when the caller's own work fails", async () => {
    const fake = createFakeDb(CHART)

    await expect(
      inTx(fake.db, async (tx) => {
        await postEntryInTx(tx, {
          organizationId: ORG,
          entry: receiptEntry(),
          lock: OPEN,
          mode: 'post',
          sources: [SUBJECT],
        })
        // The source write that motivated the posting fails AFTER it.
        throw new Error('the shipment could not be recorded')
      })
    ).rejects.toThrow('the shipment could not be recorded')

    // Nothing survives: the entry and the source write commit together, which
    // is the whole point of the variant.
    expect(fake.postings).toHaveLength(0)
    expect(fake.sources).toHaveLength(0)
    expect(fake.lines).toHaveLength(0)
  })

  it('returns a refusal rather than throwing, so nothing written is rolled back for it', async () => {
    const fake = createFakeDb(CHART)
    h.lockedThroughMonth = '2026-08'

    const result = await inTx(fake.db, (tx) =>
      postEntryInTx(tx, {
        organizationId: ORG,
        entry: receiptEntry(),
        lock: OPEN,
        mode: 'post',
        sources: [SUBJECT],
      })
    )

    expect(result.status).toBe('period_closed')
    expect(fake.postings).toHaveLength(0)
  })
})

// ── Post mode and the claim ────────────────────────────────────────────────

describe('postEntry in post mode', () => {
  it('claims the subject, numbers the entry and marks it posted', async () => {
    const fake = createFakeDb(CHART)

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'post',
      sources: [SUBJECT, PARENT],
      storeId: 'fsa_1',
      railId: 'gw_1',
    })

    expect(result.status).toBe('posted')
    expect(result.docNumber).toBe('AUXX-INV-20260818')

    const [row] = fake.postings
    expect(row?.status).toBe('posted')
    expect(row?.storeId).toBe('fsa_1')
    expect(row?.railId).toBe('gw_1')
    expect(fake.sources.map((s) => s.linkRole).sort()).toEqual(['parent', 'subject'])
  })

  it('refuses a source set with no subject, and writes nothing', async () => {
    const fake = createFakeDb(CHART)

    const result = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'post',
      sources: [PARENT],
    })

    expect(result.status).toBe('error')
    expect(result.error).toContain('exactly one subject')
    expect(fake.postings).toHaveLength(0)
  })

  it('converges: two runs of one source produce one posting and one already_posted', async () => {
    const fake = createFakeDb(CHART)
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    // The first run parks inside the claim's critical section until the second
    // has been started, so both are in flight over one source.
    let first = true
    fake.setBeforeClaim(async () => {
      if (!first) return
      first = false
      await gate
    })

    const runA = postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'post',
      sources: [SUBJECT],
    })
    const runB = postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'post',
      sources: [SUBJECT],
    })
    release()
    const [a, b] = await Promise.all([runA, runB])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual(['already_posted', 'posted'])
    // 🛑 The loser's own row rolled back with its transaction. One claim, one
    // posting - not two rows one of which is orphaned.
    expect(fake.postings).toHaveLength(1)
    expect(fake.sources.filter((s) => s.linkRole === 'subject')).toHaveLength(1)

    const loser = a.status === 'already_posted' ? a : b
    const winner = a.status === 'already_posted' ? b : a
    expect(loser.glPostingId).toBe(winner.glPostingId)
  })

  it('lets a second occurrence of the same source claim independently', async () => {
    const fake = createFakeDb(CHART)
    const base = { organizationId: ORG, lock: OPEN, mode: 'post' as const }

    const first = await postEntry(fake.db, {
      ...base,
      entry: receiptEntry(),
      sources: [SUBJECT],
    })
    const second = await postEntry(fake.db, {
      ...base,
      entry: receiptEntry({ periodKey: '2026-08-19', txnDate: '2026-08-19' }),
      sources: [{ ...SUBJECT, occurrence: 'writeoff_1' }],
    })

    expect(first.status).toBe('posted')
    expect(second.status).toBe('posted')
    expect(fake.postings).toHaveLength(2)
  })
})

// ── postDraft ──────────────────────────────────────────────────────────────

describe('postDraft', () => {
  it('claims, numbers and flips a draft to posted', async () => {
    const fake = createFakeDb(CHART)
    const drafted = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'draft',
      sources: [SUBJECT, PARENT],
    })

    const result = await postDraft(fake.db, {
      organizationId: ORG,
      glPostingId: drafted.glPostingId as string,
      lock: OPEN,
      actorUserId: 'user_1',
    })

    expect(result.status).toBe('posted')
    expect(result.docNumber).toBe('AUXX-INV-20260818')
    expect(fake.postings[0]?.status).toBe('posted')
    expect(fake.postings[0]?.docNumber).toBe('AUXX-INV-20260818')
    expect(fake.sources.filter((s) => s.linkRole === 'subject')).toHaveLength(1)
  })

  it('re-checks the period lock, so a draft cannot be approved into a closed month', async () => {
    const fake = createFakeDb(CHART)
    const drafted = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'draft',
      sources: [SUBJECT],
    })

    h.lockedThroughMonth = '2026-08'
    const result = await postDraft(fake.db, {
      organizationId: ORG,
      glPostingId: drafted.glPostingId as string,
      lock: OPEN,
    })

    expect(result.status).toBe('period_closed')
    expect(fake.postings[0]?.status).toBe('draft')
    expect(fake.sources.filter((s) => s.linkRole === 'subject')).toHaveLength(0)
  })

  it('refuses a posting that is not a draft', async () => {
    const fake = createFakeDb(CHART)
    const posted = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'post',
      sources: [SUBJECT],
    })

    const result = await postDraft(fake.db, {
      organizationId: ORG,
      glPostingId: posted.glPostingId as string,
      lock: OPEN,
    })

    expect(result.status).toBe('error')
    expect(result.error).toContain('not draft')
  })
})

// ── reverseEntry ───────────────────────────────────────────────────────────

describe('reverseEntry', () => {
  it('releases the original claim so the source can post again', async () => {
    const fake = createFakeDb(CHART)
    const posted = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'post',
      sources: [SUBJECT],
    })

    const reversal = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: posted.glPostingId as string,
      lock: OPEN,
    })

    expect(reversal.status).toBe('posted')
    expect(reversal.docNumber).toBe('AUXX-INV-20260818-R1')
    expect(fake.postings.find((p) => p.id === posted.glPostingId)?.status).toBe('reversed')

    // 🛑 The original's subject row is GONE and the reversal's own subject names
    // the posting it reverses, so the goods receipt is claimable again.
    const subjects = fake.sources.filter((s) => s.linkRole === 'subject')
    expect(subjects).toHaveLength(1)
    expect(subjects[0]).toMatchObject({
      sourceKind: 'gl_posting',
      sourceId: posted.glPostingId,
      occurrence: 'reversal',
    })

    const again = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry({ periodKey: '2026-08-20', txnDate: '2026-08-20' }),
      lock: OPEN,
      mode: 'post',
      sources: [SUBJECT],
    })
    expect(again.status).toBe('posted')
    expect(again.glPostingId).not.toBe(posted.glPostingId)
  })

  it('refuses to reverse anything but a posted entry', async () => {
    const fake = createFakeDb(CHART)
    const drafted = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'draft',
      sources: [SUBJECT],
    })

    const result = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: drafted.glPostingId as string,
      lock: OPEN,
    })

    expect(result.status).toBe('error')
    expect(result.error).toContain('not posted')
  })
})

// ── listPostingsForSource ──────────────────────────────────────────────────

describe('listPostingsForSource', () => {
  it('returns the posting with the link role it matched on', async () => {
    const fake = createFakeDb(CHART)
    const posted = await postEntry(fake.db, {
      organizationId: ORG,
      entry: receiptEntry(),
      lock: OPEN,
      mode: 'post',
      sources: [SUBJECT, PARENT],
    })

    const bySubject = await listPostingsForSource(fake.db, {
      organizationId: ORG,
      sourceKind: SUBJECT.sourceKind,
      sourceId: SUBJECT.sourceId,
    })
    expect(bySubject.isOk()).toBe(true)
    expect(bySubject._unsafeUnwrap()).toHaveLength(1)
    expect(bySubject._unsafeUnwrap()[0]).toMatchObject({
      id: posted.glPostingId,
      linkRole: 'subject',
      occurrence: 'original',
    })

    // The parent link is what lets a purchase order list its receipts' entries.
    const byParent = await listPostingsForSource(fake.db, {
      organizationId: ORG,
      sourceKind: PARENT.sourceKind,
      sourceId: PARENT.sourceId,
    })
    expect(byParent._unsafeUnwrap()[0]).toMatchObject({
      id: posted.glPostingId,
      linkRole: 'parent',
    })
  })

  it('answers with an empty list for a source that produced nothing', async () => {
    const fake = createFakeDb(CHART)
    const result = await listPostingsForSource(fake.db, {
      organizationId: ORG,
      sourceKind: 'goods_receipt',
      sourceId: 'rcpt_nothing',
    })
    expect(result._unsafeUnwrap()).toEqual([])
  })
})
