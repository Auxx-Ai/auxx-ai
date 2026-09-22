// packages/lib/src/accounting/ledger/chart/__tests__/chart-accounts.test.ts
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
import { UnprocessableEntityError } from '../../../../errors'
import type { ChartAccountRow } from '../../types'

const h = vi.hoisted(() => ({
  /** systemAttribute -> the CustomField row, or absent to model an unmigrated org. */
  fields: new Map<string, { id: string; entityDefinitionId: string | null }>(),
  /** The `chartAccounts` org-cache answer. */
  chart: [] as ChartAccountRow[],
  chartReads: 0,
}))

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.get(a) ?? null])),
    }),
    get: async (_orgId: string, key: string) => {
      if (key !== 'chartAccounts') throw new Error(`unstubbed cache key ${key}`)
      h.chartReads++
      return h.chart
    },
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
const SUBTYPE_FIELD = 'fld_subtype'
const PARENT_FIELD = 'fld_parent'

const FIELDS: ChartAccountFields = {
  code: { id: CODE_FIELD, entityDefinitionId: DEF },
  name: { id: NAME_FIELD },
  type: { id: TYPE_FIELD },
  active: { id: ACTIVE_FIELD },
  subtype: { id: SUBTYPE_FIELD },
  parent: { id: PARENT_FIELD },
}

/** A `FieldValue` row with only the column under test populated. */
function value(
  entityId: string,
  fieldId: string,
  populated: Partial<ChartAccountValueRow>
): ChartAccountValueRow {
  return {
    entityId,
    fieldId,
    valueText: null,
    optionId: null,
    valueBoolean: null,
    relatedEntityId: null,
    ...populated,
  }
}

beforeEach(() => {
  h.fields = new Map([
    ['gl_account_code', { id: CODE_FIELD, entityDefinitionId: DEF }],
    ['gl_account_name', { id: NAME_FIELD, entityDefinitionId: DEF }],
    ['gl_account_type', { id: TYPE_FIELD, entityDefinitionId: DEF }],
    ['gl_account_is_active', { id: ACTIVE_FIELD, entityDefinitionId: DEF }],
    ['gl_account_subtype', { id: SUBTYPE_FIELD, entityDefinitionId: DEF }],
    ['gl_account_parent', { id: PARENT_FIELD, entityDefinitionId: DEF }],
  ])
})

// ─────────────────────────────────────────────────────────────────────────────

describe('ACCOUNT_ATTRIBUTES', () => {
  // The list both readers share. If one of these disappears, a caller silently
  // stops reading an attribute rather than failing.
  it('is the six attributes an account is made of', () => {
    expect([...ACCOUNT_ATTRIBUTES]).toEqual([
      'gl_account_code',
      'gl_account_name',
      'gl_account_type',
      'gl_account_is_active',
      'gl_account_subtype',
      'gl_account_parent',
    ])
  })
})

