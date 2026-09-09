// packages/lib/src/resources/registry/resources/refund-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Refund resource
 * (plans/money/tasks/47-shopify-refunds.md §2, §2.1).
 *
 * ## Why this entity exists at all
 *
 * Revenue booked at fulfillment is never reversed, because nothing in auxx
 * holds a refund. An order flips to `refunded` in Shopify and auxx learns only
 * that *something* was refunded, with no amount, no date and no lines (§0.1).
 * This is the native record that carries the fact.
 *
 * ## Native entity, not a JSON dump
 *
 * The refund is projected out of the order payload the connector already
 * fetches, as a `refunds[]` fan-out, and every money value is scaled through
 * `decimalToMinorUnits` on the way in (§4). Letting the posting builder read
 * `raw.refunds` instead would put unscaled provider strings at the ledger,
 * which is where the 100x bug of money plan 37 §2.4 lived. It is also `G16`'s
 * rule: Shopify maps into this contract, and the accounting code never reads
 * Shopify fields directly.
 *
 * A refund is append-only at the source: the Shopify Refund resource has no
 * delete, void, cancel or reverse (§5.3.2). It can still CHANGE, so re-ingest
 * rewrites the record on a content-hash difference.
 *
 * ## A refund is three legs, not one
 *
 * Goods (`refund_line_items[]`), money (`transactions[]`) and adjustments
 * (`order_adjustments[]`) are separate facts and only the first is modelled
 * here as a child record. 8 of the 11 refunds measured on a live store moved
 * money with NO line items at all (§3), so a lines-only model would have missed
 * most of them.
 *
 * Money is integer minor units.
 */
export const REFUND_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique refund identifier',
  },

  /**
   * When the refund happened AT SHOPIFY, bound from the refund's own
   * `created_at`.
   *
   * 🛑 **THE accounting date. `build-refund-entry.ts` dates the ledger entry
   * from this field and never from ingest time** (§5.3). The Shopify connector
   * is manual-only (§0.9), so the gap between a refund happening and auxx
   * seeing it is unbounded and can cross a period close: taking the ingest
   * timestamp would post a July refund into September.
   *
   * Not nullable for the same reason. A null here would silently fall back to
   * whenever the row was written, which is the one behaviour this field exists
   * to prevent.
   */
  refundedAt: {
    id: toFieldId('refundedAt'),
    key: 'refundedAt',
    label: 'Refunded At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'refund_created_at',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'When the refund happened at the provider. THE accounting date - the refund entry is ' +
      'dated from this, never from when auxx ingested it, because the connector is ' +
      'manual-only and the lag can cross a period close',
  },

  /**
   * The refund `note`, and the only free text the payload carries.
   *
   * ⚠️ `G16`'s structured "reason" requirement is **not satisfiable from this
   * payload** (§3.2). `order_adjustments[].reason` holds only Shopify's own
   * generated labels (`Refund discrepancy`, `Pending refund discrepancy`) and
   * there is no human-entered reason anywhere in the object. So the reason is
   * either this free text, or a field a person fills in on review.
   */
  note: {
    id: toFieldId('note'),
    key: 'note',
    label: 'Note',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'refund_note',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter a note',
    description:
      'The provider note on the refund. The only free-text reason supplied - there is no ' +
      'structured reason field anywhere in the payload',
  },

  /**
   * The money that actually moved on this refund, in integer minor units.
   *
   * 🛑 **DERIVED, and named for it.** There is NO total on a Shopify refund
   * (§2.1): the top-level properties are `created_at`, `duties`, `id`, `note`,
   * `order_adjustments`, `processed_at`, `refund_duties`, `refund_line_items`,
   * `refund_shipping_lines`, `restock`, `transactions` and `user_id`, and the
   * live payload matches exactly. A field called `refund_total` was in an
   * earlier version of the plan and would have been **null on every refund**,
   * silently, because the projection emits `undefined` and the sink writes
   * nothing.
   *
   * The connector projection computes it as
   * `Σ transactions[] where kind == 'refund' and status == 'success'` - the
   * money that actually moved. That is defensible where the tax proration of
   * §6.2 was not: it aggregates facts that each stand on their own record, it
   * invents no rate and allocates nothing, and every leg it sums stays
   * individually inspectable.
   *
   * 🛑 **Do not rename this to `refund_total`.** The name carries the
   * distinction between a number transcribed from the provider and a number
   * auxx computed, and a list of refunds with no amount column is not usable.
   *
   * Null is not zero. Null means the provider supplied no transaction legs to
   * sum, which is a knowable gap rather than a refund of nothing (§6.2a, §9
   * rule 3); zero means legs exist and none of them succeeded.
   */
  amountRefunded: {
    id: toFieldId('amountRefunded'),
    key: 'amountRefunded',
    label: 'Amount Refunded',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'refund_amount_refunded',
    systemSortOrder: 'a3',
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
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Integer minor units. DERIVED by the connector projection as the sum of the successful ' +
      'refund transactions, because the provider supplies no total on a refund at all. Null ' +
      'means no transaction legs were supplied, which is not the same as a refund of zero',
  },

  /** The order this refund was taken against. The owning side of `order_refunds`. */
  order: {
    id: toFieldId('order'),
    key: 'order',
    label: 'Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'refund_order',
    systemSortOrder: 'a4',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'order:refunds' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'order',
      relationshipType: 'belongs_to',
      inverseName: 'Refunds',
      inverseSystemAttribute: 'order_refunds',
    },
    description:
      'The order this refund was taken against. Also the discriminator the entry builder ' +
      "needs: the order's first fulfillment date against this refund's date is what decides " +
      'whether any revenue was ever posted to reverse',
  },

  /**
   * The goods leg: one child record per refunded line.
   *
   * Empty is the ordinary case, not a defect. A concession (a post-sale price
   * reduction on goods the customer kept) and a shipping-only refund both carry
   * zero lines, and those were 8 of 11 refunds in the measured window (§3).
   */
  lines: {
    id: toFieldId('lines'),
    key: 'lines',
    label: 'Refund Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'refund_lines',
    systemSortOrder: 'a5',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'refund_line:refund' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description:
      'The goods coming back on this refund, one record per refunded line. Empty on a ' +
      'concession or a shipping-only refund, which is the common case',
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
    description:
      'Automatically set when the refund record is created in auxx. This is INGEST time and ' +
      'never the accounting date - see refundedAt',
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
    description: 'Automatically updated when the refund is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
