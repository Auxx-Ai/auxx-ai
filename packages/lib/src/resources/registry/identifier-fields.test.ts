// packages/lib/src/resources/registry/identifier-fields.test.ts

import { describe, expect, it } from 'vitest'
import { getIdentifiableFields } from '../../import/fields/get-identifiable-fields'
import { RESOURCE_FIELD_REGISTRY } from './field-registry'
import { getFieldOutputKey, type ResourceField } from './field-types'
import { getDefaultIdentifierField } from './field-utils'
import type { Resource } from './types'

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

/**
 * The picker and the planner's auto-select must answer the same question.
 *
 * `getIdentifiableFields` (import picker) and `getIdentifierFields` /
 * `getDefaultIdentifierField` (planner) used to be PARALLEL implementations of
 * `f.isIdentifier`. Grading eligibility in one of them would have left the other
 * on the old rule, so the picker could offer a field the auto-select would never
 * choose, silently, with no error anywhere. They now share
 * `getIdentifierEligibility`; this pins that they still agree, per resource.
 */
describe('picker / auto-select agreement across the registry', () => {
  const resources = Object.entries(RESOURCE_FIELD_REGISTRY).map(([id, fields]) => ({
    id,
    fields: Object.values(fields ?? {}) as ResourceField[],
  }))

  it('every registry resource has at least one field to test', () => {
    expect(resources.length).toBeGreaterThan(0)
  })

  it("getDefaultIdentifierField's answer is always in the picker's tier-1 set", () => {
    const offenders: string[] = []

    for (const resource of resources) {
      const chosen = getDefaultIdentifierField(resource)
      if (!chosen) continue

      const tierOne = new Set(
        getIdentifiableFields(resource as unknown as Resource)
          .filter((f) => f.identifierTier === 1 && !f.identifierCompositeOnly)
          .map((f) => f.key)
      )

      if (!tierOne.has(getFieldOutputKey(chosen))) {
        offenders.push(`${resource.id}: picked ${chosen.key}, tier-1 = [${[...tierOne]}]`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('prefers a real identifier over Record ID wherever one exists', () => {
    // The seeder excludes `id`, so it lands in `unmatchedStaticFields` and
    // sorts FIRST, which is why the auto-pick used to be `id` for every
    // resource and why no row had ever classified as `update`.
    const offenders: string[] = []

    for (const resource of resources) {
      const tierOneKeys = getIdentifiableFields(resource as unknown as Resource)
        .filter((f) => f.identifierTier === 1 && !f.identifierCompositeOnly)
        .map((f) => f.key)

      const hasRealIdentifier = tierOneKeys.some((key) => key !== 'id')
      if (!hasRealIdentifier) continue

      if (
        getFieldOutputKey(getDefaultIdentifierField(resource) ?? ({} as ResourceField)) === 'id'
      ) {
        offenders.push(`${resource.id}: still picks Record ID over [${tierOneKeys}]`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('part picks sku, not Record ID', () => {
    const part = resources.find((r) => r.id === 'part')
    expect(part).toBeDefined()
    expect(getDefaultIdentifierField(part!)?.key).toBe('sku')
  })
})
