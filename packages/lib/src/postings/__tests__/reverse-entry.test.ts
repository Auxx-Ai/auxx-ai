// packages/lib/src/postings/__tests__/reverse-entry.test.ts
//
// A reversal is a second, opposite entry with its own `GlPosting` row
// (decision G4). Three properties carry this file, and each one is a constraint
// or a defect rather than a preference:
//
//  1. **`reversesId` is in the INSERT.** `GlPosting_reversal_check` is
//     `(revision = 0 AND reversesId IS NULL) OR (revision > 0 AND reversesId IS
//     NOT NULL)`, so inserting and then linking is not merely untidy, it is
//     rejected by Postgres.
//  2. **`revision`, never a `':rev'` suffix on `periodKey`.** gap-e §9 asked for
//     the suffix and `parsePeriodKey` throws `BadRequestError` on it - the
//     module that owns the keyspace rejects the key the design specified.
//  3. **The reversal lands on the accounts the ORIGINAL posted to.** If the org
//     repointed a role since, re-resolving would credit a different account and
//     leave the first one overstated forever - and both entries would still
//     balance, so nothing downstream could detect it.

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

import { __resetAccountingProvidersForTests } from '../provider'
import { reverseEntry } from '../reverse-entry'

const ORG = 'org_1'
const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'

interface PostingRow {
  id: string
  organizationId: string
  postingType: string
  periodKey: string
  revision: number
  status: string
  txnDate: string
  docNumber: string
  currency?: string
  totalMinor?: number
  draft?: unknown
  requestId?: string
  providerId?: string | null
  providerEntryId?: string | null
  postedAt?: Date | null
  postedByUserId?: string | null
  failureReason?: string | null
  attempts?: number
  reversesId?: string | null
}

interface LineRow {
  organizationId: string
  glPostingId: string
  lineNumber: number
  accountCode: string
  accountRole: string | null
  accountName?: string | null
  direction: string
  amountMinor: number
  memo?: string | null
  sourceType: string
  sourceId: string
}

interface Account {
  id: string
  code: string
  name: string
  accountType: string
}

/** See the note on the same helper in `post-entry.test.ts`. */
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

function createFakeDb(input: {
  postings: PostingRow[]
  lines: LineRow[]
  chart: { role: string; account?: Account }[]
}) {
  const postings = input.postings
  const lines = input.lines
  const accounts = input.chart.filter((e) => e.account).map((e) => e.account as Account)
  let seq = postings.length
  let claimLookup: ((row: PostingRow) => boolean) | null = null

  const thenable = (get: (named: string[]) => unknown[]) => {
    let named: string[] = []
    const chain: Record<string, unknown> = {}
    chain.where = (condition: unknown) => {
      named = boundValues(condition)
      return chain
    }
    chain.limit = () => chain
    chain.orderBy = () => chain
    // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => get(named))
        .then(resolve, reject)
    return chain
  }

  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),

    select: () => ({
      from: (table: unknown) => {
        if (table === schema.GlRoleAssignment) {
          return thenable(() =>
            input.chart.map((entry) => ({
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
              { entityId: account.id, fieldId: ACTIVE_FIELD, valueBoolean: true },
            ])
          )
        }
        if (table === schema.GlPosting) {
          return thenable((named) => {
            const filter = claimLookup
            claimLookup = null
            if (filter) return postings.filter(filter)
            const byId = postings.filter((row) => named.includes(row.id))
            return byId.length > 0 ? byId : []
          })
        }
        if (table === schema.GlPostingLine) {
          return thenable((named) => lines.filter((line) => named.includes(line.glPostingId)))
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
        if (table !== schema.GlPosting) {
          lines.push(...(captured as LineRow[]))
          return []
        }
        const values = captured as PostingRow
        const duplicate = postings.find(
          (row) =>
            row.organizationId === values.organizationId &&
            row.postingType === values.postingType &&
            row.periodKey === values.periodKey &&
            row.revision === values.revision
        )
        if (duplicate) {
          claimLookup = (row) => row === duplicate
          return []
        }
        seq += 1
        const row: PostingRow = { ...values, id: `post_${seq}`, attempts: values.attempts ?? 0 }
        postings.push(row)
        return [{ id: row.id, docNumber: row.docNumber, requestId: row.requestId }]
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
            const named = boundValues(condition)
            for (const row of postings) {
              if (!named.includes(row.id)) continue
              Object.assign(row as unknown as Record<string, unknown>, values)
            }
          })
          .then(resolve, reject)
      return chain
    },
  }

  return { db: db as never, postings, lines }
}

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

