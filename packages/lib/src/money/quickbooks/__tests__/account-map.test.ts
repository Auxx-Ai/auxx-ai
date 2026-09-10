// packages/lib/src/money/quickbooks/__tests__/account-map.test.ts
//
// A removed QuickBooks-synced account stays removed across a Refresh.
//
// 🛑 THIS IS THE TEST FOR A CORRECTNESS THAT IS CURRENTLY ACCIDENTAL, and the
// reason the file exists at all. The chain is:
//
//   importChartFromProvider
//     -> provider.listAccountMappings
//          -> readQuickbooksAccountMap          <- HERE
//     -> planChartImport(providerAccounts, _, existingIdentities, _)
//          -> provider account found in the map => `alreadyImported`, not `create`
//
// `readQuickbooksAccountMap` selects `FieldValue` rows with **no join to
// `EntityInstance` and no `archivedAt` filter**. That looks like an oversight.
// It is load-bearing: an archived `gl_account` keeps its `qboAccountId`, so
// `planChartImport` still recognises the provider account as one it already has
// and files it under `alreadyImported` instead of creating it again.
//
// Add the filter that looks obviously missing and **every account a person
// removed silently comes back on the next Refresh**, with no other test in the
// repo failing. That is what this file is here to stop.
//
// The same rule, stated the other way round, is already written down one layer
// over in `seed/gl-account-chart.ts:222`: `seedChartAccounts` reads existing
// codes "ARCHIVED ROWS INCLUDED", because "someone who archived an account did
// not ask for it back". Two doors onto a chart, one answer.

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The drizzle chain `readQuickbooksAccountMap` builds, reduced to what it
 * actually consumes: `findFirst` for the `CustomField`, and
 * `select().from().where()` awaited for the `FieldValue` rows.
 *
 * `rowsFor` records the `where` it was handed so a test can assert on the
 * SHAPE of the query rather than only on its result - a filter added inside the
 * `and(...)` is the mutation this file guards against, and it is visible here.
 */
const world = {
  field: { id: 'fld_qbo_account_id' } as { id: string } | undefined,
  rows: [] as Array<{ entityId: string; valueText: string | null }>,
  /** Every table `.from()` was called with, in order. */
  fromTables: [] as string[],
  /** Every table joined onto it. Empty is the invariant - see the tripwire test. */
  joins: [] as string[],
}

const database = {
  query: {
    CustomField: {
      findFirst: vi.fn(async () => world.field),
    },
  },
  select: vi.fn(() => ({
    from: (table: { _name?: string }) => {
      world.fromTables.push(table?._name ?? 'unknown')
      // `innerJoin`/`leftJoin` are present so that ADDING one fails on the
      // assertion below rather than on a `TypeError`. A stub that simply lacked
      // the method would still catch the change, but the failure would read as a
      // broken test rather than as the deliberate refusal it is.
      const chain = {
        innerJoin: (joined: { _name?: string }) => {
          world.joins.push(joined?._name ?? 'unknown')
          return chain
        },
        leftJoin: (joined: { _name?: string }) => {
          world.joins.push(joined?._name ?? 'unknown')
          return chain
        },
        where: async () => world.rows,
      }
      return chain
    },
  })),
}

