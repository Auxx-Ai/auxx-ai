// packages/lib/src/seed/gl-account-chart.test.ts
//
// The chart of accounts is what decision `G8` rests on: a builder emits a ROLE,
// and this seed is what gives the resolver an account to turn that role into.
// So the properties pinned here are the ones the resolver depends on.
//
//  1. **Exactly one active account per role.** The resolver must fail CLOSED on
//     zero or more than one match — never "take the first" — so a chart with two
//     accounts claiming `grni` does not put money in an arbitrary place, it
//     stops every posting. The seed is the single writer, so this is where the
//     property is established.
//  2. **Idempotent on `code`.** A code the org already holds is skipped whole.
//     `gl_account_code`'s unique gate is a check-then-write with no lock, so a
//     re-run that inserted a second `1310` would pass validation and break the
//     resolver for every posting, not just the one that touches 1310.
//  3. **A role is OMITTED, never written as null.** An absent role writes no
//     `FieldValue` row at all, which is exactly what makes `unique: true` on a
//     nullable field safe — the sixteen role-less accounts have nothing to
//     collide on.
//  4. **Never touch an account the org already has.** Not the name, not the
//     type, not the role. A chart is the bookkeeper's document (`G7`).
//
// `UnifiedCrudHandler` is stubbed — a lib-internal module, following the pattern
// `ai-category-tags.test.ts` set — so the assertions are about the values this
// module hands the write path.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHART_OF_ACCOUNTS } from '../postings/default-chart'

const h = vi.hoisted(() => ({
  creates: [] as { entityDefinitionId: string; values: Record<string, unknown> }[],
  constructorOptions: [] as unknown[],
}))

vi.mock('../resources/crud', () => ({
  seedSession: (reason: string) => ({ origin: { kind: 'seed', reason }, depth: 0 }),
  UnifiedCrudHandler: class {
    constructor(
      _orgId: string,
      _userId: string,
      _db: unknown,
      _socketId: unknown,
      options?: unknown
    ) {
      h.constructorOptions.push(options)
    }
    async create(entityDefinitionId: string, values: Record<string, unknown>) {
      h.creates.push({ entityDefinitionId, values })
      return { instance: { id: `acct_${h.creates.length}` }, recordId: 'r', values }
    }
  },
}))

vi.mock('../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => 'system-user-1' },
}))

import { seedDefaultChartOfAccounts } from './gl-account-chart'

const DEF_ID = 'def-gl-account'
const CODE_FIELD_ID = 'field-gl-account-code'

/**
 * A stub `Database` that answers two selects: the `gl_account` def's fields, and
 * the `gl_account_code` values the org already holds. WHERE clauses are ignored
 * — the module scopes in SQL and picks in JS, and evaluating Drizzle conditions
 * is not what this file is about.
 */
function stubDb(existingCodes: string[], opts: { codeField?: boolean; rolesLand?: boolean } = {}) {
  let call = 0
  const chain = (rows: unknown[]) => ({
    where: () => chain(rows),
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  })
  return {
    select: () => ({
      from: () => {
        call++
        // Query 1 is the field list, query 2 is the held codes.
        if (call === 1) {
          return chain(
            opts.codeField === false
              ? [{ id: 'field-other', systemAttribute: 'gl_account_name' }]
              : [
                  { id: CODE_FIELD_ID, systemAttribute: 'gl_account_code' },
                  { id: 'field-role', systemAttribute: 'gl_account_role' },
                ]
          )
        }
        if (call === 2) return chain(existingCodes.map((code) => ({ code })))
        // Query 3 is `assertRolesLanded` re-reading the role rows it just
        // wrote. `rolesLand: false` is the stale-cache case: every create
        // reported success and the role value was silently dropped.
        if (opts.rolesLand === false) return chain([])
        return chain(
          h.creates
            .map((c, index) => ({ values: c.values, entityId: `acct_${index + 1}` }))
            .filter((row) => row.values.gl_account_role)
            .map((row) => ({ entityId: row.entityId }))
        )
      },
    }),
  } as unknown as Database
}

beforeEach(() => {
  h.creates.length = 0
  h.constructorOptions.length = 0
})

// The chart DATA's own invariants — one account per role, no role twice, no
// account claiming a role no builder emits — are pinned in
// `postings/__tests__/default-chart.test.ts`, next to the constant. This file
// is only about what the WRITER does with it.

