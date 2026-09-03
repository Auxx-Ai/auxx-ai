// packages/lib/src/data-connectors/catalog-diff.test.ts
// The three-way catalog diff (task 41 section 7): added stream, removed binding,
// changed bindings with their impact levels, a hand-edited row the app did not touch is
// not listed, a hand-edited row the app also changed is a conflict, and the D5 fallback
// for rows with no `catalogHash`. Pure: two catalogs and a fabricated row set.

import { describe, expect, it } from 'vitest'
import {
  catalogFixtureV1,
  catalogFixtureV2,
  FIXTURE_DEF_FIELDS,
  fixturePersistedContext,
  fixtureResolver,
  persistedRowsFromDerived,
} from './__test-helpers'
import { type CatalogDiffEntry, diffConnectorCatalog } from './catalog-diff'
import { deriveConnectorShape, shapeFromPersistedStreams } from './catalog-shape'
import type { StreamWithRawMappings } from './service'

const APP = 'shopify'

function derive(v2: boolean) {
  return deriveConnectorShape(
    v2 ? catalogFixtureV2() : catalogFixtureV1(),
    [],
    APP,
    fixtureResolver()
  )
}

/** What the query layer supplies in production: `part_sku` for a system field, the key for an app field. */
function labelTarget(target: string | null): string {
  if (!target) return 'external id'
  if (target.startsWith('@app:')) return target.split(':').slice(2).join(':')
  const [defId, fieldId] = target.split(':')
  const field = FIXTURE_DEF_FIELDS[defId ?? '']?.find((f) => f.id === fieldId)
  return field?.systemAttribute ?? field?.name ?? target
}

function diff(rows: StreamWithRawMappings[], withOld = true) {
  const persisted = shapeFromPersistedStreams(rows, fixturePersistedContext())
  return diffConnectorCatalog(persisted, derive(true), withOld ? derive(false) : null, {
    labelTarget,
  })
}

function binding(entries: CatalogDiffEntry[], streamKey: string, targetLabel: string) {
  return entries.find(
    (e) =>
      e.change.kind === 'binding' &&
      e.change.streamKey === streamKey &&
      e.change.targetLabel === targetLabel
  )
}

function findRow(rows: StreamWithRawMappings[], streamKey: string, defId: string) {
  const row = rows
    .find((s) => s.streamKey === streamKey)!
    .mappings.find((m) => m.entityDefinitionId === defId)!
  return row
}

describe('diffConnectorCatalog: unedited rows', () => {
  const rows = persistedRowsFromDerived(derive(false))
  const { entries } = diff(rows)

  it('lists the added stream as one entry', () => {
    const stream = entries.find((e) => e.change.kind === 'stream' && e.change.op === 'add')
    expect(stream?.change).toMatchObject({ streamKey: 'fulfillment', mappingCount: 1 })
    expect(stream?.conflict).toBe(false)
  })

  it('a match flag turned on is a rebind of the part mapping', () => {
    const sku = binding(entries, 'product', 'part_sku')
    expect(sku?.change).toMatchObject({ op: 'change', mappingTarget: 'part' })
    expect(sku?.impact.level).toBe('rebind')
    expect(sku?.impact.reasons).toContain('identity-match')
    expect(sku?.conflict).toBe(false)
    if (sku?.change.kind === 'binding') {
      expect(sku.change.before?.role).toBeNull()
      expect(sku.change.after?.role).toBe('match-exclusive')
    }
  })

  it('a merge-strategy change is cosmetic', () => {
    const title = binding(entries, 'product', 'part_title')
    expect(title?.impact.level).toBe('cosmetic')
    if (title?.change.kind === 'binding') {
      expect(title.change.before?.mergeStrategy).toBe('overwrite')
      expect(title.change.after?.mergeStrategy).toBe('fill_blank')
    }
  })

  it('a new binding re-backfills its stream, a removed one is cosmetic', () => {
    const notes = binding(entries, 'customer', 'notes')
    expect(notes?.change).toMatchObject({ op: 'add' })
    expect(notes?.impact).toEqual({ level: 'rebackfill', reasons: ['field-added'] })
    const phone = binding(entries, 'customer', 'phone')
    expect(phone?.change).toMatchObject({ op: 'remove' })
    expect(phone?.impact.level).toBe('cosmetic')
  })

  it('a sync-mode flip is a stream change that re-backfills', () => {
    const customer = entries.find(
      (e) =>
        e.change.kind === 'stream' && e.change.op === 'change' && e.change.streamKey === 'customer'
    )
    expect(customer?.change).toMatchObject({ fields: expect.arrayContaining(['syncMode']) })
    expect(customer?.impact.level).toBe('rebackfill')
    expect(customer?.conflict).toBe(false)
  })

  it('nothing the app did not change is listed', () => {
    // Every entry is one of the six v2 changes (the product schema refresh rides along
    // with the binding edits since the declared paths did not change).
    const untouched = entries.filter(
      (e) =>
        e.change.kind === 'binding' &&
        [
          'primary_email',
          'product_title',
          'catalog_item_default_unit_price',
          'storeDomain',
        ].includes(e.change.targetLabel)
    )
    expect(untouched).toEqual([])
    expect(entries.some((e) => e.change.kind === 'mapping')).toBe(false)
  })

  it('carries an apply step per entry', () => {
    const { entries: all, steps } = diff(rows)
    for (const entry of all) expect(steps.has(entry.id)).toBe(true)
  })
})

