// packages/lib/src/data-migrations/migrations/__tests__/157-payout-rail-and-order-payment-fields.test.ts
//
// Migration 157 widens five defs at once: three payout-side defs with two
// relationship pairs and a select stamped onto every payout that predates it,
// the order def with two fields and nothing stamped (`paymentGlPosting` was a
// third, retired in step 1b - TARGET §1 - since an order's payment postings
// are read through `listPostingsForSource` now), and the line item def with
// one field (the line NET) and nothing stamped. It supersedes two same-day
// drafts, and the first of them already ran on dev. What actually goes wrong
// here:
//
//  - the registry and the migration disagree. The registry edit reaches only
//    NEW orgs and the migration reaches only EXISTING ones, so if the two say
//    different things a fresh org and a migrated org end up with different
//    fields - and nothing fails. Pinned below by asserting the registry
//    literals, not by restating them;
//  - a relationship half points at an inverse that does not exist, or the two
//    halves point past each other. `linkNewRelationships` skips that pair with
//    a DEBUG line, the sync's write is accepted, and the pair lookup reads an
//    empty cell forever. Both halves of both pairs are asserted here by id;
//  - a SINGLE_SELECT seeded with no options renders BLANK, so the option list
//    is asserted rather than assumed from the fact that the field exists;
//  - the stamped value is not one of the options. `FieldValue.optionId` holds
//    the option's `value` key, so a stamp outside the list is an orphan;
//  - a paid field the connector cannot bind. `isWritableTarget` refuses a field
//    that is neither creatable nor updatable, and there is no allow-list entry
//    for these two the way there is for the totals, so both must stay writable;
//  - the payout half is NOT a no-op on an org where the first draft
//    (`157-payout-rail-and-source`) already ran. The dev worker auto-applied it
//    on boot, so on dev this migration meets fields, inverses and stamps that
//    already exist and must write nothing for that half while the order half
//    still lands its three fields. Driven below against a fake db;
//  - the id reuses a retired number. `buildRegistry` throws on reuse, but only
//    at module load, so a test has to actually import the registry to see it;
//  - the net column drifts from the gross one it shadows. `line_item_net_total`
//    is the ledger's basis and `line_item_line_total` its fallback, so the two
//    must share a type, a currency shape and the engine-only capabilities, or a
//    net that renders or filters differently from the total it falls back to is
//    a defect nobody can see from the numbers.

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../../cache'
import type { FieldOptions } from '../../../custom-fields'
import { PayoutSource } from '../../../resources/registry/enum-values'
import type { ResourceField } from '../../../resources/registry/field-types'
import { BANK_ACCOUNT_FIELDS } from '../../../resources/registry/resources/bank-account-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { PAYMENT_GATEWAY_FIELDS } from '../../../resources/registry/resources/payment-gateway-fields'
import { PAYOUT_FIELDS } from '../../../resources/registry/resources/payout-fields'
import {
  ensureCustomFields,
  fieldKey,
  linkNewRelationships,
  loadExistingState,
} from '../../../seed/entity-helpers'
import { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } from '../../registry'
import { migration157PayoutRailAndOrderPaymentFields } from '../157-payout-rail-and-order-payment-fields'

vi.mock('../../../seed/entity-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../seed/entity-helpers')>()
  return {
    ...actual,
    loadExistingState: vi.fn(),
    ensureCustomFields: vi.fn(),
    linkNewRelationships: vi.fn(),
  }
})

vi.mock('../../../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../cache')>()
  return { ...actual, getOrgCache: vi.fn() }
})

const MIGRATION_ID = '157-payout-rail-and-order-payment-fields'

/** What the payout half stamps. A literal here on purpose - see the migration's doc. */
const STAMPED = 'synced'

