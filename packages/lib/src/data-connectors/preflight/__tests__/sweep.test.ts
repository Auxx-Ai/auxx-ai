// packages/lib/src/data-connectors/preflight/__tests__/sweep.test.ts
// Covers item 1 of the design (plans/money/design/duplicate-sku-preflight.md
// §6.1) at three levels:
//  - `extractVariantsFromProducts`: the assumed projected shape, pure.
//  - `drainConnectorFetch` (the paginating sibling added in
//    `connector-runtime.ts`): the design's §9 "duplicate on page 7 of 7 is
//    detected" regression guard, and the `maxPages` ceiling — both against a
//    hand-rolled `AsyncIterable<ConnectorYield>`, no connector/credential/db
//    needed.
//  - `sweepProductVariants`: end-to-end wiring against the REAL `fixture`
//    connector type (zero network/DB access by construction), proving the
//    composition (credential resolution → fetch → extraction) is wired
//    correctly.

import { describe, expect, it } from 'vitest'
import { ConnectorSweepPageCeilingError, drainConnectorFetch } from '../../connector-runtime'
import type { ConnectorYield } from '../../connectors/types'
import type { DataConnectorType } from '../../types'
import { classifyVariants } from '../classify'
import { extractVariantsFromProducts, sweepProductVariants } from '../sweep'
import { makeFakeDb } from './support/db'
import { makeConnectorRow, makeFixtureProductRecord } from './support/fixtures'

describe('extractVariantsFromProducts', () => {
  it("flattens each product record's variants[] into one row per variant", () => {
    const records = [
      makeFixtureProductRecord({
        externalId: 'prod_1',
        displayName: 'Lift Motor',
        variants: [
          { id: 'var_1', sku: 'LIFT-3000', title: 'Lift Motor - Red' },
          { id: 'var_2', sku: null, title: 'Lift Motor - Blue' },
        ],
      }),
      makeFixtureProductRecord({
        externalId: 'prod_2',
        variants: [{ id: 'var_3', sku: 'PART-9' }],
      }),
    ]

    const variants = extractVariantsFromProducts(records)

    expect(variants).toEqual([
      { sku: 'LIFT-3000', variantId: 'var_1', title: 'Lift Motor - Red', productId: 'prod_1' },
      { sku: null, variantId: 'var_2', title: 'Lift Motor - Blue', productId: 'prod_1' },
      { sku: 'PART-9', variantId: 'var_3', title: 'var_3', productId: 'prod_2' },
    ])
  })

  it('drops a variant with no extractable id, and a product with no extractable id', () => {
    const records = [
      makeFixtureProductRecord({ externalId: 'prod_1', variants: [{ id: '', sku: 'X' }] }),
      {
        streamKey: 'product',
        externalId: '',
        displayName: '',
        fields: { variants: [{ shopifyId: 'var_1' }] },
      },
    ]

    expect(extractVariantsFromProducts(records)).toEqual([])
  })
})

describe('drainConnectorFetch', () => {
  /** A hand-rolled 7-page iterable — page N carries one variant-bearing product,
   *  and the SKU 'DUP' is repeated on page 1 and page 7. */
  async function* sevenPages(): AsyncGenerator<ConnectorYield> {
    for (let page = 1; page <= 7; page++) {
      yield {
        streamKey: 'product',
        externalId: `prod_${page}`,
        displayName: `prod_${page}`,
        fields: {
          shopify_id: `prod_${page}`,
          variants: [
            { shopifyId: `var_${page}`, sku: page === 1 || page === 7 ? 'DUP' : `UNIQUE-${page}` },
          ],
        },
      }
      yield page < 7
        ? { __checkpoint: true, cursor: { kind: 'pageNumber', value: String(page + 1) } }
        : { __checkpoint: true }
    }
  }

  it('collects records across every page — a duplicate on the last page is not lost', async () => {
    const { records, pagesFetched } = await drainConnectorFetch(sevenPages(), 'product')

    expect(pagesFetched).toBe(7)
    expect(records).toHaveLength(7)

    const variants = extractVariantsFromProducts(records)
    const { summary } = classifyVariants(variants, [])

    // The regression this test guards: a first-page-only sweep would see only
    // variant 1's 'DUP' and report `create`, never reaching page 7's second 'DUP'.
    expect(summary.counts.ambiguous).toBe(2)
    expect(summary.blocking).toBe(true)
    expect(summary.ambiguousSkus).toEqual([{ sku: 'DUP', variantIds: ['var_1', 'var_7'] }])
  })

  it('counts a single unpaginated response (no checkpoint at all) as exactly one page', async () => {
    async function* onePage(): AsyncGenerator<ConnectorYield> {
      yield { streamKey: 'product', externalId: 'prod_1', displayName: 'prod_1', fields: {} }
    }
    const { pagesFetched } = await drainConnectorFetch(onePage(), 'product')
    expect(pagesFetched).toBe(1)
  })

  it('throws ConnectorSweepPageCeilingError once pagesFetched exceeds maxPages', async () => {
    await expect(drainConnectorFetch(sevenPages(), 'product', 3)).rejects.toThrow(
      ConnectorSweepPageCeilingError
    )
  })

  it('never throws when maxPages is high enough to cover every page', async () => {
    const { pagesFetched } = await drainConnectorFetch(sevenPages(), 'product', 7)
    expect(pagesFetched).toBe(7)
  })
})

describe('sweepProductVariants', () => {
  it('pages through the fixture connector end to end and extracts every variant', async () => {
    const connector = makeConnectorRow({
      config: {
        filters: {
          fixtures: [
            makeFixtureProductRecord({
              externalId: 'prod_1',
              variants: [
                { id: 'var_1', sku: 'A' },
                { id: 'var_2', sku: 'A' },
              ],
            }),
          ],
        },
      },
    })

    // `listStreams` is consulted (no persisted stream, no `requestConfig`
    // override) even though `fixture`'s fetch ignores it entirely — an empty
    // `DataConnectorStream` result short-circuits before the mapping query.
    const { db } = makeFakeDb({ queryFindFirst: { DataConnectorStream: [[]] } })

    const result = await sweepProductVariants(db, {
      organizationId: 'org_1',
      userId: '',
      connector,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.pagesFetched).toBe(1)
    expect(result.value.variants.map((v) => v.variantId)).toEqual(['var_1', 'var_2'])
  })

  it('converts a thrown connector-resolution error into a Result, never a rejection', async () => {
    // An unknown connector type makes `connectorFor` (the registry) throw —
    // real behavior, not a fake — proving `sweepProductVariants`'s try/catch
    // actually wraps whatever `sweepConnectorFetch` throws.
    const connector = makeConnectorRow({ type: 'not-a-real-connector-type' as DataConnectorType })
    const { db } = makeFakeDb()

    const result = await sweepProductVariants(db, {
      organizationId: 'org_1',
      userId: '',
      connector,
    })

    expect(result.isErr()).toBe(true)
  })
})
