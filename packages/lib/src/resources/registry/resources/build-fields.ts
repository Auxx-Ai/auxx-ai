// packages/lib/src/resources/registry/resources/build-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { BuildSource, BuildStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Build resource — the event that turns components
 * into a finished good and writes down what it cost
 * (plans/products/build/01-build-plan.md §1.1).
 *
 * The system has a costing calculator and no cost HISTORY. `part_cost` is a
 * live mirror: a vendor raising the motor price in March silently restates
 * January's COGS, because not one link in the chain is frozen. A build is what
 * finally freezes one — it stamps each consumed component's
 * `part_standard_cost` onto an append-only `stock_movement` row that is never
 * recomputed.
 *
 * ## The three properties that make the rest of this file read correctly
 *
 * **A `planned` build writes no movements** (README B2). `completeBuild` is the
 * only function that writes, and it is gated on a real standard cost. That is
 * why this entity, its UI and the auto-build trigger can all ship and be used
 * before `part_standard_cost` has a writer — nothing can produce a wrong number
 * early.
 *
 * **A completed build is never edited or deleted — it is reversed** (B6) by a
 * second build with sign-negated movements carrying the ORIGINAL's frozen
 * costs. That is what `reversalOf` / `reversedBy` are for, and it is why every
 * cost field here is `updatable: false`.
 *
 * **Scrapped units consume material and produce nothing** (B7). Their cost
 * falls out in `varianceAmount` rather than being absorbed into the surviving
 * units, because absorbing it would give the same variant a different unit cost
 * on every run and destroy the point of a standard.
 *
 * Money is stored in **integer minor units** (`materialCost`, `laborCost`,
 * `overheadCost`, `producedValue`, `varianceAmount`).
 *
 * ⚠️ Ships INERT with entity migration 109 (`isVisible: false`, B10): the def
 * and every field below exist in each org and NOTHING writes them until
 * `packages/lib/src/builds/` lands. A def with zero rows can be reshaped for
 * free; the first row ends that.
 *
 * ## Visibility
 *
 * Declared at creation time on purpose (§1.6). `showInDialogs` on a
 * materialized field lives in the `options` JSONB written when the field is
 * created, so getting it wrong here costs a second migration — there are
 * already two in the tree that exist only to do that. Exactly four fields reach
 * the create dialog: `number`, `part`, `quantityPlanned`, `notes`, which is the
 * whole of what raising a build should ask for.
 */
