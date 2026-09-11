// packages/lib/src/resources/registry/resources/parcel-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { ParcelTrackingStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Parcel resource
 * (`plans/apps/shipstation/shared-shipment-entities-proposal.md` §6, grounded in
 * the live probe `plans/apps/shipstation/api-probe-2026-09-10.md` §2 and §3).
 *
 * ## What a parcel is
 *
 * ONE physical box with ONE tracking number. That is the grain a customer
 * actually asks about ("where is my box"), and no single app owns it today.
 * Ships `isVisible: false`, with no route folder, no list page and no create
 * dialog, and it lands with **no writers at all** (§9 step 2): the registry
 * definitions, the migration and the tests go first, nothing observable
 * changes, and the connectors are pointed at it afterwards.
 *
 * ## Why this earns its own entity rather than living on the shipment
 *
 * Proposal §6, "Cross-vocabulary grounding", checked against the Shopify Admin
 * GraphQL API on 2026-09-10: **Shopify has no parcel concept at all.**
 * `Fulfillment.trackingInfo` is a bare `[FulfillmentTrackingInfo!]!` list of
 * `{ company, number, url }` hung off the fulfillment, with no per-box
 * identity, sequence, weight or status. Multi-box in Shopify is a list of
 * numbers and nothing else, so Shopify can contribute tracking numbers and can
 * never contribute per-box status. That gap is exactly what ShipStation fills,
 * and it is why the box is a row rather than a repeated column on `shipment`.
 *
 * ## The ownership split (§5)
 *
 * **ShipStation owns structure** ({@link sequence}, {@link isMaster},
 * {@link weight}/{@link weightUnit}, {@link length}/{@link width}/
 * {@link height}/{@link dimUnit}, {@link voided}/{@link voidedAt}). **The
 * carrier app owns status** ({@link status}, {@link statusCode},
 * {@link statusDescription}, {@link estimatedDelivery}, {@link deliveredAt},
 * {@link receivedBy}). Disjoint field sets on one row, which is what makes
 * multi-app contribution safe here: no field ever has two `overwrite` writers,
 * so the mutual-drift ping-pong in §4 (two connectors each reading the other's
 * `FieldValue.managedByConnectorId` as drift and rewriting forever, silently)
 * cannot start. And a parcel has exactly one carrier, so FedEx and UPS write
 * disjoint sets of ROWS and never touch each other at all.
 *
 * ## Convergence goes through the tracking number
 *
 * {@link trackingNumber} is a native column precisely because it has to be a
 * legal `match` target. App fields cannot be `match` targets at all:
 * `buildContributingMatchBindings`
 * (`packages/lib/src/data-connectors/app-catalog.ts:223-249`) binds a native
 * `target` column only. That is why ShipStation's own parcel identity, the
 * `label_id:package_id` external id, stays in an app field and is NOT the join
 * key, while the tracking number is native.
 *
 * Carrier apps MATCH on that number and mint nothing, which is the second
 * protection: `effectiveOrphanBehavior`
 * (`packages/lib/src/data-connectors/reconciliation.ts:186-193`) degrades a
 * declared `archive` to `mark_deleted` for any record a connector merely
 * matched rather than created, so a carrier's reconciliation pass can never
 * archive ShipStation's rows.
 */
