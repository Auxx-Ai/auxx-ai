// packages/lib/src/resources/registry/resources/payout-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * A payout's life. `paid` is the only status that carries a posting.
 *
 * `failed` exists because a gateway can claw a payout back after announcing it:
 * a bank rejects the transfer and Stripe fires `payout.failed` days later. The
 * money never arrived, so the entry that said it did has to be REVERSED, and
 * `reversed` is what that leaves behind - never an edit, and never a delete.
 */
export const PAYOUT_STATUS_OPTIONS = [
  { label: 'In transit', value: 'in_transit', color: 'amber' },
  { label: 'Paid', value: 'paid', color: 'green' },
  { label: 'Failed', value: 'failed', color: 'red' },
  { label: 'Reversed', value: 'reversed', color: 'gray' },
] as const

/**
 * Field definitions for the Payout resource - one gateway settlement, the
 * batch of charges it paid out, and the entry it became.
 *
 * ## Why an entity, when the payout lives in Stripe
 *
 * Three things, and the first two on their own would be enough:
 *
 * 1. **A SHORT NUMBER.** `buildPayoutEntry` refuses a bare `po_…`: a Stripe
 *    payout id is 27 characters and the document number allows 21. The posting
 *    keys its `periodKey` on the payout, and it cannot key on a date because two
 *    payouts can settle in one day. So a payout needs a minted `PAY-0001`, and a
 *    minted number needs a row.
 * 2. **An idempotency key with a memory.** The sync is a poll, so it sees the
 *    same payout again on every run. `payoutId` is what says "already ingested",
 *    and it has to survive the process.
 * 3. **The recognised/unrecognised split, kept.** {@link PAYOUT_FIELDS.unrecognisedNetMinor}
 *    is the money the gateway settled that auxx has no payment for. Somebody has
 *    to work that number down, and it has to be visible per payout to be worked
 *    at all - a single balance in `2450` names no payout.
 *
 * ## 🛑 Every amount here is a TRANSCRIPTION
 *
 * The same rule a vendor bill's totals keep. `grossMinor`, `feesMinor` and
 * `netMinor` are what the gateway reported for the charges auxx recognised, and
 * `buildPayoutEntry` REFUSES the entry when they do not agree rather than
 * deriving one from the other two. Recomputing them here would silently correct
 * the gateway's arithmetic, and `1200 Card Clearing` would then be impossible to
 * reconcile to zero for reasons nobody could reconstruct.
 *
 * ⚠️ `depositedMinor` is the one number that is NOT about the recognised
 * charges: it is the whole transfer that reached the bank, which is what the
 * cash leg is debited and what the bank line shows. `depositedMinor =
 * netMinor + unrecognisedNetMinor`.
 *
 * Hidden system entity (`isVisible: false`), like `bank_deposit` and
 * `gl_account`: the door is Accounting > Banking > Payouts, and a payout is only
 * ever created by the sync - there is no create dialog to reach.
 */
