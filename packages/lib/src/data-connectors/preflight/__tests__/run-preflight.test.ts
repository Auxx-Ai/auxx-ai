// packages/lib/src/data-connectors/preflight/__tests__/run-preflight.test.ts
// The composition (design §6.1 items 1+2 wired together) and the design's §9
// rows that are about the WHOLE pipeline rather than one module: "pre-flight
// run twice with no change is idempotent, no writes either time."
//
// `sweepProductVariants` and `findPartsBySkus` are injected as hand-written
// fakes (`RunAdoptionPreflightDeps` — see run-preflight.ts's JSDoc for why:
// the real `findPartsBySkus` reads through the Redis-backed org cache, and
// this suite uses no `vi.mock`). The `db` handed to `runAdoptionPreflight`
// itself is the write-refusing double — it is what actually proves "no
// writes", not the fakes, which are plain functions that could not write to
// begin with.

import { ok } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import type { ExistingPart } from '../classify'
import { runAdoptionPreflight } from '../run-preflight'
import type { SweptVariant } from '../sweep'
import { makeFakeDb } from './support/db'
import { makeConnectorRow } from './support/fixtures'

const VARIANTS: SweptVariant[] = [
  { sku: 'MATCHED-1', variantId: 'v1', title: 'Matched', productId: 'p1' },
  { sku: 'DUP-1', variantId: 'v2', title: 'Dup A', productId: 'p1' },
  { sku: 'DUP-1', variantId: 'v3', title: 'Dup B', productId: 'p1' },
  { sku: null, variantId: 'v4', title: 'Blank', productId: 'p1' },
  { sku: 'NEW-1', variantId: 'v5', title: 'New', productId: 'p1' },
]

const EXISTING_PARTS: ExistingPart[] = [
  { id: 'part_1', sku: 'MATCHED-1', archivedAt: null, displayName: 'Existing Part' },
]

function fakeDeps() {
  return {
    sweepProductVariants: async () => ok({ variants: VARIANTS, pagesFetched: 3 }),
    findPartsBySkus: async () => EXISTING_PARTS,
  }
}

describe('runAdoptionPreflight', () => {
  it('composes the sweep, lookup and classification into one report', async () => {
    const { db, writesAttempted } = makeFakeDb({
      queryFindFirst: { DataConnector: [makeConnectorRow()] },
    })

    const result = await runAdoptionPreflight(
      db,
      { organizationId: 'org_1', connectorId: 'connector_1' },
      fakeDeps()
    )

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    const report = result.value

    expect(report.variantCount).toBe(5)
    expect(report.pagesFetched).toBe(3)
    expect(report.summary.counts).toEqual({
      matched: 1,
      matched_archived: 0,
      create: 1,
      ambiguous: 2,
      blank: 1,
    })
    expect(report.summary.blocking).toBe(true)
    expect(writesAttempted).toEqual([])
  })

  it('never writes, even when the connector is not found', async () => {
    const { db, writesAttempted } = makeFakeDb({ queryFindFirst: { DataConnector: [undefined] } })

    const result = await runAdoptionPreflight(
      db,
      { organizationId: 'org_1', connectorId: 'missing' },
      fakeDeps()
    )

    expect(result.isErr()).toBe(true)
    expect(writesAttempted).toEqual([])
  })

  it('running twice against unchanged input is idempotent and never writes either time', async () => {
    const { db, writesAttempted } = makeFakeDb({
      queryFindFirst: { DataConnector: [makeConnectorRow(), makeConnectorRow()] },
    })
    const deps = fakeDeps()
    const input = { organizationId: 'org_1', connectorId: 'connector_1' }

    const first = await runAdoptionPreflight(db, input, deps)
    const second = await runAdoptionPreflight(db, input, deps)

    expect(first.isOk() && second.isOk()).toBe(true)
    if (!first.isOk() || !second.isOk()) return
    expect(second.value).toEqual(first.value)
    expect(writesAttempted).toEqual([])
  })
})
