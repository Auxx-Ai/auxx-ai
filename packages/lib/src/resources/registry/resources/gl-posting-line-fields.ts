// packages/lib/src/resources/registry/resources/gl-posting-line-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { GlPostingLineDirection } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the GL Posting Line resource — one double-entry line of
 * a {@link GL_POSTING_FIELDS gl_posting} journal entry
 * (plans/purchasing/01-build-plan.md §7.3, decisions P1/P2).
 *
 * **Why the lines are stored at all.** `post-journal-entry.ts` today takes
 * `JournalLine[]` carrying a QuickBooks `accountId` and persists **nothing** —
 * so the entry we posted is not reconstructable from our own data. Under P1 the
 * accounting system is an *exporter*, not the system of record, and an exporter
 * you cannot replay is just a one-way door. These rows are what make the ledger
 * ours: replayable, auditable, and provider-swappable.
 *
 * 🛑 **`accountCode` is an account CODE (`'1310'`), never a provider account
 * id.** This is decision P2 and the whole point of the seam. Provider ids live
 * in `RecordIdentity`, hung off `gl_account` by the app that owns them, so
 * swapping or adding an accounting provider changes a resolver and nothing in
 * the stored ledger. Put a provider id in this column and the ledger becomes
 * meaningless the moment that provider is disconnected, re-authorised into a
 * different realm, or replaced.
 *
 * 🛑 **`amount` is ALWAYS POSITIVE; `direction` carries the sign.** Storing a
 * signed amount *and* a direction lets the two disagree — a `credit` of `-500`
 * has two readings and no way to choose — and a ledger that can contradict
 * itself is not a ledger. One representation, one meaning.
 *
 * `sourceType` + `sourceId` are the audit trail: they name the row that
 * produced this line, which is what makes a posting explainable three years
 * later **without joining through a provider's API**.
 *
 * Hidden system entity, written only by the poster — the same shape
 * `gl_posting` and `payment` use.
 */
export const GL_POSTING_LINE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique GL posting line identifier',
  },

  glPosting: {
    id: toFieldId('glPosting'),
    key: 'glPosting',
    label: 'GL Posting',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'gl_posting_line_gl_posting',
    systemSortOrder: 'a1',
    showInPanel: false, // lines are read in the context of their posting
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false, // a line never moves between entries; it is voided and re-cut
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'gl_posting:lines' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'gl_posting',
      relationshipType: 'belongs_to',
      inverseName: 'Lines',
      inverseSystemAttribute: 'gl_posting_lines',
    },
    description: 'The journal entry this line belongs to — required',
  },

  accountCode: {
    id: toFieldId('accountCode'),
    key: 'accountCode',
    label: 'Account Code',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'gl_posting_line_account_code',
    systemSortOrder: 'a2',
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    placeholder: '1310',
    description:
      "An account CODE such as '1310', matching `gl_account.code` — NEVER a provider " +
      'account id (P2). Provider ids live in RecordIdentity on `gl_account`, so the ' +
      'stored ledger survives disconnecting, re-authorising or replacing the provider',
  },

  direction: {
    id: toFieldId('direction'),
    key: 'direction',
    label: 'Direction',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'gl_posting_line_direction',
    systemSortOrder: 'a3',
    nullable: false,
    options: { options: GlPostingLineDirection.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    placeholder: 'Select direction',
    description:
      'debit or credit. This field alone carries the SIGN of the line — `amount` is ' +
      'always positive',
  },

  amount: {
    id: toFieldId('amount'),
    key: 'amount',
    label: 'Amount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'gl_posting_line_amount',
    systemSortOrder: 'a4',
    nullable: false,
    options: {
      currencyCode: 'USD',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'symbol',
    },
    validation: { min: 0 },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    description:
      'Integer minor units, ALWAYS POSITIVE — `direction` carries the sign. Storing a ' +
      'signed amount as well as a direction would let the two disagree, and a ledger ' +
      'that can contradict itself is not a ledger',
  },

  memo: {
    id: toFieldId('memo'),
    key: 'memo',
    label: 'Memo',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'gl_posting_line_memo',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    placeholder: 'Line description',
    description: 'Per-line description, pushed through to the provider line where one exists',
  },

  sourceType: {
    id: toFieldId('sourceType'),
    key: 'sourceType',
    label: 'Source Type',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'gl_posting_line_source_type',
    systemSortOrder: 'a6',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    placeholder: 'stock_movement, vendor_bill',
    description:
      'Which KIND of row produced this line. Half of the audit trail: with `sourceId` it ' +
      "makes a posting explainable years later without joining through a provider's API",
  },

  sourceId: {
    id: toFieldId('sourceId'),
    key: 'sourceId',
    label: 'Source ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'gl_posting_line_source_id',
    systemSortOrder: 'a7',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description:
      'WHICH row produced this line — the id within `sourceType`. Kept as plain text ' +
      'rather than a relation on purpose: the source can be any of several entities, ' +
      'and the trail must stay readable even if that row is later archived',
  },

  sortOrder: {
    id: toFieldId('sortOrder'),
    key: 'sortOrder',
    label: 'Sort Order',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'gl_posting_line_sort_order',
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
    description: 'Presentation order of the lines within the entry',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a9',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the GL posting line is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'aA',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the GL posting line is modified',
  },
}
