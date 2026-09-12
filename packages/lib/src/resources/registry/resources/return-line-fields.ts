// packages/lib/src/resources/registry/resources/return-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * What condition the returned units came back in
 * (plans/money/tasks/54-returns.md §3.5).
 *
 * The grade is the INSPECTOR's verdict on the whole of this line, which is why
 * divergent conditions are two `return_line` rows rather than one row with a
 * hedged grade. It is deliberately about the goods, not about fault: fault is
 * {@link RETURN_LINE_LIABILITY_OPTIONS}, and the two answers come apart all the
 * time (a `damaged_scrap` unit can still be `no_fault`).
 */
export const RETURN_LINE_CONDITION_GRADE_OPTIONS = [
  { label: 'New, sealed', value: 'new_sealed', color: 'green' },
  { label: 'New, open box', value: 'new_open_box', color: 'teal' },
  { label: 'Used, resalable', value: 'used_resalable', color: 'blue' },
  { label: 'Damaged, repairable', value: 'damaged_repairable', color: 'amber' },
  { label: 'Damaged, scrap', value: 'damaged_scrap', color: 'red' },
] as const

/**
 * WHOSE fault the condition is (plans/money/tasks/54-returns.md §3.5).
 *
 * 🔑 This is the field the chargeback turns on, and no external system carries
 * it. Shopify's `ReturnReason` has no value for "the customer damaged it during
 * installation", which is the exact fact Auxx-Lift has to prove when a lift is
 * wrecked on site, a full refund is demanded, refused, and a chargeback filed.
 *
 * `undetermined` is a real answer and the honest default before inspection.
 * `no_fault` means nothing was wrong with the goods at all - an unwanted or
 * mis-ordered item.
 */
export const RETURN_LINE_LIABILITY_OPTIONS = [
  { label: 'Customer damage', value: 'customer_damage', color: 'red' },
  { label: 'Shipping damage', value: 'shipping_damage', color: 'orange' },
  { label: 'Manufacturing defect', value: 'manufacturing_defect', color: 'purple' },
  { label: 'Wear and tear', value: 'wear_and_tear', color: 'amber' },
  { label: 'No fault', value: 'no_fault', color: 'blue' },
  { label: 'Undetermined', value: 'undetermined', color: 'gray' },
] as const

/**
 * Field definitions for the Return Line resource
 * (plans/money/tasks/54-returns.md §3.5, §3.7).
 *
 * ## The grain: one per SOLD LINE returned, PER CONDITION
 *
 * The customer buys 2 lifts, the channel carries ONE line item with quantity 2,
 * and they send 1 or 2 back. Either way that is one `return_line` against that
 * sold line carrying the returned {@link RETURN_LINE_FIELDS.quantity} - NOT one
 * row per physical unit.
 *
 * The one thing that splits a line is DIVERGENT CONDITION. Two lifts back, one
 * pristine and one wrecked, are two rows of quantity 1, each with its own
 * grade, liability verdict, notes, photos and part tree. So several rows may
 * point at the same `line_item`, exactly as `credit_memo_line` already does
 * when one sold line is credited in pieces.
 *
 * ## This is the evidence anchor
 *
 * Everything a chargeback rebuttal reads hangs here: the condition, whose fault
 * it was, the inspector, when they looked, and the timestamped photos.
 * Inspection findings are FIELDS on this row rather than a separate
 * `return_inspection` definition, by owner decision - a re-inspection
 * overwrites. If side-by-side findings are ever needed that is a new
 * definition, and nothing here blocks it.
 *
 * ## 🛑 The guard this needs, which is not a field
 *
 * Σ {@link RETURN_LINE_FIELDS.quantity} across every `return_line` pointing at
 * a given `line_item`, across ALL returns, must not exceed what that line
 * actually SHIPPED. Without it a customer can return three of two lifts and the
 * salvage tree will happily restock parts for a unit that never left. The
 * ceiling is Σ `fulfillment_line_quantity` over the line's fulfillment lines
 * (excluding `cancelled` ones), falling back to sold quantity when the line has
 * no fulfillment lines at all. It belongs in a pre-write hook, not in the UI.
 *
 * ⤵️ There is deliberately NO `fulfillmentLine` relationship here. The guard
 * reads the fulfillment lines off the `line_item` and the evidence pack reaches
 * the dispatch through the order, so nothing needs the return to name which
 * dispatch a unit came back from, and an unused relationship goes stale.
 */