function original(overrides: Partial<PostingRow> = {}): PostingRow {
  return {
    id: 'post_1',
    organizationId: ORG,
    postingType: 'receipt',
    periodKey: '2026-08-18',
    revision: 0,
    status: 'posted',
    txnDate: '2026-08-18',
    docNumber: 'AUXX-RCP-20260818',
    providerId: 'none',
    providerEntryId: null,
    reversesId: null,
    ...overrides,
  }
}

function originalLines(overrides: Partial<LineRow>[] = [{}, {}]): LineRow[] {
  const base: LineRow[] = [
    {
      organizationId: ORG,
      glPostingId: 'post_1',
      lineNumber: 1,
      accountCode: '1310',
      accountRole: 'inventory_raw_materials',
      accountName: 'Raw Materials Inventory',
      direction: 'debit',
      amountMinor: 125_000,
      memo: 'received',
      sourceType: 'stock_movement',
      sourceId: 'mv_1',
    },
    {
      organizationId: ORG,
      glPostingId: 'post_1',
      lineNumber: 2,
      accountCode: '2160',
      accountRole: 'grni',
      accountName: 'Goods Received Not Invoiced',
      direction: 'credit',
      amountMinor: 125_000,
      sourceType: 'stock_movement',
      sourceId: 'mv_1',
    },
  ]
  return base.map((line, index) => ({ ...line, ...overrides[index] }))
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

describe('the reversal pair', () => {
  it('claims revision 1 with reversesId in the INSERT and an -R1 document number', async () => {
    const fake = createFakeDb({
      postings: [original()],
      lines: originalLines(),
      chart: CHART,
    })

    const result = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: 'post_1',
      lock: OPEN,
      actorUserId: 'user_1',
    })

    expect(result.status).toBe('not_connected')
    expect(fake.postings).toHaveLength(2)

    const reversal = fake.postings[1]!
    expect(reversal.revision).toBe(1)
    // In the INSERT. `GlPosting_reversal_check` makes linking afterwards
    // impossible, so an id that appeared only in a later UPDATE would have
    // been rejected by Postgres before it could be observed here.
    expect(reversal.reversesId).toBe('post_1')
    expect(reversal.docNumber).toBe('AUXX-RCP-20260818-R1')
    // The SAME period and the SAME accounting date: `revision` is what
    // distinguishes the pair, not the period key.
    expect(reversal.periodKey).toBe('2026-08-18')
    expect(reversal.txnDate).toBe('2026-08-18')
    expect(reversal.status).toBe('posted')
    expect(result.docNumber).toBe('AUXX-RCP-20260818-R1')
  })

  it('flips the original to reversed', async () => {
    const fake = createFakeDb({ postings: [original()], lines: originalLines(), chart: CHART })
    await reverseEntry(fake.db, { organizationId: ORG, glPostingId: 'post_1', lock: OPEN })

    expect(fake.postings[0]!.status).toBe('reversed')
  })

  it('posts the opposite of every line, to the same accounts and the same sources', async () => {
    const fake = createFakeDb({ postings: [original()], lines: originalLines(), chart: CHART })
    await reverseEntry(fake.db, { organizationId: ORG, glPostingId: 'post_1', lock: OPEN })

    const reversalId = fake.postings[1]!.id
    const written = fake.lines.filter((line) => line.glPostingId === reversalId)
    expect(written).toHaveLength(2)
    expect(written[0]).toMatchObject({
      lineNumber: 1,
      accountCode: '1310',
      accountRole: 'inventory_raw_materials',
      direction: 'credit',
      amountMinor: 125_000,
      // The audit pair carries through: "what did this movement post to" must
      // find both halves.
      sourceType: 'stock_movement',
      sourceId: 'mv_1',
    })
    expect(written[1]).toMatchObject({ accountCode: '2160', direction: 'debit' })
  })

  it('leaves the original provider entry alone', async () => {
    const fake = createFakeDb({
      postings: [original({ providerId: 'stub', providerEntryId: 'qb_44' })],
      lines: originalLines(),
      chart: CHART,
    })
    await reverseEntry(fake.db, { organizationId: ORG, glPostingId: 'post_1', lock: OPEN })

    // There is no `void` on a line-carrying journal entry, and a sparse update
    // on one is how an entry silently unbalances.
    expect(fake.postings[0]!.providerEntryId).toBe('qb_44')
    expect(fake.postings[0]!.providerId).toBe('stub')
  })

  it('converges rather than reversing twice', async () => {
    const fake = createFakeDb({ postings: [original()], lines: originalLines(), chart: CHART })
    const first = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: 'post_1',
      lock: OPEN,
    })

    // The original is now `reversed`, so a second attempt refuses at the door
    // rather than claiming revision 2.
    const second = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: 'post_1',
      lock: OPEN,
    })

    expect(first.status).toBe('not_connected')
    expect(second.status).toBe('error')
    expect(second.error).toContain('reversed')
    expect(fake.postings).toHaveLength(2)
  })
})

