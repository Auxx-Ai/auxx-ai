// packages/lib/src/postings/__tests__/chart-accounts.test.ts
//
// This module exists because there were two copies of "how auxx reads a chart of
// accounts" - one in `resolve-roles.ts`, one in `role-map.ts` - and a second copy
// of a decode is the thing that drifts. The property these tests protect is
// therefore not "the decode works" but "there is exactly ONE decode, and it says
// what both readers need it to say":
//
//  1. **Missing code or missing type means ABSENT, never defaulted.** A blank
//     code on a ledger line is unauditable (`P2`), and a guessed type would
//     defeat the only check the type is read for. The id goes to `malformed`.
//  2. **A missing active flag means ACTIVE.** `gl_account_is_active` declares
//     `defaultValue: true` and an account written before the field existed has no
//     row at all. The opposite reading refuses to post to, and hides, a chart
//     nobody has ever deactivated anything in.
//  3. **A SINGLE_SELECT's value lives in `optionId`, not `valueText`.** For a
//     system-seeded enum that id IS the value. Recorded in HANDOFF §3 because it
//     has been got wrong.
//  4. **The refusal message is the CALLER's**, not this module's - a resolver
//     reached at post time and a setup screen tell different readers to do
//     different things, and sharing the check must not collapse the two.
//
// `decodeChartAccounts` is pure, so most of this needs no doubles at all.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../errors'

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

import {
  ACCOUNT_ATTRIBUTES,
  type ChartAccountFields,
  type ChartAccountValueRow,
  decodeChartAccounts,
  loadChartAccountFields,
  loadChartAccountsById,
} from '../chart-accounts'

const ORG = 'org_1'
const DEF = 'def_gl_account'

const CODE_FIELD = 'fld_code'
const NAME_FIELD = 'fld_name'
const TYPE_FIELD = 'fld_type'
const ACTIVE_FIELD = 'fld_active'

const FIELDS: ChartAccountFields = {
  code: { id: CODE_FIELD, entityDefinitionId: DEF },
  name: { id: NAME_FIELD },
  type: { id: TYPE_FIELD },
  active: { id: ACTIVE_FIELD },
}

