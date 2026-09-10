// packages/lib/src/seed/gl-account-chart.test.ts
//
// The chart of accounts is what decision `G8` rests on: a builder emits a ROLE,
// and this seed is what gives the resolver an account to turn that role into.
// So the properties pinned here are the ones the resolver depends on.
//
//  1. **Exactly one account per role, per org.** The resolver must fail CLOSED
//     on zero or more than one match - never "take the first" - so a chart with
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
//     (organizationId, role) DO NOTHING` - a bookkeeper who moved `grni` onto
//     their own `2155` keeps it through every re-seed.
//  4. **Never touch an account the org already has.** Not the name, not the
//     type. A chart is the bookkeeper's document (`G7`).
//  5. **Packs, not the flat chart** (brief 16 §1.5). `seedChartPacks` always
//     walks `core` first and expands `requires` transitively, so
//     `['purchasing']` also lands `inventory`, and the packs actually walked
//     come back on the result.
//
// ✅ The old rule that used to sit here, `assertRolesLanded`, is GONE and so is
// its test. It existed because a role was written as a `gl_account_role` FIELD
// through `UnifiedCrudHandler`, which resolves fields from the ORG CACHE and
// SILENTLY DROPS a value whose field it cannot resolve - the defect that wrote
// 784 accounts across 28 orgs with every column populated except the role, and
// logged success. `G19` moved the mapping to a table and the insert is now plain
// Drizzle: no field resolution, no cache, nothing to drop. The failure mode is
// structurally unavailable rather than guarded against.
//
// `UnifiedCrudHandler` is stubbed - a lib-internal module, following the pattern
// `ai-category-tags.test.ts` set - so the assertions are about the values this
// module hands the write path.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ROLES } from '../postings/build-entry'
import { CHART_PACKS } from '../postings/default-chart'

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

import { seedChartPacks, seedDefaultChartOfAccounts } from './gl-account-chart'

const DEF_ID = 'def-gl-account'
const CODE_FIELD_ID = 'field-gl-account-code'

/** Every account in a pack, in pack order, flattened - the shape `seedChartPacks` walks. */
const CORE_ACCOUNTS = CHART_PACKS.core.accounts
const INVENTORY_ACCOUNTS = CHART_PACKS.inventory.accounts
const PURCHASING_ACCOUNTS = CHART_PACKS.purchasing.accounts

const CORE_CODES = CORE_ACCOUNTS.map((a) => a.code)
const CORE_ROLES = CORE_ACCOUNTS.flatMap((a) => (a.role ? [a.role] : []))
const CORE_PLUS_INVENTORY_ACCOUNTS = [...CORE_ACCOUNTS, ...INVENTORY_ACCOUNTS]
const CORE_PLUS_INVENTORY_ROLES = CORE_PLUS_INVENTORY_ACCOUNTS.flatMap((a) =>
  a.role ? [a.role] : []
)
const CORE_INVENTORY_PURCHASING_ACCOUNTS = [
  ...CORE_ACCOUNTS,
  ...INVENTORY_ACCOUNTS,
  ...PURCHASING_ACCOUNTS,
]
const CORE_INVENTORY_PURCHASING_ROLES = CORE_INVENTORY_PURCHASING_ACCOUNTS.flatMap((a) =>
  a.role ? [a.role] : []
)

/**
 * A stub `Database` that answers two selects - the `gl_account_code` field and
 * the code values the org already holds - and records the assignment insert.
 *
 * WHERE clauses are ignored: the module scopes in SQL and picks in JS, and
 * evaluating Drizzle conditions is not what this file is about.
 */
