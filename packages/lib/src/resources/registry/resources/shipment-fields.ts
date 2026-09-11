// packages/lib/src/resources/registry/resources/shipment-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { ShipmentStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Shipment resource
 * (`plans/apps/shipstation/shared-shipment-entities-proposal.md` §6, grounded in
 * the live probe at `plans/apps/shipstation/api-probe-2026-09-10.md` §2).
 *
 * ## What a shipment is
 *
 * One dispatch of goods. Its boxes are `parcel` records
 * ({@link parcels}), one per physical box with one tracking number each.
 *
 * Hidden system entity (`isVisible: false`) with **no route folder** under
 * `apps/web/src/app/(protected)/app/`, so there is no list page and no create
 * dialog. Per proposal §3, `isVisible: false` only suppresses the Records
 * sidebar group, the kbar create action, the kbar record-search scope and the
 * AI entity catalog; the absent route folder is what actually keeps it off the
 * list pages. This lands with **no writers at all**. The ShipStation connector
 * arrives afterwards (§9 step 3), so every field below is null on every row
 * until it does. Nothing observable changes when this ships.
 *
 * ## Why NATIVE rather than app-owned (§2)
 *
 * Three apps know different things about the same object. ShipStation knows
 * what was dispatched: shipments, which boxes belong together, void and relabel
 * history. FedEx and UPS know where each parcel is: status, scans, delivery.
 * Shopify knows which order it belongs to. App-owned entities would give each
 * of them its own table, with no way to join a ShipStation box to the FedEx
 * status of that same box. The normalized carrier status enum is already
 * duplicated byte-for-byte between the FedEx and UPS apps; ShipStation would
 * have been a third copy.
 *
 * ## The ownership split that makes multi-app writing safe (§5)
 *
 * Every drift and collision hazard in §4 is a consequence of **two writers on
 * one field**, so this design removes that by construction:
 *
 * - **ShipStation owns structure, the carrier apps own status.** Disjoint field
 *   sets on one row. No field ever has two `overwrite` writers, so the
 *   mutual-drift ping-pong in §4 cannot start.
 * - A parcel has exactly one carrier, so FedEx and UPS never touch the same row.
 *
 * This split is load-bearing, not a convention. Any later contributor must take
 * `fill_blank`, `connector_owned_only` or `ignore` on fields it does not own, or
 * route its value to its own namespaced app field instead. A second `overwrite`
 * writer starts the ping-pong silently: nothing errors, both connectors rewrite
 * and re-stamp every field every run, forever.
 *
 * ## Per-app external ids stay in APP fields
 *
 * ShipStation's `shipmentId` (the probe observed `se-428778294`) lives in an app
 * field, which is namespaced by `appSlug` and therefore cannot collide with
 * another app's id for the same row. These are deliberately **not** native
 * columns here: a native id column would have to be claimed by one app, and it
 * would still be useless as a cross-app join key because `match` cannot bind an
 * `appField` (§4).
 *
 * ## ⚠️ `shipment` is NOT `order_fulfillments`
 *
 * `order_fulfillments` is a JSON field on `order`, authored in
 * `order-fields.ts`. That is the **accounting** fulfillment record: what was
 * shipped and the GL posting it produced. This entity is the **physical**
 * dispatch and its boxes. They answer different questions, they have different
 * writers, and one is not derivable from the other. Do not conflate them, and
 * do not replace either with the other.
 */