/** A `FieldValue` row with only the column under test populated. */
function value(
  entityId: string,
  fieldId: string,
  populated: Partial<ChartAccountValueRow>
): ChartAccountValueRow {
  return { entityId, fieldId, valueText: null, optionId: null, valueBoolean: null, ...populated }
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

describe('ACCOUNT_ATTRIBUTES', () => {
  // The list both readers share. If one of these disappears, a caller silently
  // stops reading an attribute rather than failing.
  it('is the four attributes an account is made of', () => {
    expect([...ACCOUNT_ATTRIBUTES]).toEqual([
      'gl_account_code',
      'gl_account_name',
      'gl_account_type',
      'gl_account_is_active',
    ])
  })
})

describe('decodeChartAccounts', () => {
  it('assembles one account from its four field values', () => {
    const { accounts, malformed } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '2160' }),
        value('a1', NAME_FIELD, { valueText: 'Goods Received Not Invoiced' }),
        value('a1', TYPE_FIELD, { optionId: 'liability' }),
        value('a1', ACTIVE_FIELD, { valueBoolean: true }),
      ],
      FIELDS
    )

    expect(malformed).toEqual([])
    expect(accounts.get('a1')).toEqual({
      id: 'a1',
      code: '2160',
      name: 'Goods Received Not Invoiced',
      accountType: 'liability',
      isActive: true,
    })
  })

  // ⚠️ A SINGLE_SELECT carries its chosen value in `optionId`; for a
  // system-seeded enum that id IS the value. Reading `valueText` gets null and
  // the account reads as typeless, which reads downstream as "archived".
  it('reads the account type from optionId, not valueText', () => {
    const { accounts, malformed } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '1310' }),
        value('a1', TYPE_FIELD, { valueText: 'asset' }),
      ],
      FIELDS
    )

    expect(accounts.size).toBe(0)
    expect(malformed).toEqual(['a1'])
  })

  // 🛑 The rule the whole module is for. A blank code on a ledger line is
  // unauditable, and a guessed type defeats the compatibility check.
  it.each([
    ['no code', [value('a1', TYPE_FIELD, { optionId: 'asset' })]],
    ['no type', [value('a1', CODE_FIELD, { valueText: '1310' })]],
    ['neither', [value('a1', NAME_FIELD, { valueText: 'Orphan' })]],
    ['an empty code', [value('a1', CODE_FIELD, { valueText: '' })]],
  ])('treats an account with %s as absent rather than defaulting one', (_label, rows) => {
    const { accounts, malformed } = decodeChartAccounts(rows, FIELDS)
    expect(accounts.has('a1')).toBe(false)
    expect(malformed).toEqual(['a1'])
  })

  // `gl_account_is_active` declares `defaultValue: true`, and an account written
  // before the field existed has no row at all.
  it('treats a missing active flag as active', () => {
    const { accounts } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '1310' }),
        value('a1', TYPE_FIELD, { optionId: 'asset' }),
      ],
      FIELDS
    )
    expect(accounts.get('a1')?.isActive).toBe(true)
  })

  it('honours an explicit false active flag', () => {
    const { accounts } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '1310' }),
        value('a1', TYPE_FIELD, { optionId: 'asset' }),
        value('a1', ACTIVE_FIELD, { valueBoolean: false }),
      ],
      FIELDS
    )
    expect(accounts.get('a1')?.isActive).toBe(false)
  })

  it('defaults a missing name to the empty string rather than dropping the account', () => {
    const { accounts, malformed } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '1310' }),
        value('a1', TYPE_FIELD, { optionId: 'asset' }),
      ],
      FIELDS
    )
    expect(malformed).toEqual([])
    expect(accounts.get('a1')?.name).toBe('')
  })

  // An org whose chart predates `gl_account_name` / `_is_active` has no field id
  // to match on. The two required attributes still decode.
  it('decodes with the two optional fields unprovisioned', () => {
    const fields: ChartAccountFields = { ...FIELDS, name: null, active: null }
    const { accounts } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '1310' }),
        value('a1', TYPE_FIELD, { optionId: 'asset' }),
        // A row for a field this org does not have must not be mistaken for one
        // it does - the guards are what stop `name` eating the active flag.
        value('a1', NAME_FIELD, { valueText: 'Ignored' }),
      ],
      fields
    )
    expect(accounts.get('a1')).toEqual({
      id: 'a1',
      code: '1310',
      name: '',
      accountType: 'asset',
      isActive: true,
    })
  })

  it('keeps several accounts apart', () => {
    const { accounts, malformed } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '1310' }),
        value('a1', TYPE_FIELD, { optionId: 'asset' }),
        value('a2', CODE_FIELD, { valueText: '2160' }),
        value('a2', TYPE_FIELD, { optionId: 'liability' }),
        value('a3', NAME_FIELD, { valueText: 'Broken' }),
      ],
      FIELDS
    )

    expect([...accounts.keys()].sort()).toEqual(['a1', 'a2'])
    expect(accounts.get('a2')?.accountType).toBe('liability')
    expect(malformed).toEqual(['a3'])
  })

  it('decodes nothing from nothing', () => {
    expect(decodeChartAccounts([], FIELDS)).toEqual({ accounts: new Map(), malformed: [] })
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('loadChartAccountFields', () => {
  it('resolves the four field ids and carries the definition id', async () => {
    const fields = await loadChartAccountFields(ORG, 'nope')
    expect(fields).toEqual({
      code: { id: CODE_FIELD, entityDefinitionId: DEF },
      name: { id: NAME_FIELD },
      type: { id: TYPE_FIELD },
      active: { id: ACTIVE_FIELD },
    })
  })

  it('tolerates the two optional fields being absent', async () => {
    h.fields.delete('gl_account_name')
    h.fields.delete('gl_account_is_active')
    const fields = await loadChartAccountFields(ORG, 'nope')
    expect(fields.name).toBeNull()
    expect(fields.active).toBeNull()
  })

  // 🛑 The message belongs to the CALLER. `resolveRoles` says "before posting",
  // `listChartAccounts` does not, because they are read by different people
  // doing different things. Sharing the check must not collapse the two.
  it.each([
    'gl_account_code',
    'gl_account_type',
  ])('refuses with the caller own message when %s is missing', async (attribute) => {
    h.fields.delete(attribute)
    await expect(loadChartAccountFields(ORG, 'THE CALLER SENTENCE')).rejects.toThrow(
      'THE CALLER SENTENCE'
    )
  })

  it('refuses with an UnprocessableEntityError carrying the org', async () => {
    h.fields.delete('gl_account_code')
    await expect(loadChartAccountFields(ORG, 'nope')).rejects.toBeInstanceOf(
      UnprocessableEntityError
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A stub answering the two reads this function makes, in order: the live
 * `EntityInstance` rows, then their `FieldValue` rows. Archived accounts are
 * modelled by exclusion, because that is what the real query does.
 */
function stubDb(accounts: { id: string; archived?: boolean }[], values: ChartAccountValueRow[]) {
  let call = 0
  const chain = (rows: unknown[]) => ({
    where: () => chain(rows),
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  })

  const live = accounts.filter((a) => !a.archived)
  return {
    reads: () => call,
    db: {
      select: () => ({
        from: () => {
          call++
          if (call === 1) return chain(live.map((a) => ({ id: a.id })))
          return chain(values.filter((v) => live.some((a) => a.id === v.entityId)))
        },
      }),
    } as unknown as Database,
  }
}

describe('loadChartAccountsById', () => {
  it('loads and decodes the named accounts', async () => {
    const stub = stubDb(
      [{ id: 'a1' }],
      [
        value('a1', CODE_FIELD, { valueText: '1310' }),
        value('a1', NAME_FIELD, { valueText: 'Raw Materials' }),
        value('a1', TYPE_FIELD, { optionId: 'asset' }),
      ]
    )
    const { accounts } = await loadChartAccountsById(stub.db, ORG, ['a1'], 'nope')

    expect(accounts.get('a1')).toEqual({
      id: 'a1',
      code: '1310',
      name: 'Raw Materials',
      accountType: 'asset',
      isActive: true,
    })
  })

  // "Archived" and "deleted" are one fact to every caller: the account the
  // mapping names is not available. Excluding it in the query rather than after
  // is what makes them one fact rather than two code paths.
  it('omits an archived account entirely', async () => {
    const stub = stubDb(
      [{ id: 'a1', archived: true }],
      [
        value('a1', CODE_FIELD, { valueText: '1310' }),
        value('a1', TYPE_FIELD, { optionId: 'asset' }),
      ]
    )
    const { accounts } = await loadChartAccountsById(stub.db, ORG, ['a1'], 'nope')
    expect(accounts.size).toBe(0)
  })

  // 🛑 A fresh org has no assignments, so no ids, and must still get an answer
  // rather than a provisioning refusal - `listRoleMap`'s thirteen `unmapped`
  // rows depend on this short-circuit happening BEFORE the cache is touched.
  it('short-circuits an empty id list without touching the cache or the database', async () => {
    h.fields.clear()
    const stub = stubDb([], [])
    const read = await loadChartAccountsById(stub.db, ORG, [], 'nope')

    expect(read).toEqual({ accounts: new Map(), malformed: [] })
    expect(stub.reads()).toBe(0)
  })

  it('skips the field-value read when no named account is live', async () => {
    const stub = stubDb([{ id: 'a1', archived: true }], [])
    await loadChartAccountsById(stub.db, ORG, ['a1'], 'nope')
    expect(stub.reads()).toBe(1)
  })

  it('reports an undecodable account as malformed rather than refusing', async () => {
    const stub = stubDb([{ id: 'a1' }], [value('a1', NAME_FIELD, { valueText: 'No code' })])
    const { accounts, malformed } = await loadChartAccountsById(stub.db, ORG, ['a1'], 'nope')

    expect(accounts.size).toBe(0)
    expect(malformed).toEqual(['a1'])
  })

  it('refuses with the caller message when the chart is not provisioned', async () => {
    h.fields.delete('gl_account_type')
    const stub = stubDb([{ id: 'a1' }], [])
    await expect(
      loadChartAccountsById(stub.db, ORG, ['a1'], 'THE CALLER SENTENCE')
    ).rejects.toThrow('THE CALLER SENTENCE')
  })
})
