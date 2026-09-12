// packages/lib/src/resources/registry/resources/return-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * The PHYSICAL lifecycle of a return (plans/money/tasks/54-returns.md §3.3).
 *
 * ```
 * requested -> approved -> in_transit -> received -> inspected -> closed
 *                    \-> declined          \-> cancelled
 * ```
 *
 * An emailed or phoned return enters at `requested`. A dock surprise enters at
 * `received` with {@link RETURN_FIELDS.contact} null. One line, two entry
 * points. Transitions are enforced by `lifecycle-status-guard.ts`, the same way
 * `build` and `purchase_order` do it.
 *
 * 🛑 There is deliberately NO `resolved` value and no money value of any kind.
 * An earlier draft had `resolved` between `inspected` and `closed` and it was
 * wrong: the refund routinely completes before the warehouse restocks, so on
 * the day the money clears the return is neither `resolved` (nothing was
 * inspected) nor merely `received` (that understates it). Goods and money are
 * two axes, and crushing them into one enum is the mistake `VendorBillStatus`
 * already stands as the cautionary tale for.
 *
 * Money is DERIVED, never stored as a status: {@link RETURN_FIELDS.creditedAmount}
 * rolls up the linked credit memos, and "credited but not inspected" (memos
 * present while status is below `inspected`) is a one-line derivation the UI
 * surfaces as a badge. It is never blocked - there are good commercial reasons
 * to refund fast, and the system's job is to say what was given up, not to
 * refuse the decision.
 */
export const RETURN_STATUS_OPTIONS = [
  { label: 'Requested', value: 'requested', color: 'gray' },
  { label: 'Approved', value: 'approved', color: 'blue' },
  { label: 'In Transit', value: 'in_transit', color: 'indigo' },
  { label: 'Received', value: 'received', color: 'teal' },
  { label: 'Inspected', value: 'inspected', color: 'amber' },
  { label: 'Closed', value: 'closed', color: 'green' },
  { label: 'Declined', value: 'declined', color: 'red' },
  { label: 'Cancelled', value: 'cancelled', color: 'gray' },
] as const

/**
 * How the return reached us (plans/money/tasks/54-returns.md §3.4).
 *
 * 🛑 A CLOSED `SINGLE_SELECT`, and that is a deliberate asymmetry with
 * {@link RETURN_REASON_SEED_OPTIONS}, which is TAGS. A return has exactly ONE
 * origin; TAGS is multi-value and would permit a return that arrived by both
 * email and dock. Single-value-with-user-extension does not exist as a field
 * type in this system: a `SINGLE_SELECT` marked `configurable: true` is
 * editable only from the admin settings screen, never inline by the agent
 * taking the call.
 *
 * ⚠️ `ensureCustomFields` never updates an existing field's options, so these
 * values reach an org exactly ONCE, at creation. Adding one later needs its own
 * entity migration. This binds hardest here, because the set is closed.
 */
export const RETURN_ORIGIN_OPTIONS = [
  { label: 'Email', value: 'email', color: 'blue' },
  { label: 'Phone', value: 'phone', color: 'purple' },
  { label: 'Dock', value: 'dock', color: 'amber' },
  { label: 'Web', value: 'web', color: 'teal' },
] as const

/**
 * Why the goods came back (plans/money/tasks/54-returns.md §3.4). TAGS: ours,
 * seeded, and user-extensible inline.
 *
 * The vocabulary is auxx's rather than any provider's. Shopify's `ReturnReason`
 * is an apparel enum (`COLOR`, `SIZE_TOO_LARGE`, `STYLE`, `UNWANTED`, ...) with
 * **no value for "the customer damaged it during installation"**, which is the
 * exact fact a chargeback rebuttal turns on. `arrived_damaged` (carrier or our
 * packing) and `damaged_by_customer` (theirs) are the two the business actually
 * fights about, and no external system distinguishes them.
 *
 * No `other` value is seeded: with TAGS, "other" is just typing the real
 * answer.
 *
 * ⚠️ Same one-shot rule as {@link RETURN_ORIGIN_OPTIONS}. `ensureCustomFields`
 * never rewrites an existing field's options, so these seeds land once per org
 * at creation and a later addition needs its own entity migration. TAGS is also
 * multi-value, so a return may legitimately carry two reasons (wrong item AND
 * damaged); that is accepted, and it is precisely why `origin` is not TAGS.
 */