function stubDb(
  existingCodes: string[],
  opts: { codeField?: boolean; existingRoles?: readonly string[] } = {}
) {
  let call = 0
  const existingRoles = new Set(opts.existingRoles ?? [])
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
              // `existingRoles` simulates the ON CONFLICT (organizationId,
              // role) DO NOTHING a real Postgres index enforces - a role
              // already held by the org comes back un-returned, same as a
              // real re-seed. Everything else is treated as inserted.
              returning: async () =>
                rows
                  .filter((row) => !existingRoles.has(row.role as string))
                  .map((_, index) => ({ id: `assign_${index + 1}` })),
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

// The chart DATA's own invariants - one account per role, no role twice, no
// account claiming a role no builder emits - are pinned in
// `postings/__tests__/default-chart.test.ts`, next to the constant. This file
// is only about what the WRITER does with it.

describe('seedChartPacks', () => {
  it('walks core first, expands requires, and reports the packs actually walked', async () => {
    const result = await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['purchasing'])

    expect(result.packs).toEqual(['core', 'inventory', 'purchasing'])
  })

  it("['core'] creates 13 and assigns 11", async () => {
    const result = await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['core'])

    expect(result.packs).toEqual(['core'])
    expect(result.created).toBe(13)
    expect(result.created).toBe(CORE_CODES.length)
    expect(result.rolesAssigned).toBe(11)
    expect(result.rolesAssigned).toBe(CORE_ROLES.length)
    expect(h.creates).toHaveLength(13)
  })

  it("['core', 'inventory'] creates 22 and assigns 18", async () => {
    const result = await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['core', 'inventory'])

    expect(result.packs).toEqual(['core', 'inventory'])
    expect(result.created).toBe(22)
    expect(result.created).toBe(CORE_PLUS_INVENTORY_ACCOUNTS.length)
    expect(result.rolesAssigned).toBe(18)
    expect(result.rolesAssigned).toBe(CORE_PLUS_INVENTORY_ROLES.length)
  })

  it("['purchasing'] alone walks core, then inventory, then purchasing, landing 26 accounts and 22 roles", async () => {
    const result = await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['purchasing'])

    expect(result.packs).toEqual(['core', 'inventory', 'purchasing'])
    expect(result.created).toBe(26)
    expect(result.created).toBe(CORE_INVENTORY_PURCHASING_ACCOUNTS.length)
    expect(result.rolesAssigned).toBe(22)
    expect(result.rolesAssigned).toBe(CORE_INVENTORY_PURCHASING_ROLES.length)
  })

  it('a second pass over the same packs creates and assigns nothing', async () => {
    const heldCodes = CORE_INVENTORY_PURCHASING_ACCOUNTS.map((a) => a.code)
    const heldRoles = CORE_INVENTORY_PURCHASING_ROLES

    const second = await seedChartPacks(
      stubDb(heldCodes, { existingRoles: heldRoles }),
      'org-1',
      DEF_ID,
      ['purchasing']
    )

    expect(second.created).toBe(0)
    expect(second.rolesAssigned).toBe(0)
    expect(second.packs).toEqual(['core', 'inventory', 'purchasing'])
    expect(h.creates).toEqual([])
  })

  it('writes code, name, type and active on every row, and nothing else', async () => {
    await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['purchasing'])

    const grni = h.creates.find((c) => c.values.gl_account_code === '2160')
    expect(grni?.values).toEqual({
      gl_account_code: '2160',
      gl_account_name: 'Goods Received Not Invoiced',
      gl_account_type: 'liability',
      gl_account_is_active: true,
    })
  })

  it('never writes a gl_account_role key on any account', async () => {
    await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['purchasing'])

    for (const create of h.creates) {
      expect('gl_account_role' in create.values, String(create.values.gl_account_code)).toBe(false)
    }
  })

  it('seeds the corrected purchasing accounts - 2150 broadened, 5095 in inventory not purchasing', async () => {
    await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['purchasing'])

    const byCode = new Map(h.creates.map((c) => [c.values.gl_account_code, c.values]))
    expect(byCode.get('2150')?.gl_account_name).toBe('Inbound Freight & Brokerage Accrual')
    expect(byCode.get('5095')?.gl_account_name).toBe('Inventory Count Variance')
    expect(byCode.get('5095')?.gl_account_type).toBe('expense')
  })

  describe('role assignments', () => {
    it('writes exactly one assignment per declared role, pointed at the right account', async () => {
      const result = await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['purchasing'])

      expect(result.rolesAssigned).toBe(CORE_INVENTORY_PURCHASING_ROLES.length)
      expect(h.assignmentBatches).toHaveLength(1)

      const rows = h.assignmentBatches[0] ?? []
      expect(rows.map((r) => r.role).sort()).toEqual([...CORE_INVENTORY_PURCHASING_ROLES].sort())

      const grniIndex = h.creates.findIndex((c) => c.values.gl_account_code === '2160')
      const grni = rows.find((r) => r.role === ACCOUNT_ROLES.GRNI)
      expect(grni?.glAccountId).toBe(`acct_${grniIndex + 1}`)
    })

    // `G19` leans on the difference between a suggestion and a confirmation: the
    // setup wizard renders "we chose this for you" differently from "you chose
    // this". Stamping a confirmation nobody gave would erase that on day one.
    it('marks every seeded mapping as source `seed`, and confirms nothing', async () => {
      await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['core'])

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
      await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['core'])

      expect(h.conflictTargets).toHaveLength(1)
      expect(h.conflictTargets[0]).toMatchObject({ target: expect.any(Array) })
    })

    // 🛑 The self-healing case. An org whose accounts all exist but whose
    // assignments do not is exactly what the dev chart reset leaves behind
    // mid-run, and what a partially-applied seed leaves behind for real. The
    // roles must still be written, pointed at the accounts already there.
    it('assigns roles to accounts it did NOT create', async () => {
      const result = await seedChartPacks(stubDb(CORE_CODES), 'org-1', DEF_ID, ['core'])

      expect(result.created).toBe(0)
      expect(result.rolesAssigned).toBe(CORE_ROLES.length)

      const rows = h.assignmentBatches[0] ?? []
      const arIndex = CORE_ACCOUNTS.findIndex((a) => a.code === '1100')
      expect(rows.find((r) => r.role === ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)?.glAccountId).toBe(
        `existing_${arIndex + 1}`
      )
    })
  })

  it('inserts only the codes the org is missing', async () => {
    const result = await seedChartPacks(stubDb(['1000', '1100', '2200']), 'org-1', DEF_ID, ['core'])

    expect(result.created).toBe(CORE_CODES.length - 3)
    const written = h.creates.map((c) => c.values.gl_account_code)
    expect(written).not.toContain('1000')
    expect(written).not.toContain('1100')
    expect(written).not.toContain('2200')
  })

  it('is a no-op when the org has no gl_account def yet', async () => {
    const result = await seedChartPacks(stubDb([]), 'org-1', undefined, ['core'])

    expect(result).toEqual({ created: 0, skipped: 0, rolesAssigned: 0, packs: ['core'] })
    expect(h.creates).toEqual([])
  })

  // The def can exist a moment before its fields do. Writing rows with no code
  // would give the org a chart whose accounts have no identity at all - and no
  // second pass could tell them apart to fix it.
  it('is a no-op when gl_account_code has not been materialised', async () => {
    const result = await seedChartPacks(stubDb([], { codeField: false }), 'org-1', DEF_ID, ['core'])

    expect(result).toEqual({ created: 0, skipped: 0, rolesAssigned: 0, packs: ['core'] })
    expect(h.creates).toEqual([])
    expect(h.assignmentBatches).toEqual([])
  })

  it('writes through a silent seed session', async () => {
    await seedChartPacks(stubDb([]), 'org-1', DEF_ID, ['core'])

    expect(h.constructorOptions).toHaveLength(1)
    expect(h.constructorOptions[0]).toMatchObject({
      session: { origin: { kind: 'seed' } },
    })
  })
})

describe('seedDefaultChartOfAccounts', () => {
  it("is seedChartPacks(..., ['core']) - the one caller that means the core", async () => {
    const result = await seedDefaultChartOfAccounts(stubDb([]), 'org-1', DEF_ID)

    expect(result.packs).toEqual(['core'])
    expect(result.created).toBe(13)
    expect(result.rolesAssigned).toBe(11)
  })
})
