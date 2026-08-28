// packages/lib/src/seed/gl-account-chart.test.ts
//
// The chart of accounts is what decision `G8` rests on: a builder emits a ROLE,
// and this seed is what gives the resolver an account to turn that role into.
// So the properties pinned here are the ones the resolver depends on.
//
//  1. **Exactly one account per role, per org.** The resolver must fail CLOSED
//     on zero or more than one match — never "take the first" — so a chart with
//     two accounts claiming `grni` does not put money in an arbitrary place, it
//     stops every posting. Since decision `G19` that is a Postgres unique index
//     on `GlRoleAssignment(organizationId, role)`; what this file pins is that
//     the seed writes exactly one row per declared role and takes
//     `ON CONFLICT DO NOTHING` so a re-run cannot fight it.
//  2. **Idempotent on `code`.** A code the org already holds is skipped whole.
//     `gl_account_code`'s unique gate is a check-then-write with no lock, so a
//     re-run that inserted a second `1310` would pass validation and break the
//     resolver for every posting, not just the one that touches 1310.
//  3. **Never repoint a role the org already mapped.** `ON CONFLICT
//     (organizationId, role) DO NOTHING` — a bookkeeper who moved `grni` onto
//     their own `2155` keeps it through every re-seed.
//  4. **Never touch an account the org already has.** Not the name, not the
//     type. A chart is the bookkeeper's document (`G7`).
//
// ✅ The old rule 5, `assertRolesLanded`, is GONE and so is its test. It existed
// because a role was written as a `gl_account_role` FIELD through
// `UnifiedCrudHandler`, which resolves fields from the ORG CACHE and SILENTLY
// DROPS a value whose field it cannot resolve — the defect that wrote 784
// accounts across 28 orgs with every column populated except the role, and
// logged success. `G19` moved the mapping to a table and the insert is now plain
// Drizzle: no field resolution, no cache, nothing to drop. The failure mode is
// structurally unavailable rather than guarded against.
//
// `UnifiedCrudHandler` is stubbed — a lib-internal module, following the pattern
// `ai-category-tags.test.ts` set — so the assertions are about the values this
// module hands the write path.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ROLES } from '../postings/build-entry'
import { DEFAULT_CHART_OF_ACCOUNTS } from '../postings/default-chart'