export const RETURN_REASON_SEED_OPTIONS = [
  { label: 'Not needed', value: 'not_needed', color: 'gray' },
  { label: 'Ordered wrong', value: 'ordered_wrong', color: 'blue' },
  { label: 'Arrived damaged', value: 'arrived_damaged', color: 'orange' },
  { label: 'Damaged by customer', value: 'damaged_by_customer', color: 'red' },
  { label: 'Defective', value: 'defective', color: 'amber' },
  { label: 'Wrong item', value: 'wrong_item', color: 'purple' },
  { label: 'Warranty', value: 'warranty', color: 'teal' },
] as const

/**
 * Field definitions for the Return resource
 * (plans/money/tasks/54-returns.md §3.1, §3.2, §3.3, §3.4, §3.7).
 *
 * ## What a return is
 *
 * ONE shipment back: one customer, one conversation. Its returned sold lines
 * are `return_line` records, and the teardown checklist under each of those is
 * `return_part_line`. Three grains, on purpose: this level is the logistics and
 * money envelope, the middle level is the commercial fact and the evidence
 * anchor, and the bottom level is the only thing that moves inventory.
 *
 * ## Visible, with a route folder, unlike `shipment` and `parcel`
 *
 * Warehouse staff create these BY HAND - returns do not arrive through the
 * sales channel - so the list page and the create dialog are the entire point.
 * `return` ships `isVisible: true` with a route folder at `app/returns/`.
 * `return_line` and `return_part_line` stay hidden, like `credit_memo_line`.
 *
 * ## The money is linked, never created here
 *
 * The refund is issued at the channel and lands as a `credit_memo` with
 * `source: channel`. A return LINKS to existing memos through
 * {@link RETURN_FIELDS.creditMemos} and never creates one; the FK is on the
 * memo because the memo is created first on the channel path. Nothing here ever
 * writes to a channel-sourced memo: its fields are connector-managed and the
 * next sync re-delivers every refund.
 *
 * Money amounts are integer MINOR UNITS.
 */