describe('decodeChartAccounts', () => {
  it('assembles one account from its field values', () => {
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
      subtype: null,
      parentId: null,
    })
  })

  it('reads the parent id from relatedEntityId when the org has the field', () => {
    const { accounts } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '4100' }),
        value('a1', TYPE_FIELD, { optionId: 'revenue' }),
        value('a1', PARENT_FIELD, { relatedEntityId: 'a0' }),
      ],
      FIELDS
    )
    expect(accounts.get('a1')?.parentId).toBe('a0')
  })

  // An org not yet stamped by the CHART-HIERARCHY per-org migration has no
  // `gl_account_parent` field at all - every row decodes top-level.
  it('decodes parentId: null when the org has no gl_account_parent field', () => {
    const fields: ChartAccountFields = { ...FIELDS, parent: null }
    const { accounts } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '4100' }),
        value('a1', TYPE_FIELD, { optionId: 'revenue' }),
      ],
      fields
    )
    expect(accounts.get('a1')?.parentId).toBeNull()
  })

  // Task 13 §3 / 15 §5: the second fact about an account, read the same way the
  // type is - a SINGLE_SELECT's chosen value lives in `optionId`.
  it('reads the subtype from optionId when the org has the field', () => {
    const { accounts } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '5100' }),
        value('a1', TYPE_FIELD, { optionId: 'expense' }),
        value('a1', SUBTYPE_FIELD, { optionId: 'cost_of_goods_sold' }),
      ],
      FIELDS
    )
    expect(accounts.get('a1')?.subtype).toBe('cost_of_goods_sold')
  })

  // An org not yet stamped by entity migration 144 has no `gl_account_subtype`
  // field at all - not merely a blank value on the account.
  it('decodes subtype: null when the org has no gl_account_subtype field', () => {
    const fields: ChartAccountFields = { ...FIELDS, subtype: null }
    const { accounts } = decodeChartAccounts(
      [
        value('a1', CODE_FIELD, { valueText: '5100' }),
        value('a1', TYPE_FIELD, { optionId: 'expense' }),
      ],
      fields
    )
    expect(accounts.get('a1')?.subtype).toBeNull()
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

  // 🛑 The rule the whole module is for. A guessed type would defeat the
  // compatibility check that is the only reason it is read at all.
  it.each([
    ['no type', [value('a1', CODE_FIELD, { valueText: '1310' })]],
    ['neither code nor type', [value('a1', NAME_FIELD, { valueText: 'Orphan' })]],
  ])('treats an account with %s as absent rather than defaulting one', (_label, rows) => {
    const { accounts, malformed } = decodeChartAccounts(rows, FIELDS)
    expect(accounts.has('a1')).toBe(false)
    expect(malformed).toEqual(['a1'])
  })

  // 🛑 Task 15 §5's own regression: a missing or blank code is no longer
  // malformed. The account id is the identity; the code is a label an account
  // may not carry.
  it.each([
    ['no code at all', [value('a1', TYPE_FIELD, { optionId: 'asset' })]],
    [
      'an empty-string code',
      [value('a1', CODE_FIELD, { valueText: '' }), value('a1', TYPE_FIELD, { optionId: 'asset' })],
    ],
  ])('decodes an account with %s as code: null rather than malformed', (_label, rows) => {
    const { accounts, malformed } = decodeChartAccounts(rows, FIELDS)
    expect(malformed).toEqual([])
    expect(accounts.get('a1')?.code).toBeNull()
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
  // to match on. The required attribute still decodes.
  it('decodes with the optional fields unprovisioned', () => {
    const fields: ChartAccountFields = { ...FIELDS, name: null, active: null, subtype: null }
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
      subtype: null,
      parentId: null,
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
  it('resolves the field ids and carries the definition id', async () => {
    const fields = await loadChartAccountFields(ORG, 'nope')
    expect(fields).toEqual({
      code: { id: CODE_FIELD, entityDefinitionId: DEF },
      name: { id: NAME_FIELD },
      type: { id: TYPE_FIELD },
      active: { id: ACTIVE_FIELD },
      subtype: { id: SUBTYPE_FIELD },
      parent: { id: PARENT_FIELD },
    })
  })

  it('tolerates the four optional fields being absent', async () => {
    h.fields.delete('gl_account_name')
    h.fields.delete('gl_account_is_active')
    h.fields.delete('gl_account_subtype')
    h.fields.delete('gl_account_parent')
    const fields = await loadChartAccountFields(ORG, 'nope')
    expect(fields.name).toBeNull()
    expect(fields.active).toBeNull()
    expect(fields.subtype).toBeNull()
    expect(fields.parent).toBeNull()
  })

  // Task 15 §5's own concern: an org not yet stamped by entity migration 144
  // must not refuse to provision because it lacks a field neither `code` nor
  // `type` ever required.
  it('tolerates gl_account_subtype absent on its own, unrelated to provisioning', async () => {
    h.fields.delete('gl_account_subtype')
    const fields = await loadChartAccountFields(ORG, 'nope')
    expect(fields.subtype).toBeNull()
    expect(fields.code).toEqual({ id: CODE_FIELD, entityDefinitionId: DEF })
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

/** `loadChartAccountsById` reads the cache, never the db it is handed. */
const DB = {} as Database

describe('loadChartAccountsById', () => {
  const account = (id: string, extra: Partial<ChartAccountRow> = {}): ChartAccountRow => ({
    id,
    code: '1310',
    name: 'Raw Materials',
    accountType: 'asset',
    isActive: true,
    subtype: null,
    parentId: null,
    ...extra,
  })

  beforeEach(() => {
    h.chart = []
    h.chartReads = 0
  })

  it('answers the named accounts from the cached chart', async () => {
    h.chart = [account('a1'), account('a2', { code: '1320' })]
    const read = await loadChartAccountsById(DB, ORG, ['a1'], 'nope')

    expect([...read.accounts.keys()]).toEqual(['a1'])
    expect(read.accounts.get('a1')).toEqual(account('a1'))
    expect(read.malformed).toEqual([])
  })

  // "Archived" and "deleted" are one fact to every caller: the account the
  // mapping names is not available.
  it('omits an archived account entirely', async () => {
    h.chart = [account('a1', { isArchived: true })]
    const { accounts } = await loadChartAccountsById(DB, ORG, ['a1'], 'nope')
    expect(accounts.size).toBe(0)
  })

  // 🛑 A fresh org has no assignments, so no ids, and must still get an answer
  // rather than a provisioning refusal - `listRoleMap`'s thirteen `unmapped`
  // rows depend on this short-circuit happening BEFORE the cache is touched.
  it('short-circuits an empty id list without touching the cache', async () => {
    h.fields.clear()
    const read = await loadChartAccountsById(DB, ORG, [], 'nope')

    expect(read).toEqual({ accounts: new Map(), malformed: [] })
    expect(h.chartReads).toBe(0)
  })

  it('refuses with the caller message when the chart is not provisioned', async () => {
    h.fields.delete('gl_account_type')
    h.chart = [account('a1')]
    await expect(loadChartAccountsById(DB, ORG, ['a1'], 'THE CALLER SENTENCE')).rejects.toThrow(
      'THE CALLER SENTENCE'
    )
  })
})
