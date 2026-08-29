// packages/lib/src/postings/__tests__/role-map.test.ts
//
// Two properties carry this file, and they are the two things a role-map screen
// is for:
//
//  1. **The list is a CHECKLIST.** `listRoleMap` returns one row for every role
//     in `ACCOUNT_ROLES`, mapped or not. A screen that only rendered the rows
//     that happen to exist could never show what is MISSING, which is the single
//     question the `G19` setup wizard exists to answer.
//  2. **The write validates what the resolver validates, one step earlier.**
//     Pointing `grni` at a revenue account produces an entry that BALANCES, so
//     nothing downstream can detect it. If `setRoleAssignment` did not refuse,
//     the first anybody would learn of it is a refused close.
//
// The database is a hand-written stub rather than a mock chain, for the reason
// `resolve-roles.test.ts` gives: this module issues reads against three
// different tables plus an insert and an update, and each has to answer
// differently. Tables are identified by REFERENCE - `src/test/setup.ts` memoizes
// `schema.*` so identity is stable - and the org/id filter is applied by the
// stub out of the parameters the module actually passed.

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'

const h = vi.hoisted(() => ({
  /** systemAttribute -> the CustomField row, or absent to model an unmigrated org. */
  fields: new Map<string, { id: string; entityDefinitionId: string | null }>(),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.get(a) ?? null])),
    }),
  }),
}))

import { listChartAccounts, listRoleMap, setRoleAssignment } from '../role-map'

const ORG = 'org_1'
const OTHER_ORG = 'org_2'
const DEF = 'def_gl_account'

const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'

const ALL_ROLES = Object.values(ACCOUNT_ROLES)

interface Assignment {
  role: string
  glAccountId: string
  organizationId?: string
  source?: string
  confirmedAt?: Date | null
  markedUnused?: boolean
}

interface Account {
  id: string
  organizationId?: string
  code?: string
  name?: string
  accountType?: string
  isActive?: boolean
  /** Archived rows are excluded by the query, so this models "not returned". */
  archived?: boolean
}

/** Every scalar the module put into a `where` clause, flattened. See read-posting.test.ts. */
function whereValues(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 10 || node === null || node === undefined) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) whereValues(child, out, depth + 1)
    return out
  }
  const obj = node as Record<string, unknown>
  if ('value' in obj) whereValues(obj.value, out, depth + 1)
  if (Array.isArray(obj.queryChunks)) whereValues(obj.queryChunks, out, depth + 1)
  return out
}

interface Stub {
  db: Database
  inserts: { values: Record<string, unknown>; conflict: unknown }[]
  updates: Record<string, unknown>[]
}

/**
 * A stub answering the three reads by table, plus the upsert and the update.
 *
 * The `EntityInstance` read is modelled by excluding archived accounts and
 * accounts belonging to another org, exactly as the real query's `WHERE` does -
 * which is what lets "the mapped account was archived" be a real test rather
 * than a fixture returning what it was told to.
 */
