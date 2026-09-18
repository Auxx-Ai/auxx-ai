// packages/lib/src/resources/registry/resources/payment-gateway-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { PaymentGatewayFeeTreatment, PaymentGatewayStatus } from '../enum-values'
import { defineResourceFields } from '../system-attributes'

/**
 * Field definitions for the Payment Gateway resource
 * (`plans/accounting/tasks/done/13-cash-accounts-and-the-qbo-seam.md` §5.3, HANDOFF
 * step 5).
 *
 * ## Why this entity exists
 *
 * `13` §5.1's gateway census counted eleven distinct handles across five card
 * rails on one store's history, and the pattern that had already been applied
 * once (`clearing_affirm`, entity migration 137) did not survive a second
 * application: role-per-gateway costs a role, an account and a chart migration
 * per rail, and a rail is not permanent (the store cut over from
 * Authorize.Net to Shopify Payments mid-book). A `payment_gateway` record is a
 * ROW instead: a gateway is a fact about the business, never a function the
 * chart has to grow a role for. `clearing_affirm` was retired into a record on
 * 2026-09-10 and `ACCOUNT_ROLES` now names no gateway at all.
 *
 * 🛑 **This does NOT mint an account per gateway.** {@link clearingAccount} and
 * {@link feeAccount} name WHICH account a gateway settles into; two rails
 * sharing one clearing account is normal (`1200` already is that for every
 * unrecognised card rail) and this entity does not demand a new one. A gateway
 * whose settlements auxx can see gets its own so it reconciles independently;
 * a dead one can share.
 *
 * ## `clearingAccount` / `feeAccount` are `gl_account` EntityInstance ids, as
 * TEXT, no relationship
 *
 * The same call `bank_account.glAccount` makes
 * (`plans/accounting/tasks/done/15-the-account-id-is-the-identity.md` §4): plain
 * `text()`, no `references()`, validated for existence, active status and
 * type on every read, fail closed. A registry relationship buys nothing a
 * read-time check does not already have to do.
 *
 * ## `handles` is a SET, not one string
 *
 * §5.1's census: `authorize_net` / `authorize.net` and `Affirm` / `affirm` are
 * each one rail arriving under two spellings. A `payment_gateway` keyed on a
 * single handle would need two rows for one rail; `handles` is a TAGS field so
 * one record can claim every spelling a gateway is seen under.  Compared
 * case-insensitively and trimmed at write time and at match time
 * (`normaliseGatewayHandle` in `payment-gateways/client.ts`), mirroring
 * `normaliseGateways` in `postings/build-fulfillment-batch-entry.ts`.
 *
 * Hidden system entity (`isVisible: false`) - the door is Accounting >
 * Settings > Payment gateways, a master-detail settings page, the same shape
 * `bank_account` uses and for the same reason: a purpose-built screen is a
 * better door than an auto-linked sidebar entry.
 */
export const PAYMENT_GATEWAY_FIELDS = defineResourceFields({
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
    description: 'Unique payment gateway identifier',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payment_gateway_name',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Shopify Payments',
    description: 'What the settings screen calls this gateway. The display field.',
  },

  handles: {
    id: toFieldId('handles'),
    key: 'handles',
    label: 'Gateway handles',
    type: BaseType.TAGS,
    fieldType: FieldType.TAGS,
    isSystem: true,
    systemAttribute: 'payment_gateway_handles',
    systemSortOrder: 'a2',
    nullable: false,
    options: { options: [] },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Add a gateway handle',
    description:
      'Every stored `order_payment_gateways` value this rail is seen under - a SET, because ' +
      'two rails arrive under two spellings each (`authorize_net`/`authorize.net`, ' +
      '`Affirm`/`affirm`). Compared trimmed and lower-cased, never one string.',
  },

  feeTreatment: {
    id: toFieldId('feeTreatment'),
    key: 'feeTreatment',
    label: 'Fee treatment',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'payment_gateway_fee_treatment',
    systemSortOrder: 'a5a',
    nullable: false,
    options: { options: PaymentGatewayFeeTreatment.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select fee treatment',
    defaultValue: 'netted',
    description:
      'Whether the processor withholds its cut from the deposit (`netted`) or bills for it ' +
      'later (`billed`). A payout entry on a billed rail has NO fee leg and its deposit is ' +
      'gross, so this decides the shape of the entry, not just a label. Deliberately not ' +
      'folded into settlementSource: PayPal and Authorize.Net are both `manual` and disagree ' +
      'on this, and Affirm reads a feed and still nets its fee.',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'payment_gateway_status',
    systemSortOrder: 'a6',
    nullable: false,
    options: { options: PaymentGatewayStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'active',
    description:
      'A rail is not permanent (§5.1: Authorize.Net closed May 2026, its clearing balance ' +
      'still winding down to zero). `closed` marks it retired; a closed rail still routes its ' +
      'history, because `toGatewayRoutes` reads active AND closed rows.',
  },

  lastSettlementAt: {
    id: toFieldId('lastSettlementAt'),
    key: 'lastSettlementAt',
    label: 'Last settlement',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'payment_gateway_last_settlement_at',
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
      'The last date this rail is known to have settled. Informational - nothing in posting ' +
      'reads it today - and what the screen shows under a closed gateway to say why it is ' +
      'still worth seeing.',
  },

  lastFeeBookedAt: {
    id: toFieldId('lastFeeBookedAt'),
    key: 'lastFeeBookedAt',
    label: 'Last fee booked',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'payment_gateway_last_fee_booked_at',
    systemSortOrder: 'a7a',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The last date a fee was booked to this rail. Informational only, exactly like ' +
      'lastSettlementAt - nothing in posting reads it. A billed rail has no statement auxx can ' +
      'read, so the close console shows this DATE rather than a checkmark or a refusal: a rail ' +
      'that bills quarterly would nag two months in three and teach everyone to ignore it.',
  },

  payouts: {
    id: toFieldId('payouts'),
    key: 'payouts',
    label: 'Payouts',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'payment_gateway_payouts',
    systemSortOrder: 'a8',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'payout:paymentGateway' as ResourceFieldId,
      relationshipType: 'has_many',
      // A payout is posting history and its rail is the routing key the entry
      // was built from. A gateway is retired with `status: 'closed'`, never
      // deleted (writes.ts header), so the generic delete door refusing while
      // any payout still names the record is the only answer that keeps the
      // history attributable.
      onDelete: 'restrict',
      isInverse: true,
    },
    description:
      'The settlements this rail produced (brief 27 §6.1). The INVERSE half - the owning side ' +
      'is payout.paymentGateway, and both halves must exist in one migration or ' +
      'linkNewRelationships skips the pair with a debug line',
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
    description: 'Automatically set when the gateway is created',
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
    description: 'Automatically updated when the gateway is modified',
  },

  createdBy: CREATED_BY_FIELD,
})
