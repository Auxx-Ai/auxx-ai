// packages/lib/src/resources/registry/resources/bank-account-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * What kind of account the bank says this is, and therefore which side of the
 * balance sheet it lives on.
 *
 * 🛑 **A `credit` account is a LIABILITY and its signs are inverted**
 * (plans/bank-connection/02-connection-architecture.md §6). This is asserted
 * ONCE, from this field, at mapping time - never inferred per transaction. Get
 * it wrong and the balance sheet still balances, which is what two years of it
 * looks like: LFK's QuickBooks card sits at -$570,855.81 against a real
 * $29,701.88.
 */
export const BANK_ACCOUNT_TYPE_OPTIONS = [
  { label: 'Depository', value: 'depository', color: 'blue' },
  { label: 'Credit', value: 'credit', color: 'amber' },
] as const

/**
 * Where the rows on this account come from.
 *
 * `manual` is an account somebody typed in and imports statements into;
 * `connected` has a live `DataConnector`; `disconnected` HAD one. There is no
 * `deleted` value on purpose - disconnecting keeps every row, because a
 * `bank_transaction` that has been coded and posted is the source document of a
 * journal entry (02 §5.1).
 */
export const BANK_ACCOUNT_STATUS_OPTIONS = [
  { label: 'Manual', value: 'manual', color: 'gray' },
  { label: 'Connected', value: 'connected', color: 'green' },
  { label: 'Disconnected', value: 'disconnected', color: 'red' },
] as const

/**
 * Field definitions for the Bank Account resource
 * (plans/bank-connection/02-connection-architecture.md §6, HANDOFF slot 2I).
 *
 * ## Why this entity exists
 *
 * It is where the feed meets the chart of accounts. Every other part of the bank
 * subsystem is transport; this row is the one place that says "the money in this
 * institution's account is the money in GL account 1000", and it is what lets a
 * reconciliation, a coverage warning and a balance sheet all mean the same
 * thing by "cash".
 *
 * ## The connection is NOT stored here
 *
 * Decision **B4**: there is no `bank_connection` entity and no connection state
 * on this row beyond {@link BANK_ACCOUNT_FIELDS.connectorId}. The `DataConnector`
 * row already carries `status`, `error`, `lastSyncedAt`, `lastWebhookEventAt`,
 * `itemCount`, the credential link and the run history, and a second copy of any
 * of that would be a second answer to "is this feed healthy". `connectorId` is
 * a POINTER; `banking/reads.ts` joins it and returns the connector's own values.
 *
 * ⚠️ One connector is one bank account and one credential is one bank LOGIN, so
 * two accounts under one login share a credential and hold two connector ids
 * (plans/accounting/implementation-review.md §2).
 *
 * ## `glAccount` is a CODE as TEXT, not a relationship
 *
 * 🛑 The bank plan (02 §6) asks for a RELATIONSHIP to `gl_account`, on the
 * argument that an org that renumbers Cash from `1000` to `1010` must not break
 * the feed. That argument is right and this field still departs from it, for the
 * reason `bank_deposit.bankAccount` and `vendor_bill_line.glAccount` already
 * departed: **there is no `gl_account` relationship precedent anywhere in the
 * registry** - every GL pointer in the money subsystem is a code as TEXT, and
 * `resolveRoles` takes a code with no foreign key (decision `P2`). One
 * inconsistent field would be worse than one consistent departure. A single
 * later migration converts every one of them together.
 *
 * ## Coverage
 *
 * {@link BANK_ACCOUNT_FIELDS.coverageFrom} and
 * {@link BANK_ACCOUNT_FIELDS.coverageGaps} are the per-account coverage record
 * that plans/bank-connection/01 §4.1 (4c) calls "the one most likely to be
 * skipped and most expensive to add later". Without it a balance sheet spanning
 * a hole renders happily and is wrong - arithmetically right, financially
 * meaningless, and silent. They are STORED as well as derived: `readCoverage`
 * recomputes gaps from the transactions it can see, and these columns are what
 * an importer stamps when it knows something the transactions cannot say (a
 * statement was imported for a range that legitimately had no activity).
 */