describe('seedDefaultChartOfAccounts', () => {
  it('creates every account on a first pass over an empty org', async () => {
    const result = await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

    expect(result.created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length)
    expect(result.skipped).toBe(0)
    expect(h.creates).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length)
    expect(h.creates.every((c) => c.entityDefinitionId === DEF_ID)).toBe(true)
  })

  it('writes code, name, type and active on every row', async () => {
    await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

    const grni = h.creates.find((c) => c.values.gl_account_code === '2160')
    expect(grni?.values).toEqual({
      gl_account_code: '2160',
      gl_account_name: 'Goods Received Not Invoiced',
      gl_account_type: 'liability',
      gl_account_role: 'grni',
      gl_account_is_active: true,
    })
  })

  // Rule 3. `unique: true` on a nullable field is only safe because an absent
  // role writes no FieldValue row at all; an explicit null would route through
  // `deleteValue` to reach the same absence.
  it('omits the role key entirely on an account that has none', async () => {
    await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

    const receivables = h.creates.find((c) => c.values.gl_account_code === '1100')
    expect(receivables).toBeDefined()
    expect('gl_account_role' in (receivables?.values ?? {})).toBe(false)
  })

  it('creates nothing on a second pass, and reports it', async () => {
    const held = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code)
    const result = await seedDefaultChartOfAccounts(stubDb(held), 'org-1', DEF_ID)

    expect(result).toEqual({ created: 0, skipped: DEFAULT_CHART_OF_ACCOUNTS.length })
    expect(h.creates).toEqual([])
  })

  // 🛑 The partial case, which is the one that actually happens: a run that
  // died halfway, or an org that already had `1000` of its own. Re-inserting a
  // held code is what puts two `1310` rows in a chart, and the unique gate
  // (check-then-write, archived rows excluded) does not reliably stop it.
  it('inserts only the codes the org is missing', async () => {
    const result = await seedDefaultChartOfAccounts(
      stubDb(['1000', '1310', '2160']),
      'org-1',
      DEF_ID
    )

    expect(result.created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length - 3)
    const written = h.creates.map((c) => c.values.gl_account_code)
    expect(written).not.toContain('1000')
    expect(written).not.toContain('1310')
    expect(written).not.toContain('2160')
  })

  it('is a no-op when the org has no gl_account def yet', async () => {
    const result = await seedDefaultChartOfAccounts(stubDb([]), 'org-1', undefined)

    expect(result).toEqual({ created: 0, skipped: 0 })
    expect(h.creates).toEqual([])
  })

  // The def can exist a moment before its fields do. Writing rows with no code
  // would give the org a chart whose accounts have no identity at all — and no
  // second pass could tell them apart to fix it.
  it('is a no-op when gl_account_code has not been materialised', async () => {
    const result = await seedDefaultChartOfAccounts(
      stubDb([], { codeField: false }),
      'org-1',
      DEF_ID
    )

    expect(result).toEqual({ created: 0, skipped: 0 })
    expect(h.creates).toEqual([])
  })

  // 🛑 The defect this file was written after. `UnifiedCrudHandler` resolves an
  // entity's fields from the ORG CACHE and DROPS a value whose field it cannot
  // resolve — so a `gl_account_role` created moments earlier in the same
  // migration pass is invisible to it, every create still succeeds, and the org
  // ends up with a chart whose accounts have no roles at all. That happened for
  // real: 784 accounts across 28 orgs, every field written except the role, and
  // a migration log line reading "applied". A chart that resolves nothing makes
  // the posting resolver fail closed on every entry.
  it('throws when the roles it wrote did not land', async () => {
    await expect(
      seedDefaultChartOfAccounts(stubDb([], { rolesLand: false }), 'org-1', DEF_ID)
    ).rejects.toThrow(/did not land/)
  })

  it('names the stale org cache in the failure, because that is always the cause', async () => {
    await expect(
      seedDefaultChartOfAccounts(stubDb([], { rolesLand: false }), 'org-1', DEF_ID)
    ).rejects.toThrow(/org cache/)
  })

  // A seed has nobody to notify, and 28 accounts x 28 orgs of cache
  // invalidations is real time on a cold Redis.
  it('writes through a silent seed session', async () => {
    await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

    expect(h.constructorOptions).toHaveLength(1)
    expect(h.constructorOptions[0]).toMatchObject({
      session: { origin: { kind: 'seed' } },
    })
  })
})
