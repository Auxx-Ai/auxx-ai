// packages/lib/src/resources/registry/resources/fulfillment-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { FulfillmentStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Fulfillment resource
 * (`plans/money/tasks/55-shipment-lines.md` §3).
 *
 * ## What this replaces
 *
 * One dispatch of goods as the sales channel describes it - the record form of
 * what used to be one entry in the `order_fulfillments` JSON array. Entity
 * migration 153 drops that JSON field and recreates it under the SAME name as
 * a has_many pointing here, because Shopify sends per-fulfillment line
 * quantities and dates for every merchant and the old field threw them away
 * (§1 of the brief). Revenue now posts from these records, not from a
 * collapsed min/max/sum over them.
 *
 * `isVisible: false`, no route folder - the same hiding `credit_memo_line` and
 * `parcel` get, for the same reason: nobody creates one by hand, and there is
 * no list page to 404.
 *
 * ## Why not the `shipment` entity
 *
 * `shipment` / `parcel` are the LOGISTICS fact (which boxes, which carrier,
 * where are they), written by ShipStation and the carrier apps, and they exist
 * only when a label was bought through a connected provider. `fulfillment` /
 * `fulfillment_line` are the SALES-CHANNEL fact (which order lines went out,
 * how many, when), written by any channel and by `money.fulfillOrder`, and
 * they exist ALWAYS - a fulfillment marked complete in the Shopify admin with
 * no label bought still has to post revenue. The two meet only on the
 * nullable {@link shipment} edge (§2.2 of the brief); nothing in relief or
 * posting may read it.
 *
 * ⚠️ `RawFulfillment.location_id` exists on the Shopify payload and is
 * deliberately NOT mapped here - auxx has no locations today. It is the field
 * a future multi-location on-hand would need, recorded here as an omission
 * rather than forgotten.
 */
