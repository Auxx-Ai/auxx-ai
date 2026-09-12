// packages/lib/src/resources/registry/resources/return-part-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * The warehouse's disposition for one node of the teardown tree
 * (plans/money/tasks/54-returns.md §3.6, §6.3).
 *
 * 🛑 Only `good` writes anything to the ledger, and only at the HIGHEST `good`
 * node in each branch: marking a subassembly good and also marking its children
 * good is ONE recovery, not two.
 *
 * Every other value writes NOTHING. A scrapped component was never in inventory
 * to begin with - the lift was relieved at sale - so a `scrap` movement would
 * be inventing a quantity in order to remove it. The decision is recorded on
 * the row and stops there.
 *
 * `undecided` is also what a node with NO ROW means: rows are materialized
 * lazily as the warehouse expands the tree, so absence is the default rather
 * than an explicit row.
 */
export const RETURN_PART_LINE_STATUS_OPTIONS = [
  { label: 'Good', value: 'good', color: 'green' },
  { label: 'Damaged', value: 'damaged', color: 'amber' },
  { label: 'Scrap', value: 'scrap', color: 'red' },
  { label: 'Missing', value: 'missing', color: 'orange' },
  { label: 'Undecided', value: 'undecided', color: 'gray' },
] as const

/**
 * Field definitions for the Return Part Line resource
 * (plans/money/tasks/54-returns.md §3.6, §6.3, §6.4, §6.6, §3.7).
 *
 * ## The BOM tree, and NOTHING else
 *
 * Deliberately minimal, by explicit owner decision: *"we don't want all these
 * fields for each row, it would be just one status and the qty. All the photos,
 * notes etc would be on the return item itself."* So there is no `photos`, no
 * `notes`, no `liability` and no `inspector` here. If a specific component
 * needs a photo, it is photographed onto the parent `return_line`.
 *
 * A lift is built from subassemblies which have their own subassemblies, and
 * the tree can be deep. {@link RETURN_PART_LINE_FIELDS.parent} is
 * SELF-REFERENTIAL and is what makes it a tree.
 *
 * ## Why restocking the CHECKED node is coherent
 *
 * `completeBuild` consumes ONE level: a subassembly is produced by its own
 * build and carries its own on-hand balance. So a subassembly went DOWN when
 * the lift was built, and recovering it from a return puts it back at the same
 * level it left. An intact subassembly is worth a subassembly, not a bag of
 * leaves, and the ledger stays coherent at every depth.
 *
 * ## Rows are materialized LAZILY
 *
 * 🛑 Do not explode the whole BOM into rows when the return line is created.
 * Depth 20 times two lifts is an unbounded row count for a checklist the
 * warehouse may only open two levels of. Create the top level only and
 * materialize a node's children on first expand; the tree the user sees is
 * `loadSubpartGraph`'s in-memory map. A node with no row is `undecided` by
 * absence, and the salvage writer therefore sees only rows somebody touched.
 *
 * ## Cost is FROZEN on the row, not recomputed
 *
 * {@link RETURN_PART_LINE_FIELDS.salvagePercent} is the input and
 * {@link RETURN_PART_LINE_FIELDS.unitCost} is the output, and BOTH are stored,
 * always. `part_standard_cost` is re-rolled over time, so the percentage alone
 * cannot reproduce the number a year from now. The movement freezes the output,
 * and a correction is priced at what was frozen, never re-priced.
 */