export const PAYOUT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique payout identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payout_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      // RecordSequence-issued (`PAY-0001`), the `bank_deposit` precedent - the
      // system hook is the ONLY writer. It is also the posting's `periodKey`,
      // because a Stripe `po_…` id blows the 21-character document-number cap
      // and two payouts can settle on one day.
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically generated payout number',
  },

  payoutId: {
    id: toFieldId('payoutId'),
    key: 'payoutId',
    label: 'Gateway Payout ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payout_gateway_id',
    systemSortOrder: 'a2',
    nullable: false,
    isIdentifier: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    placeholder: 'po_1AbCdEf...',
    description:
      "The gateway's own payout id, and every posting line's sourceId. THE idempotency key " +
      'for the sync, which is a poll and sees the same payout on every run',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'payout_status',
    systemSortOrder: 'a3',
    nullable: false,
    options: { options: [...PAYOUT_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'in_transit',
    description:
      'in_transit until the gateway confirms, paid once it has, failed when the bank ' +
      'rejected it, reversed once the entry that said it arrived has been backed out',
  },

  paidAt: {
    id: toFieldId('paidAt'),
    key: 'paidAt',
    label: 'Paid At',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'payout_paid_at',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The date the money reached the bank. THE accounting date - the entry is dated from ' +
      'this, never from when the charges it settles were taken',
  },

  currency: {
    id: toFieldId('currency'),
    key: 'currency',
    label: 'Currency',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payout_currency',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    placeholder: 'usd',
    description:
      "The payout's own currency, lowercase as the gateway reports it. Recorded so a " +
      'multi-currency account can be told apart later; the sync posts only the org book currency',
  },

  depositedMinor: {
    id: toFieldId('depositedMinor'),
    key: 'depositedMinor',
    label: 'Deposited',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'payout_deposited',
    systemSortOrder: 'a6',
    nullable: false,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Integer minor units. The WHOLE transfer that reached the bank, which is what the ' +
      'cash leg is debited and what the bank line shows. Equals net + unrecognised net',
  },

  grossMinor: {
    id: toFieldId('grossMinor'),
    key: 'grossMinor',
    label: 'Recognised Gross',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'payout_gross',
    systemSortOrder: 'a7',
    nullable: false,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Integer minor units. What the charges auxx HAS a payment for settled at, gross - ' +
      'exactly what is relieved from card clearing. Transcribed from the gateway, never derived',
  },

  feesMinor: {
    id: toFieldId('feesMinor'),
    key: 'feesMinor',
    label: 'Recognised Fees',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'payout_fees',
    systemSortOrder: 'a8',
    nullable: false,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Integer minor units. What the PROCESSOR withheld on the recognised charges - not the ' +
      'Connect application fee, which is a different number in money/payments/fees.ts',
  },

  netMinor: {
    id: toFieldId('netMinor'),
    key: 'netMinor',
    label: 'Recognised Net',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'payout_net',
    systemSortOrder: 'a9',
    nullable: false,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Integer minor units. Recognised gross less recognised fees. The entry REFUSES to post ' +
      'when these three do not agree, rather than deriving one from the other two',
  },

  unrecognisedNetMinor: {
    id: toFieldId('unrecognisedNetMinor'),
    key: 'unrecognisedNetMinor',
    label: 'Unidentified',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'payout_unrecognised_net',
    systemSortOrder: 'aA',
    nullable: false,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Integer minor units, net. What this payout settled that auxx has no payment for - a ' +
      'charge taken outside auxx. Credited to 2450 Unidentified Receipts, where somebody has ' +
      'to code it. Zero is the ordinary case',
  },

  unrecognisedCount: {
    id: toFieldId('unrecognisedCount'),
    key: 'unrecognisedCount',
    label: 'Unidentified Charges',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'payout_unrecognised_count',
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
      'How many balance transactions in this payout auxx could not match to a payment. The ' +
      'amount alone does not say whether it is one big charge or forty small ones',
  },

  glPostingId: {
    id: toFieldId('glPostingId'),
    key: 'glPostingId',
    label: 'GL Posting',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payout_gl_posting_id',
    systemSortOrder: 'aC',
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
      'The posting this payout became. TEXT and not a RELATIONSHIP because GlPosting is a ' +
      'Drizzle table with no EntityDefinition to point at - the journal_entry precedent',
  },

  destination: {
    id: toFieldId('destination'),
    key: 'destination',
    label: 'Destination',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payout_destination',
    systemSortOrder: 'aE',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    placeholder: 'ba_1AbCdEf...',
    description:
      "The gateway's own external-account id this payout settled to (brief 13 §2.3). Resolved " +
      "against a bank account's confirmed stripeExternalAccountId to find which gl_account to " +
      'debit - never last4',
  },

  blockedReason: {
    id: toFieldId('blockedReason'),
    key: 'blockedReason',
    label: 'Blocked Reason',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payout_blocked_reason',
    systemSortOrder: 'aF',
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
      'Set when this payout could not be posted for lack of a confirmed bank-account identity ' +
      '(brief 13 §2.3). Names the payout, the destination id and the remedy. Null once posted',
  },

  bankTransactionId: {
    id: toFieldId('bankTransactionId'),
    key: 'bankTransactionId',
    label: 'Bank Transaction ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'payout_bank_transaction_id',
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
      'The imported bank statement line this payout matches. Same name and semantics as the ' +
      'bank_deposit and vendor payment twins, so the feed matcher has ONE shape to look for',
  },

  createdBy: CREATED_BY_FIELD,
}
