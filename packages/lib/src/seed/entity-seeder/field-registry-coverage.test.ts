// packages/lib/src/seed/entity-seeder/field-registry-coverage.test.ts

import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from '../../resources/registry/field-registry'
import { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } from './constants'
import { FIELD_REGISTRY } from './create-fields'

/**
 * The lists a new system entity has to appear in, pinned against each other.
 *
 * `createAllFields` iterates {@link FIELD_REGISTRY} while `createEntityDefinitions`
 * iterates {@link SYSTEM_ENTITIES}, so a type in the second and not the first
 * lands on a NEW org as a definition with zero fields: rows render nameless, the
 * list has no columns, and a create through `UnifiedCrudHandler` drops every
 * value with only a logged warning. `bank_rule` shipped that way and nothing
 * failed, because the one test asserting both registries at once lived in a
 * single migration's own file.
 */

/**
 * Types deliberately absent from a registry, each with the reason. A new type
 * does NOT belong here: if a test below fails for something you just added, add
 * the type to the registry rather than to this list.
 */
const KNOWN_ABSENT = {
  /** Seeded with no custom fields at all: a group is its `EntityInstance` row. */
  entity_group: ['FIELD_REGISTRY', 'RESOURCE_FIELD_REGISTRY'],
  /** Seeded by the entity seeder, but not exposed as an editable resource. */
  tag: ['RESOURCE_FIELD_REGISTRY'],
} as const satisfies Record<string, readonly string[]>

function absentFrom(entityType: string, registry: string): boolean {
  const entry = KNOWN_ABSENT[entityType as keyof typeof KNOWN_ABSENT] as
    | readonly string[]
    | undefined
  return !!entry?.includes(registry)
}

describe('system entity registries agree', () => {
  const systemTypes = SYSTEM_ENTITIES.map((entity) => entity.entityType)

  it.each(systemTypes)('%s has a field map in FIELD_REGISTRY', (entityType) => {
    if (absentFrom(entityType, 'FIELD_REGISTRY')) return
    expect(FIELD_REGISTRY[entityType]).toBeDefined()
  })

  it.each(systemTypes)('%s has a field map in RESOURCE_FIELD_REGISTRY', (entityType) => {
    if (absentFrom(entityType, 'RESOURCE_FIELD_REGISTRY')) return
    expect(RESOURCE_FIELD_REGISTRY[entityType]).toBeDefined()
  })

  it.each(systemTypes)('%s resolves the SAME field map in both registries', (entityType) => {
    if (
      absentFrom(entityType, 'FIELD_REGISTRY') ||
      absentFrom(entityType, 'RESOURCE_FIELD_REGISTRY')
    ) {
      return
    }
    expect(FIELD_REGISTRY[entityType]).toBe(RESOURCE_FIELD_REGISTRY[entityType])
  })

  it('has no FIELD_REGISTRY entry for a type that is not a system entity', () => {
    const orphans = Object.keys(FIELD_REGISTRY).filter((type) => !systemTypes.includes(type))
    expect(orphans).toEqual([])
  })

  it.each(systemTypes)('%s names a display field that exists in its field map', (entityType) => {
    const config = DISPLAY_FIELD_CONFIG[entityType]
    const fields = FIELD_REGISTRY[entityType]
    if (!config || !fields) return
    expect(Object.keys(fields)).toContain(config.primaryDisplayField)
  })

  it('pins the accounting pass five, so none can fall out of either registry', () => {
    for (const entityType of [
      'journal_entry',
      'bank_deposit',
      'bank_account',
      'bank_transaction',
      'bank_rule',
    ]) {
      expect(FIELD_REGISTRY[entityType], `${entityType} in FIELD_REGISTRY`).toBeDefined()
      expect(
        RESOURCE_FIELD_REGISTRY[entityType],
        `${entityType} in RESOURCE_FIELD_REGISTRY`
      ).toBeDefined()
      expect(systemTypes, `${entityType} in SYSTEM_ENTITIES`).toContain(entityType)
    }
  })
})