export const RETURN_LINE_FIELDS: Record<string, ResourceField> = {
  id: {
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'id',
    systemSortOrder: 'a0',
    showInPanel: false,
    dbColumn: 'id',
    nullable: false,
    isIdentifier: true,
    operatorOverrides: ['is', 'is not', 'in', 'not in'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique return line identifier',
  },

  /** The return this line belongs to. The owning side of `return_lines`. */
  return: {
    id: toFieldId('return'),
    key: 'return',
    label: 'Return',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_line_return',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'a1',
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'return:lines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'return',
      relationshipType: 'belongs_to',
      inverseName: 'Lines',
      inverseSystemAttribute: 'return_lines',
    },
    description: 'The return this line belongs to',
  },

  /**
   * The sold line being returned. NULLABLE: a manually keyed return has no
   * order at all, which is the ordinary case for a dock surprise, and the
   * record has to exist before anyone matches it.
   */
  lineItem: {
    id: toFieldId('lineItem'),
    key: 'lineItem',
    label: 'Line Item',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_line_line_item',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'line_item:returnLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'line_item',
      relationshipType: 'belongs_to',
      inverseName: 'Return Lines',
      inverseSystemAttribute: 'line_item_return_lines',
    },
    description:
      'The sold line these units came off - nullable, because a manually keyed return may ' +
      'have no order. Several return lines may point at one line item when the units came ' +
      'back in different conditions',
  },

  /**
   * What came back. Denormalized off the sold line so a return with no order
   * still names a part, and it is the BOM ROOT the salvage tree is loaded from.
   */
  part: {
    id: toFieldId('part'),
    key: 'part',
    label: 'Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_line_part',
    systemSortOrder: 'a3',
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'part:returnLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'part',
      relationshipType: 'belongs_to',
      inverseName: 'Return Lines',
      inverseSystemAttribute: 'part_return_lines',
    },
    description:
      'What came back. Required and denormalized off the sold line, because a return with no ' +
      'order still has to name a part - and this is the BOM root the salvage tree loads from',
  },

  /**
   * Units returned on this line, bounded by what the sold line SHIPPED. See the
   * module docblock for the cross-return guard, which is a pre-write hook
   * rather than anything expressible here.
   */
  quantity: {
    id: toFieldId('quantity'),
    key: 'quantity',
    label: 'Quantity',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'return_line_quantity',
    systemSortOrder: 'a4',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: 1,
    validation: { min: 0 },
    description:
      'Units returned on this line. Bounded across ALL returns by what the sold line shipped, ' +
      'not by what it sold',
  },

  customerReason: {
    id: toFieldId('customerReason'),
    key: 'customerReason',
    label: 'Customer Reason',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'return_line_customer_reason',
    showInTable: false,
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: "The customer's stated reason",
    description:
      "The customer's own words for why this came back, kept verbatim beside the return's " +
      'normalized reason tags. Their claim is evidence; our classification is not',
  },

  customerNote: {
    id: toFieldId('customerNote'),
    key: 'customerNote',
    label: 'Customer Note',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'return_line_customer_note',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'a6',
    nullable: true,
    options: { multiline: true, rows: 3 },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Anything else the customer said',
    description: 'Anything further the customer said about this line, in their words',
  },

  /**
   * The inspector's verdict on the goods. See
   * {@link RETURN_LINE_CONDITION_GRADE_OPTIONS}. Null until somebody inspects,
   * which is routinely weeks after the refund cleared.
   */
  conditionGrade: {
    id: toFieldId('conditionGrade'),
    key: 'conditionGrade',
    label: 'Condition Grade',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'return_line_condition_grade',
    systemSortOrder: 'a7',
    nullable: true,
    options: { options: [...RETURN_LINE_CONDITION_GRADE_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select condition',
    description:
      'What condition the units came back in. One grade per line, which is why units that ' +
      'came back differently are separate lines. Null until inspection',
  },

  /**
   * Whose fault the condition is. See {@link RETURN_LINE_LIABILITY_OPTIONS}.
   * Independent of {@link conditionGrade} on purpose: a scrapped unit can still
   * be `no_fault`, and a pristine one can still be `customer_damage` on a part
   * the customer already swapped out.
   */
  liability: {
    id: toFieldId('liability'),
    key: 'liability',
    label: 'Liability',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'return_line_liability',
    systemSortOrder: 'a8',
    nullable: true,
    options: { options: [...RETURN_LINE_LIABILITY_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select liability',
    description:
      'Whose fault the condition is - the fact a chargeback turns on, and one no sales ' +
      'channel carries. Independent of the condition grade',
  },

  inspectionNotes: {
    id: toFieldId('inspectionNotes'),
    key: 'inspectionNotes',
    label: 'Inspection Notes',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'return_line_inspection_notes',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'a9',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'What the inspection found',
    description:
      'What the inspection found. A re-inspection OVERWRITES this - findings are fields on ' +
      'this row, not a separate inspection record',
  },

  inspectedBy: {
    id: toFieldId('inspectedBy'),
    key: 'inspectedBy',
    label: 'Inspected By',
    type: BaseType.ACTOR,
    fieldType: FieldType.ACTOR,
    isSystem: true,
    systemAttribute: 'return_line_inspected_by',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aA',
    dynamicOptionsKey: 'teamMembers',
    nullable: true,
    options: { actor: { target: 'user', multiple: false } },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Who inspected these units. Named in the evidence pack',
  },

  inspectedAt: {
    id: toFieldId('inspectedAt'),
    key: 'inspectedAt',
    label: 'Inspected At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'return_line_inspected_at',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aB',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'When these units were inspected. Per line rather than per return, because a pallet is ' +
      'routinely opened one item at a time over several days',
  },

  /**
   * The damage evidence. IMAGES ONLY, unlike the return's own photos: this is
   * the timestamped proof of condition that a card network reads, and a PDF
   * does not belong in it. If one component needs a photo it is photographed
   * here, onto the parent line - `return_part_line` deliberately carries none.
   */
  photos: {
    id: toFieldId('photos'),
    key: 'photos',
    label: 'Photos',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'return_line_photos',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aC',
    nullable: true,
    options: {
      file: { allowMultiple: true, maxFiles: 25, allowedFileTypes: ['image'] },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Timestamped condition photos for these units. Every component photo lands here too - ' +
      'the part lines carry no files of their own',
  },

  /**
   * The teardown checklist: the BOM tree the warehouse works through.
   *
   * `cascade` because a part line is an owned child with no meaning away from
   * its return line. The has_many side declares the behavior; the `belongs_to`
   * on `return_part_line` declares nothing.
   *
   * ⚠️ Rows are materialized LAZILY, top level first and children on expand.
   * Depth 20 times two lifts is an unbounded row count for a checklist somebody
   * may only open two levels of, so a node with no row is `undecided` by
   * absence and the salvage writer sees only rows a person actually touched.
   */
  partLines: {
    id: toFieldId('partLines'),
    key: 'partLines',
    label: 'Part Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_line_part_lines',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aD',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'return_part_line:returnLine' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description:
      'The teardown checklist under this line - the BOM tree, materialized lazily as the ' +
      'warehouse works down it',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'b0',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the return line is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'b1',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the return line is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
