// packages/lib/src/payment-gateways/__tests__/census.test.ts
//
// `listGatewayHandleCensus` - the widened census the setup wizard's rail page
// reads (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §8 item 1).
//
// What is worth pinning here is not the SQL, which the double cannot see, but
// the post-processing the SQL hands to: reserved handles dropped, option-keyed
// values resolved through the field's own option list, rows merged on the
// NORMALISED handle with their counts summed and the later date kept, and
// `authorize_net`/`authorize.net` deliberately NOT merged (they are one rail,
// but they are two handles, and the rail grouping is the caller's job).
//
// Same table-keyed double `reads.test.ts` uses, plus `leftJoin`/`groupBy` on
// the chain. `claimedBy` now comes through `listPaymentGateways`, whose own
// hydrate reads `GlRoleAssignment`/`FinancialSourceAccount` as well as
// `FieldValue` (task 58 §4.3) - `script`'s `gateways` param queues all three.

import { schema } from '@auxx/database'
import { getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  tables: new Map<string, unknown[][]>(),
  gatewayFieldOptions: null as unknown,
  /** False to simulate an org whose `order_placed_at` field is not provisioned. */
  placedAtField: true,
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: async (_org: string, entityType: string) =>
    entityType === 'payment_gateway' ? 'def_pg' : null,
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((attr) => {
            if (attr === 'order_payment_gateways') {
              return [attr, { id: attr, options: state.gatewayFieldOptions }]
            }
            if (attr === 'order_placed_at') {
              return [attr, state.placedAtField ? { id: attr } : null]
            }
            return [attr, { id: attr }]
          })
        ),
    }),
  }),
}))

function queue(table: unknown, rows: unknown[]): void {
  const name = getTableName(table as Parameters<typeof getTableName>[0])
  const pages = state.tables.get(name) ?? []
  pages.push(rows)
  state.tables.set(name, pages)
}