export const SHIPMENT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique shipment identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Shipment Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'shipment_number',
    systemSortOrder: 'a1',
    // 🛑 NULLABLE, and it has to be. ShipStation's docs on `shipment_number` are
    // explicit that it is "optional, mutable, and does not require uniqueness,
    // allowing multiple shipments to share the same value" - deliberately, so
    // partial shipments and re-created canceled orders can share a number.
    //
    // An earlier version of this field was `nullable: false`, reasoned from the
    // consequence (this is the primary display field and `computeDisplayValue`
    // has no fallback, so a null renders the row nameless) rather than from the
    // provider. The consequence is real; the requirement was not ours to make.
    // A shipment with no number is a legitimate shipment and renders nameless,
    // which is honest.
    //
    // Two corollaries follow from the same doc and are load-bearing elsewhere:
    // MUTABLE, so this could never be the external id (that is the app's
    // `shipmentId`), and NOT UNIQUE, so it must never carry a `match`.
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '14530',
    description:
      "ShipStation's shipment number, which is the merchant's ORDER number - the same value " +
      "as v1's `orderNumber` and the Order Number in the ShipStation UI, not a tracking " +
      'number and not an internal id. Free-form text: the probe observed `14530`, the docs ' +
      'also show `ORDER-2024-001`. Optional, mutable and non-unique at the source. ' +
      '⚠️ NOT carried on the label payload - it lives on the shipment resource, so the ' +
      'label stream alone leaves it empty.',
  },

  /**
   * The tracking number of this shipment's ACTIVE label's master parcel,
   * denormalized onto the shipment so it can be the display value.
   *
   * ## Why this is denormalized rather than read through the relationship
   *
   * `computeDisplayValue` reads a field on the ROW, and a tracking number lives
   * on a `parcel`. There is no way to point a display field at a related
   * record's column, so the value has to exist here.
   *
   * ## Why it is not fetched from the shipment endpoint
   *
   * Checked against the V2 docs on 2026-09-10: `GET /v2/shipments/{id}` returns
   * NO tracking number, at the top level or inside its `packages[]` (those carry
   * `package_code`, `weight`, `dimensions` and `label_messages` only). The live
   * probe found the same thing. Labels are the only source of tracking numbers,
   * and the label stream already holds the master, so the connector writes this
   * at no extra request. (`GET /v2/shipments/{id}/labels` does return a
   * shipment-level `tracking_number`, but that is one request per shipment for
   * something already in hand.)
   *
   * ## Which master, when there is more than one
   *
   * The ACTIVE label's. A void plus its reprint puts two masters on one
   * shipment - 6 of 135 shipments in the first real sync - and exactly one is
   * live in each case. When every label is voided (1 of 135) the connector
   * writes the voided master rather than nothing: a number a person can still
   * search beats a nameless row.
   *
   * ⚠️ NOT STABLE. A reprint replaces this with the new label's master, so the
   * shipment's display name changes. That is intended - it is the number the
   * customer is quoting today - but it means this must never be used as an
   * identity or a match key.
   */
  masterTrackingNumber: {
    id: toFieldId('masterTrackingNumber'),
    key: 'masterTrackingNumber',
    label: 'Master Tracking Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'shipment_master_tracking_number',
    systemSortOrder: 'a1a',
    // Nullable like everything else the provider does not guarantee. The first
    // real sync filled it on 135 of 135 shipments, but that is evidence, not a
    // contract, and `shipment_number` is the cautionary tale: a `nullable:
    // false` argued from "it is the display field" rather than from the source.
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '383646550733',
    description:
      "The master parcel's tracking number on this shipment's active label, copied here by " +
      'the connector so the shipment has a name a support agent can search. Free-form text: ' +
      'FedEx is 12 digits, UPS is `1Z` plus 16 alphanumeric, USPS is 20 to 22 digits. ' +
      'Changes when a label is voided and reprinted, so never match on it.',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'shipment_status',
    systemSortOrder: 'a2',
    nullable: true,
    options: { options: ShipmentStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    description:
      "DERIVED, never typed by a person. A roll-up over this shipment's ACTIVE (non-voided) " +
      'parcels, computed by the connector (§8d: the mapping has no transform hook, so the ' +
      'connector server emits an already-normalized value). Voided parcels are excluded ' +
      'entirely; a shipment with no active parcels is `unknown`; `delivered` applies only ' +
      'when EVERY active parcel is delivered, any mix being `partially_delivered`. The ' +
      'precedence is attention-first, so one exception box among three in-transit ones reads ' +
      '`exception` rather than hiding the problem behind progress. That ordering was ' +
      'confirmed by the owner on 2026-09-10, closing the open item in §8.',
  },

  carrier: {
    id: toFieldId('carrier'),
    key: 'carrier',
    label: 'Carrier',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'shipment_carrier',
    systemSortOrder: 'a3',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'fedex',
    description:
      'Which carrier moved this shipment: `fedex`, `ups`, `usps`. Free TEXT rather than an ' +
      'enum, because the carrier list is account configuration and a new connection must not ' +
      'need a registry edit. ShipStation owns this field.',
  },

  service: {
    id: toFieldId('service'),
    key: 'service',
    label: 'Service',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'shipment_service',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'fedex_home_delivery',
    description:
      "The carrier service code, e.g. `fedex_home_delivery` from the probe's three-box " +
      'example. Per-carrier vocabulary, so TEXT for the same reason as carrier.',
  },

  shipDate: {
    id: toFieldId('shipDate'),
    key: 'shipDate',
    label: 'Ship Date',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'shipment_ship_date',
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
      'When the shipment was dispatched. The probe found the shipment and its label disagree ' +
      '(`2026-09-10T00:00:00Z` against `2026-09-10T07:00:00Z`) and did not establish the ' +
      'timezone contract, so whichever the connector picks must be written down there. This ' +
      'never replaces the accounting fulfillment date on the order.',
  },

  parcelCount: {
    id: toFieldId('parcelCount'),
    key: 'parcelCount',
    label: 'Parcel Count',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'shipment_parcel_count',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'How many boxes the provider reported for this shipment. Multi-box is the common case, ' +
      'not the edge: 34 of the 50 labels in the probe carried more than one package, up to ' +
      'ten. Carried as its own number so a count is available before the parcel rows are.',
  },

  parcels: {
    id: toFieldId('parcels'),
    key: 'parcels',
    label: 'Parcels',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'shipment_parcels',
    systemSortOrder: 'a7',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'parcel:shipment' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description:
      'The physical boxes in this shipment. `cascade` because a parcel is an owned child: it ' +
      'has no meaning without its shipment, and a voided label survives as a voided parcel ' +
      'rather than as an orphan. The has_many side declares the behavior; the belongs_to side ' +
      'on `parcel` declares nothing.',
  },

  order: {
    id: toFieldId('order'),
    key: 'order',
    label: 'Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'shipment_order',
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'order:shipments' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'order',
      relationshipType: 'belongs_to',
      inverseName: 'Shipments',
      inverseSystemAttribute: 'order_shipments',
    },
    description:
      'The order this dispatch fulfils. One order has many shipments, one shipment has one ' +
      "order (Shopify's `Fulfillment.order` is `Order!`, singular and non-null). " +
      '⚠️ Declared here but **not populatable by a ShipStation reference mapping**: per §4, ' +
      "`linkMode: 'reference'` cannot cross connectors, because `findItemByDef` filters " +
      '`dataConnectorId` with hard equality, so a ShipStation reference to a Shopify-created ' +
      'order resolves nothing and is retried every run forever. Populating this needs either ' +
      'a native `match` on a column Shopify already writes, or the platform resolver in build ' +
      'plan §6. Neither blocks this entity: the parcel data is useful before any order is ' +
      'matched.',
  },

  /**
   * What the merchant paid the carrier for this label.
   *
   * ## Integer minor units, and why the connector does the multiplying
   *
   * `field-value-helpers.ts` is explicit that CURRENCY is NUMBER's shape
   * exactly: an integer minor-unit amount. ShipStation sends a DECIMAL
   * (`{"currency":"usd","amount":16.54}`), so writing it through unconverted
   * stores 12 cents for a $12.34 label. The mapping layer has no transform
   * hook, so the connector server must emit the already-multiplied integer.
   * That is what the `Minor` suffix on the key is for, the same signal
   * `bank_deposit_total`'s `totalMinor` carries.
   */
  costMinor: {
    id: toFieldId('costMinor'),
    key: 'costMinor',
    label: 'Shipping Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'shipment_cost',
    systemSortOrder: 'a9',
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
      'What the merchant paid for this label, in INTEGER MINOR UNITS (1654 is $16.54). The ' +
      'provider sends a decimal amount with its own currency, so the connector multiplies ' +
      'before it emits: the mapping layer has no transform hook to do it later. Populated on ' +
      'all 50 labels in the 2026-09-11 probe. Defaults to USD because every shipment observed ' +
      'is US domestic. Only the LIVE (non-voided) label reaches this field, which is correct, ' +
      'because voiding refunds the label and the reprint is what was actually paid for.',
  },

  insuranceCostMinor: {
    id: toFieldId('insuranceCostMinor'),
    key: 'insuranceCostMinor',
    label: 'Insurance Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'shipment_insurance_cost',
    systemSortOrder: 'aA',
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
      'What insuring this shipment cost, integer minor units, converted by the connector for ' +
      'the same reason as the shipping cost. The provider supplied it on all 50 labels in the ' +
      '2026-09-11 probe and the amount was 0 on every one: this merchant does not insure. A ' +
      'zero here is therefore a real reading rather than a missing value. Live label only.',
  },

  insuranceClaim: {
    id: toFieldId('insuranceClaim'),
    key: 'insuranceClaim',
    label: 'Insurance Claim',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'shipment_insurance_claim',
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
      'Any insurance claim the provider reports against this label. FORWARD-LOOKING, added by ' +
      'owner decision on 2026-09-11 rather than because a value was seen: it was null on all ' +
      '50 probed labels, which follows from the insurance cost being 0 everywhere, since ' +
      'nothing uninsured can be claimed. The wire shape is consequently UNKNOWN, so the ' +
      'connector writes this only when the provider sends a string. If a later label returns a ' +
      'structure, whoever finds it picks the one scalar that belongs in a text column and ' +
      'records which, instead of serializing the whole object into the field.',
  },

  /**
   * The printable PDF of this shipment's live label.
   *
   * ## A bearer secret, stored as plain text
   *
   * Verified 2026-09-11: the href is on the provider's public API host and an
   * UNAUTHENTICATED GET returns `200 application/pdf`, so a plain link in the UI
   * works with no proxying. The flip side is that the opaque path segment is the
   * ONLY thing protecting a document carrying a customer's name and address.
   * Anyone holding the string can fetch the label. Treat the column the way a
   * token is treated: never in an export, a log line, a webhook payload, or
   * anything an agent can read out to a third party.
   *
   * Stored as a URL rather than fetched into a `MediaAsset` by owner decision.
   * Expiry is unmeasured, so if these eventually 404 the column becomes dead
   * strings, which is the argument for revisiting that decision.
   */
  labelUrl: {
    id: toFieldId('labelUrl'),
    key: 'labelUrl',
    label: 'Label PDF',
    type: BaseType.URL,
    fieldType: FieldType.URL,
    isSystem: true,
    systemAttribute: 'shipment_label_url',
    systemSortOrder: 'aC',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      "The PDF of the label a person would actually print, read off the provider's " +
      '`label_download` object (which also carries png and zpl). Present on all 50 labels in ' +
      'the 2026-09-11 probe. BEARER SECRET: the URL fetches unauthenticated and the document ' +
      "carries the customer's name and address, so it must never be exported, logged, or " +
      'handed to a third party. Live label only, so a void and reprint replaces this and the ' +
      'superseded PDF becomes unreachable. Expiry is unmeasured.',
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
    description: 'Automatically set when the shipment is created',
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
    description: 'Automatically updated when the shipment is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
