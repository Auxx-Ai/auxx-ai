// packages/lib/src/seed/entity-migrations/migrations/136-refunds-and-tax-lines.test.ts
//
// Migration 136 is helper composition (defs, fields, links, chart) plus one
// hand-written step: the delete-behavior stamp. The helpers have their own
// coverage. What is pinned here is the stamp, because it reconciles two doors
// that reach the same stored shape: `buildFieldOptions` copies the registry's
// `onDelete` for a FRESH org, and the stamp copies it for an EXISTING one. If
// the two disagree, whether deleting an order cascades into its credit memos
// depends on when the org signed up (plans/relationships/01-delete-semantics.md).

import type { Database } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { RELATION_DELETE_BEHAVIORS } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import type { FieldOptions } from '../../../custom-fields'
import { BUILD_FIELDS } from '../../../resources/registry/resources/build-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { CREDIT_MEMO_FIELDS } from '../../../resources/registry/resources/credit-memo-fields'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { FIELD_REGISTRY } from '../../entity-seeder/create-fields'
import { buildFieldOptions } from '../../entity-seeder/utils'
import { fieldKey, type loadExistingState } from '../helpers'
import {
  collectDeleteBehaviorStamps,
  collectSeedOnlyRelationshipFields,
  linkSeedOnlyPairs,
  migration136RefundsAndTaxLines,
  withDeleteBehavior,
} from './136-refunds-and-tax-lines'

type OrgState = Awaited<ReturnType<typeof loadExistingState>>
type StoredField = OrgState['fields'] extends Map<string, infer V> ? V : never

/** A `db` that records every `update().set().where()` and answers nothing else. */
function recordingDb(): { db: Database; writes: { options: FieldOptions }[] } {
  const writes: { options: FieldOptions }[] = []
  const db = {
    update: () => ({
      set: (values: { options: FieldOptions }) => ({
        where: async () => {
          writes.push(values)
        },
      }),
    }),
  } as unknown as Database
  return { db, writes }
}

function storedField(
  id: string,
  entityDefinitionId: string,
  systemAttribute: string,
  options: FieldOptions
): [string, StoredField] {
  return [
    fieldKey(entityDefinitionId, systemAttribute),
    { id, entityDefinitionId, systemAttribute, options },
  ]
}

const registry = FIELD_REGISTRY

describe('migration 136 registration', () => {
  it('is registered exactly once, last, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '136-refunds-and-tax-lines')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.at(-1)).toBe('136-refunds-and-tax-lines')
    expect(migration136RefundsAndTaxLines.id).toBe('136-refunds-and-tax-lines')
  })

  it('names the stamp in its description', () => {
    expect(migration136RefundsAndTaxLines.description).toContain('onDelete')
    expect(migration136RefundsAndTaxLines.description).toContain('onDeleteWithChildren')
  })
})

describe('collectDeleteBehaviorStamps: the registry-derived stamp list', () => {
  const stamps = collectDeleteBehaviorStamps()

  it('lists every registry field that declares onDelete at either site, and nothing else', () => {
    const expected = new Map<string, string>()
    for (const [entityType, fields] of Object.entries(registry)) {
      for (const field of Object.values(fields)) {
        const onDelete = field.relationship?.onDelete ?? field.relationshipConfig?.onDelete
        if (onDelete === undefined || !field.systemAttribute) continue
        expected.set(`${entityType}:${field.systemAttribute}`, onDelete)
      }
    }
    expect(expected.size).toBeGreaterThan(50)
    expect([...stamps.entries()].sort()).toEqual([...expected.entries()].sort())
  })

  it('every stamped value is a known RELATION_DELETE_BEHAVIORS member', () => {
    for (const [key, onDelete] of stamps) {
      expect(RELATION_DELETE_BEHAVIORS, key).toContain(onDelete)
    }
  })

  it('never stamps a belongs_to side', () => {
    for (const key of stamps.keys()) {
      const [entityType, systemAttribute] = key.split(':')
      const field = Object.values(registry[entityType!] ?? {}).find(
        (f) => f.systemAttribute === systemAttribute
      )
      const type =
        field?.relationship?.relationshipType ?? field?.relationshipConfig?.relationshipType
      expect(type, key).not.toBe('belongs_to')
    }
  })

  it('covers the owning fields this migration itself creates', () => {
    expect(stamps.get('order:order_credit_memos')).toBe('cascade')
    expect(stamps.get('order:order_tax_lines')).toBe('cascade')
    expect(stamps.get('credit_memo:credit_memo_lines')).toBe('cascade')
    expect(stamps.get('credit_memo:credit_memo_applications')).toBe('cascade')
    expect(stamps.get('line_item:line_item_credit_memo_lines')).toBe('unlink')
    expect(stamps.get('contact:contact_credit_memos')).toBe('restrict')
    expect(stamps.get('invoice:invoice_credit_memos')).toBe('restrict')
    expect(stamps.get('invoice:invoice_credit_applications')).toBe('restrict')
  })

  it('covers the three relationshipConfig-only self-relations', () => {
    expect(stamps.get('build:build_reversed_by')).toBe('restrict')
    expect(stamps.get('stock_movement:stock_movement_child_movements')).toBe('cascade')
    expect(stamps.get('stock_movement:stock_movement_reversed_by_movements')).toBe('restrict')
  })
})