describe('migration 157 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is the only migration claiming the number 157', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '157')).toHaveLength(1)
  })

  it('leaves 158 unclaimed: the two same-day drafts merged into this one id', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers).not.toContain('158')
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids).not.toContain('157-payout-rail-and-source')
    expect(ids).not.toContain('158-order-payment-stamp-and-paid-fields')
  })

  it('claims a number past the retired range', () => {
    expect(Number(MIGRATION_ID.split('-')[0])).toBeGreaterThan(150)
  })

  it('carries the id the module exports', () => {
    expect(migration157PayoutRailAndOrderPaymentFields.id).toBe(MIGRATION_ID)
  })

  it('describes all six fields, the payout stamp AND the absence of a backfill', () => {
    const { description } = migration157PayoutRailAndOrderPaymentFields
    expect(description).toMatch(/paymentGateway/)
    expect(description).toMatch(/bankAccount/)
    expect(description).toMatch(/source/)
    expect(description).toMatch(/stamps synced/)
    expect(description).toMatch(/paidAt/)
    expect(description).toMatch(/paidGateway/)
    expect(description).toMatch(/No backfill/)
    expect(description).toMatch(/netTotal/)
    expect(description).toMatch(/never backfilled/)
  })
})

describe('the registry says the same thing the payout half provisions', () => {
  // The whole point of this block. A new org is seeded from the registry and
  // an existing org is reached by the migration. If these drift, a fresh org
  // and a migrated org hold different fields and every symptom shows up months
  // later as "the payout has no gateway" or "the source select is empty".

  it('declares paymentGateway as a belongs_to RELATIONSHIP on the attribute the sync writes', () => {
    const field = PAYOUT_FIELDS.paymentGateway
    expect(field?.systemAttribute).toBe('payout_payment_gateway')
    expect(field?.fieldType).toBe('RELATIONSHIP')
    expect(field?.relationship?.relationshipType).toBe('belongs_to')
    expect(field?.relationship?.inverseResourceFieldId).toBe('payment_gateway:payouts')
    expect(field?.relationshipConfig?.relatedEntityType).toBe('payment_gateway')
    expect(field?.relationshipConfig?.inverseSystemAttribute).toBe('payment_gateway_payouts')
  })

  it('declares bankAccount as a belongs_to RELATIONSHIP on the attribute the sync writes', () => {
    const field = PAYOUT_FIELDS.bankAccount
    expect(field?.systemAttribute).toBe('payout_bank_account')
    expect(field?.fieldType).toBe('RELATIONSHIP')
    expect(field?.relationship?.relationshipType).toBe('belongs_to')
    expect(field?.relationship?.inverseResourceFieldId).toBe('bank_account:payouts')
    expect(field?.relationshipConfig?.relatedEntityType).toBe('bank_account')
    expect(field?.relationshipConfig?.inverseSystemAttribute).toBe('bank_account_payouts')
  })

  it('has both inverse halves, each pointing back at the payout field by ID', () => {
    // `linkNewRelationships` looks an inverse up by `<entityType>:<field id>`,
    // the id and not the key - which is why `bank_deposit.bankAccount` has to
    // spell `bankAccountRecord` in its inverse. Here id and key coincide, and
    // this pins that they keep doing so.
    const gatewayInverse = PAYMENT_GATEWAY_FIELDS.payouts
    expect(gatewayInverse?.systemAttribute).toBe('payment_gateway_payouts')
    expect(gatewayInverse?.relationship?.relationshipType).toBe('has_many')
    expect(gatewayInverse?.relationship?.inverseResourceFieldId).toBe(
      `payout:${PAYOUT_FIELDS.paymentGateway?.id}`
    )

    const bankAccountInverse = BANK_ACCOUNT_FIELDS.payouts
    expect(bankAccountInverse?.systemAttribute).toBe('bank_account_payouts')
    expect(bankAccountInverse?.relationship?.relationshipType).toBe('has_many')
    expect(bankAccountInverse?.relationship?.inverseResourceFieldId).toBe(
      `payout:${PAYOUT_FIELDS.bankAccount?.id}`
    )

    expect(PAYOUT_FIELDS.paymentGateway?.relationship?.inverseResourceFieldId).toBe(
      `payment_gateway:${gatewayInverse?.id}`
    )
    expect(PAYOUT_FIELDS.bankAccount?.relationship?.inverseResourceFieldId).toBe(
      `bank_account:${bankAccountInverse?.id}`
    )
  })

  it('refuses to delete a rail under its payouts, and unlinks a bank account from them', () => {
    // A payout is posting history and its rail is the routing key the entry
    // was built from; a bank account's payouts survive on the ledger by
    // gl_account id, exactly as its deposits do.
    expect(PAYMENT_GATEWAY_FIELDS.payouts?.relationship?.onDelete).toBe('restrict')
    expect(BANK_ACCOUNT_FIELDS.payouts?.relationship?.onDelete).toBe('unlink')
    expect(BANK_ACCOUNT_FIELDS.payouts?.relationship?.onDelete).toBe(
      BANK_ACCOUNT_FIELDS.deposits?.relationship?.onDelete
    )
  })

  it('declares source as a SINGLE_SELECT on the attribute the migration stamps', () => {
    expect(PAYOUT_FIELDS.source?.systemAttribute).toBe('payout_source')
    expect(PAYOUT_FIELDS.source?.fieldType).toBe('SINGLE_SELECT')
  })

  it('carries the OPTIONS with the field, because a select with none renders blank', () => {
    expect(PAYOUT_FIELDS.source?.options?.options).toEqual(PayoutSource.values)
    expect(PAYOUT_FIELDS.source?.options?.options?.map((o) => o.value)).toEqual([
      'synced',
      'imported',
    ])
  })

  it('defaults to synced, which is what every existing record is', () => {
    expect(PAYOUT_FIELDS.source?.defaultValue).toBe(STAMPED)
  })

  it('stamps a value that is actually one of the options', () => {
    const values = PayoutSource.values.map((o) => o.value)
    expect(values).toContain(STAMPED)
  })

  it('is not nullable - the record says where it came from, the read does not guess', () => {
    expect(PAYOUT_FIELDS.source?.nullable).toBe(false)
  })

  it('keeps source write-once: provenance is set at create and never edited', () => {
    expect(PAYOUT_FIELDS.source?.capabilities?.creatable).toBe(true)
    expect(PAYOUT_FIELDS.source?.capabilities?.updatable).toBe(false)
  })

  it('keeps both pointers writable, so the sync can adopt an unstamped row', () => {
    expect(PAYOUT_FIELDS.paymentGateway?.capabilities?.updatable).toBe(true)
    expect(PAYOUT_FIELDS.bankAccount?.capabilities?.updatable).toBe(true)
  })
})