/** One query stage: chainable and awaitable, resolving to `rows`. */
function stage(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  for (const method of ['orderBy', 'limit', 'where', 'leftJoin', 'innerJoin', 'groupBy']) {
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

/** The census query, then (when there are any instances) `listPaymentGateways`'s own reads. */
function script(censusRows: unknown[], gateways: { instances: unknown[]; values: unknown[] }) {
  queue(schema.FieldValue, censusRows)
  queue(schema.EntityInstance, gateways.instances)
  if (gateways.instances.length > 0) {
    queue(schema.GlRoleAssignment, [])
    queue(schema.FinancialSourceAccount, [])
    queue(schema.FieldValue, gateways.values)
  }
}

const NO_GATEWAYS = { instances: [], values: [] }

beforeEach(() => {
  state.tables.clear()
  state.gatewayFieldOptions = null
  state.placedAtField = true
})

const { listGatewayHandleCensus } = await import('../reads')

describe('listGatewayHandleCensus', () => {
  it('carries the order count and the last-seen date per handle', async () => {
    script(
      [
        { optionId: 'authorize_net', valueText: null, orderCount: 5308, lastSeenAt: '2026-03-11' },
        {
          optionId: 'shopify_payments',
          valueText: null,
          orderCount: 979,
          lastSeenAt: '2026-09-12',
        },
      ],
      NO_GATEWAYS
    )

    const result = await listGatewayHandleCensus(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([
      { handle: 'authorize_net', claimedBy: null, orderCount: 5308, lastSeenAt: '2026-03-11' },
      { handle: 'shopify_payments', claimedBy: null, orderCount: 979, lastSeenAt: '2026-09-12' },
    ])
  })

  it('sorts busiest first, not alphabetically', async () => {
    script(
      [
        { optionId: 'affirm', valueText: null, orderCount: 141, lastSeenAt: '2026-09-09' },
        { optionId: 'zzz_rail', valueText: null, orderCount: 900, lastSeenAt: '2026-09-09' },
      ],
      NO_GATEWAYS
    )

    const handles = (await listGatewayHandleCensus(fakeDb(), ORG))
      ._unsafeUnwrap()
      .map((row) => row.handle)
    expect(handles).toEqual(['zzz_rail', 'affirm'])
  })

  it('merges two spellings that normalise to one handle, summing and keeping the later date', async () => {
    script(
      [
        { optionId: 'Affirm', valueText: null, orderCount: 100, lastSeenAt: '2026-01-02' },
        { optionId: 'affirm', valueText: null, orderCount: 41, lastSeenAt: '2026-09-09' },
      ],
      NO_GATEWAYS
    )

    expect((await listGatewayHandleCensus(fakeDb(), ORG))._unsafeUnwrap()).toEqual([
      { handle: 'Affirm', claimedBy: null, orderCount: 141, lastSeenAt: '2026-09-09' },
    ])
  })

  it('does NOT merge authorize_net and authorize.net - one rail, two handles', async () => {
    // 🔑 The rail grouping is the caller's, against the suggestion catalogue.
    // Doing it here would make the census lie about what is stored on orders.
    script(
      [
        { optionId: 'authorize_net', valueText: null, orderCount: 5308, lastSeenAt: '2026-03-11' },
        { optionId: 'authorize.net', valueText: null, orderCount: 64, lastSeenAt: '2026-02-28' },
      ],
      NO_GATEWAYS
    )

    expect(
      (await listGatewayHandleCensus(fakeDb(), ORG))._unsafeUnwrap().map((row) => row.handle)
    ).toEqual(['authorize_net', 'authorize.net'])
  })

  it('drops the reserved handles, which no record can ever claim', async () => {
    script(
      [
        { optionId: 'manual', valueText: null, orderCount: 7, lastSeenAt: '2026-09-01' },
        { optionId: 'bogus', valueText: null, orderCount: 3, lastSeenAt: '2026-09-01' },
        { optionId: 'shop_cash', valueText: null, orderCount: 1, lastSeenAt: '2026-09-01' },
      ],
      NO_GATEWAYS
    )

    expect(
      (await listGatewayHandleCensus(fakeDb(), ORG))._unsafeUnwrap().map((row) => row.handle)
    ).toEqual(['shop_cash'])
  })

  it('resolves an option-keyed value through the field option list, not valueText alone', async () => {
    state.gatewayFieldOptions = { options: [{ value: 'opt_1', label: 'Shopify Payments' }] }
    script(
      [{ optionId: 'opt_1', valueText: null, orderCount: 979, lastSeenAt: '2026-09-12' }],
      NO_GATEWAYS
    )

    expect((await listGatewayHandleCensus(fakeDb(), ORG))._unsafeUnwrap()[0]?.handle).toBe(
      'Shopify Payments'
    )
  })

  it('marks a handle claimed by the gateway that holds it, closed rails included', async () => {
    script([{ optionId: 'Affirm', valueText: null, orderCount: 141, lastSeenAt: '2026-09-09' }], {
      instances: [{ id: 'pg_1', createdAt: null, updatedAt: null }],
      values: [
        { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Affirm', optionId: null },
        {
          entityId: 'pg_1',
          fieldId: 'payment_gateway_handles',
          valueText: null,
          optionId: 'affirm',
        },
        {
          entityId: 'pg_1',
          fieldId: 'payment_gateway_status',
          valueText: null,
          optionId: 'closed',
        },
      ],
    })

    expect((await listGatewayHandleCensus(fakeDb(), ORG))._unsafeUnwrap()[0]?.claimedBy).toBe(
      'pg_1'
    )
  })

  it('is empty when nothing was ever written to the field', async () => {
    script([], NO_GATEWAYS)
    expect((await listGatewayHandleCensus(fakeDb(), ORG))._unsafeUnwrap()).toEqual([])
  })

  it('still answers when the org has no order_placed_at field, with null dates', async () => {
    // A missing date field is a reason to say less on a setup page, never a
    // reason to hide the census.
    state.placedAtField = false
    script([{ optionId: 'stripe', valueText: null, orderCount: 12, lastSeenAt: null }], NO_GATEWAYS)

    expect((await listGatewayHandleCensus(fakeDb(), ORG))._unsafeUnwrap()).toEqual([
      { handle: 'stripe', claimedBy: null, orderCount: 12, lastSeenAt: null },
    ])
  })
})
