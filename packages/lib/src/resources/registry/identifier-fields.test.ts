// packages/lib/src/resources/registry/identifier-fields.test.ts

import { describe, expect, it } from 'vitest'
import { getIdentifiableFields } from '../../import/fields/get-identifiable-fields'
import { RESOURCE_FIELD_REGISTRY } from './field-registry'
import { getFieldOutputKey, type ResourceField } from './field-types'
import { getDefaultIdentifierField, getNaturalKeyFields } from './field-utils'
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

/**
 * The declared NATURAL KEY — the composite identity of a join-shaped entity.
 *
 * `getNaturalKeyFields` returns EMPTY on a non-contiguous declaration rather
 * than a partial key, because a partial tuple ANDs too little and updates the
 * wrong record. That failure is silent at runtime, so it is pinned here instead.
 */
describe('registry natural-key declarations', () => {
  const resources = Object.entries(RESOURCE_FIELD_REGISTRY).map(([id, fields]) => ({
    id,
    fields: Object.values(fields ?? {}) as ResourceField[],
  }))

  it('every declared position is a contiguous run from 1', () => {
    const offenders: string[] = []

    for (const resource of resources) {
      const declared = resource.fields
        .filter((f) => f.naturalKeyPosition !== undefined)
        .map((f) => f.naturalKeyPosition!)
        .sort((a, b) => a - b)

      if (declared.length === 0) continue
      // A lone leg is not a composite key; it is a mistyped `isIdentifier`.
      if (declared.length === 1) {
        offenders.push(`${resource.id}: a natural key of ONE field, use isIdentifier instead`)
        continue
      }
      if (declared.some((position, index) => position !== index + 1)) {
        offenders.push(`${resource.id}: positions [${declared}] are not 1..${declared.length}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('every natural-key leg is eligible as an identifier', () => {
    // A leg the picker refuses (hidden, unfilterable, computed, multi-value, or a
    // type outside `ELIGIBLE_IDENTIFIER_TYPES`) can never be flagged, so the key
    // would be undeclarable in the UI while looking declared in the registry.
    const offenders: string[] = []

    for (const resource of resources) {
      const eligibleKeys = new Set(
        getIdentifiableFields(resource as unknown as Resource).map((f) => f.key)
      )
      for (const field of getNaturalKeyFields(resource)) {
        if (!eligibleKeys.has(getFieldOutputKey(field))) {
          offenders.push(`${resource.id}.${field.key}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('vendor_part is keyed on (part, supplier), in that order', () => {
    const vendorPart = resources.find((r) => r.id === 'vendor_part')
    expect(vendorPart).toBeDefined()
    expect(getNaturalKeyFields(vendorPart!).map((f) => f.key)).toEqual(['part', 'contact'])
  })

  it('subpart is keyed on (parentPart, childPart), in that order', () => {
    const subpart = resources.find((r) => r.id === 'subpart')
    expect(subpart).toBeDefined()
    expect(getNaturalKeyFields(subpart!).map((f) => f.key)).toEqual(['parentPart', 'childPart'])
  })

  it('a natural-key leg is offered at tier 1, and only as part of a composite', () => {
    // Tier 2 would bury the only identity `vendor_part` has behind "Not enforced
    // unique"; dropping `compositeOnly` would let a whole supplier's price list be
    // keyed on the supplier alone, updating an arbitrary line of it.
    const vendorPart = resources.find((r) => r.id === 'vendor_part')!
    const offered = getIdentifiableFields(vendorPart as unknown as Resource)

    for (const key of ['vendor_part_part', 'vendor_part_contact']) {
      const entry = offered.find((f) => f.key === key)
      expect(entry, `${key} is not offered at all`).toBeDefined()
      expect(entry?.identifierTier).toBe(1)
      expect(entry?.identifierCompositeOnly).toBe(true)
    }
  })

  // The auto-select must not start answering with a relation the moment the legs
  // become tier 1 — it filters `!compositeOnly`, and this pins that it still does.
  it('does not let a natural-key leg become the LONE auto-selected identifier', () => {
    const offenders: string[] = []

    for (const resource of resources) {
      const legs = new Set(getNaturalKeyFields(resource).map(getFieldOutputKey))
      if (legs.size === 0) continue
      const chosen = getDefaultIdentifierField(resource)
      if (chosen && legs.has(getFieldOutputKey(chosen))) {
        offenders.push(`${resource.id}: auto-selected ${chosen.key}, a composite leg`)
      }
    }

    expect(offenders).toEqual([])
  })
})