describe('the field it retired is gone from the registry (step 1b)', () => {
  it('paymentGlPosting no longer resolves on ORDER_FIELDS', () => {
    expect(ORDER_FIELDS.paymentGlPosting).toBeUndefined()
  })
})

describe('the registry says the same thing the order half provisions', () => {
  // Same drift, other def. The symptom here is "the paid date never lands".

  it('declares paidAt as a nullable DATETIME on the attribute the connector writes', () => {
    const field = ORDER_FIELDS.paidAt
    expect(field?.systemAttribute).toBe('order_paid_at')
    expect(field?.fieldType).toBe('DATETIME')
    expect(field?.nullable).toBe(true)
  })

  it('declares paidGateway as a nullable TEXT on the attribute the connector writes', () => {
    const field = ORDER_FIELDS.paidGateway
    expect(field?.systemAttribute).toBe('order_paid_gateway')
    expect(field?.fieldType).toBe('TEXT')
    expect(field?.nullable).toBe(true)
    expect(field?.showInPanel).toBe(false)
  })

  it('keeps both paid fields connector-bindable: creatable AND updatable, no allow-list needed', () => {
    // `isWritableTarget` (data-connectors/app-catalog.ts) accepts a target that
    // is creatable or updatable; a Shopify order can arrive already paid, so
    // the insert must be able to carry the date, and a terms order flips later.
    for (const key of ['paidAt', 'paidGateway'] as const) {
      expect(ORDER_FIELDS[key]?.capabilities?.creatable).toBe(true)
      expect(ORDER_FIELDS[key]?.capabilities?.updatable).toBe(true)
      expect(ORDER_FIELDS[key]?.capabilities?.configurable).toBe(false)
    }
  })

  it('keeps the paid date out of the create and update dialogs', () => {
    // You do not pay an order by typing a date, the same rule cancelledAt follows.
    expect(ORDER_FIELDS.paidAt?.showInDialogs).toBe(false)
    expect(ORDER_FIELDS.cancelledAt?.showInDialogs).toBe(false)
  })

  it('carries no defaults: every field is empty until the connector fills it', () => {
    for (const key of ['paidAt', 'paidGateway'] as const) {
      expect(ORDER_FIELDS[key]?.defaultValue).toBeUndefined()
    }
  })

  it('sorts the paid date beside placed and cancelled', () => {
    const placed = ORDER_FIELDS.placedAt?.systemSortOrder ?? ''
    const cancelled = ORDER_FIELDS.cancelledAt?.systemSortOrder ?? ''
    const paid = ORDER_FIELDS.paidAt?.systemSortOrder ?? ''
    const financial = ORDER_FIELDS.financialStatus?.systemSortOrder ?? ''
    expect(placed < cancelled && cancelled < paid && paid < financial).toBe(true)

    const orders = Object.values(ORDER_FIELDS)
      .map((f) => f.systemSortOrder)
      .filter((o): o is string => typeof o === 'string')
    expect(new Set(orders).size).toBe(orders.length)
  })
})