export const FULFILLMENT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique fulfillment identifier',
  },

  /** The order this fulfillment shipped against. The owning side of `order_fulfillments`. */
  order: {
    id: toFieldId('order'),
    key: 'order',
    label: 'Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'fulfillment_order',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'order:fulfillments' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'order',
      relationshipType: 'belongs_to',
      inverseName: 'Fulfillments',
      inverseSystemAttribute: 'order_fulfillments',
    },
    description: 'The order this fulfillment shipped against',
  },

  /**
   * 1-based within the order, in ship-date order. The revenue poster's
   * document numbers key on it, the same role `bank_deposit_number` /
   * `payout_number` play for their own postings - see §5's open question on
   * where this gets computed (the projection, mirroring where `shipment_count`
   * is derived today).
   */
  sequence: {
    id: toFieldId('sequence'),
    key: 'sequence',
    label: 'Sequence',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'fulfillment_sequence',
    systemSortOrder: 'a2',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description: "1-based within the order, ship-date order. The poster's doc numbers key on it",
  },

  /**
   * Shopify's fulfillment `created_at`. 🛑 Never `updated_at`, which moves on
   * every tracking scan and would silently re-date revenue already posted.
   */
  shippedAt: {
    id: toFieldId('shippedAt'),
    key: 'shippedAt',
    label: 'Shipped At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'fulfillment_shipped_at',
    systemSortOrder: 'a3',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description:
      "THE accounting date. Shopify's fulfillment created_at - never updated_at, which moves " +
      'on every tracking scan',
  },

  /** Shopify's own fulfillment lifecycle. See {@link FulfillmentStatus} for the values. */
  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'fulfillment_status',
    systemSortOrder: 'a4',
    nullable: false,
    options: { options: [...FulfillmentStatus.values] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      "Shopify's own fulfillment lifecycle. 🛑 A cancelled fulfillment is a record with this " +
      'set to cancelled, never an absence - a vanished record is indistinguishable from one ' +
      'never seen, and inventory relief nets against it',
  },

  /**
   * When a relief reversal is written, on a cancelled fulfillment. NOT
   * {@link shippedAt} - that is the dispatch date, and reversing relief at the
   * dispatch date rather than the cancellation date would misdate the
   * reversal's own accounting period.
   */
  cancelledAt: {
    id: toFieldId('cancelledAt'),
    key: 'cancelledAt',
    label: 'Cancelled At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'fulfillment_cancelled_at',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The date a relief reversal is written at, on a cancelled fulfillment. shippedAt is ' +
      'the wrong one - it is the dispatch date, not the cancellation date',
  },

  /**
   * ### A display field is not optional
   *
   * `computeDisplayValue` reads a field on the ROW and has no fallback - the
   * shipment proposal learned this the expensive way when `shipment_number`
   * was empty on 135 of 135 rows and every one rendered nameless. This is
   * nullable in the type because Shopify's own field can be absent on an
   * older API version, but the connector projects it (Shopify's `name`, e.g.
   * `#1001.1`) and the native door (`money.fulfillOrder`) synthesises one when
   * there is nothing to project, so in practice it is always there to read.
   */
  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'fulfillment_name',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description:
      "The display field. Shopify's own name (#1001.1) when supplied; the native door " +
      'synthesises one otherwise. Nullable in the type only - never actually absent',
  },

  trackingNumber: {
    id: toFieldId('trackingNumber'),
    key: 'trackingNumber',
    label: 'Tracking Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'fulfillment_tracking_number',
    systemSortOrder: 'a7',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The channel-supplied tracking number, if any - a fulfillment marked complete with no ' +
      'label bought carries none. This is the opportunistic match key for the nullable ' +
      '{@link shipment} edge; nothing in relief or posting may read it (§2.2)',
  },

  trackingCompany: {
    id: toFieldId('trackingCompany'),
    key: 'trackingCompany',
    label: 'Tracking Company',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'fulfillment_tracking_company',
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  trackingUrl: {
    id: toFieldId('trackingUrl'),
    key: 'trackingUrl',
    label: 'Tracking URL',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'fulfillment_tracking_url',
    systemSortOrder: 'a9',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  /** The goods amount this fulfillment recognised, in integer minor units. Was `subtotalMinor`. */
  subtotal: {
    id: toFieldId('subtotal'),
    key: 'subtotal',
    label: 'Subtotal',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'fulfillment_subtotal',
    systemSortOrder: 'aA',
    nullable: false,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description:
      'Integer minor units. The goods amount this fulfillment recognised - was subtotalMinor',
  },

  /** Subtotal plus the freight this fulfillment recognised. Was `totalMinor`. */
  total: {
    id: toFieldId('total'),
    key: 'total',
    label: 'Total',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'fulfillment_total',
    systemSortOrder: 'aB',
    nullable: false,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description:
      'Integer minor units. Subtotal plus the freight this fulfillment recognised - was totalMinor',
  },

  /**
   * Whether freight was recognised on THIS fulfillment. Freight is recognised
   * once, on the first dispatch of an order - every later fulfillment of the
   * same order carries `false` here even though it has its own {@link subtotal}.
   */
  shippingRecognised: {
    id: toFieldId('shippingRecognised'),
    key: 'shippingRecognised',
    label: 'Shipping Recognised',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'fulfillment_shipping_recognised',
    systemSortOrder: 'aC',
    nullable: false,
    defaultValue: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description:
      'Whether freight was recognised on THIS fulfillment - freight is recognised once, on ' +
      'the first dispatch of an order, so a later fulfillment of the same order carries ' +
      'false here even though it has its own subtotal',
  },

  /**
   * 🛑 The posting this fulfillment became. TEXT and not a RELATIONSHIP,
   * exactly the precedent `credit_memo_gl_posting` set
   * (`credit-memo-fields.ts`): `GlPosting` is a Drizzle table with no
   * `EntityDefinition` to point at - the `gl_posting` `EntityRefKind` was
   * removed on 2026-08-28 for that reason, and `payout_gl_posting_id` /
   * `credit_memo_gl_posting` are the precedent. `readUnpostedShipments`'s
   * idempotency guard becomes a `fulfillment_gl_posting IS NULL` predicate over
   * these records instead of the JSON array's `glPostingId IS NULL` filter.
   */
  glPosting: {
    id: toFieldId('glPosting'),
    key: 'glPosting',
    label: 'GL Posting',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'fulfillment_gl_posting',
    systemSortOrder: 'aD',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The posting this fulfillment became. TEXT and not a RELATIONSHIP because GlPosting is ' +
      'a Drizzle table with no EntityDefinition to point at - the gl_posting EntityRefKind ' +
      'was removed on 2026-08-28 for that reason, and credit_memo_gl_posting / ' +
      'payout_gl_posting_id are the precedent',
  },

  docNumber: {
    id: toFieldId('docNumber'),
    key: 'docNumber',
    label: 'Doc Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'fulfillment_doc_number',
    systemSortOrder: 'aE',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  recordedAt: {
    id: toFieldId('recordedAt'),
    key: 'recordedAt',
    label: 'Recorded At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'fulfillment_recorded_at',
    systemSortOrder: 'aF',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description:
      'When auxx recorded this fulfillment, distinct from shippedAt (the accounting date)',
  },

  /** The lines: one record per (fulfillment, line item) tuple this dispatch carried. */
  lines: {
    id: toFieldId('lines'),
    key: 'lines',
    label: 'Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'fulfillment_lines',
    systemSortOrder: 'aG',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'fulfillment_line:fulfillment' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description: 'The per-line-item tuples this dispatch carried - one record per shipped line',
  },

  /**
   * ### The nullable, opportunistic join to the logistics fact (brief §2.2)
   *
   * Filled when a fulfillment's tracking number matches a
   * `parcel_tracking_number`; empty otherwise, which is the ordinary case
   * today (a ShipStation label is bought for only some dispatches). 🛑
   * **Nothing in this brief or in inventory relief may read it** - the moment
   * either does, the shipment proposal's unsolved order-linking problem (its
   * §7) becomes a blocker for the books. It is a support convenience only.
   *
   * 🛑 **Deliberately one-sided, per the brief's explicit "nothing new on
   * `shipment` or `parcel`".** Every other belongs_to field in this registry
   * pairs with a has_many inverse so `linkNewRelationships` can resolve
   * `inverseResourceFieldId` to a real `CustomField`; this one has none to
   * resolve to; `relationship.inverseResourceFieldId` stays `null` forever,
   * by construction, and `relationshipConfig` is omitted so neither the
   * per-org seeder's Pass 3 nor a migration's linker ever logs a spurious
   * "inverse not found" warning trying to find one. The field still stores
   * and reads correctly: a `RELATIONSHIP` value's target entity type is
   * carried per-row on `FieldValue.relatedEntityDefinitionId`, not derived
   * from the field's own inverse pairing, so an unresolved inverse costs this
   * edge exactly two things and nothing else - reverse traversal from
   * `shipment` (there is no field to traverse from) and a declared
   * `onDelete` (the registry's own rule is that a `belongs_to` side never
   * declares one; the has_many side does, and there is no has_many side
   * here). A `shipment` deleted out from under a live pointer here is left
   * unlinked rather than cascaded - acceptable exactly because §2.2 says
   * nothing may depend on this edge.
   */
  shipment: {
    id: toFieldId('shipment'),
    key: 'shipment',
    label: 'Shipment',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'fulfillment_shipment',
    systemSortOrder: 'aH',
    nullable: true,
    showInPanel: false,
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
      'The dispatch this maps to on the logistics side, filled opportunistically by ' +
      'matching tracking numbers. Nullable, one-sided - no field on shipment points back ' +
      '(brief §2.2), and nothing in relief or posting may read it',
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
    description: 'Automatically set when the fulfillment is created',
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
    description: 'Automatically updated when the fulfillment is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
