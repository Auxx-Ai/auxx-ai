// packages/lib/src/payment-gateways/__tests__/reads.test.ts
//
// The one thing this hydration does that `banking/reads.ts`'s does not:
// `handles` is a multi-value TAGS field, one `FieldValue` row per handle, so
// the byInstance map has to group by (entityId, fieldId) into ARRAYS rather
// than keep the single row `hydrateBankAccounts` does for every scalar field.
// Uses the same double `banking/__tests__/reads-archived.test.ts` does
// (`docs/lib-module-guide.md` §9's "copy the reference module" rule, applied
// to its tests too).
//
// `clearingGlAccountId`/`feeGlAccountId`/`settlementSource`/`processorAccountId`
// are no longer `payment_gateway` fields (task 58 §4.3) - they are resolved
// through the rail scope (`GlRoleAssignment`, mocked as its own table queue
// below) and the linked feed (`FinancialSourceAccount`), never through
// `FieldValue`.

import { schema } from '@auxx/database'
import { getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  /** FIFO rows per table name - each `.from(table)` call shifts the next page for it. */
  tables: new Map<string, unknown[][]>(),
  /**
   * `options` hung on `order_payment_gateways`, for the census test that
   * exercises the connector-provisioned option path rather than free text.
   */
  gatewayFieldOptions: null as unknown,
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: async (_org: string, entityType: string) =>
    entityType === 'payment_gateway' ? 'def_pg' : null,
  getOrgCache: () => ({
    from: () => ({
      // Every attribute resolves to a field whose id IS the attribute name.
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((attr) => [
            attr,
            attr === 'order_payment_gateways'
              ? { id: attr, options: state.gatewayFieldOptions }
              : { id: attr },
          ])
        ),
    }),
  }),
}))

/** Queue one page of rows for the next `.from(table)` call against that table. */
function queue(table: unknown, rows: unknown[]): void {
  const name = getTableName(table as Parameters<typeof getTableName>[0])
  const pages = state.tables.get(name) ?? []
  pages.push(rows)
  state.tables.set(name, pages)
}

/** One query stage: chainable and awaitable, resolving to `rows`. */
function stage(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  for (const method of ['orderBy', 'limit', 'where']) {
    chain[method] = () => stage(rows)
  }
  return Object.assign(Promise.resolve(rows), chain)
}

function fakeDb() {
  const request = () => ({
    from: (table: unknown) => {
      const name = getTableName(table as Parameters<typeof getTableName>[0])
      const pages = state.tables.get(name) ?? []
      return stage(pages.shift() ?? [])
    },
  })
  return { select: request, selectDistinct: request } as never
}

const ORG = 'org_1'

beforeEach(() => {
  state.tables.clear()
  state.gatewayFieldOptions = null
})

const { getPaymentGateway, listObservedGatewayHandles, listPaymentGateways } = await import(
  '../reads'
)