export const BANK_ACCOUNT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique bank account identifier',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_account_name',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Business Adv Relationship',
    description:
      'The account name the bank shows. The display field - a row reads ' +
      '"Bank of America - Business Adv Relationship ...5381"',
  },

  institution: {
    id: toFieldId('institution'),
    key: 'institution',
    label: 'Institution',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_account_institution',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Bank of America',
    description:
      'The bank. Accounts group by this on the settings page, because a reconnect is per ' +
      'LOGIN and not per account',
  },

  last4: {
    id: toFieldId('last4'),
    key: 'last4',
    label: 'Last Four',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_account_last4',
    systemSortOrder: 'a3',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '5381',
    description:
      'The last four digits, as the bank prints them. TEXT and never a number - a leading ' +
      'zero is part of the account and 0381 must not read as 381',
  },

  type: {
    id: toFieldId('type'),
    key: 'type',
    label: 'Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_account_type',
    systemSortOrder: 'a4',
    nullable: false,
    options: { options: [...BANK_ACCOUNT_TYPE_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select type',
    defaultValue: 'depository',
    description:
      'depository (an asset) or credit (a liability whose signs invert). Asserted once at ' +
      'mapping time and never inferred per transaction',
  },

  currency: {
    id: toFieldId('currency'),
    key: 'currency',
    label: 'Currency',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_account_currency',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'USD',
    defaultValue: 'USD',
    description:
      'ISO 4217. The ledger is single-currency today, so a non-USD account is recorded and ' +
      'refused at posting rather than silently converted',
  },

  glAccount: {
    id: toFieldId('glAccount'),
    key: 'glAccount',
    label: 'GL Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_account_gl_account',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '1000',
    description:
      'The GL account CODE this account maps to, from the org own chart. THE point of this ' +
      'entity. TEXT rather than a RELATIONSHIP because every GL pointer in the money ' +
      'subsystem is a code (decision P2); one later migration converts them all together',
  },

  feedStartDate: {
    id: toFieldId('feedStartDate'),
    key: 'feedStartDate',
    label: 'Feed Start',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'bank_account_feed_start_date',
    systemSortOrder: 'a7',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select date',
    description:
      'The earliest date we TRUST on this account. Distinct from coverageFrom, which is the ' +
      'earliest date we HOLD - a feed can deliver rows before the cutover that nobody has ' +
      'agreed to book',
  },

  coverageFrom: {
    id: toFieldId('coverageFrom'),
    key: 'coverageFrom',
    label: 'Coverage From',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'bank_account_coverage_from',
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
      'The earliest date this account has data for, by any means. Drives the setup wizard ' +
      'gap number and lets a reconciliation refuse to run over a hole',
  },

  coverageGaps: {
    id: toFieldId('coverageGaps'),
    key: 'coverageGaps',
    label: 'Coverage Gaps',
    type: BaseType.JSON,
    fieldType: FieldType.JSON,
    isSystem: true,
    systemAttribute: 'bank_account_coverage_gaps',
    systemSortOrder: 'a9',
    nullable: true,
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Ranges with no data, as [{ from, to }] date keys. JSON on the record rather than a ' +
      'child entity, the journal_entry_lines precedent: a gap has no independent identity, ' +
      'nothing links to one, and the whole list is replaced every time it is recomputed',
  },

  connectorId: {
    id: toFieldId('connectorId'),
    key: 'connectorId',
    label: 'Connector',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_account_connector_id',
    systemSortOrder: 'aA',
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
      'The DataConnector row that feeds this account, or null for a manual one. A POINTER, ' +
      'never a copy: status, last synced, item count and error are read off the connector ' +
      'so there is one answer to "is this feed healthy" (decision B4)',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_account_status',
    systemSortOrder: 'aB',
    nullable: false,
    options: { options: [...BANK_ACCOUNT_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'manual',
    description:
      'manual, connected, or disconnected. Disconnecting keeps every row - a coded and ' +
      'posted bank line is the source document of a journal entry',
  },

  transactions: {
    id: toFieldId('transactions'),
    key: 'transactions',
    label: 'Transactions',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'bank_account_transactions',
    systemSortOrder: 'aC',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'bank_transaction:bankAccount' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description:
      'The statement lines on this account. The INVERSE half - the owning side is ' +
      'bank_transaction.bankAccount, and both halves must exist in one migration or ' +
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
    description: 'Automatically set when the account is created',
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
    description: 'Automatically updated when the account is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