const h = vi.hoisted(() => ({
  creates: [] as { entityDefinitionId: string; values: Record<string, unknown> }[],
  constructorOptions: [] as unknown[],
  /** Every `GlRoleAssignment` batch handed to `insert().values()`. */
  assignmentBatches: [] as Record<string, unknown>[][],
  /** Whether the assignment insert declared `onConflictDoNothing` on (org, role). */
  conflictTargets: [] as unknown[],
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
 * A stub `Database` that answers two selects — the `gl_account_code` field and
 * the code values the org already holds — and records the assignment insert.
 *
 * WHERE clauses are ignored: the module scopes in SQL and picks in JS, and
 * evaluating Drizzle conditions is not what this file is about.
 */
function stubDb(existingCodes: string[], opts: { codeField?: boolean } = {}) {
  let call = 0
  const chain = (rows: unknown[]) => ({
    where: () => chain(rows),
    limit: () => chain(rows),
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  })
  return {
    select: () => ({
      from: () => {
        call++
        // Query 1 is the `gl_account_code` field, query 2 is the held codes.
        if (call === 1) {
          return chain(opts.codeField === false ? [] : [{ id: CODE_FIELD_ID }])
        }
        return chain(
          existingCodes.map((code, index) => ({ code, entityId: `existing_${index + 1}` }))
        )
      },
    }),
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => {
        h.assignmentBatches.push(rows)
        return {
          onConflictDoNothing: (config: unknown) => {
            h.conflictTargets.push(config)
            return {
              // Every row is treated as inserted; the DO NOTHING behaviour is
              // Postgres', and asserting it here would be asserting the stub.
              returning: async () => rows.map((_, index) => ({ id: `assign_${index + 1}` })),
            }
          },
        }
      },
    }),
  } as unknown as Database
}

beforeEach(() => {
  h.creates.length = 0
  h.constructorOptions.length = 0
  h.assignmentBatches.length = 0
  h.conflictTargets.length = 0
})

/** Every role the default chart declares, which is every role that exists. */
const CHART_ROLES = DEFAULT_CHART_OF_ACCOUNTS.flatMap((a) => (a.role ? [a.role] : []))

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

  // 🛑 No `gl_account_role`. The field does not exist any more (`G19`), and a
  // key `UnifiedCrudHandler` cannot resolve is DROPPED rather than rejected — so
  // re-adding one here would silently write nothing and look correct in review.
  it('writes code, name, type and active on every row, and nothing else', async () => {
    await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

    const grni = h.creates.find((c) => c.values.gl_account_code === '2160')
    expect(grni?.values).toEqual({
      gl_account_code: '2160',
      gl_account_name: 'Goods Received Not Invoiced',
      gl_account_type: 'liability',
      gl_account_is_active: true,
    })
  })

  it('never writes a gl_account_role key on any account', async () => {
    await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

    for (const create of h.creates) {
      expect('gl_account_role' in create.values, String(create.values.gl_account_code)).toBe(false)
    }
  })

  it('seeds the corrected chart — 2150 broadened, 5095 present', async () => {
    await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

    const byCode = new Map(h.creates.map((c) => [c.values.gl_account_code, c.values]))
    expect(byCode.get('2150')?.gl_account_name).toBe('Inbound Freight & Brokerage Accrual')
    expect(byCode.get('5095')?.gl_account_name).toBe('Inventory Count Variance')
    expect(byCode.get('5095')?.gl_account_type).toBe('expense')
  })

  describe('role assignments', () => {
    it('writes exactly one assignment per declared role, pointed at the right account', async () => {
      const result = await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

      expect(result.rolesAssigned).toBe(CHART_ROLES.length)
      expect(h.assignmentBatches).toHaveLength(1)

      const rows = h.assignmentBatches[0] ?? []
      expect(rows.map((r) => r.role).sort()).toEqual([...CHART_ROLES].sort())

      // GRNI is the fifteenth create (index 14), so `acct_15` — the id the
      // handler stub minted for `2160`.
      const grniIndex = h.creates.findIndex((c) => c.values.gl_account_code === '2160')
      const grni = rows.find((r) => r.role === ACCOUNT_ROLES.GRNI)
      expect(grni?.glAccountId).toBe(`acct_${grniIndex + 1}`)
    })

    // `G19` leans on the difference between a suggestion and a confirmation: the
    // setup wizard renders "we chose this for you" differently from "you chose
    // this". Stamping a confirmation nobody gave would erase that on day one.
    it('marks every seeded mapping as source `seed`, and confirms nothing', async () => {
      await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

      for (const row of h.assignmentBatches[0] ?? []) {
        expect(row.source).toBe('seed')
        expect(row.confirmedAt).toBeUndefined()
        expect(row.confirmedByUserId).toBeUndefined()
      }
    })

    // Rule 3, and the whole reason the unique index is the right shape: the
    // index that makes the resolver's answer unambiguous is the same index that
    // makes this insert safe to repeat.
    it('defers to a mapping the org already made', async () => {
      await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

      expect(h.conflictTargets).toHaveLength(1)
      expect(h.conflictTargets[0]).toMatchObject({ target: expect.any(Array) })
    })

    // 🛑 The self-healing case. An org whose accounts all exist but whose
    // assignments do not is exactly what the dev chart reset leaves behind
    // mid-run, and what a partially-applied seed leaves behind for real. The
    // roles must still be written, pointed at the accounts already there.
    it('assigns roles to accounts it did NOT create', async () => {
      const held = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code)
      const result = await seedDefaultChartOfAccounts(stubDb(held), 'org-1', DEF_ID)

      expect(result.created).toBe(0)
      expect(result.rolesAssigned).toBe(CHART_ROLES.length)

      const rows = h.assignmentBatches[0] ?? []
      const grniIndex = DEFAULT_CHART_OF_ACCOUNTS.findIndex((a) => a.code === '2160')
      expect(rows.find((r) => r.role === ACCOUNT_ROLES.GRNI)?.glAccountId).toBe(
        `existing_${grniIndex + 1}`
      )
    })
  })

  it('creates nothing on a second pass, and reports it', async () => {
    const held = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code)
    const result = await seedDefaultChartOfAccounts(stubDb(held), 'org-1', DEF_ID)

    expect(result.created).toBe(0)
    expect(result.skipped).toBe(DEFAULT_CHART_OF_ACCOUNTS.length)
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

    expect(result).toEqual({ created: 0, skipped: 0, rolesAssigned: 0 })
    expect(h.creates).toEqual([])
    expect(h.assignmentBatches).toEqual([])
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

    expect(result).toEqual({ created: 0, skipped: 0, rolesAssigned: 0 })
    expect(h.creates).toEqual([])
    expect(h.assignmentBatches).toEqual([])
  })

  // A seed has nobody to notify, and 29 accounts x 28 orgs of cache
  // invalidations is real time on a cold Redis.
  it('writes through a silent seed session', async () => {
    await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

    expect(h.constructorOptions).toHaveLength(1)
    expect(h.constructorOptions[0]).toMatchObject({
      session: { origin: { kind: 'seed' } },
    })
  })
})