vi.mock('@auxx/database', () => ({
  database,
  schema: {
    CustomField: {
      _name: 'CustomField',
      organizationId: 'CustomField.organizationId',
      appInstallationId: 'CustomField.appInstallationId',
      connectionId: 'CustomField.connectionId',
      appFieldKey: 'CustomField.appFieldKey',
    },
    FieldValue: {
      _name: 'FieldValue',
      organizationId: 'FieldValue.organizationId',
      fieldId: 'FieldValue.fieldId',
      entityId: 'FieldValue.entityId',
      valueText: 'FieldValue.valueText',
    },
    EntityInstance: {
      _name: 'EntityInstance',
      id: 'EntityInstance.id',
      archivedAt: 'EntityInstance.archivedAt',
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  isNotNull: (a: unknown) => ({ op: 'isNotNull', a }),
  isNull: (a: unknown) => ({ op: 'isNull', a }),
}))

vi.mock('../../../cache', () => ({ getCachedEntityDefId: vi.fn() }))
vi.mock('../../../field-values/field-value-service', () => ({ FieldValueService: class {} }))
vi.mock('../../../identity', () => ({ deleteRecordIdentity: vi.fn() }))
vi.mock('../identity-field', () => ({
  QUICKBOOKS_SOURCE: 'quickbooks',
  writeQuickbooksIdField: vi.fn(),
}))

const { readQuickbooksAccountMap } = await import('../account-map')
const { planChartImport } = await import('../../../postings/chart-import-plan')

const PARAMS = { organizationId: 'org1', installationId: 'inst1', connectionId: 'conn1' }

/** The account somebody removed from the chart. Archived, still QuickBooks-linked. */
const ARCHIVED_GL_ACCOUNT = 'gla_archived'
/** Its counterpart in the provider's chart, which Refresh will hand us again. */
const ARCHIVED_PROVIDER_ID = '84'
const LIVE_GL_ACCOUNT = 'gla_live'
const LIVE_PROVIDER_ID = '12'

beforeEach(() => {
  world.field = { id: 'fld_qbo_account_id' }
  world.rows = []
  world.fromTables = []
  world.joins = []
})

describe('readQuickbooksAccountMap', () => {
  it('includes an archived account, so a Refresh cannot resurrect it', async () => {
    // The read returns the cell for BOTH accounts, because it does not filter on
    // the instance at all. That is the behaviour under test.
    world.rows = [
      { entityId: LIVE_GL_ACCOUNT, valueText: LIVE_PROVIDER_ID },
      { entityId: ARCHIVED_GL_ACCOUNT, valueText: ARCHIVED_PROVIDER_ID },
    ]

    const map = await readQuickbooksAccountMap(PARAMS)

    expect(map.get(ARCHIVED_GL_ACCOUNT)).toBe(ARCHIVED_PROVIDER_ID)
    expect(map.size).toBe(2)
  })

  it('reads FieldValue alone and never joins EntityInstance', async () => {
    world.rows = [{ entityId: LIVE_GL_ACCOUNT, valueText: LIVE_PROVIDER_ID }]

    await readQuickbooksAccountMap(PARAMS)

    // 🛑 The tripwire. A join onto `EntityInstance` is how the `archivedAt`
    // filter would arrive, and the moment it does, every removed account
    // returns on the next Refresh. If this assertion is failing because you
    // added the join deliberately, read this file's header first: the removal
    // needs somewhere else to be remembered before the filter is safe.
    expect(world.fromTables).toEqual(['FieldValue'])
    expect(world.joins).toEqual([])
  })

  it('answers an empty map when the field is not provisioned', async () => {
    world.field = undefined

    const map = await readQuickbooksAccountMap(PARAMS)

    expect(map.size).toBe(0)
    // Nothing is read at all - a connection with no `qboAccountId` field has no
    // map to build, and querying `FieldValue` on a null field id would match
    // every cell in the org.
    expect(world.fromTables).toEqual([])
  })

  it('skips a cell that is blank or whitespace', async () => {
    world.rows = [
      { entityId: LIVE_GL_ACCOUNT, valueText: '  ' },
      { entityId: 'gla_null', valueText: null },
      { entityId: ARCHIVED_GL_ACCOUNT, valueText: `  ${ARCHIVED_PROVIDER_ID}  ` },
    ]

    const map = await readQuickbooksAccountMap(PARAMS)

    expect(map.size).toBe(1)
    // Trimmed, so a padded cell still matches the provider id it names.
    expect(map.get(ARCHIVED_GL_ACCOUNT)).toBe(ARCHIVED_PROVIDER_ID)
  })
})

describe('a removed account across a Refresh', () => {
  /** One provider account, as `list_quickbooks_accounts` hands it back. */
  const providerAccount = (id: string, name: string) => ({
    id,
    name,
    // Required, and not optional in `ProviderAccount`: `matchesDeclaredName`
    // reads its last `:` segment, so a fixture without it throws rather than
    // failing an assertion.
    fullyQualifiedName: name,
    number: null,
    classification: 'expense' as const,
    accountType: 'Expense',
    active: true,
  })

  it('is not recreated, because the map still names it', async () => {
    world.rows = [{ entityId: ARCHIVED_GL_ACCOUNT, valueText: ARCHIVED_PROVIDER_ID }]
    const identities = await readQuickbooksAccountMap(PARAMS)

    // Refresh: the provider still has the account, and always will - removing it
    // here is OUR decision about OUR chart, not a change to theirs.
    const plan = planChartImport(
      [providerAccount(ARCHIVED_PROVIDER_ID, 'Job Materials')],
      [],
      identities,
      []
    )

    expect(plan.create).toEqual([])
    expect(plan.alreadyImported.map((row) => row.glAccountId)).toEqual([ARCHIVED_GL_ACCOUNT])
  })

  it('IS recreated once its mapping is gone, which is the other half of the contract', async () => {
    // Nothing links the provider account to anything of ours any more - the
    // account was hard-deleted, or the org reconnected to a different realm
    // (the field is connection-scoped). Then it is genuinely new.
    world.rows = []
    const identities = await readQuickbooksAccountMap(PARAMS)

    const plan = planChartImport(
      [providerAccount(ARCHIVED_PROVIDER_ID, 'Job Materials')],
      [],
      identities,
      []
    )

    expect(plan.create.map((row) => row.name)).toEqual(['Job Materials'])
    expect(plan.alreadyImported).toEqual([])
  })
})