export const PARCEL_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique parcel identifier',
  },

  /**
   * ### Tracking numbers are treated as UNIQUE (§8b, owner's call 2026-09-10)
   *
   * This field carries the cross-app match on its own, with no date guard.
   *
   * The counter-evidence, written down so nobody rediscovers it: carriers DO
   * reuse tracking numbers after long intervals, and the FedEx app already
   * accepts `shipDateBegin`/`shipDateEnd` specifically to disambiguate reused
   * ones. It is an acceptable risk rather than a latent corruption bug for
   * three reasons:
   *
   * 1. **ShipStation is unaffected.** Its parcel identity is its own external
   *    id (`label_id:package_id`) in an app field, not this number, so the
   *    structural fields are never at risk of a mis-merge.
   * 2. **Only the carrier apps match on it,** and only to write status.
   * 3. **The failure is visible.** `lookupByField` runs under
   *    `onAmbiguous: 'first'`: two rows sharing a number means status may land
   *    on the older parcel, which is wrong but files a `DuplicateSuggestion`
   *    and is repairable, not silent structural damage.
   *
   * A composite guard is unavailable to a connector anyway (§8a): match
   * candidates are OR'd, not AND'd, so adding a ship-date candidate would only
   * WIDEN the match. The `IdentityRole` docblock claiming otherwise is wrong.
   *
   * `nullable: false` because this is the primary display field and
   * `computeDisplayValue` has no fallback.
   */
  trackingNumber: {
    id: toFieldId('trackingNumber'),
    key: 'trackingNumber',
    label: 'Tracking Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'parcel_tracking_number',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter tracking number',
    description:
      'THE cross-app match key and the display field. Written by ShipStation; matched on by ' +
      'the carrier apps, which mint nothing. Native rather than an app field because only a ' +
      'native column can be a `match` target.',
  },

  sequence: {
    id: toFieldId('sequence'),
    key: 'sequence',
    label: 'Sequence',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'parcel_sequence',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter sequence',
    description:
      "The box's position within its label, as ShipStation reports it. Use this for " +
      'presentation whenever it is present: probe §2 found the packages returned in ' +
      'sequence order 3, 2, 1, so array position carries no meaning.',
  },

  isMaster: {
    id: toFieldId('isMaster'),
    key: 'isMaster',
    label: 'Master Parcel',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'parcel_is_master',
    systemSortOrder: 'a3',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The master box of a multi-package label. Probe §2: the master is the package with ' +
      '`sequence` 1, and in the observed three-box label it was returned LAST in the array. ' +
      'Never assume array index zero is the master.',
  },

  weight: {
    id: toFieldId('weight'),
    key: 'weight',
    label: 'Weight',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'parcel_weight',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter weight',
    description:
      'Box weight in whatever {@link weightUnit} says. ShipStation returned OUNCES in the ' +
      'probe (a 3-box label reported 1280, 464 and 704), so this number is meaningless on ' +
      'its own. Never render it without the unit.',
  },

  weightUnit: {
    id: toFieldId('weightUnit'),
    key: 'weightUnit',
    label: 'Weight Unit',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'parcel_weight_unit',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'ounce',
    description:
      'The unit {@link weight} is expressed in. Not decorative: ShipStation reports ounces, ' +
      'not pounds, and a reader that assumes pounds is off by a factor of sixteen.',
  },

  length: {
    id: toFieldId('length'),
    key: 'length',
    label: 'Length',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'parcel_length',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter length',
    description: 'Box length in whatever {@link dimUnit} says. ShipStation returned inches.',
  },

  width: {
    id: toFieldId('width'),
    key: 'width',
    label: 'Width',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'parcel_width',
    systemSortOrder: 'a7',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter width',
    description: 'Box width in whatever {@link dimUnit} says. ShipStation returned inches.',
  },

  height: {
    id: toFieldId('height'),
    key: 'height',
    label: 'Height',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'parcel_height',
    systemSortOrder: 'a8',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter height',
    description: 'Box height in whatever {@link dimUnit} says. ShipStation returned inches.',
  },

  dimUnit: {
    id: toFieldId('dimUnit'),
    key: 'dimUnit',
    label: 'Dimension Unit',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'parcel_dim_unit',
    systemSortOrder: 'a9',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'inch',
    description:
      'The unit {@link length}, {@link width} and {@link height} are expressed in. The probe ' +
      'observed inches (26 x 50 x 4, 96 x 4 x 4, 71 x 6 x 13), but like {@link weightUnit} ' +
      'this is carried rather than assumed.',
  },

  voided: {
    id: toFieldId('voided'),
    key: 'voided',
    label: 'Voided',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'parcel_voided',
    systemSortOrder: 'aA',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Label lifecycle, NOT transit state. A void and reprint becomes this flag plus new ' +
      'parcel rows, which is why there is no native `label` entity (§6) and why the label ' +
      'lifecycle is deliberately absent from `ParcelTrackingStatus`. A voided parcel is ' +
      'excluded from the shipment status roll-up ENTIRELY. Probe §3: voided labels still ' +
      "carried a `tracking_status` of `in_transit`, so a carrier's status says nothing about " +
      'whether the label is live and the two must be preserved independently.',
  },

  voidedAt: {
    id: toFieldId('voidedAt'),
    key: 'voidedAt',
    label: 'Voided At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'parcel_voided_at',
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
      'When the label carrying this box was voided. Keeps the void history rather than ' +
      'deleting the row, which is how relabel history survives without a `label` entity.',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'parcel_status',
    systemSortOrder: 'aC',
    nullable: true,
    options: { options: ParcelTrackingStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    description:
      'Normalized transit state for this one box. The carrier apps are the writers, and ' +
      'neither FedEx nor UPS has a connector today, so this stays NULL in the first pass. ' +
      'That is expected, not a gap: the ownership split in §5 is designed for their arrival, ' +
      'not dependent on it.',
  },

  statusCode: {
    id: toFieldId('statusCode'),
    key: 'statusCode',
    label: 'Status Code',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'parcel_status_code',
    systemSortOrder: 'aD',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter status code',
    description:
      "The carrier's own raw code, kept beside the normalized {@link status} so the " +
      "normalization is auditable. Carrier app writes it (probe §3 saw FedEx's `NY`).",
  },

  statusDescription: {
    id: toFieldId('statusDescription'),
    key: 'statusDescription',
    label: 'Status Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'parcel_status_description',
    systemSortOrder: 'aE',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter status description',
    description:
      "The carrier's human-readable text for {@link statusCode} (probe §3 saw `Not Yet In " +
      'System`). Carrier app writes it.',
  },

  estimatedDelivery: {
    id: toFieldId('estimatedDelivery'),
    key: 'estimatedDelivery',
    label: 'Estimated Delivery',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'parcel_estimated_delivery',
    systemSortOrder: 'aF',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      "The carrier's current ETA for this box. Carrier app writes it. This is what an agent " +
      'requotes when a box reads `delayed` rather than `exception`.',
  },

  deliveredAt: {
    id: toFieldId('deliveredAt'),
    key: 'deliveredAt',
    label: 'Delivered At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'parcel_delivered_at',
    systemSortOrder: 'aG',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'When the carrier reports this box was delivered. Carrier app writes it.',
  },

  receivedBy: {
    id: toFieldId('receivedBy'),
    key: 'receivedBy',
    label: 'Received By',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'parcel_received_by',
    systemSortOrder: 'aH',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter recipient name',
    description:
      'Who the carrier says signed for this box. Carrier app writes it; per box, because a ' +
      'multi-box shipment can be signed for by different people on different days.',
  },

  shipment: {
    id: toFieldId('shipment'),
    key: 'shipment',
    label: 'Shipment',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'parcel_shipment',
    systemSortOrder: 'aI',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'shipment:parcels' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'shipment',
      relationshipType: 'belongs_to',
      inverseName: 'Parcels',
      inverseSystemAttribute: 'shipment_parcels',
    },
    description:
      'The dispatch this box was part of. Declaration only in the first pass. No `onDelete` ' +
      'here by rule: a `belongs_to` never declares one, the has_many side ' +
      '(`shipment.parcels`) owns that answer.',
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
    description: 'Automatically set when the parcel is created',
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
    description: 'Automatically updated when the parcel is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
