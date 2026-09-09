// packages/lib/src/resources/registry/__tests__/relationship-on-delete.test.ts

import { RELATION_DELETE_BEHAVIORS } from '@auxx/types/custom-field'
import { describe, expect, it } from 'vitest'
import { SYSTEM_ENTITIES } from '../../../seed/entity-seeder/constants'
import { FIELD_REGISTRY } from '../../../seed/entity-seeder/create-fields'
import { RESOURCE_FIELD_REGISTRY } from '../field-registry'
import type { ResourceField } from '../field-types'

/**
 * `onDelete` is only meaningful on an edge the delete engine can act on: both
 * ends are EntityInstance-backed defs (`SYSTEM_ENTITIES`) and the relation is
 * stored as FieldValue rows, which means the inverse belongs_to field has no
 * `dbColumn`. Compile-time cannot know which defs are entity-backed, so the
 * type only forbids `onDelete` on a belongs_to side; this test enforces the
 * rest: every actionable owning edge declares it, every non-actionable one
 * omits it.
 */
const ENTITY_BACKED = new Set<string>(SYSTEM_ENTITIES.map((e) => e.entityType))

// Both maps: RESOURCE_FIELD_REGISTRY carries the table-backed registries the
// absence rule needs, FIELD_REGISTRY carries every seeded def (`tag` is only there).
const registry: Record<string, Record<string, ResourceField>> = {
  ...(RESOURCE_FIELD_REGISTRY as Record<string, Record<string, ResourceField>>),
  ...FIELD_REGISTRY,
}

interface Site {
  site: string
  relationshipType: string
  onDelete: string | undefined
  actionable: boolean
  constraints: Record<string, unknown> | undefined
}

function inverseHasDbColumn(inverseRef: string | null | undefined): boolean {
  if (!inverseRef) return false
  const [defType, fieldKey] = inverseRef.split(':')
  const inverse = defType && fieldKey ? registry[defType]?.[fieldKey] : undefined
  return inverse?.dbColumn !== undefined
}

const sites: Site[] = Object.entries(registry).flatMap(([tableId, fields]) =>
  Object.values(fields).flatMap((field) => {
    const out: Site[] = []
    if (field.relationship) {
      const rel = field.relationship
      const [relatedType] = (rel.inverseResourceFieldId ?? '').split(':')
      out.push({
        site: `${tableId}.${field.key} (relationship)`,
        relationshipType: rel.relationshipType,
        onDelete: rel.onDelete as string | undefined,
        actionable:
          ENTITY_BACKED.has(tableId) &&
          ENTITY_BACKED.has(relatedType ?? '') &&
          !inverseHasDbColumn(rel.inverseResourceFieldId),
        constraints: rel.constraints as Record<string, unknown> | undefined,
      })
    }
    if (field.relationshipConfig) {
      const cfg = field.relationshipConfig
      // A seed-only self-relation names its inverse by systemAttribute, so the
      // dbColumn check resolves it by attribute instead of by key.
      const inverse = Object.values(registry[cfg.relatedEntityType] ?? {}).find(
        (f) => f.systemAttribute === cfg.inverseSystemAttribute
      )
      out.push({
        site: `${tableId}.${field.key} (relationshipConfig)`,
        relationshipType: cfg.relationshipType,
        onDelete: cfg.onDelete as string | undefined,
        actionable:
          ENTITY_BACKED.has(tableId) &&
          ENTITY_BACKED.has(cfg.relatedEntityType) &&
          inverse?.dbColumn === undefined,
        constraints: undefined,
      })
    }
    return out
  })
)

const owning = sites.filter((s) => s.relationshipType !== 'belongs_to')

describe('registry relationship onDelete coverage', () => {
  it('walks a non-trivial number of relationship sites', () => {
    expect(sites.length).toBeGreaterThan(100)
    expect(owning.length).toBeGreaterThan(50)
  })

  it('every actionable owning edge declares a known onDelete', () => {
    const missing = owning.filter(
      (s) => s.actionable && !RELATION_DELETE_BEHAVIORS.includes(s.onDelete as never)
    )
    expect(missing.map((s) => `${s.site}: ${s.onDelete}`)).toEqual([])
  })

  it('no owning edge the delete engine cannot act on carries onDelete', () => {
    const stray = owning.filter((s) => !s.actionable && s.onDelete !== undefined)
    expect(stray.map((s) => `${s.site}: ${s.onDelete}`)).toEqual([])
  })

  it('no belongs_to side carries onDelete', () => {
    const upward = sites.filter(
      (s) => s.relationshipType === 'belongs_to' && s.onDelete !== undefined
    )
    expect(upward.map((s) => s.site)).toEqual([])
  })

  it('no relationship constraints block still carries the retired onDeleteWithChildren', () => {
    const stale = sites.filter((s) => s.constraints && 'onDeleteWithChildren' in s.constraints)
    expect(stale.map((s) => s.site)).toEqual([])
  })
})