describe('refusals', () => {
  it('refuses a posting in another organization, or none at all', async () => {
    const fake = createFakeDb({ postings: [original()], lines: originalLines(), chart: CHART })
    const result = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: 'post_missing',
      lock: OPEN,
    })
    expect(result.status).toBe('error')
    expect(result.error).toContain('post_missing')
    expect(fake.postings).toHaveLength(1)
  })

  it.each(['pending', 'failed', 'reversed'])('refuses to reverse a %s entry', async (status) => {
    const fake = createFakeDb({
      postings: [original({ status })],
      lines: originalLines(),
      chart: CHART,
    })
    const result = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: 'post_1',
      lock: OPEN,
    })

    expect(result.status).toBe('error')
    expect(result.error).toContain(status)
    expect(fake.postings).toHaveLength(1)
  })

  it('refuses when the chart moved under the entry', async () => {
    const fake = createFakeDb({
      postings: [original()],
      lines: originalLines(),
      // The org renumbered GRNI after the original posted.
      chart: [{ role: 'grni', account: { ...GRNI, code: '2155' } }, CHART[1]!],
    })

    const result = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: 'post_1',
      lock: OPEN,
    })

    // Reversing into 2155 would leave 2160 overstated forever, and the entry
    // would still balance - so nothing downstream could detect it.
    expect(result.status).toBe('error')
    expect(result.error).toContain('2160')
    expect(result.error).toContain('2155')
    expect(result.glPostingId).toBe('post_1')
    expect(fake.postings).toHaveLength(1)
  })

  it('refuses a line that carries no account role', async () => {
    const fake = createFakeDb({
      postings: [original()],
      lines: originalLines([{ accountRole: null }, {}]),
      chart: CHART,
    })
    const result = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: 'post_1',
      lock: OPEN,
    })

    expect(result.status).toBe('error')
    expect(result.error).toContain('1310')
    expect(fake.postings).toHaveLength(1)
  })

  it('refuses an entry with no lines', async () => {
    const fake = createFakeDb({ postings: [original()], lines: [], chart: CHART })
    const result = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: 'post_1',
      lock: OPEN,
    })
    expect(result.status).toBe('error')
    expect(result.error).toContain('nothing to reverse')
  })

  it('refuses when the original period has since been closed', async () => {
    const fake = createFakeDb({ postings: [original()], lines: originalLines(), chart: CHART })
    const result = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: 'post_1',
      lock: { lockedThroughMonth: '2026-08' },
    })

    // A reversal is a posting, so it refuses at the same door.
    expect(result.status).toBe('period_closed')
    expect(fake.postings).toHaveLength(1)
    expect(fake.postings[0]!.status).toBe('posted')
  })

  it('reports an unmapped role rather than reversing into nothing', async () => {
    const fake = createFakeDb({
      postings: [original()],
      lines: originalLines(),
      chart: [{ role: 'grni' }, CHART[1]!],
    })
    const result = await reverseEntry(fake.db, {
      organizationId: ORG,
      glPostingId: 'post_1',
      lock: OPEN,
    })

    expect(result.status).toBe('account_unmapped')
    expect(result.failureClass).toBe('configuration')
    expect(result.error).toContain('grni')
    expect(fake.postings).toHaveLength(1)
  })
})