export const BUILD_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique build identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'build_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      // RecordSequence-issued, the `order` / `purchase_order` precedent — the
      // hook is the ONLY writer. It seeds the QuickBooks `DocNumber` later.
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Auto-generated build number — RecordSequence scope `build`, prefix `B`',
  },

  part: {
    id: toFieldId('part'),
    key: 'part',
    label: 'Part',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'build_part',
    systemSortOrder: 'a2',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      // Not updatable: the finished good is what the whole costing run is
      // computed against, so changing it after the fact would leave the frozen
      // movements pointing at a different part than the build claims.
      updatable: false,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'part:builds' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'part',
      relationshipType: 'belongs_to',
      inverseName: 'Builds',
      inverseSystemAttribute: 'part_builds',
    },
    placeholder: 'Select part',
    description: 'The finished good this build produces',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'build_status',
    systemSortOrder: 'a3',
    nullable: true,
    // `createBuild` always starts at `planned` (B2) — the same reason
    // `work_order_status` is hidden from the new-job dialog.
    showInDialogs: false,
    options: { options: BuildStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'planned',
    description: 'Where the build sits — planned, in progress, completed or canceled',
  },

  quantityPlanned: {
    id: toFieldId('quantityPlanned'),
    key: 'quantityPlanned',
    label: 'Quantity Planned',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'build_quantity_planned',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter quantity to build',
    description: 'How many units this run intends to produce',
  },

  quantityProduced: {
    id: toFieldId('quantityProduced'),
    key: 'quantityProduced',
    label: 'Quantity Produced',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'build_quantity_produced',
    systemSortOrder: 'a5',
    nullable: true,
    showInDialogs: false, // set by the completion form, not at creation
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description: 'Good units that entered finished goods — the quantity of the produce movement',
  },

  quantityScrapped: {
    id: toFieldId('quantityScrapped'),
    key: 'quantityScrapped',
    label: 'Quantity Scrapped',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'build_quantity_scrapped',
    systemSortOrder: 'a6',
    nullable: true,
    showInDialogs: false, // set by the completion form, not at creation
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description:
      'Units started but lost (B7). They consume material and produce NO movement — their ' +
      'cost falls out in varianceAmount rather than being absorbed into the survivors',
  },

  startedAt: {
    id: toFieldId('startedAt'),
    key: 'startedAt',
    label: 'Started',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'build_started_at',
    systemSortOrder: 'a7',
    nullable: true,
    showInDialogs: false, // stamped by `startBuild`
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description: 'When the run moved to in progress',
  },

  completedAt: {
    id: toFieldId('completedAt'),
    key: 'completedAt',
    label: 'Completed',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'build_completed_at',
    systemSortOrder: 'a8',
    nullable: true,
    showInDialogs: false, // stamped by `completeBuild`
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description:
      'THE accounting date — what every movement this build writes carries as its occurredAt, ' +
      'and therefore which period the cost lands in',
  },

  materialCost: {
    id: toFieldId('materialCost'),
    key: 'materialCost',
    label: 'Material Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'build_material_cost',
    systemSortOrder: 'a9',
    nullable: true,
    showInDialogs: false, // computed at completion
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'Sum of the consumed rows extended standard cost, integer minor units — written by ' +
      'completeBuild and never recomputed',
  },

  laborCost: {
    id: toFieldId('laborCost'),
    key: 'laborCost',
    label: 'Labor Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'build_labor_cost',
    systemSortOrder: 'aA',
    nullable: true,
    showInDialogs: false, // computed at completion
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'Absorbed direct labour for this run, integer minor units — the org rate ' +
      '`manufacturing.assemblyLaborCostPerUnit` applied to the units started',
  },

  overheadCost: {
    id: toFieldId('overheadCost'),
    key: 'overheadCost',
    label: 'Overhead Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'build_overhead_cost',
    systemSortOrder: 'aB',
    nullable: true,
    showInDialogs: false, // computed at completion
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'Applied overhead for this run, integer minor units — the org rate ' +
      '`manufacturing.overheadCostPerUnit` applied to the units started',
  },

  producedValue: {
    id: toFieldId('producedValue'),
    key: 'producedValue',
    label: 'Produced Value',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'build_produced_value',
    systemSortOrder: 'aC',
    nullable: true,
    showInDialogs: false, // computed at completion
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    description:
      'quantityProduced x the finished goods frozen part_standard_cost — what actually ' +
      'entered inventory, integer minor units',
  },

  varianceAmount: {
    id: toFieldId('varianceAmount'),
    key: 'varianceAmount',
    label: 'Variance',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'build_variance_amount',
    systemSortOrder: 'aD',
    nullable: true,
    showInDialogs: false, // computed at completion
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      computed: true,
      configurable: false,
    },
    // Stays in the panel, unlike the part's five cost rows: the variance is the
    // number a person actually reads on a build.
    description:
      '(material + labor + overhead) - producedValue, integer minor units. Account 5090. ' +
      'This is what scrap and yield loss show up as — it is meaningless the moment a ' +
      'structural roll-up error is booked to it (README B11)',
  },

  order: {
    id: toFieldId('order'),
    key: 'order',
    label: 'Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'build_order',
    systemSortOrder: 'aE',
    nullable: true,
    // Real provenance — WHICH order caused this build. Set by the trigger
    // (plans/products/12 §5.3), never picked out of a create dialog.
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'order:builds' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'order',
      relationshipType: 'belongs_to',
      inverseName: 'Builds',
      inverseSystemAttribute: 'order_builds',
    },
    description:
      'The order this build was raised for. Without it, "cancel the builds for this order" ' +
      'has nothing to look up (plans/products/12 AB7)',
  },

  source: {
    id: toFieldId('source'),
    key: 'source',
    label: 'Source',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'build_source',
    systemSortOrder: 'aF',
    nullable: true,
    // An internal discriminator, so it is out of the panel and the dialog — but
    // it IS the one useful column here, so an auto-build is distinguishable at a
    // glance in the list. This is the single field in migration 109 where the
    // table default deliberately diverges from the panel default.
    showInPanel: false,
    showInTable: true,
    showInDialogs: false,
    options: { options: BuildSource.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    defaultValue: 'manual',
    description:
      'Who raised this build. An auto-build must be distinguishable from one a person raised ' +
      'against the same order deliberately (plans/products/12 AB7)',
  },

  notes: {
    id: toFieldId('notes'),
    key: 'notes',
    label: 'Notes',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'build_notes',
    systemSortOrder: 'aG',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter notes',
    description: 'Free text about this run',
  },

  postedAt: {
    id: toFieldId('postedAt'),
    key: 'postedAt',
    label: 'Posted',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'build_posted_at',
    systemSortOrder: 'aH',
    nullable: true,
    // 🛑 "Denormalized convenience only — never gate on it." A VISIBLE field
    // invites exactly the gating that warning exists to prevent, so it is out of
    // both the panel and the dialog. Not `capabilities.hidden` — it stays
    // findable in the field picker for anyone who deliberately wants it.
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description:
      'Denormalized convenience only — never gate on it. The gl_posting rows are the truth ' +
      'about whether this build has been posted',
  },

  // ─── Relationship inverses and the reversal pair ───────────────────

  movements: {
    id: toFieldId('movements'),
    key: 'movements',
    label: 'Stock Movements',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'build_movements',
    systemSortOrder: 'aI',
    nullable: true,
    showInPanel: false, // has_many; a card lists them
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'stock_movement:build' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'The consume and produce rows this build wrote — the costed subledger entries',
  },

  reversalOf: {
    id: toFieldId('reversalOf'),
    key: 'reversalOf',
    label: 'Reversal Of',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'build_reversal_of',
    systemSortOrder: 'aJ',
    nullable: true,
    // Surfaced as a banner/badge on a reversed build, not as two relationship
    // rows in the Details panel.
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    // Self-relation: carries `relationshipConfig` but NO
    // `relationship.inverseResourceFieldId`, exactly like the
    // `parentMovement` / `childMovements` and `reversesMovement` /
    // `reversedByMovements` pairs. `linkNewRelationships` skips it by design and
    // the seeder materialises it from `relationshipConfig`.
    relationshipConfig: {
      relatedEntityType: 'build',
      relationshipType: 'belongs_to',
      inverseName: 'Reversed By',
      inverseSystemAttribute: 'build_reversed_by',
    },
    description:
      'Set on the REVERSING build, pointing at the one it undoes (B6). A completed build is ' +
      'never edited or deleted — a period that has been posted must not change shape',
  },

  reversedBy: {
    id: toFieldId('reversedBy'),
    key: 'reversedBy',
    label: 'Reversed By',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'build_reversed_by',
    systemSortOrder: 'aK',
    nullable: true,
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationshipConfig: {
      relatedEntityType: 'build',
      relationshipType: 'has_many',
      inverseName: 'Reversal Of',
      inverseSystemAttribute: 'build_reversal_of',
    },
    description: 'Builds that undo this one',
  },

  /**
   * The order's demand fingerprint AS IT WAS when this build was last agreed
   * with its order (plans/products/13). Stamped by `createBuild`, and only for a
   * build the order raised — a hand-raised build tracks no order and gets none.
   *
   * 🛑 **Rewritten by exactly one other writer, and only alongside the amendment
   * that earns it.** Under Model A+ this was stamped once and never rewritten,
   * because refreshing a stamp nothing else had changed would erase the drift it
   * exists to show. Model B (decided 2026-08-28) adds
   * `amendPlannedBuildQuantity`, which converges a `planned` build ON its order
   * and re-stamps in the SAME update — there the old stamp would report drift
   * that has just been resolved. The invariant is therefore not "never
   * rewritten" but **"never rewritten on its own"**.
   *
   * It works identically for `planned`, `in_progress` and `completed`, which is
   * why plan 13 preferred it to a status field — §1.5 forbids automation from
   * amending an `in_progress` build, but nothing forbids it from being HONEST
   * about one, and `canAmendBuild` is what keeps the amendment off it.
   */
  orderRevision: {
    id: toFieldId('orderRevision'),
    key: 'orderRevision',
    label: 'Order revision',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'build_order_revision',
    systemSortOrder: 'aL',
    nullable: true,
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    capabilities: {
      filterable: false,
      sortable: false,
      // Set on the insert by `createBuild`; re-stamped by exactly one other
      // writer, `builds/build-mutations.ts`'s `amendPlannedBuildQuantity`.
      //
      // 🛑 `updatable: false` STAYS, and is not a contradiction: it means there
      // is no INTERACTIVE writer — this field is backend-owned, and a person
      // editing a build must never be able to move its drift stamp. The flag is
      // documentation and a UI/connector gate; the write path does not read
      // `capabilities.updatable` at all (`field-hooks/register-hooks.ts:443`,
      // and data-migrations 078/079 say the same), so a server-side writer needs
      // no registry change and no migration.
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description:
      'Fingerprint of what the order asked production for at the moment this build was ' +
      'raised. Differs from the order’s current fingerprint once the order has changed',
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
    description: 'Automatically set when the build is created',
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
    description: 'Automatically updated when the build is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
