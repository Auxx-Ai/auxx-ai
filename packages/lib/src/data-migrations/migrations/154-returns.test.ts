// packages/lib/src/data-migrations/migrations/154-returns.test.ts
//
// Migration 154 creates three defs at once and hangs SEVEN new halves off six
// defs that already exist. What actually goes wrong here:
//
//  - a relationship half that never gets linked. The migration is the only
//    thing that reaches an existing org, and `linkNewRelationships` skips an
//    unresolvable inverse with nothing louder than a debug line, so the field
//    exists, accepts writes, and the other side reads empty forever (135's
//    lesson, carried by 149 and 153);
//  - `return_part_line.parent` is SELF-REFERENTIAL, which is the one edge
//    shape no earlier migration in this directory has had to link;
//  - `return_part_line.movement` is one-sided on purpose and must never enter
//    a "must be linked" assertion list;
//  - the seeded option sets. `ensureCustomFields` NEVER updates an existing
//    field's options, so `return.origin` (CLOSED) and `return.reason` (TAGS
//    seeds) reach an org exactly once, at creation. Getting either list wrong
//    here costs another migration, so both are pinned value-for-value;
//  - a new entity type is a hand-edit across several files, and a type present
//    in one registry and missing from its sibling silently seeds a zero-field
//    def (149's and 153's tests pin the same checklist).