describe('the two doors agree: a field created by this run already carries onDelete', () => {
  // `ensureCustomFields` inserts `buildFieldOptions(field)`, so on a fresh
  // create the stamp must find nothing to do. If this breaks, the stamp still
  // repairs the row a moment later, but the seeder and the migration have
  // started to disagree and the registry test for onDelete will not see it.
  it.each([
    ['order.creditMemos', ORDER_FIELDS.creditMemos],
    ['order.taxLines', ORDER_FIELDS.taxLines],
    ['credit_memo.lines', CREDIT_MEMO_FIELDS.lines],
    ['credit_memo.applications', CREDIT_MEMO_FIELDS.applications],
    ['line_item.creditMemoLines', LINE_ITEM_FIELDS.creditMemoLines],
    ['contact.creditMemos', CONTACT_FIELDS.creditMemos],
    ['invoice.creditMemos', INVOICE_FIELDS.creditMemos],
    ['invoice.creditApplications', INVOICE_FIELDS.creditApplications],
  ])('%s', (_label, field) => {
    expect(field).toBeDefined()
    expect(field!.fieldType).toBe(FieldType.RELATIONSHIP)
    const seeded = buildFieldOptions(field!)
    expect(seeded.relationship?.onDelete).toBe(field!.relationship?.onDelete)
    expect(withDeleteBehavior(seeded, field!.relationship?.onDelete)).toBeNull()
  })
})