function stubDb(assignments: Assignment[], accounts: Account[]): Stub {
  const inserts: Stub['inserts'] = []
  const updates: Record<string, unknown>[] = []

  const visible = accounts.filter((a) => !a.archived && (a.organizationId ?? ORG) === ORG)
  const fieldValues = visible.flatMap((account) => {
    const rows: Record<string, unknown>[] = []
    if (account.code !== undefined) {
      rows.push({ entityId: account.id, fieldId: CODE_FIELD, valueText: account.code })
    }
    if (account.name !== undefined) {
      rows.push({ entityId: account.id, fieldId: NAME_FIELD, valueText: account.name })
    }
    if (account.accountType !== undefined) {
      rows.push({ entityId: account.id, fieldId: TYPE_FIELD, optionId: account.accountType })
    }
    if (account.isActive !== undefined) {
      rows.push({ entityId: account.id, fieldId: ACTIVE_FIELD, valueBoolean: account.isActive })
    }
    return rows
  })

  const rowsFor = (table: unknown, params: string[]): unknown[] => {
    if (table === schema.GlRoleAssignment) {
      return assignments
        .filter((a) => params.includes(a.organizationId ?? ORG))
        .map((a) => ({
          role: a.role,
          glAccountId: a.glAccountId,
          source: a.source ?? 'seed',
          confirmedAt: a.confirmedAt ?? null,
          markedUnused: a.markedUnused ?? false,
        }))
    }
    if (table === schema.EntityInstance) {
      // Either the by-id read (ids in params) or the whole-def read (DEF in
      // params) - and in both cases the org has to have been asked for, which is
      // what makes the cross-org tests real rather than fixture-shaped.
      return accounts
        .filter(
          (a) =>
            !a.archived &&
            params.includes(a.organizationId ?? ORG) &&
            (params.includes(a.id) || params.includes(DEF))
        )
        .map((a) => ({ id: a.id }))
    }
    return fieldValues.filter((row) => params.includes(row.entityId as string))
  }

  const db = {
    select: () => ({
      from: (table: unknown) => {
        let params: string[] = []
        const chain: any = {
          where: (condition: unknown) => {
            params = whereValues(condition)
            return chain
          },
          limit: () => chain,
          orderBy: () => chain,
          // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(rowsFor(table, params)).then(resolve, reject),
        }
        return chain
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const chain: any = {
          onConflictDoUpdate: (conflict: unknown) => {
            inserts.push({ values, conflict })
            return chain
          },
          onConflictDoNothing: () => chain,
          returning: async () => [values],
        }
        return chain
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values)
        let params: string[] = []
        const chain: any = {
          where: (condition: unknown) => {
            params = whereValues(condition)
            return chain
          },
          returning: async () =>
            assignments
              .filter((a) => params.includes(a.organizationId ?? ORG) && params.includes(a.role))
              .map((a) => ({
                glAccountId: a.glAccountId,
                source: a.source ?? 'seed',
                confirmedAt: a.confirmedAt ?? null,
                markedUnused: a.markedUnused ?? false,
                ...values,
              })),
        }
        return chain
      },
    }),
  } as unknown as Database

  return { db, inserts, updates }
}

const GRNI_ACCOUNT: Account = {
  id: 'acct_grni',
  code: '2160',
  name: 'Goods Received Not Invoiced',
  accountType: 'liability',
  isActive: true,
}

beforeEach(() => {
  h.fields = new Map([
    ['gl_account_code', { id: CODE_FIELD, entityDefinitionId: DEF }],
    ['gl_account_name', { id: NAME_FIELD, entityDefinitionId: DEF }],
    ['gl_account_type', { id: TYPE_FIELD, entityDefinitionId: DEF }],
    ['gl_account_is_active', { id: ACTIVE_FIELD, entityDefinitionId: DEF }],
  ])
})

// ─────────────────────────────────────────────────────────────────────────────

describe('listRoleMap - the checklist', () => {
  // 🛑 The property the whole screen rests on. An absent row is INFORMATION, so
  // it gets a row; a table dump could never show what nobody has mapped yet.
  it('returns a row for every declared role even with zero assignments', async () => {
    const stub = stubDb([], [])
    const rows = (await listRoleMap(stub.db, ORG))._unsafeUnwrap()

    expect(rows).toHaveLength(ALL_ROLES.length)
    expect(rows.map((r) => r.role).sort()).toEqual([...ALL_ROLES].sort())
    expect(rows.every((r) => r.state === 'unmapped')).toBe(true)
    expect(rows.every((r) => r.accountId === null && r.account === null)).toBe(true)
    expect(rows.every((r) => r.source === null && r.confirmedAt === null)).toBe(true)
  })

  it('returns the roles in declaration order', async () => {
    const stub = stubDb([], [])
    const rows = (await listRoleMap(stub.db, ORG))._unsafeUnwrap()
    expect(rows.map((r) => r.role)).toEqual(ALL_ROLES)
  })

  it('never reads the chart when nothing is mapped', async () => {
    // An org with no `gl_account` fields at all still gets its thirteen rows -
    // the by-id chart read short-circuits on an empty id list.
    h.fields.clear()
    const stub = stubDb([], [])
    const result = await listRoleMap(stub.db, ORG)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toHaveLength(ALL_ROLES.length)
  })
})