export const RETURN_PART_LINE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique return part line identifier',
  },

  /**
   * The returned sold line this teardown belongs to. The owning side of
   * `return_line_part_lines`. Set on every row in the tree, not only on the
   * roots, so the whole checklist is one query.
   */
  returnLine: {
    id: toFieldId('returnLine'),
    key: 'returnLine',
    label: 'Return Line',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_part_line_return_line',
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
      inverseResourceFieldId: 'return_line:partLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'return_line',
      relationshipType: 'belongs_to',
      inverseName: 'Part Lines',
      inverseSystemAttribute: 'return_line_part_lines',
    },
    description:
      'The returned sold line this teardown row belongs to. Carried on every row in the ' +
      'tree, not only the roots, so the whole checklist loads in one query',
  },

  /**
   * The node above this one. SELF-REFERENTIAL: this is the tree.
   *
   * Null on a top-level row (a direct subpart of the return line's part).
   * `preventCircular` and `maxDepth` mirror the BOM loader's own
   * `MAX_BOM_DEPTH = 20` guard; the relationship picker already excludes the
   * record itself and its descendants from its own options.
   */
  parent: {
    id: toFieldId('parent'),
    key: 'parent',
    label: 'Parent',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_part_line_parent',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
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
      inverseResourceFieldId: 'return_part_line:children' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
      constraints: {
        preventCircular: true,
        maxDepth: 20,
      },
    },
    relationshipConfig: {
      relatedEntityType: 'return_part_line',
      relationshipType: 'belongs_to',
      inverseName: 'Children',
      inverseSystemAttribute: 'return_part_line_children',
    },
    description:
      'The node above this one - self-referential, and this is what makes the teardown a ' +
      'tree. Null on a top-level row. Depth is bounded at 20, matching MAX_BOM_DEPTH',
  },

  /**
   * The nodes below this one. The self-referential inverse of {@link parent}.
   *
   * `cascade`: a child node has no meaning once its parent row is gone. The
   * delete engine walking a cascade SELF-edge is the unusual case here and is
   * worth a dedicated case in the relationship-on-delete coverage test.
   */
  children: {
    id: toFieldId('children'),
    key: 'children',
    label: 'Children',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_part_line_children',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'a2a',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'return_part_line:parent' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description:
      'The nodes below this one - self-referential. Cascade, because a child node is ' +
      'meaningless without its parent row',
  },

  /** The component at this node of the tree. */
  part: {
    id: toFieldId('part'),
    key: 'part',
    label: 'Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_part_line_part',
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
      inverseResourceFieldId: 'part:returnPartLines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'part',
      relationshipType: 'belongs_to',
      inverseName: 'Return Part Lines',
      inverseSystemAttribute: 'part_return_part_lines',
    },
    description: 'The component at this node of the teardown tree',
  },

  /**
   * Units of this component at this node.
   *
   * Prefilled from the BOM as `bom quantity x the return line's quantity`: two
   * lifts back, each carrying 2 of a subassembly, prefills 4. Editable, and
   * splittable with the tree's plus button when the units diverge.
   *
   * ⚠️ A parent's quantity BOUNDS the sum of its children's. The split button
   * creates siblings and must not create more units than the parent had; the
   * writer enforces it.
   */
  quantity: {
    id: toFieldId('quantity'),
    key: 'quantity',
    label: 'Quantity',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'return_part_line_quantity',
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
      "Units at this node. Prefilled as BOM quantity times the return line's quantity, then " +
      "edited or split. A parent's quantity bounds the sum of its children's",
  },

  /**
   * The warehouse's disposition. See {@link RETURN_PART_LINE_STATUS_OPTIONS}
   * for which values move inventory (only `good`, and only at the highest
   * `good` node in a branch) and why the rest write nothing.
   */
  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'return_part_line_status',
    systemSortOrder: 'a5',
    nullable: false,
    options: { options: [...RETURN_PART_LINE_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'undecided',
    description:
      'What the warehouse decided about this node. Only good writes a movement, and only at ' +
      'the highest good node in a branch - scrap and the rest record the decision and stop',
  },

  /**
   * What this recovered unit is worth as a percentage of the part's standard
   * cost. A recovered cylinder is not worth a new cylinder, and a stored
   * percentage is the cheapest honest way to say so.
   *
   * 🛑 Standard cost, NOT the ledger average, by owner decision. An average
   * basis would gate the salvage writer on data no org has: no org holds a
   * single `initial` movement and builds are not backfilled, so most parts have
   * no average at all. It is also a policy a person has to be able to defend -
   * "60% of what this part is worth new" is a sentence a warehouse worker can
   * say, and "60% of a blended average that moved three times this week" is
   * not. Standard also remains the basis for `build_consume` and
   * `build_produce`, so this is the consistent choice rather than the odd one.
   *
   * The writer refuses `pct <= 0` (a worthless part is `scrap`, which writes
   * nothing at all, not a zero-cost movement) and `pct > 100` (salvage is never
   * worth more than new). `validation` here is a UI hint, not the guard.
   */
  salvagePercent: {
    id: toFieldId('salvagePercent'),
    key: 'salvagePercent',
    label: 'Salvage Percent',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'return_part_line_salvage_percent',
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'a6',
    nullable: true,
    options: { decimals: 0 },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    defaultValue: 100,
    validation: { min: 0, max: 100 },
    description:
      "What this recovered unit is worth as a percentage of the part's STANDARD cost. The " +
      'writer refuses 0 or less (that is scrap, which writes nothing) and more than 100',
  },

  /**
   * `round(part_standard_cost x salvagePercent / 100)`, in integer minor units,
   * FROZEN at the moment the salvage movement is written.
   *
   * Stored alongside {@link salvagePercent} rather than derived from it,
   * because `part_standard_cost` is re-rolled over time and the percentage
   * alone cannot reproduce this number later. `updatable: false`: this is the
   * output the movement carries, and a correction reverses at the frozen amount
   * rather than re-pricing.
   *
   * ⚠️ The writer refuses a part whose `part_standard_cost` is null OR ZERO,
   * naming the part, rather than freezing $0 onto an append-only ledger. That
   * refusal is deliberate asymmetry with sale relief, which warns and never
   * refuses: a refused relief loses a shipment that really happened and cannot
   * be re-derived, while a refused salvage loses nothing, because the
   * disposition is already on this row and the movement can be written the
   * moment somebody costs the part.
   */
  unitCost: {
    id: toFieldId('unitCost'),
    key: 'unitCost',
    label: 'Unit Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'return_part_line_unit_cost',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'a7',
    nullable: true,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true, // written once by the salvage writer, alongside the movement
      updatable: false,
      configurable: false,
    },
    description:
      'Standard cost times the salvage percent, rounded once in integer MINOR UNITS and ' +
      'frozen when the movement is written. A correction reverses at this amount, never at ' +
      "today's standard",
  },

  /**
   * Sibling order within one parent. A FRACTIONAL INDEX, hence TEXT rather than
   * a number: the tree's split button inserts between existing siblings, and a
   * lexicographic key does that without renumbering the rest.
   */
  sortOrder: {
    id: toFieldId('sortOrder'),
    key: 'sortOrder',
    label: 'Sort Order',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'return_part_line_sort_order',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Sibling order within one parent. A fractional index, so the split button can insert ' +
      'between two rows without renumbering anything',
  },

  /**
   * The `return_in` movement this row produced, if it produced one. Set only on
   * rows the salvage writer actually acted on, which is the highest `good` node
   * in each branch and nothing else.
   *
   * One-sided on purpose: the `stock_movement` ledger is append-only and
   * carries no field pointing back here. That also keeps this edge out of the
   * ledger's own link set.
   *
   * 🛑 A salvage movement carries NO `stock_movement_fulfillment_line`, however
   * tempting it is to record which dispatch a part came back from. That link is
   * the whole of sale relief's netting, and a stray one is a single predicate
   * away from reading as un-relief. If a salvage ever needs to name its
   * dispatch, that is a field on `return_line` - never the movement's ledger
   * link.
   *
   * ⚠️ `stock_movement_adjust_subparts` must also be FALSE on every salvage
   * movement: the BOM trigger explodes any movement carrying that flag into
   * child movements for every leaf, which would restock the subassembly AND its
   * leaves, the same material twice on an append-only ledger. It would also
   * make the row invisible to the on-hand SUM, which excludes flagged rows.
   */
  movement: {
    id: toFieldId('movement'),
    key: 'movement',
    label: 'Movement',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_part_line_movement',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'a9',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: null,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    description:
      'The return_in movement this row produced, on the rows that produced one. Nullable and ' +
      'ONE-SIDED: the append-only ledger carries no field pointing back here',
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
    description: 'Automatically set when the return part line is created',
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
    description: 'Automatically updated when the return part line is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