describe('withDeleteBehavior: the options merge', () => {
  const linked = {
    isCustom: false,
    relationship: {
      inverseResourceFieldId: 'defid:fieldid',
      relationshipType: 'has_many',
      isInverse: true,
    },
  } as FieldOptions

  it('stamps onDelete and keeps every other key, the inverse link above all', () => {
    expect(withDeleteBehavior(linked, 'cascade')).toEqual({
      isCustom: false,
      relationship: {
        inverseResourceFieldId: 'defid:fieldid',
        relationshipType: 'has_many',
        isInverse: true,
        onDelete: 'cascade',
      },
    })
  })

  it('overwrites a stored value that differs from the registry', () => {
    const stale = {
      ...linked,
      relationship: { ...linked.relationship!, onDelete: 'unlink' },
    } as FieldOptions
    expect(withDeleteBehavior(stale, 'cascade')?.relationship?.onDelete).toBe('cascade')
  })

  it('is idempotent: a row already at the registry value is unchanged', () => {
    const done = withDeleteBehavior(linked, 'cascade')
    expect(withDeleteBehavior(done, 'cascade')).toBeNull()
  })

  it('leaves a row alone when the registry declares nothing and nothing is stale', () => {
    expect(withDeleteBehavior(linked, undefined)).toBeNull()
  })

  it('strips onDeleteWithChildren, keeping the sibling constraint keys', () => {
    // The stored shape of `tag_parent` / `article_parent` in every org seeded
    // before the field was retired: a belongs_to side, so no onDelete is given.
    // Through `unknown` because the key no longer exists on the type; that is
    // the point, the row predates the type.
    const stored = {
      isCustom: false,
      relationship: {
        inverseResourceFieldId: 'defid:fieldid',
        relationshipType: 'belongs_to',
        isInverse: false,
        constraints: { maxDepth: 10, preventCircular: true, onDeleteWithChildren: 'prevent' },
      },
    } as unknown as FieldOptions
    expect(withDeleteBehavior(stored, undefined)).toEqual({
      isCustom: false,
      relationship: {
        inverseResourceFieldId: 'defid:fieldid',
        relationshipType: 'belongs_to',
        isInverse: false,
        constraints: { maxDepth: 10, preventCircular: true },
      },
    })
  })

  it('drops the constraints object outright once it is empty', () => {
    const stored = {
      relationship: {
        inverseResourceFieldId: null,
        relationshipType: 'has_many',
        isInverse: true,
        constraints: { onDeleteWithChildren: 'cascade' },
      },
    } as unknown as FieldOptions
    const next = withDeleteBehavior(stored, 'restrict')
    expect(next?.relationship).toEqual({
      inverseResourceFieldId: null,
      relationshipType: 'has_many',
      isInverse: true,
      onDelete: 'restrict',
    })
    expect(next?.relationship).not.toHaveProperty('constraints')
  })

  it('never invents a relationship block on a row that has none', () => {
    expect(withDeleteBehavior({ isCustom: false } as FieldOptions, 'cascade')).toBeNull()
    expect(withDeleteBehavior(null, 'cascade')).toBeNull()
    expect(withDeleteBehavior(undefined, 'cascade')).toBeNull()
  })

  it('does not mutate its input', () => {
    const input = {
      relationship: {
        inverseResourceFieldId: null,
        relationshipType: 'has_many',
        isInverse: true,
        constraints: { maxDepth: 3, onDeleteWithChildren: 'prevent' },
      },
    } as unknown as FieldOptions
    const snapshot = JSON.stringify(input)
    withDeleteBehavior(input, 'cascade')
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('collectSeedOnlyRelationshipFields: the pairs the seeder used to ignore', () => {
  it('is exactly the three self-relation pairs, six fields', () => {
    const keys = collectSeedOnlyRelationshipFields()
      .map(({ entityType, field }) => `${entityType}:${field.systemAttribute}`)
      .sort()
    expect(keys).toEqual([
      'build:build_reversal_of',
      'build:build_reversed_by',
      'stock_movement:stock_movement_child_movements',
      'stock_movement:stock_movement_parent_movement',
      'stock_movement:stock_movement_reversed_by_movements',
      'stock_movement:stock_movement_reverses_movement',
    ])
  })

  it('every pair names an inverse that exists on the related registry and points back', () => {
    for (const { entityType, field } of collectSeedOnlyRelationshipFields()) {
      const config = field.relationshipConfig!
      const inverse = Object.values(registry[config.relatedEntityType] ?? {}).find(
        (f) => f.systemAttribute === config.inverseSystemAttribute
      )
      expect(inverse, `${entityType}:${field.systemAttribute}`).toBeDefined()
      expect(inverse?.relationshipConfig?.inverseSystemAttribute).toBe(field.systemAttribute)
      expect(inverse?.relationshipConfig?.relatedEntityType).toBe(entityType)
    }
  })

  // The seeder half of the fix: `buildFieldOptions` now writes the block from
  // `relationshipConfig`, so a fresh org gets the same stored shape a
  // `relationship` pair gets, and the stamp finds nothing to add.
  it('buildFieldOptions writes the stored block from relationshipConfig, onDelete on the owning side only', () => {
    expect(buildFieldOptions(BUILD_FIELDS.reversedBy!).relationship).toEqual({
      inverseResourceFieldId: null,
      relationshipType: 'has_many',
      isInverse: true,
      onDelete: 'restrict',
    })
    expect(buildFieldOptions(BUILD_FIELDS.reversalOf!).relationship).toEqual({
      inverseResourceFieldId: null,
      relationshipType: 'belongs_to',
      isInverse: false,
      onDelete: undefined,
    })
    expect(withDeleteBehavior(buildFieldOptions(BUILD_FIELDS.reversedBy!), 'restrict')).toBeNull()
  })
})

describe('linkSeedOnlyPairs: the migration half, against an org seeded without the block', () => {
  const bare: FieldOptions = { isCustom: false }

  /** An org with `build` (both rows bare) and `stock_movement` (one pair bare, one already linked). */
  function orgState(): OrgState {
    const linkedParent: FieldOptions = {
      isCustom: false,
      relationship: {
        inverseResourceFieldId: toResourceFieldId('def_sm', 'f_children'),
        relationshipType: 'belongs_to',
        isInverse: false,
      },
    }
    const linkedChildren: FieldOptions = {
      isCustom: false,
      relationship: {
        inverseResourceFieldId: toResourceFieldId('def_sm', 'f_parent'),
        relationshipType: 'has_many',
        isInverse: true,
        onDelete: 'cascade',
      },
    }
    return {
      entityDefs: new Map([
        ['build', { id: 'def_build', entityType: 'build' }],
        ['stock_movement', { id: 'def_sm', entityType: 'stock_movement' }],
      ]),
      fields: new Map([
        storedField('f_reversal_of', 'def_build', 'build_reversal_of', bare),
        storedField('f_reversed_by', 'def_build', 'build_reversed_by', bare),
        storedField('f_parent', 'def_sm', 'stock_movement_parent_movement', linkedParent),
        storedField('f_children', 'def_sm', 'stock_movement_child_movements', linkedChildren),
        storedField('f_reverses', 'def_sm', 'stock_movement_reverses_movement', bare),
        storedField('f_reversed_by_m', 'def_sm', 'stock_movement_reversed_by_movements', bare),
      ]),
    }
  }

  it('links every bare row to its inverse by systemAttribute and leaves linked rows alone', async () => {
    const { db, writes } = recordingDb()
    const state = { relationshipsLinked: 0 }
    const current = orgState()

    await linkSeedOnlyPairs(db, current, state)

    expect(state.relationshipsLinked).toBe(4)
    expect(writes).toHaveLength(4)

    const reversedBy = current.fields.get(fieldKey('def_build', 'build_reversed_by'))!
    expect(reversedBy.options).toEqual({
      isCustom: false,
      relationship: {
        inverseResourceFieldId: toResourceFieldId('def_build', 'f_reversal_of'),
        relationshipType: 'has_many',
        isInverse: true,
        onDelete: 'restrict',
      },
    })
    const reversalOf = current.fields.get(fieldKey('def_build', 'build_reversal_of'))!
    expect(reversalOf.options.relationship).toMatchObject({
      inverseResourceFieldId: toResourceFieldId('def_build', 'f_reversed_by'),
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(reversalOf.options.relationship?.onDelete).toBeUndefined()

    const reversedByMovements = current.fields.get(
      fieldKey('def_sm', 'stock_movement_reversed_by_movements')
    )!
    expect(reversedByMovements.options.relationship).toMatchObject({
      inverseResourceFieldId: toResourceFieldId('def_sm', 'f_reverses'),
      onDelete: 'restrict',
    })

    // The already-linked pair keeps its inverse ids exactly as stored.
    expect(
      current.fields.get(fieldKey('def_sm', 'stock_movement_parent_movement'))!.options.relationship
        ?.inverseResourceFieldId
    ).toBe(toResourceFieldId('def_sm', 'f_children'))
  })

  it('writes the same options it keeps in memory, so the stamp that follows sees the block', async () => {
    const { db, writes } = recordingDb()
    const current = orgState()
    await linkSeedOnlyPairs(db, current, { relationshipsLinked: 0 })

    const inMemory = [...current.fields.values()]
      .filter((f) => f.systemAttribute.includes('revers'))
      .map((f) => f.options)
    expect(writes.map((w) => w.options)).toEqual(expect.arrayContaining(inMemory))

    // And the stamp is then a no-op for the owning sides.
    const stamps = collectDeleteBehaviorStamps()
    for (const field of current.fields.values()) {
      const entityType = field.entityDefinitionId === 'def_build' ? 'build' : 'stock_movement'
      const onDelete = stamps.get(`${entityType}:${field.systemAttribute}`)
      expect(withDeleteBehavior(field.options, onDelete), field.systemAttribute).toBeNull()
    }
  })

  it('is idempotent: a second run over the linked state writes nothing', async () => {
    const current = orgState()
    await linkSeedOnlyPairs(recordingDb().db, current, { relationshipsLinked: 0 })

    const { db, writes } = recordingDb()
    const state = { relationshipsLinked: 0 }
    await linkSeedOnlyPairs(db, current, state)
    expect(writes).toHaveLength(0)
    expect(state.relationshipsLinked).toBe(0)
  })

  it('skips an org short of the def, and a row whose inverse is missing', async () => {
    const { db, writes } = recordingDb()
    const state = { relationshipsLinked: 0 }
    const current: OrgState = {
      entityDefs: new Map([['build', { id: 'def_build', entityType: 'build' }]]),
      // Only one half present: nothing to point at, so nothing is written.
      fields: new Map([storedField('f_reversed_by', 'def_build', 'build_reversed_by', bare)]),
    }
    await linkSeedOnlyPairs(db, current, state)
    expect(writes).toHaveLength(0)
    expect(state.relationshipsLinked).toBe(0)
    expect(current.fields.get(fieldKey('def_build', 'build_reversed_by'))!.options).toEqual(bare)
  })
})