describe('diffConnectorCatalog: merchant edits', () => {
  it('a hand-edited binding the app did not change is left alone and not listed', () => {
    const rows = persistedRowsFromDerived(derive(false))
    const contact = findRow(rows, 'customer', 'def_contact')
    const email = contact.fieldMappings.find((fm) => fm.targetFieldRef?.endsWith('f_email'))!
    email.mergeStrategy = 'ignore'
    const { entries } = diff(rows)
    expect(binding(entries, 'customer', 'primary_email')).toBeUndefined()
    // The rest of the row still updates cleanly: binding-level conflict detection.
    expect(binding(entries, 'customer', 'first_name')?.conflict).toBe(false)
  })

  it('a hand-edited binding the app also changed is a conflict', () => {
    const rows = persistedRowsFromDerived(derive(false))
    const contact = findRow(rows, 'customer', 'def_contact')
    const first = contact.fieldMappings.find((fm) => fm.targetFieldRef?.endsWith('f_first'))!
    first.mergeStrategy = 'overwrite' // v1 said fill_blank; v2 says connector_owned_only
    const { entries } = diff(rows)
    const entry = binding(entries, 'customer', 'first_name')
    expect(entry?.conflict).toBe(true)
    if (entry?.change.kind === 'binding') {
      expect(entry.change.before?.mergeStrategy).toBe('overwrite')
      expect(entry.change.after?.mergeStrategy).toBe('connector_owned_only')
    }
  })

  it('a merchant edit that already matches the new catalog is not listed', () => {
    const rows = persistedRowsFromDerived(derive(false))
    const part = findRow(rows, 'product', 'def_part')
    const title = part.fieldMappings.find((fm) => fm.targetFieldRef?.endsWith('f_title'))!
    title.mergeStrategy = 'fill_blank'
    const { entries } = diff(rows)
    expect(binding(entries, 'product', 'part_title')).toBeUndefined()
  })

  it('a binding the merchant removed that the app changed comes back as a conflict', () => {
    const rows = persistedRowsFromDerived(derive(false))
    const part = findRow(rows, 'product', 'def_part')
    part.fieldMappings = part.fieldMappings.filter((fm) => !fm.targetFieldRef?.endsWith('f_sku'))
    const { entries } = diff(rows)
    const sku = binding(entries, 'product', 'part_sku')
    expect(sku?.change).toMatchObject({ op: 'add' })
    expect(sku?.conflict).toBe(true)
  })

  it('a merchant-added mapping the app never had is never removed', () => {
    const rows = persistedRowsFromDerived(derive(false))
    const stream = rows.find((s) => s.streamKey === 'customer')!
    stream.mappings.push({
      ...stream.mappings[0]!,
      id: 'm_hand',
      rootPath: 'addresses[]',
      entityDefinitionId: 'def_contact',
      parentMappingId: stream.mappings[0]!.id,
      catalogHash: null,
    })
    const { entries } = diff(rows)
    expect(entries.some((e) => e.change.kind === 'mapping' && e.change.op === 'remove')).toBe(false)
  })
})

describe('diffConnectorCatalog: D5 fallback (no catalogHash)', () => {
  it('rows that match the seeding catalog apply cleanly', () => {
    const rows = persistedRowsFromDerived(derive(false), { withHash: false })
    const { entries } = diff(rows)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => !e.conflict)).toBe(true)
  })

  it('a row that differs from the seeding catalog conflicts where the app changed it', () => {
    const rows = persistedRowsFromDerived(derive(false), { withHash: false })
    const part = findRow(rows, 'product', 'def_part')
    const sku = part.fieldMappings.find((fm) => fm.targetFieldRef?.endsWith('f_sku'))!
    sku.mergeStrategy = 'ignore'
    const { entries } = diff(rows)
    expect(binding(entries, 'product', 'part_sku')?.conflict).toBe(true)
    expect(binding(entries, 'product', 'part_title')?.conflict).toBe(false)
  })

  it('with no hash and no seeding catalog every touched row is a conflict', () => {
    const rows = persistedRowsFromDerived(derive(false), { withHash: false })
    const { entries } = diff(rows, false)
    const touched = entries.filter((e) => e.change.kind === 'binding')
    expect(touched.length).toBeGreaterThan(0)
    expect(touched.every((e) => e.conflict)).toBe(true)
    // And a removal cannot be told from a merchant add, so it is skipped.
    expect(binding(entries, 'customer', 'phone')).toBeUndefined()
  })
})