import { ENTITY_DEFINITION_TYPES } from '@auxx/types/resource'
import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from '../../resources/registry/field-registry'
import { CONTACT_FIELDS } from '../../resources/registry/resources/contact-fields'
import { CREDIT_MEMO_FIELDS } from '../../resources/registry/resources/credit-memo-fields'
import { LINE_ITEM_FIELDS } from '../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../resources/registry/resources/order-fields'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import {
  RETURN_FIELDS,
  RETURN_ORIGIN_OPTIONS,
  RETURN_REASON_SEED_OPTIONS,
  RETURN_STATUS_OPTIONS,
} from '../../resources/registry/resources/return-fields'
import { RETURN_LINE_FIELDS } from '../../resources/registry/resources/return-line-fields'
import {
  RETURN_PART_LINE_FIELDS,
  RETURN_PART_LINE_STATUS_OPTIONS,
} from '../../resources/registry/resources/return-part-line-fields'
import { TICKET_FIELDS } from '../../resources/registry/resources/ticket-fields'
import { SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import { FIELD_REGISTRY } from '../../seed/entity-seeder/create-fields'
import { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } from '../registry'
import { migration154Returns } from './154-returns'

const MIGRATION_ID = '154-returns'

describe('migration 154 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is the only migration claiming the number 154', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '154')).toHaveLength(1)
  })

  it('exports the migration it registers', () => {
    expect(PER_ORG_MIGRATIONS).toContain(migration154Returns)
  })

  it('reaches the shared data-migration registry without an entry of its own, sorted by id', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe.each([
  ['return', RETURN_FIELDS],
  ['return_line', RETURN_LINE_FIELDS],
  ['return_part_line', RETURN_PART_LINE_FIELDS],
] as const)('%s is registered everywhere a new def has to be', (type, fields) => {
  it('is an EntityDefinitionType, so a <type>:<id> RecordId canonicalizes', () => {
    expect(ENTITY_DEFINITION_TYPES).toContain(type)
  })

  it('resolves the SAME field map in both registries used by the two seeders', () => {
    // Object identity: `createAllFields` iterates FIELD_REGISTRY while
    // `createEntityDefinitions` iterates SYSTEM_ENTITIES, so a type in the
    // second and not the first lands on a new org as a definition with ZERO
    // fields, and UnifiedCrudHandler silently drops every value.
    expect(RESOURCE_FIELD_REGISTRY[type]).toBe(fields)
    expect(FIELD_REGISTRY[type]).toBe(fields)
  })

  it('every field carries a systemAttribute in the shared union, and every sort order is distinct', () => {
    const orders: string[] = []
    for (const field of Object.values(fields)) {
      expect(SYSTEM_ATTRIBUTES).toContain(field.systemAttribute)
      if (typeof field.systemSortOrder === 'string') orders.push(field.systemSortOrder)
    }
    expect(new Set(orders).size).toBe(orders.length)
  })
})

describe('the SYSTEM_ENTITIES rows the migration copies verbatim', () => {
  // The migration filters SYSTEM_ENTITIES rather than restating any of this,
  // so a fresh org and a migrated org get byte-identical definitions. These
  // assertions pin the rows themselves.
  it('ships return VISIBLE, on the returns slug', () => {
    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === 'return')
    expect(entity).toMatchObject({
      entityType: 'return',
      apiSlug: 'returns',
      singular: 'Return',
      plural: 'Returns',
      icon: 'package-x',
      color: 'orange',
      isVisible: true,
    })
  })

  it('ships both child defs HIDDEN, managed from their parent', () => {
    const line = SYSTEM_ENTITIES.find((e) => e.entityType === 'return_line')
    const partLine = SYSTEM_ENTITIES.find((e) => e.entityType === 'return_part_line')
    expect(line).toMatchObject({ apiSlug: 'return-lines', isVisible: false, color: 'orange' })
    expect(partLine).toMatchObject({
      apiSlug: 'return-part-lines',
      isVisible: false,
      color: 'orange',
    })
  })

  it('gives each of the three a distinct apiSlug', () => {
    const slugs = SYSTEM_ENTITIES.filter((e) => e.entityType.startsWith('return')).map(
      (e) => e.apiSlug
    )
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe('the seeded option sets, which reach an org exactly ONCE', () => {
  // 🛑 `ensureCustomFields` never updates an existing field's options. Adding
  // a value after this migration ships needs its own migration, so both lists
  // are pinned value-for-value here rather than merely "non-empty".
  it('seeds return.origin with the four CLOSED values and nothing else', () => {
    expect(RETURN_ORIGIN_OPTIONS.map((o) => o.value)).toEqual(['email', 'phone', 'dock', 'web'])
    expect(RETURN_FIELDS.origin?.fieldType).toBe('SINGLE_SELECT')
    expect(RETURN_FIELDS.origin?.options?.options).toEqual([...RETURN_ORIGIN_OPTIONS])
    // Not TAGS, on purpose: a return has exactly one origin, and a multi-value
    // field would permit one that arrived by both email and dock.
    expect(RETURN_FIELDS.origin?.capabilities?.configurable).toBe(false)
  })

  it('seeds return.reason with the seven TAGS values, and no "other"', () => {
    expect(RETURN_REASON_SEED_OPTIONS.map((o) => o.value)).toEqual([
      'not_needed',
      'ordered_wrong',
      'arrived_damaged',
      'damaged_by_customer',
      'defective',
      'wrong_item',
      'warranty',
    ])
    expect(RETURN_FIELDS.reason?.fieldType).toBe('TAGS')
    expect(RETURN_FIELDS.reason?.options?.options).toEqual([...RETURN_REASON_SEED_OPTIONS])
  })

  it('keeps the two damage answers the business fights about distinct', () => {
    const values = RETURN_REASON_SEED_OPTIONS.map((o) => o.value)
    expect(values).toContain('arrived_damaged')
    expect(values).toContain('damaged_by_customer')
  })

  it('carries the PHYSICAL lifecycle only - no resolved, and no money value', () => {
    expect(RETURN_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      'requested',
      'approved',
      'in_transit',
      'received',
      'inspected',
      'closed',
      'declined',
      'cancelled',
    ])
    expect(RETURN_FIELDS.status?.nullable).toBe(false)
    expect(RETURN_FIELDS.status?.defaultValue).toBe('requested')
  })

  it('gives every seeded value a label and a colour, on all four sets', () => {
    for (const set of [
      RETURN_STATUS_OPTIONS,
      RETURN_ORIGIN_OPTIONS,
      RETURN_REASON_SEED_OPTIONS,
      RETURN_PART_LINE_STATUS_OPTIONS,
    ]) {
      for (const item of set) {
        expect(item.label).toBeTruthy()
        expect(item.color).toBeTruthy()
      }
      expect(new Set(set.map((o) => o.value)).size).toBe(set.length)
    }
  })
})

describe('return.contact is nullable, and that is load-bearing', () => {
  it('leaves contact and order both optional', () => {
    // The 15% case: a pallet on the dock with no RMA, no email and no call.
    // The record has to exist before anyone knows whose it is.
    expect(RETURN_FIELDS.contact?.nullable).toBe(true)
    expect(RETURN_FIELDS.contact?.capabilities?.required).toBeUndefined()
    expect(RETURN_FIELDS.order?.nullable).toBe(true)
  })

  it('carries the raw label fields the dock types instead', () => {
    expect(RETURN_FIELDS.senderNameRaw?.fieldType).toBe('TEXT')
    expect(RETURN_FIELDS.senderAddressRaw?.fieldType).toBe('TEXT')
  })

  it('has no status value standing in for "unidentified"', () => {
    expect(RETURN_STATUS_OPTIONS.map((o) => o.value)).not.toContain('unidentified')
  })
})

describe('the relationship edges this migration must link', () => {
  it('links the three parties a return points at, each with its own onDelete', () => {
    expect(RETURN_FIELDS.contact?.relationship?.inverseResourceFieldId).toBe('contact:returns')
    expect(CONTACT_FIELDS.returns?.relationship).toMatchObject({
      inverseResourceFieldId: 'return:contact',
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    })

    expect(RETURN_FIELDS.order?.relationship?.inverseResourceFieldId).toBe('order:returns')
    expect(ORDER_FIELDS.returns?.relationship).toMatchObject({
      inverseResourceFieldId: 'return:order',
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    })

    expect(RETURN_FIELDS.ticket?.relationship?.inverseResourceFieldId).toBe('ticket:returns')
    expect(TICKET_FIELDS.returns?.relationship).toMatchObject({
      inverseResourceFieldId: 'return:ticket',
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    })
  })

  it('never declares onDelete on a belongs_to - the has_many side owns that answer', () => {
    for (const field of [
      RETURN_FIELDS.contact,
      RETURN_FIELDS.order,
      RETURN_FIELDS.ticket,
      RETURN_LINE_FIELDS.return,
      RETURN_LINE_FIELDS.lineItem,
      RETURN_LINE_FIELDS.part,
      RETURN_PART_LINE_FIELDS.returnLine,
      RETURN_PART_LINE_FIELDS.parent,
      RETURN_PART_LINE_FIELDS.part,
      CREDIT_MEMO_FIELDS.return,
    ]) {
      expect(field?.relationship?.relationshipType).toBe('belongs_to')
      expect(field?.relationship?.onDelete).toBeUndefined()
    }
  })

  it('cascades return.lines into return_line, and links the inverse', () => {
    expect(RETURN_FIELDS.lines?.relationship).toMatchObject({
      inverseResourceFieldId: 'return_line:return',
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    })
    expect(RETURN_LINE_FIELDS.return?.relationship?.inverseResourceFieldId).toBe('return:lines')
    expect(RETURN_LINE_FIELDS.return?.nullable).toBe(false)
  })

  it('unlinks line_item.returnLines and restricts part.returnLines', () => {
    // Deleting a sold line must not delete the returns against it; deleting a
    // PART that a return line names must be refused outright.
    expect(LINE_ITEM_FIELDS.returnLines?.relationship).toMatchObject({
      inverseResourceFieldId: 'return_line:lineItem',
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    })
    expect(RETURN_LINE_FIELDS.lineItem?.relationship?.inverseResourceFieldId).toBe(
      'line_item:returnLines'
    )
    expect(RETURN_LINE_FIELDS.lineItem?.nullable).toBe(true)

    expect(PART_FIELDS.returnLines?.relationship).toMatchObject({
      inverseResourceFieldId: 'return_line:part',
      relationshipType: 'has_many',
      onDelete: 'restrict',
      isInverse: true,
    })
    expect(RETURN_LINE_FIELDS.part?.relationship?.inverseResourceFieldId).toBe('part:returnLines')
    expect(RETURN_LINE_FIELDS.part?.nullable).toBe(false)
  })

  it('cascades return_line.partLines into the teardown tree', () => {
    expect(RETURN_LINE_FIELDS.partLines?.relationship).toMatchObject({
      inverseResourceFieldId: 'return_part_line:returnLine',
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    })
    expect(RETURN_PART_LINE_FIELDS.returnLine?.relationship?.inverseResourceFieldId).toBe(
      'return_line:partLines'
    )
    expect(RETURN_PART_LINE_FIELDS.returnLine?.nullable).toBe(false)
  })

  it('restricts part.returnPartLines, so a salvaged part cannot be deleted out from under it', () => {
    expect(PART_FIELDS.returnPartLines?.relationship).toMatchObject({
      inverseResourceFieldId: 'return_part_line:part',
      relationshipType: 'has_many',
      onDelete: 'restrict',
      isInverse: true,
    })
    expect(RETURN_PART_LINE_FIELDS.part?.relationship?.inverseResourceFieldId).toBe(
      'part:returnPartLines'
    )
  })

  it('puts the credit memo FK on the MEMO, not on the return', () => {
    // A memo very often has no return at all, and on the channel path the
    // connector creates the memo BEFORE anyone records the return. This is the
    // only direction that works.
    expect(CREDIT_MEMO_FIELDS.return?.relationship?.inverseResourceFieldId).toBe(
      'return:creditMemos'
    )
    expect(CREDIT_MEMO_FIELDS.return?.nullable).toBe(true)
    expect(RETURN_FIELDS.creditMemos?.relationship).toMatchObject({
      inverseResourceFieldId: 'credit_memo:return',
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    })
  })
})

describe('return_part_line.parent is self-referential', () => {
  it('points both halves at its own def', () => {
    expect(RETURN_PART_LINE_FIELDS.parent?.relationship).toMatchObject({
      inverseResourceFieldId: 'return_part_line:children',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(RETURN_PART_LINE_FIELDS.children?.relationship).toMatchObject({
      inverseResourceFieldId: 'return_part_line:parent',
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    })
  })

  it('is nullable on the parent side - a top-level row has none', () => {
    expect(RETURN_PART_LINE_FIELDS.parent?.nullable).toBe(true)
  })

  it('bounds depth and refuses a cycle, matching MAX_BOM_DEPTH', () => {
    expect(RETURN_PART_LINE_FIELDS.parent?.relationship?.constraints).toMatchObject({
      preventCircular: true,
      maxDepth: 20,
    })
  })

  it('keeps the two halves on distinct sort orders, so neither overwrites the other', () => {
    expect(RETURN_PART_LINE_FIELDS.parent?.systemSortOrder).not.toBe(
      RETURN_PART_LINE_FIELDS.children?.systemSortOrder
    )
  })
})

describe('return_part_line.movement is one-sided on purpose', () => {
  it('declares a null inverse, so linkNewRelationships skips it', () => {
    // The append-only ledger carries no field pointing back at a salvage row.
    // This edge must never appear in a "must be linked" assertion list.
    expect(RETURN_PART_LINE_FIELDS.movement?.relationship?.relationshipType).toBe('belongs_to')
    expect(RETURN_PART_LINE_FIELDS.movement?.relationship?.inverseResourceFieldId).toBeNull()
    expect(RETURN_PART_LINE_FIELDS.movement?.relationship?.onDelete).toBeUndefined()
    expect(RETURN_PART_LINE_FIELDS.movement?.relationshipConfig).toBeUndefined()
    expect(RETURN_PART_LINE_FIELDS.movement?.nullable).toBe(true)
  })
})

describe('the fields the migration must not let a human write', () => {
  it('keeps the RMA number hook-only', () => {
    expect(RETURN_FIELDS.number?.capabilities).toMatchObject({
      creatable: false,
      updatable: false,
    })
  })

  it('keeps both derived money amounts un-typeable', () => {
    expect(RETURN_FIELDS.creditedAmount?.capabilities).toMatchObject({
      creatable: false,
      updatable: false,
    })
    expect(RETURN_FIELDS.withheldAmount?.capabilities).toMatchObject({
      creatable: false,
      updatable: false,
    })
  })

  it('keeps the evidence pack generator-only and hidden', () => {
    expect(RETURN_FIELDS.evidencePackAsset?.capabilities).toMatchObject({
      creatable: false,
      updatable: false,
      hidden: true,
    })
  })

  it('freezes return_part_line.unitCost after it is written once', () => {
    expect(RETURN_PART_LINE_FIELDS.unitCost?.capabilities).toMatchObject({
      creatable: true,
      updatable: false,
    })
  })
})

describe('the photo fields land on return and return_line, never on the tree', () => {
  it('takes documents as well as images on the return itself', () => {
    expect(RETURN_FIELDS.photos?.options?.file).toMatchObject({
      allowMultiple: true,
      maxFiles: 25,
      allowedFileTypes: ['document', 'image'],
    })
  })

  it('takes images only on the evidence anchor', () => {
    expect(RETURN_LINE_FIELDS.photos?.options?.file).toMatchObject({
      allowMultiple: true,
      maxFiles: 25,
      allowedFileTypes: ['image'],
    })
  })

  it('gives return_part_line no files, no notes and no inspector', () => {
    for (const key of ['photos', 'inspectionNotes', 'inspectedBy', 'liability', 'customerNote']) {
      expect(RETURN_PART_LINE_FIELDS[key]).toBeUndefined()
    }
  })
})
