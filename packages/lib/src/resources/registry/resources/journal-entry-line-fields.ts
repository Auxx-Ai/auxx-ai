// packages/lib/src/resources/registry/resources/journal-entry-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { JournalEntryLineCounterpartyType, JournalEntryLineSide } from '../enum-values'
import { defineResourceFields } from '../system-attributes'

/**
 * Field definitions for the Journal Entry Line resource — one row per line a
 * bookkeeper types into a manual journal (91 D5). Hidden system entity, managed
 * from the entry it belongs to, like `vendor_bill_line`. Post builds the entry
 * from these rows; the ledger never stores them a second time.
 */
export const JOURNAL_ENTRY_LINE_FIELDS = defineResourceFields({
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
  },

  journalEntry: {
    id: toFieldId('journalEntry'),
    key: 'journalEntry',
    label: 'Journal Entry',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'journal_entry_line_journal_entry',
    systemSortOrder: 'a1',
    showInPanel: false,
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'journal_entry:lines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'journal_entry',
      relationshipType: 'belongs_to',
      inverseName: 'Lines',
      inverseSystemAttribute: 'journal_entry_lines',
    },
  },

  // The `gl_account` instance id, as `vendor_bill_line_gl_account` names its account:
  // TEXT, no foreign key, not a code and not a role (task 15 §4).
  glAccount: {
    id: toFieldId('glAccount'),
    key: 'glAccount',
    label: 'GL Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'journal_entry_line_gl_account',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select account',
    description:
      "The gl_account id this line posts to, in the organization's own chart of accounts. " +
      'TEXT with no foreign key, not a code and not an auxx posting role.',
  },

  side: {
    id: toFieldId('side'),
    key: 'side',
    label: 'Side',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'journal_entry_line_side',
    systemSortOrder: 'a3',
    nullable: false,
    defaultValue: JournalEntryLineSide.DEBIT,
    options: { options: JournalEntryLineSide.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Debit or credit. The only carrier of sign - the amount is always positive',
  },

  amount: {
    id: toFieldId('amount'),
    key: 'amount',
    label: 'Amount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'journal_entry_line_amount',
    systemSortOrder: 'a4',
    nullable: false,
    options: { currencyCode: 'USD', decimals: 2, useGrouping: true, currencyDisplay: 'symbol' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Integer minor units, greater than zero',
  },

  memo: {
    id: toFieldId('memo'),
    key: 'memo',
    label: 'Memo',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'journal_entry_line_memo',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: "The line's own memo. The entry's memo covers a line that has none",
  },

  counterpartyType: {
    id: toFieldId('counterpartyType'),
    key: 'counterpartyType',
    label: 'Counterparty Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'journal_entry_line_counterparty_type',
    systemSortOrder: 'a6',
    showInTable: false,
    nullable: true,
    options: { options: JournalEntryLineCounterpartyType.values },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  },

  // A `contact` (customer) or `company` (vendor) instance id, by `counterpartyType`.
  // TEXT for the same reason as `glAccount`: one field names either kind.
  counterparty: {
    id: toFieldId('counterparty'),
    key: 'counterparty',
    label: 'Counterparty',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'journal_entry_line_counterparty',
    systemSortOrder: 'a7',
    showInTable: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Who this line is attributable to when it names a receivable or payable account (brief 13 §1.4)',
  },

  sortOrder: {
    id: toFieldId('sortOrder'),
    key: 'sortOrder',
    label: 'Sort Order',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'journal_entry_line_sort_order',
    systemSortOrder: 'a8',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
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
  },

  createdBy: CREATED_BY_FIELD,
})