describe('listPaymentGateways', () => {
  it('groups a multi-value TAGS field (handles) into an array per instance, and resolves the rail scope', async () => {
    queue(schema.EntityInstance, [{ id: 'pg_1', createdAt: null, updatedAt: null }])
    queue(schema.GlRoleAssignment, [
      {
        role: 'clearing',
        glAccountId: 'acct_card_clearing',
        markedUnused: false,
        sourceAccountId: null,
        paymentGatewayId: 'pg_1',
        currency: null,
        source: 'human',
        confirmedAt: null,
      },
    ])
    queue(schema.FinancialSourceAccount, [])
    queue(schema.FieldValue, [
      { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Authorize.Net' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_handles', optionId: 'authorize_net' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_handles', optionId: 'authorize.net' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_status', optionId: 'closed' },
    ])

    const result = await listPaymentGateways(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toHaveLength(1)
    expect(result.value[0]?.handles).toEqual(['authorize_net', 'authorize.net'])
    expect(result.value[0]?.status).toBe('closed')
    // No linked feed queued - manual, per §5.5's "there is no enum".
    expect(result.value[0]?.settlementSource).toBe('manual')
    expect(result.value[0]?.clearingGlAccountId).toBe('acct_card_clearing')
  })

  it('falls back to valueText for a handle with no optionId, and drops a truly empty row', async () => {
    queue(schema.EntityInstance, [{ id: 'pg_1', createdAt: null, updatedAt: null }])
    queue(schema.GlRoleAssignment, [])
    queue(schema.FinancialSourceAccount, [])
    queue(schema.FieldValue, [
      { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Shopify Payments' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_handles', valueText: 'shopify_payments' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_handles', optionId: null, valueText: null },
    ])

    const result = await listPaymentGateways(fakeDb(), ORG)
    if (!result.isOk()) throw result.error
    expect(result.value[0]?.handles).toEqual(['shopify_payments'])
  })

  it('reads settlementSource off the linked feed, never a stored field', async () => {
    queue(schema.EntityInstance, [{ id: 'pg_1', createdAt: null, updatedAt: null }])
    queue(schema.GlRoleAssignment, [])
    queue(schema.FinancialSourceAccount, [
      { paymentGatewayId: 'pg_1', providerKey: 'stripe', externalAccountId: 'acct_stripe_1' },
    ])
    queue(schema.FieldValue, [
      { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Stripe' },
    ])

    const result = await listPaymentGateways(fakeDb(), ORG)
    if (!result.isOk()) throw result.error
    expect(result.value[0]?.settlementSource).toBe('stripe')
    expect(result.value[0]?.processorAccountId).toBe('acct_stripe_1')
  })

  it('defaults to unmapped clearing and no fee account when nothing is scoped to the rail', async () => {
    queue(schema.EntityInstance, [{ id: 'pg_1', createdAt: null, updatedAt: null }])
    queue(schema.GlRoleAssignment, [])
    queue(schema.FinancialSourceAccount, [])
    queue(schema.FieldValue, [
      { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Affirm' },
    ])

    const result = await listPaymentGateways(fakeDb(), ORG)
    if (!result.isOk()) throw result.error
    expect(result.value[0]?.settlementSource).toBe('manual')
    expect(result.value[0]?.status).toBe('active')
    expect(result.value[0]?.clearingGlAccountId).toBe('')
    expect(result.value[0]?.feeGlAccountId).toBeNull()
    expect(result.value[0]?.bankAccountId).toBeNull()
  })

  it('ignores a marked-unused clearing row, and prefers the no-currency row over a currency one', async () => {
    queue(schema.EntityInstance, [{ id: 'pg_1', createdAt: null, updatedAt: null }])
    queue(schema.GlRoleAssignment, [
      {
        role: 'clearing',
        glAccountId: 'acct_usd',
        markedUnused: false,
        sourceAccountId: null,
        paymentGatewayId: 'pg_1',
        currency: 'USD',
        source: 'human',
        confirmedAt: null,
      },
      {
        role: 'clearing',
        glAccountId: 'acct_default',
        markedUnused: false,
        sourceAccountId: null,
        paymentGatewayId: 'pg_1',
        currency: null,
        source: 'human',
        confirmedAt: null,
      },
      {
        role: 'payment_processing_fees',
        glAccountId: 'acct_fees_unused',
        markedUnused: true,
        sourceAccountId: null,
        paymentGatewayId: 'pg_1',
        currency: null,
        source: 'human',
        confirmedAt: null,
      },
    ])
    queue(schema.FinancialSourceAccount, [])
    queue(schema.FieldValue, [
      { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Stripe' },
    ])

    const result = await listPaymentGateways(fakeDb(), ORG)
    if (!result.isOk()) throw result.error
    expect(result.value[0]?.clearingGlAccountId).toBe('acct_default')
    expect(result.value[0]?.feeGlAccountId).toBeNull()
  })

  // ── brief 26 §4 and §10: the two fields migration 156 adds ────────────────

  it('reads feeTreatment as netted on a record that predates the field', async () => {
    // 🛑 The direction that matters. An org short of migration 156 holds no
    // option row here, and `netted` is exactly the entry `buildPayoutEntry` has
    // always produced - so its payouts keep their fee leg. Coercing the other
    // way would silently drop the fee leg off every unanswered rail.
    queue(schema.EntityInstance, [{ id: 'pg_1', createdAt: null, updatedAt: null }])
    queue(schema.GlRoleAssignment, [])
    queue(schema.FinancialSourceAccount, [])
    queue(schema.FieldValue, [
      { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Affirm' },
    ])

    const result = await listPaymentGateways(fakeDb(), ORG)
    if (!result.isOk()) throw result.error
    expect(result.value[0]?.feeTreatment).toBe('netted')
    expect(result.value[0]?.lastFeeBookedAt).toBeNull()
  })

  it('reads a stamped billed treatment and a last-fee date off the option and date columns', async () => {
    queue(schema.EntityInstance, [{ id: 'pg_1', createdAt: null, updatedAt: null }])
    queue(schema.GlRoleAssignment, [])
    queue(schema.FinancialSourceAccount, [])
    queue(schema.FieldValue, [
      { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Authorize.Net' },
      // 🛑 `optionId`, not `valueText` - the column the CRUD handler writes a
      // select into and the one migration 156 stamps.
      { entityId: 'pg_1', fieldId: 'payment_gateway_fee_treatment', optionId: 'billed' },
      {
        entityId: 'pg_1',
        fieldId: 'payment_gateway_last_fee_booked_at',
        valueDate: '2026-07-14T00:00:00.000Z',
      },
    ])

    const result = await listPaymentGateways(fakeDb(), ORG)
    if (!result.isOk()) throw result.error
    expect(result.value[0]?.feeTreatment).toBe('billed')
    expect(result.value[0]?.lastFeeBookedAt).toBe('2026-07-14')
  })
})

describe('getPaymentGateway', () => {
  it('returns null when the instance does not exist', async () => {
    queue(schema.EntityInstance, [])
    const result = await getPaymentGateway(fakeDb(), ORG, 'gone')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The census behind the add dialog's suggestions and the list page's
// "routed" line.
// ─────────────────────────────────────────────────────────────────────────────

describe('listObservedGatewayHandles', () => {
  /** Queue what `listPaymentGateways` reads for one claiming gateway. */
  function claimedBy(id: string, handles: string[]) {
    queue(schema.EntityInstance, [{ id, createdAt: null, updatedAt: null }])
    queue(schema.GlRoleAssignment, [])
    queue(schema.FinancialSourceAccount, [])
    queue(schema.FieldValue, [
      { entityId: id, fieldId: 'payment_gateway_name', valueText: id },
      ...handles.map((handle) => ({
        entityId: id,
        fieldId: 'payment_gateway_handles',
        optionId: handle,
      })),
    ])
  }

  it('de-duplicates case-insensitively, drops the reserved handles, and marks what is claimed', async () => {
    queue(schema.FieldValue, [
      { optionId: 'shopify_payments', valueText: null },
      // Same rail, different spelling - one row out, the first spelling seen.
      { optionId: 'Shopify_Payments', valueText: null },
      { optionId: 'authorize_net', valueText: null },
      // 🛑 Neither of these ever reaches a route: `manual` debits A/R and
      // `bogus` excludes the shipment, both before any route is consulted.
      { optionId: 'manual', valueText: null },
      { optionId: 'bogus', valueText: null },
    ])
    claimedBy('pg_shopify', ['shopify_payments'])

    const result = await listObservedGatewayHandles(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([
      { handle: 'authorize_net', claimedBy: null },
      { handle: 'shopify_payments', claimedBy: 'pg_shopify' },
    ])
  })

  it('resolves an option-keyed value through the field option list, not the raw key', async () => {
    // The connector-provisioned case: the stored value is an opaque key and the
    // label is in the field's own option set. Grouping on the key would offer a
    // handle that matches nothing a person recognises.
    state.gatewayFieldOptions = {
      options: [{ id: 'opt_1', value: 'opt_1', label: 'Authorize.Net' }],
    }
    queue(schema.FieldValue, [{ optionId: 'opt_1', valueText: null }])
    queue(schema.EntityInstance, [])

    const result = await listObservedGatewayHandles(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([{ handle: 'Authorize.Net', claimedBy: null }])
  })

  it('reads valueText when the row carries no optionId', async () => {
    queue(schema.FieldValue, [{ optionId: null, valueText: 'paypal' }])
    queue(schema.EntityInstance, [])

    const result = await listObservedGatewayHandles(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([{ handle: 'paypal', claimedBy: null }])
  })

  it('is empty when no order carries a gateway, without reading the gateways at all', async () => {
    queue(schema.FieldValue, [])

    const result = await listObservedGatewayHandles(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([])
  })

  it('counts a CLOSED gateway as claiming its handles', async () => {
    // `toGatewayRoutes` keeps closed rows on purpose - a closed rail still
    // routes its own history - so its handles are routed, not orphaned.
    queue(schema.FieldValue, [{ optionId: 'authorize_net', valueText: null }])
    queue(schema.EntityInstance, [{ id: 'pg_closed', createdAt: null, updatedAt: null }])
    queue(schema.GlRoleAssignment, [])
    queue(schema.FinancialSourceAccount, [])
    queue(schema.FieldValue, [
      { entityId: 'pg_closed', fieldId: 'payment_gateway_name', valueText: 'Authorize.Net' },
      { entityId: 'pg_closed', fieldId: 'payment_gateway_handles', optionId: 'AUTHORIZE_NET' },
      { entityId: 'pg_closed', fieldId: 'payment_gateway_status', optionId: 'closed' },
    ])

    const result = await listObservedGatewayHandles(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([{ handle: 'authorize_net', claimedBy: 'pg_closed' }])
  })
})