export const RETURN_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique return identifier',
  },

  // `RMA-` series through `keepOrAllocateRecordNumber`, wired exactly as `CM-`
  // is on `credit_memo`: `creatable: false` and `updatable: false`, so the hook
  // is the ONLY writer and the number is stable for the record's life. Nothing
  // external supplies a number here, so in practice the hook always allocates.
  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'return_number',
    showInDialogs: false,
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false, // hook-generated, prefix RMA - the hook is the ONLY writer
      updatable: false,
      configurable: false,
    },
    description: 'Auto-generated return number, RMA-0001 off the return sequence scope',
  },

  /**
   * Where the goods physically are. See {@link RETURN_STATUS_OPTIONS} for the
   * transitions and for why there is no `resolved` and no money value.
   */
  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'return_status',
    systemSortOrder: 'a2',
    nullable: false,
    options: { options: [...RETURN_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'requested',
    description:
      'The PHYSICAL lifecycle only: where the goods are. Money is never a status here - it ' +
      'is derived from the linked credit memos. A dock surprise enters at received with no ' +
      'contact; an emailed or phoned return enters at requested',
  },

  /**
   * How the return reached us. Closed set, one value. See
   * {@link RETURN_ORIGIN_OPTIONS} for why this is a `SINGLE_SELECT` while
   * {@link reason} is TAGS.
   */
  origin: {
    id: toFieldId('origin'),
    key: 'origin',
    label: 'Origin',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'return_origin',
    systemSortOrder: 'a3',
    nullable: true,
    options: { options: [...RETURN_ORIGIN_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select origin',
    description:
      'How the return reached us: email, phone, dock or web. A CLOSED single select, not ' +
      'tags - a return has exactly one origin, and a multi-value field would permit one that ' +
      'arrived by both email and dock',
  },

  /**
   * Why the goods came back. Seeded and user-extensible. See
   * {@link RETURN_REASON_SEED_OPTIONS} for the seed set, why it is ours rather
   * than any provider's, and why the seeds are one-shot per org.
   */
  reason: {
    id: toFieldId('reason'),
    key: 'reason',
    label: 'Reason',
    type: BaseType.TAGS,
    fieldType: FieldType.TAGS,
    isSystem: true,
    systemAttribute: 'return_reason',
    showInPanel: false,
    showInTable: false,
    systemSortOrder: 'a4',
    nullable: true,
    options: { options: [...RETURN_REASON_SEED_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Add reasons',
    description:
      'Why the goods came back. TAGS, seeded but extensible inline by the agent taking the ' +
      'call. Multi-value on purpose: wrong item AND damaged is a real answer. The seed ' +
      'values reach an org once, at creation - adding one later needs its own migration',
  },

  /**
   * The customer's own words, verbatim, beside the normalized {@link reason}
   * tags. Lives HERE rather than on `return_line` (by owner decision,
   * plans/money/tasks/56-return-lines-on-the-line-grid.md §5): one email or
   * call covers the whole return, not one line of it, and a customer does not
   * narrate per sold line.
   */
  customerNote: {
    id: toFieldId('customerNote'),
    key: 'customerNote',
    label: 'Customer Note',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'return_customer_note',
    // Interstitial between reason ('a4') and contact ('a5'): both are taken.
    systemSortOrder: 'a4a',
    showInPanel: true,
    nullable: true,
    options: { multiline: true, rows: 3 },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: "The customer's own words",
    description:
      "The customer's own words about the return, verbatim - one email or call covers the " +
      'whole return, not one line of it',
  },

  /**
   * 🛑 NULLABLE, and that is LOAD-BEARING (§3.2).
   *
   * Every other document in this system requires a party: `credit_memo.contact`
   * is `nullable: false, required: true`. A return cannot be. About 15% of
   * Auxx-Lift's returns are an unannounced pallet on the dock with no RMA, no
   * email and no call, and the record has to exist BEFORE anyone knows whose it
   * is. The warehouse photographs the label, types the sender into
   * {@link senderNameRaw}, and identification happens later.
   *
   * "Unidentified" is therefore DERIVED from `contact IS NULL`, never a status
   * value: identification and lifecycle are different axes, and the dock queue
   * is a saved view over this null rather than an enum member. Do not add one.
   */
  contact: {
    id: toFieldId('contact'),
    key: 'contact',
    label: 'Contact',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_contact',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'contact:returns' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'contact',
      relationshipType: 'belongs_to',
      inverseName: 'Returns',
      inverseSystemAttribute: 'contact_returns',
    },
    description:
      'The customer returning the goods. NULLABLE by design: a pallet arrives on the dock ' +
      'with no notice and the record exists before anyone knows whose it is. Unidentified is ' +
      'derived from this being null, never a status value',
  },

  /**
   * The order the goods were sold on. Nullable for the same reason
   * {@link contact} is: a dock surprise has no order until somebody matches the
   * shipping label.
   */
  order: {
    id: toFieldId('order'),
    key: 'order',
    label: 'Order',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_order',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'order:returns' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'order',
      relationshipType: 'belongs_to',
      inverseName: 'Returns',
      inverseSystemAttribute: 'order_returns',
    },
    description:
      'The order the returned goods were sold on - nullable, because a dock surprise has no ' +
      'order until the label is matched. Also what suggests which credit memos to link',
  },

  /**
   * The conversation. The ticket is the PRIMARY creation door for a return:
   * returns arrive as email or as a call, both of which already become a ticket,
   * and the return is created or linked from inside the ticket drawer rather
   * than from a new button of its own.
   */
  ticket: {
    id: toFieldId('ticket'),
    key: 'ticket',
    label: 'Ticket',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_ticket',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'a7',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'ticket:returns' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'ticket',
      relationshipType: 'belongs_to',
      inverseName: 'Returns',
      inverseSystemAttribute: 'ticket_returns',
    },
    description:
      'The conversation this return came out of. The ticket drawer is the primary creation ' +
      'door, so this is usually preset by the create-from-ticket flow',
  },

  requestedAt: {
    id: toFieldId('requestedAt'),
    key: 'requestedAt',
    label: 'Requested',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'return_requested_at',
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
      'When the customer asked to return. Null on a dock surprise, which never had a request',
  },

  receivedAt: {
    id: toFieldId('receivedAt'),
    key: 'receivedAt',
    label: 'Received',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'return_received_at',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'a9',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'When the goods physically arrived at the dock',
  },

  inspectedAt: {
    id: toFieldId('inspectedAt'),
    key: 'inspectedAt',
    label: 'Inspected',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'return_inspected_at',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
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
      'When the warehouse finished inspecting. Routinely WEEKS after the refund cleared, ' +
      'which is why money is not a status',
  },

  closedAt: {
    id: toFieldId('closedAt'),
    key: 'closedAt',
    label: 'Closed',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'return_closed_at',
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
    description: 'When the return was closed out, with nothing further owed in either direction',
  },

  /**
   * What the shipping label says, before anyone matches it to a contact. This
   * plus {@link senderAddressRaw} and the label photo in {@link photos} is the
   * whole of what the dock knows on a surprise pallet. No OCR in v1: the
   * warehouse reads the label and types it.
   */
  senderNameRaw: {
    id: toFieldId('senderNameRaw'),
    key: 'senderNameRaw',
    label: 'Sender Name (as labelled)',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'return_sender_name_raw',
    showInTable: false,
    systemSortOrder: 'aC',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter the name on the shipping label',
    description:
      'The sender exactly as the shipping label reads it, typed by the warehouse before any ' +
      'contact is matched. Never overwritten once a contact is identified - it is evidence',
  },

  senderAddressRaw: {
    id: toFieldId('senderAddressRaw'),
    key: 'senderAddressRaw',
    label: 'Sender Address (as labelled)',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'return_sender_address_raw',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aD',
    nullable: true,
    options: { multiline: true, rows: 3 },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter the address on the shipping label',
    description: 'The return address exactly as the shipping label reads it',
  },

  inboundCarrier: {
    id: toFieldId('inboundCarrier'),
    key: 'inboundCarrier',
    label: 'Inbound Carrier',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'return_inbound_carrier',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aE',
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
      'Who carried the goods back. Free text for the same reason `shipment_carrier` is: the ' +
      'carrier list is account configuration, not a registry fact',
  },

  inboundTracking: {
    id: toFieldId('inboundTracking'),
    key: 'inboundTracking',
    label: 'Inbound Tracking',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'return_inbound_tracking',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aF',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Enter tracking number',
    description: 'The tracking number on the inbound leg, when there is one',
  },

  labelProvided: {
    id: toFieldId('labelProvided'),
    key: 'labelProvided',
    label: 'Label Provided',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'return_label_provided',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aG',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Did we pay for the return label',
  },

  labelCost: {
    id: toFieldId('labelCost'),
    key: 'labelCost',
    label: 'Label Cost',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'return_label_cost',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aH',
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
      'What the return label cost us, in integer MINOR UNITS (1654 is $16.54). Null when the ' +
      'customer paid their own way back',
  },

  /**
   * What the returned items were sold for, in integer minor units.
   * TRANSCRIBED, never computed: recomputing it from the order lines would
   * silently correct a discount, a price override or a partial line, and the
   * whole point of this number is that it is what the customer was charged.
   */
  goodsValue: {
    id: toFieldId('goodsValue'),
    key: 'goodsValue',
    label: 'Goods Value',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'return_goods_value',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aI',
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
      'What the returned items were sold for, integer minor units. Transcribed, never ' +
      'computed from the order lines',
  },

  /**
   * What was actually credited, in integer minor units.
   *
   * DERIVED: rolled up from the credit memos linked through
   * {@link creditMemos}, never typed by a person. `creatable: false` and
   * `updatable: false` keep every human door shut, the same way the credit
   * memo's own totals are protected.
   */
  creditedAmount: {
    id: toFieldId('creditedAmount'),
    key: 'creditedAmount',
    label: 'Credited Amount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'return_credited_amount',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aJ',
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
      creatable: false, // rolled up from the linked memos - the roll-up is the only writer
      updatable: false,
      configurable: false,
    },
    description:
      'Rolled up from the linked credit memos, integer minor units. Derived, never typed. ' +
      'Memos present while status is below inspected is the "credited but not inspected" ' +
      'risk state, surfaced as a badge and deliberately never blocked',
  },

  /**
   * `goodsValue - creditedAmount`, in integer minor units. DERIVED.
   *
   * 🛑 This has NO GL effect and no account role of its own (§5.2). When we
   * refund $800 against $1,000 of goods, the memo IS $800 and the $200 was
   * never credited, so there is nothing to post. An earlier design added a
   * "damage deduction" LINE to the credit memo and was dropped: the memo is
   * connector-managed, its total equals what the channel refunded by
   * construction, and a line we add would be fought by the next sync.
   *
   * This is reporting and evidence. It is also already the column to sum if
   * "how much did we eat on damage" is ever wanted annually.
   */
  withheldAmount: {
    id: toFieldId('withheldAmount'),
    key: 'withheldAmount',
    label: 'Withheld Amount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'return_withheld_amount',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aK',
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
      creatable: false, // derived from goodsValue and creditedAmount
      updatable: false,
      configurable: false,
    },
    description:
      'Goods value minus credited amount, integer minor units. Derived, never typed, and it ' +
      'has no GL effect at all: the money was simply never credited',
  },

  /**
   * The sentence that goes in the chargeback rebuttal. Long-form on purpose:
   * "the customer damaged the mast during installation, see the dated
   * inspection photos" is what a card network reads, and it is the one piece of
   * this record a human has to write.
   */
  withheldReason: {
    id: toFieldId('withheldReason'),
    key: 'withheldReason',
    label: 'Withheld Reason',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'return_withheld_reason',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aL',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Why the full amount was not credited',
    description: 'Why the full amount was not credited - the sentence for the chargeback rebuttal',
  },

  /**
   * The label, the pallet, the packaging, the carrier paperwork. Documents as
   * well as images, because a dock surprise routinely arrives with a printed
   * packing slip or a carrier exception form and those are evidence too.
   */
  photos: {
    id: toFieldId('photos'),
    key: 'photos',
    label: 'Photos',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'return_photos',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aM',
    nullable: true,
    options: {
      file: { allowMultiple: true, maxFiles: 25, allowedFileTypes: ['document', 'image'] },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The shipping label, the pallet, the packaging and the carrier paperwork. Per-item ' +
      'damage photos belong on the return line, not here',
  },

  /**
   * The returned sold lines. One row per sold line PER CONDITION, so two lifts
   * returned pristine and wrecked are two rows against the same `line_item`.
   *
   * `cascade` because a return line is an owned child: it has no meaning
   * without its return. The has_many side declares the behavior; the
   * `belongs_to` on `return_line` declares nothing.
   */
  lines: {
    id: toFieldId('lines'),
    key: 'lines',
    label: 'Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_lines',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aN',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'return_line:return' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description:
      'The returned sold lines - one per sold line per condition, each carrying its own ' +
      'condition grade, liability verdict, photos and part tree',
  },

  /**
   * The credit memos raised for this return. INVERSE: the FK is on the memo
   * (`credit_memo.return`), because a return produces zero, one or several
   * memos, a memo very often has no return at all (an allowance, a
   * cancellation), and on the channel path the memo exists FIRST. That is the
   * only direction that works.
   *
   * `unlink` rather than `cascade`: a credit memo is a posted accounting
   * document with its own life, and deleting the return must never take one
   * with it.
   */
  creditMemos: {
    id: toFieldId('creditMemos'),
    key: 'creditMemos',
    label: 'Credit Memos',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'return_credit_memos',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aO',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'credit_memo:return' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'unlink',
      isInverse: true,
    },
    description:
      'The credit memos raised for this return. The return LINKS to memos and never creates ' +
      'one; a channel-sourced memo is connector-managed and must never be written to',
  },

  /**
   * The generated chargeback evidence pack, as a single FILE value - the
   * documents registry `pointerAttr` pattern.
   *
   * `updatable: false` (and `creatable: false`) is what keeps every human door
   * shut, exactly as on `credit_memo_pdf_asset`. Never make this user-writable:
   * `ensureDocumentPdf` reads the pointer, loads that MediaAsset and appends a
   * new VERSION whenever the content hash disagrees, and a file a person
   * uploaded has no `contentHash` at all, so the comparison always fails and
   * the next generation would silently republish their file as our pack.
   */
  evidencePackAsset: {
    id: toFieldId('evidencePackAsset'),
    key: 'evidencePackAsset',
    label: 'Evidence Pack',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'return_evidence_pack_asset',
    showInPanel: false,
    showInTable: false,
    showInDialogs: false,
    systemSortOrder: 'aP',
    nullable: true,
    options: {
      file: { allowMultiple: false, maxFiles: 1, allowedFileTypes: ['document'] },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
      hidden: true,
    },
    description: 'The generated chargeback evidence pack PDF - the generator is the only writer',
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
      'Automatically set when the return record is created in auxx. Never the date the goods ' +
      'arrived - see receivedAt',
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
    description: 'Automatically updated when the return is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