describe('listRoleMap - the four derived states', () => {
  it('derives unmapped from an absent row', async () => {
    const stub = stubDb([], [])
    const rows = (await listRoleMap(stub.db, ORG))._unsafeUnwrap()
    expect(rows.find((r) => r.role === 'grni')?.state).toBe('unmapped')
  })

  it('derives suggested from a row with no confirmation', async () => {
    const stub = stubDb([{ role: 'grni', glAccountId: 'acct_grni' }], [GRNI_ACCOUNT])
    const row = (await listRoleMap(stub.db, ORG))._unsafeUnwrap().find((r) => r.role === 'grni')

    expect(row?.state).toBe('suggested')
    expect(row?.source).toBe('seed')
    expect(row?.confirmedAt).toBeNull()
    expect(row?.accountId).toBe('acct_grni')
    expect(row?.account).toEqual({
      id: 'acct_grni',
      code: '2160',
      name: 'Goods Received Not Invoiced',
      accountType: 'liability',
      isActive: true,
    })
  })

  it('derives confirmed from a confirmedAt stamp, serialised as ISO', async () => {
    const stub = stubDb(
      [
        {
          role: 'grni',
          glAccountId: 'acct_grni',
          source: 'human',
          confirmedAt: new Date('2026-08-20T10:00:00.000Z'),
        },
      ],
      [GRNI_ACCOUNT]
    )
    const row = (await listRoleMap(stub.db, ORG))._unsafeUnwrap().find((r) => r.role === 'grni')

    expect(row?.state).toBe('confirmed')
    expect(row?.source).toBe('human')
    expect(row?.confirmedAt).toBe('2026-08-20T10:00:00.000Z')
  })

  it('derives unused from markedUnused, hiding the account behind it', async () => {
    const stub = stubDb(
      [{ role: 'duties_accrual', glAccountId: 'acct_grni', markedUnused: true }],
      [GRNI_ACCOUNT]
    )
    const row = (await listRoleMap(stub.db, ORG))
      ._unsafeUnwrap()
      .find((r) => r.role === 'duties_accrual')

    expect(row?.state).toBe('unused')
    expect(row?.accountId).toBeNull()
    expect(row?.account).toBeNull()
  })

  // A row can carry both once somebody confirms a mapping and later marks the
  // role unused. "We do not use this" is the more recent and the more
  // consequential claim, and `resolveRoles` refuses on it regardless.
  it('lets markedUnused outrank a confirmation', async () => {
    const stub = stubDb(
      [
        {
          role: 'grni',
          glAccountId: 'acct_grni',
          confirmedAt: new Date('2026-08-20T10:00:00.000Z'),
          markedUnused: true,
        },
      ],
      [GRNI_ACCOUNT]
    )
    const row = (await listRoleMap(stub.db, ORG))._unsafeUnwrap().find((r) => r.role === 'grni')
    expect(row?.state).toBe('unused')
  })

  // The dangling case `GlRoleAssignment` deliberately has no foreign key to
  // prevent. `state: 'confirmed'` with `account: null` IS the repair a close
  // would otherwise refuse over, and the screen has to be able to show it.
  it('keeps the state but nulls the account when the mapped account was archived', async () => {
    const stub = stubDb(
      [
        {
          role: 'grni',
          glAccountId: 'acct_grni',
          confirmedAt: new Date('2026-08-20T10:00:00.000Z'),
        },
      ],
      [{ ...GRNI_ACCOUNT, archived: true }]
    )
    const row = (await listRoleMap(stub.db, ORG))._unsafeUnwrap().find((r) => r.role === 'grni')

    expect(row?.state).toBe('confirmed')
    expect(row?.accountId).toBe('acct_grni')
    expect(row?.account).toBeNull()
  })

  it('ignores assignments belonging to another organization', async () => {
    const stub = stubDb(
      [{ role: 'grni', glAccountId: 'acct_grni', organizationId: OTHER_ORG }],
      [GRNI_ACCOUNT]
    )
    const row = (await listRoleMap(stub.db, ORG))._unsafeUnwrap().find((r) => r.role === 'grni')
    expect(row?.state).toBe('unmapped')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('listChartAccounts', () => {
  it('returns the live accounts ordered by code', async () => {
    const stub = stubDb(
      [],
      [
        { id: 'a2', code: '2160', name: 'GRNI', accountType: 'liability', isActive: true },
        { id: 'a1', code: '1310', name: 'Raw Materials', accountType: 'asset', isActive: true },
        { id: 'a3', code: '5090', name: 'PPV', accountType: 'expense', isActive: false },
      ]
    )
    const rows = (await listChartAccounts(stub.db, ORG))._unsafeUnwrap()

    expect(rows.map((r) => r.code)).toEqual(['1310', '2160', '5090'])
    expect(rows[2]).toEqual({
      id: 'a3',
      code: '5090',
      name: 'PPV',
      accountType: 'expense',
      isActive: false,
    })
  })

  it('excludes archived accounts', async () => {
    const stub = stubDb(
      [],
      [
        { id: 'a1', code: '1310', name: 'Raw', accountType: 'asset', isActive: true },
        { id: 'a2', code: '1311', name: 'Old', accountType: 'asset', archived: true },
      ]
    )
    const rows = (await listChartAccounts(stub.db, ORG))._unsafeUnwrap()
    expect(rows.map((r) => r.id)).toEqual(['a1'])
  })

  // Guessing a type would defeat the compatibility check that is the only reason
  // the type is read, and a blank code on a ledger line is unauditable (P2).
  it('skips an account with no code or no type rather than defaulting one', async () => {
    const stub = stubDb(
      [],
      [
        { id: 'a1', code: '1310', name: 'Raw', accountType: 'asset' },
        { id: 'a2', name: 'No code', accountType: 'asset' },
        { id: 'a3', code: '9999', name: 'No type' },
      ]
    )
    const rows = (await listChartAccounts(stub.db, ORG))._unsafeUnwrap()
    expect(rows.map((r) => r.id)).toEqual(['a1'])
  })

  // `gl_account_is_active` declares `defaultValue: true`, and an account written
  // before the field existed has no row at all.
  it('treats a missing active flag as active', async () => {
    const stub = stubDb([], [{ id: 'a1', code: '1310', name: 'Raw', accountType: 'asset' }])
    const rows = (await listChartAccounts(stub.db, ORG))._unsafeUnwrap()
    expect(rows[0]?.isActive).toBe(true)
  })

  it('refuses when the chart is not provisioned for the org at all', async () => {
    h.fields.delete('gl_account_code')
    const stub = stubDb([], [GRNI_ACCOUNT])
    const result = await listChartAccounts(stub.db, ORG)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(result._unsafeUnwrapErr().message).toMatch(/not provisioned/i)
  })

  it('does not return another organization accounts', async () => {
    const stub = stubDb(
      [],
      [
        { id: 'a1', code: '1310', name: 'Ours', accountType: 'asset' },
        {
          id: 'a2',
          code: '1311',
          name: 'Theirs',
          accountType: 'asset',
          organizationId: OTHER_ORG,
        },
      ]
    )
    const rows = (await listChartAccounts(stub.db, ORG))._unsafeUnwrap()
    expect(rows.map((r) => r.id)).toEqual(['a1'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

async function expectErr(promise: Promise<{ isErr(): boolean; _unsafeUnwrapErr(): Error }>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

describe('setRoleAssignment - what it refuses before writing anything', () => {
  // The role vocabulary is CLOSED. An org may renumber, rename or replace the
  // ACCOUNT behind a role; it may not invent a role, because a role only means
  // something if a builder emits it.
  it('refuses a role outside ACCOUNT_ROLES', async () => {
    const stub = stubDb([], [GRNI_ACCOUNT])
    const error = await expectErr(
      setRoleAssignment(stub.db, {
        organizationId: ORG,
        role: 'invented',
        glAccountId: 'acct_grni',
      })
    )

    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toMatch(/not a declared posting role/i)
    expect(stub.inserts).toHaveLength(0)
  })

  // 🛑 The one a balanced entry hides completely. `grni` on a revenue account
  // posts, balances, and misstates the books until a close.
  it('refuses an account of the wrong statement type, naming both types', async () => {
    const stub = stubDb([], [{ ...GRNI_ACCOUNT, accountType: 'revenue' }])
    const error = await expectErr(
      setRoleAssignment(stub.db, { organizationId: ORG, role: 'grni', glAccountId: 'acct_grni' })
    )

    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/'grni' must be mapped to a liability account/i)
    expect(error.message).toMatch(/is a revenue account/i)
    expect(stub.inserts).toHaveLength(0)
  })

  it('refuses an account that does not exist in this organization', async () => {
    const stub = stubDb([], [{ ...GRNI_ACCOUNT, organizationId: OTHER_ORG }])
    const error = await expectErr(
      setRoleAssignment(stub.db, { organizationId: ORG, role: 'grni', glAccountId: 'acct_grni' })
    )

    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/does not exist in this organization/i)
    expect(stub.inserts).toHaveLength(0)
  })

  it('refuses an archived account', async () => {
    const stub = stubDb([], [{ ...GRNI_ACCOUNT, archived: true }])
    const error = await expectErr(
      setRoleAssignment(stub.db, { organizationId: ORG, role: 'grni', glAccountId: 'acct_grni' })
    )
    expect(error.message).toMatch(/archived/i)
  })

  it('refuses an inactive account and names it', async () => {
    const stub = stubDb([], [{ ...GRNI_ACCOUNT, isActive: false }])
    const error = await expectErr(
      setRoleAssignment(stub.db, { organizationId: ORG, role: 'grni', glAccountId: 'acct_grni' })
    )
    expect(error.message).toMatch(/not active/i)
    expect(error.message).toContain('2160')
  })

  it('refuses a request that both maps an account and marks the role unused', async () => {
    const stub = stubDb([], [GRNI_ACCOUNT])
    const error = await expectErr(
      setRoleAssignment(stub.db, {
        organizationId: ORG,
        role: 'grni',
        glAccountId: 'acct_grni',
        markedUnused: true,
      })
    )

    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toMatch(/one or the other/i)
    expect(stub.inserts).toHaveLength(0)
  })

  it('refuses a request that sets nothing', async () => {
    const stub = stubDb([], [GRNI_ACCOUNT])
    const error = await expectErr(setRoleAssignment(stub.db, { organizationId: ORG, role: 'grni' }))

    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toMatch(/nothing to set/i)
  })
})

describe('setRoleAssignment - mapping a role', () => {
  it('stamps human, confirmedAt, the actor, and clears markedUnused', async () => {
    const stub = stubDb([], [GRNI_ACCOUNT])
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'grni',
      glAccountId: 'acct_grni',
      actorUserId: 'usr_7',
    })

    expect(result.isOk()).toBe(true)
    expect(stub.inserts).toHaveLength(1)
    expect(stub.inserts[0]?.values).toMatchObject({
      organizationId: ORG,
      role: 'grni',
      glAccountId: 'acct_grni',
      source: 'human',
      confirmedByUserId: 'usr_7',
      markedUnused: false,
    })
    expect(stub.inserts[0]?.values.confirmedAt).toBeInstanceOf(Date)
  })

  // 🛑 One row per (org, role), enforced by the unique index rather than by a
  // check-then-insert - which two concurrent admins would both pass, producing
  // the ONE state `resolveRoles` refuses outright rather than choosing between.
  it('upserts on the (organizationId, role) unique index rather than inserting a second row', async () => {
    const stub = stubDb(
      [{ role: 'grni', glAccountId: 'acct_old', source: 'seed' }],
      [GRNI_ACCOUNT, { id: 'acct_old', code: '2155', name: 'Old', accountType: 'liability' }]
    )
    await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'grni',
      glAccountId: 'acct_grni',
    })

    expect(stub.inserts).toHaveLength(1)
    const conflict = stub.inserts[0]?.conflict as {
      target: unknown[]
      set: Record<string, unknown>
    }
    expect(conflict.target).toHaveLength(2)
    expect(conflict.set).toMatchObject({
      glAccountId: 'acct_grni',
      source: 'human',
      markedUnused: false,
    })
  })

  it('returns the role as the list would render it afterwards', async () => {
    const stub = stubDb([], [GRNI_ACCOUNT])
    const row = (
      await setRoleAssignment(stub.db, {
        organizationId: ORG,
        role: 'grni',
        glAccountId: 'acct_grni',
        actorUserId: 'usr_7',
      })
    )._unsafeUnwrap()

    expect(row.role).toBe('grni')
    expect(row.state).toBe('confirmed')
    expect(row.source).toBe('human')
    expect(row.accountId).toBe('acct_grni')
    expect(row.account?.code).toBe('2160')
    expect(row.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  // Two roles may legitimately share one account - the exact case `G19` names.
  it('lets a second role point at an account another role already uses', async () => {
    const variance: Account = {
      id: 'acct_var',
      code: '5090',
      name: 'Variances',
      accountType: 'expense',
      isActive: true,
    }
    const stub = stubDb([{ role: 'ppv', glAccountId: 'acct_var' }], [variance])
    const result = await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'inventory_count_variance',
      glAccountId: 'acct_var',
    })

    expect(result.isOk()).toBe(true)
  })
})

describe('setRoleAssignment - marking a role unused', () => {
  it('sets the flag and reports the role as unused', async () => {
    const stub = stubDb([{ role: 'duties_accrual', glAccountId: 'acct_grni' }], [GRNI_ACCOUNT])
    const row = (
      await setRoleAssignment(stub.db, {
        organizationId: ORG,
        role: 'duties_accrual',
        markedUnused: true,
      })
    )._unsafeUnwrap()

    expect(stub.updates).toEqual([expect.objectContaining({ markedUnused: true })])
    expect(row.state).toBe('unused')
    expect(row.accountId).toBeNull()
    expect(row.account).toBeNull()
  })

  // Marking a role unused is not a confirmation of the account behind it -
  // stamping one would erase the `G19` distinction the wizard renders.
  it('does not stamp a confirmation', async () => {
    const stub = stubDb([{ role: 'duties_accrual', glAccountId: 'acct_grni' }], [GRNI_ACCOUNT])
    await setRoleAssignment(stub.db, {
      organizationId: ORG,
      role: 'duties_accrual',
      markedUnused: true,
    })

    expect(stub.updates[0]).not.toHaveProperty('confirmedAt')
    expect(stub.updates[0]).not.toHaveProperty('source')
  })

  it('clears the flag again, restoring the state the row already had', async () => {
    const stub = stubDb(
      [
        {
          role: 'duties_accrual',
          glAccountId: 'acct_grni',
          source: 'human',
          confirmedAt: new Date('2026-08-20T10:00:00.000Z'),
          markedUnused: true,
        },
      ],
      [GRNI_ACCOUNT]
    )
    const row = (
      await setRoleAssignment(stub.db, {
        organizationId: ORG,
        role: 'duties_accrual',
        markedUnused: false,
      })
    )._unsafeUnwrap()

    expect(row.state).toBe('confirmed')
    expect(row.accountId).toBe('acct_grni')
    expect(row.account?.code).toBe('2160')
  })

  // `GlRoleAssignment.glAccountId` is NOT NULL, so a row cannot exist without
  // naming an account. Inserting a placeholder id would dangle forever and read
  // to `resolveRoles` as "the account moved under the mapping".
  it('refuses to mark a role that has no assignment at all', async () => {
    const stub = stubDb([], [GRNI_ACCOUNT])
    const error = await expectErr(
      setRoleAssignment(stub.db, { organizationId: ORG, role: 'grni', markedUnused: true })
    )

    expect(error).toBeInstanceOf(NotFoundError)
    expect(error.message).toMatch(/map it to an account first/i)
  })

  it('refuses to mark a role belonging to another organization', async () => {
    const stub = stubDb(
      [{ role: 'grni', glAccountId: 'acct_grni', organizationId: OTHER_ORG }],
      [GRNI_ACCOUNT]
    )
    const error = await expectErr(
      setRoleAssignment(stub.db, { organizationId: ORG, role: 'grni', markedUnused: true })
    )
    expect(error).toBeInstanceOf(NotFoundError)
  })
})
