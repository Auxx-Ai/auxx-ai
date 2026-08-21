// packages/lib/src/resources/registry/identifier-fields.test.ts

import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from './field-registry'
import type { ResourceField } from './field-types'

/**
 * Registry invariants behind `mergeSystemAndCustomFields`' `isIdentifier` rung.
 *
 * That merge coalesces `staticField.isIdentifier ?? dbField.isIdentifier`, where
 * the DB side is `CustomField.isUnique`. The coalesce is only sufficient because
 * of the two rules pinned here — a registry field that declares uniqueness but
 * forgets `isIdentifier`, or declares `isIdentifier` while unfilterable, is
 * dropped somewhere downstream with no error.
 *
 * Both rules are cheap to satisfy and were violated by nobody at the time of
 * writing; the point is that the NEXT field added cannot break them silently.
 */

const allFields = (): Array<{ resource: string; key: string; field: ResourceField }> =>
  Object.entries(RESOURCE_FIELD_REGISTRY).flatMap(([resource, fields]) =>
    Object.entries(fields ?? {}).map(([key, field]) => ({
      resource,
      key,
      field: field as ResourceField,
    }))
  )

describe('registry identifier declarations', () => {
  it('every unique field is also declared an identifier', () => {
    // A field the product enforces as unique is by definition a usable import
    // match key. If the registry declares `unique` without `isIdentifier`, the
    // merge's coalesce still promotes it via `CustomField.isUnique` — but ONLY in
    // orgs whose seeded row actually carries the flag. `part_sku` drifted exactly
    // that way (orgs before 2026-04-08 seeded `isUnique: false`), which left the
    // import wizard with no usable identifier and duplicated every re-imported row.
    // Declaring both makes the registry, not the seed date, the source of truth.
    const offenders = allFields()
      .filter(({ field }) => field.capabilities.unique === true && field.isIdentifier !== true)
      .map(({ resource, key }) => `${resource}.${key}`)

    expect(offenders).toEqual([])
  })

  it('every identifier field is filterable', () => {
    // `getIdentifiableFields` rejects non-filterable fields before it ever looks
    // at `isIdentifier`, so an unfilterable identifier is silently absent from
    // the import picker rather than rejected loudly.
    const offenders = allFields()
      .filter(({ field }) => field.isIdentifier === true && !field.capabilities.filterable)
      .map(({ resource, key }) => `${resource}.${key}`)

    expect(offenders).toEqual([])
  })
})