describe('the registry says the same thing the line item half provisions', () => {
  // The symptom of drift here is "the ledger keeps posting the gross" on a
  // migrated org while a fresh org posts the net, with every entry balancing.

  it('declares netTotal as a nullable CURRENCY on the attribute the engine and the connector write', () => {
    const field = LINE_ITEM_FIELDS.netTotal
    expect(field?.systemAttribute).toBe('line_item_net_total')
    expect(field?.fieldType).toBe('CURRENCY')
    expect(field?.nullable).toBe(true)
    expect(field?.label).toBe('Line total after discount')
  })

  it('mirrors line_item_line_total in type, currency shape and engine-only capabilities', () => {
    // The net is the ledger's basis and the total its fallback (29 §2.3), so
    // the two must render, filter and sort the same way. `decimals: 2` and not
    // the unit price's RATE_DECIMALS: both are AMOUNTS.
    const net = LINE_ITEM_FIELDS.netTotal
    const gross = LINE_ITEM_FIELDS.lineTotal
    expect(gross?.systemAttribute).toBe('line_item_line_total')
    expect(net?.type).toBe(gross?.type)
    expect(net?.fieldType).toBe(gross?.fieldType)
    expect(net?.options).toEqual(gross?.options)
    expect(net?.capabilities).toEqual(gross?.capabilities)
    expect(net?.capabilities?.creatable).toBe(false)
    expect(net?.capabilities?.updatable).toBe(false)
    expect(net?.capabilities?.filterable).toBe(true)
    expect(net?.capabilities?.sortable).toBe(true)
  })

  it('hides the net from the panel and the dialogs, leaving it a records-table column only', () => {
    expect(LINE_ITEM_FIELDS.netTotal?.showInPanel).toBe(false)
    expect(LINE_ITEM_FIELDS.netTotal?.showInDialogs).toBe(false)
    // Not forced visible in the table either: `showInTable` unset resolves to
    // `showInPanel !== false`, so it is offered but hidden by default.
    expect(LINE_ITEM_FIELDS.netTotal?.showInTable).toBeUndefined()
  })

  it('sorts the net directly after the gross total it shadows', () => {
    const gross = LINE_ITEM_FIELDS.lineTotal?.systemSortOrder ?? ''
    const net = LINE_ITEM_FIELDS.netTotal?.systemSortOrder ?? ''
    const taxable = LINE_ITEM_FIELDS.taxable?.systemSortOrder ?? ''
    expect(gross < net && net < taxable).toBe(true)

    const orders = Object.values(LINE_ITEM_FIELDS)
      .map((f) => f.systemSortOrder)
      .filter((o): o is string => typeof o === 'string')
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('carries no default: the column is empty until the engine or the connector fills it', () => {
    expect(LINE_ITEM_FIELDS.netTotal?.defaultValue).toBeUndefined()
  })
})

// ─── up() against a fake database ────────────────────────────────────
//
// `ensureCustomFields` and `linkNewRelationships` are replaced by fakes that
// keep their real contract (INSERT-only by `(defId, systemAttribute)`, the map
// keyed `<entityType>:<field id>`, `state.fieldsCreated` bumped per created
// field) so the migration's own logic - which half runs, what it stamps, what
// it flushes - is what gets exercised.

const ORG = 'org-1'
const DEF_IDS = {
  payout: 'def-payout',
  payment_gateway: 'def-gateway',
  bank_account: 'def-bank',
  order: 'def-order',
  line_item: 'def-line-item',
} as const
type DefType = keyof typeof DEF_IDS

type ExistingState = Awaited<ReturnType<typeof loadExistingState>>

function attr(field: ResourceField | undefined): string {
  if (!field?.systemAttribute) throw new Error('registry field has no systemAttribute')
  return field.systemAttribute
}

const PAYOUT_HALF: readonly [DefType, ResourceField | undefined][] = [
  ['payout', PAYOUT_FIELDS.paymentGateway],
  ['payout', PAYOUT_FIELDS.bankAccount],
  ['payout', PAYOUT_FIELDS.source],
  ['payment_gateway', PAYMENT_GATEWAY_FIELDS.payouts],
  ['bank_account', BANK_ACCOUNT_FIELDS.payouts],
]
const ORDER_HALF: readonly [DefType, ResourceField | undefined][] = [
  ['order', ORDER_FIELDS.paidAt],
  ['order', ORDER_FIELDS.paidGateway],
]
const LINE_ITEM_HALF: readonly [DefType, ResourceField | undefined][] = [
  ['line_item', LINE_ITEM_FIELDS.netTotal],
]

function existingState(opts: {
  defs: readonly DefType[]
  applied: readonly (readonly [DefType, ResourceField | undefined])[]
}): ExistingState {
  const entityDefs = new Map(opts.defs.map((t) => [t, { id: DEF_IDS[t], entityType: t }]))
  const fields: ExistingState['fields'] = new Map()
  for (const [defType, field] of opts.applied) {
    const systemAttribute = attr(field)
    fields.set(fieldKey(DEF_IDS[defType], systemAttribute), {
      id: `stored-${systemAttribute}`,
      systemAttribute,
      entityDefinitionId: DEF_IDS[defType],
      options: {} as FieldOptions,
    })
  }
  return { entityDefs, fields }
}

function fakeDb(opts: { payoutIds: readonly string[]; stampedIds: readonly string[] }) {
  const values = vi.fn(async (_rows: Record<string, unknown>[]) => undefined)
  const insert = vi.fn(() => ({ values }))
  const findFirst = vi.fn(async () => ({
    options: { relationship: { inverseResourceFieldId: 'linked' } },
  }))
  const db = {
    query: { CustomField: { findFirst } },
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: async () =>
          table === schema.EntityInstance
            ? opts.payoutIds.map((id) => ({ id }))
            : opts.stampedIds.map((entityId) => ({ entityId })),
      }),
    })),
    insert,
  }
  return { db: db as unknown as Database, insert, values, findFirst }
}

describe('up() on a fake database', () => {
  let createdKeys: string[]
  let invalidateAndRecompute: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createdKeys = []
    invalidateAndRecompute = vi.fn(async () => undefined)
    vi.mocked(getOrgCache).mockReturnValue({ invalidateAndRecompute } as never)
    vi.mocked(linkNewRelationships).mockReset().mockResolvedValue(undefined)
    vi.mocked(ensureCustomFields)
      .mockReset()
      .mockImplementation(async (_db, _org, entityType, defId, fields, existing, state) => {
        const map: Awaited<ReturnType<typeof ensureCustomFields>> = new Map()
        for (const field of Object.values(fields)) {
          const key = `${entityType}:${field.id}`
          const systemAttribute = attr(field)
          const held = existing.fields.get(fieldKey(defId, systemAttribute))
          if (held) {
            map.set(key, { id: held.id, systemAttribute, options: held.options, _fieldDef: field })
            continue
          }
          map.set(key, {
            id: `new-${key}`,
            systemAttribute,
            options: {} as FieldOptions,
            _fieldDef: field,
          })
          state.fieldsCreated++
          createdKeys.push(key)
        }
        return map
      })
  })

  const ALL_DEFS = ['payout', 'payment_gateway', 'bank_account', 'order', 'line_item'] as const
  const orderKeys = ORDER_HALF.map(([, f]) => `order:${f?.id}`)
  const lineItemKeys = LINE_ITEM_HALF.map(([, f]) => `line_item:${f?.id}`)
  const payoutKeys = PAYOUT_HALF.map(([t, f]) => `${t}:${f?.id}`)
  const EVERY_HALF = [...PAYOUT_HALF, ...ORDER_HALF, ...LINE_ITEM_HALF]

  it('is a no-op for the payout half where the first draft already ran, and still lands the order and line item fields', async () => {
    // The dev database: `157-payout-rail-and-source` applied on boot, every
    // payout stamped, `158-order-payment-stamp-and-paid-fields` never run.
    vi.mocked(loadExistingState).mockResolvedValue(
      existingState({ defs: ALL_DEFS, applied: PAYOUT_HALF })
    )
    const { db, insert } = fakeDb({ payoutIds: ['p1', 'p2'], stampedIds: ['p1', 'p2'] })

    const result = await migration157PayoutRailAndOrderPaymentFields.up(db, ORG)

    expect(result).toEqual({
      entityDefsCreated: 0,
      fieldsCreated: 3,
      relationshipsLinked: 0,
      alreadyUpToDate: false,
    })
    expect(createdKeys).toEqual([...orderKeys, ...lineItemKeys])
    expect(insert).not.toHaveBeenCalled()
    expect(vi.mocked(ensureCustomFields)).toHaveBeenCalledTimes(5)
    expect(invalidateAndRecompute).toHaveBeenCalledTimes(1)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('writes nothing and flushes nothing when every half is already in place', async () => {
    vi.mocked(loadExistingState).mockResolvedValue(
      existingState({ defs: ALL_DEFS, applied: EVERY_HALF })
    )
    const { db, insert } = fakeDb({ payoutIds: ['p1'], stampedIds: ['p1'] })

    const result = await migration157PayoutRailAndOrderPaymentFields.up(db, ORG)

    expect(result).toEqual({
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: true,
    })
    expect(createdKeys).toEqual([])
    expect(insert).not.toHaveBeenCalled()
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('on a fresh org creates all eight fields and stamps synced in ONE insert, optionId only', async () => {
    vi.mocked(loadExistingState).mockResolvedValue(existingState({ defs: ALL_DEFS, applied: [] }))
    const { db, insert, values } = fakeDb({
      payoutIds: ['p1', 'p2', 'p3'],
      stampedIds: ['p2'],
    })

    const result = await migration157PayoutRailAndOrderPaymentFields.up(db, ORG)

    expect(result.fieldsCreated).toBe(8)
    expect(result.alreadyUpToDate).toBe(false)
    expect(createdKeys).toEqual([...payoutKeys, ...orderKeys, ...lineItemKeys])

    // The backfill call shape: one bulk INSERT for the difference, never a
    // per-row loop, and the option key in `optionId` and nowhere else.
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(schema.FieldValue)
    expect(values).toHaveBeenCalledTimes(1)
    const rows = values.mock.calls[0]?.[0] ?? []
    expect(rows.map((r) => r.entityId)).toEqual(['p1', 'p3'])
    for (const row of rows) {
      expect(row.optionId).toBe(STAMPED)
      expect(row.fieldId).toBe(`new-payout:${PAYOUT_FIELDS.source?.id}`)
      expect(row.entityDefinitionId).toBe(DEF_IDS.payout)
      expect(row.organizationId).toBe(ORG)
      expect(row).not.toHaveProperty('valueText')
    }
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('never rewrites a stored source: a payout already stamped is left alone', async () => {
    vi.mocked(loadExistingState).mockResolvedValue(
      existingState({ defs: ALL_DEFS, applied: EVERY_HALF })
    )
    const { db, insert, values } = fakeDb({
      payoutIds: ['p1', 'p2'],
      stampedIds: ['p1'],
    })

    const result = await migration157PayoutRailAndOrderPaymentFields.up(db, ORG)

    expect(result.fieldsCreated).toBe(0)
    expect(insert).toHaveBeenCalledTimes(1)
    const rows = values.mock.calls[0]?.[0] ?? []
    expect(rows.map((r) => r.entityId)).toEqual(['p2'])
    expect(rows[0]?.fieldId).toBe(`stored-${attr(PAYOUT_FIELDS.source)}`)
  })

  it('skips the payout half when one of its defs is missing, and still lands the order and line item fields', async () => {
    vi.mocked(loadExistingState).mockResolvedValue(
      existingState({ defs: ['payout', 'order', 'line_item'], applied: [] })
    )
    const { db, insert, findFirst } = fakeDb({ payoutIds: ['p1'], stampedIds: [] })

    const result = await migration157PayoutRailAndOrderPaymentFields.up(db, ORG)

    expect(result.fieldsCreated).toBe(3)
    expect(createdKeys).toEqual([...orderKeys, ...lineItemKeys])
    expect(vi.mocked(ensureCustomFields)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(linkNewRelationships)).not.toHaveBeenCalled()
    expect(findFirst).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('skips the order and line item halves when their defs are missing, and still runs the payout half', async () => {
    vi.mocked(loadExistingState).mockResolvedValue(
      existingState({ defs: ['payout', 'payment_gateway', 'bank_account'], applied: [] })
    )
    const { db, insert } = fakeDb({ payoutIds: ['p1'], stampedIds: [] })

    const result = await migration157PayoutRailAndOrderPaymentFields.up(db, ORG)

    expect(result.fieldsCreated).toBe(5)
    expect(createdKeys).toEqual(payoutKeys)
    expect(vi.mocked(ensureCustomFields)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(linkNewRelationships)).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('lands the line item field alone on an org where the other two halves already ran', async () => {
    // The org that ran this migration's payout and order halves before the
    // line item half was added to it: only the net column is missing.
    vi.mocked(loadExistingState).mockResolvedValue(
      existingState({ defs: ALL_DEFS, applied: [...PAYOUT_HALF, ...ORDER_HALF] })
    )
    const { db, insert, values } = fakeDb({ payoutIds: ['p1'], stampedIds: ['p1'] })

    const result = await migration157PayoutRailAndOrderPaymentFields.up(db, ORG)

    expect(result.fieldsCreated).toBe(1)
    expect(result.alreadyUpToDate).toBe(false)
    expect(createdKeys).toEqual(lineItemKeys)
    // No value backfill for the net: nothing is inserted into FieldValue.
    expect(insert).not.toHaveBeenCalled()
    expect(values).not.toHaveBeenCalled()
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('links the two pairs out of ONE field map that spans all three payout-side defs', async () => {
    vi.mocked(loadExistingState).mockResolvedValue(existingState({ defs: ALL_DEFS, applied: [] }))
    const { db } = fakeDb({ payoutIds: [], stampedIds: [] })

    await migration157PayoutRailAndOrderPaymentFields.up(db, ORG)

    const [, fieldMap, entityDefIds] = vi.mocked(linkNewRelationships).mock.calls[0] ?? []
    expect([...(fieldMap?.keys() ?? [])]).toEqual(payoutKeys)
    expect([...(entityDefIds?.entries() ?? [])]).toEqual([
      ['payout', DEF_IDS.payout],
      ['payment_gateway', DEF_IDS.payment_gateway],
      ['bank_account', DEF_IDS.bank_account],
    ])
  })

  it('fails loudly when a relationship half was created but never linked', async () => {
    vi.mocked(loadExistingState).mockResolvedValue(existingState({ defs: ALL_DEFS, applied: [] }))
    const { db, findFirst, insert } = fakeDb({ payoutIds: ['p1'], stampedIds: [] })
    findFirst.mockResolvedValue({ options: {} } as never)

    await expect(migration157PayoutRailAndOrderPaymentFields.up(db, ORG)).rejects.toThrow(
      /could not link it to payment_gateway:payouts/
    )
    // The stamp never runs over an unlinked graph, and nothing is flushed.
    expect(insert).not.toHaveBeenCalled()
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })
})
