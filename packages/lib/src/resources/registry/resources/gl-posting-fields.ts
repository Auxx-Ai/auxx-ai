// packages/lib/src/resources/registry/resources/gl-posting-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { GlPostingStatus, GlPostingType } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the GL Posting resource — the auxx-side record of one
 * summary journal entry pushed to the general ledger
 * (plans/auxx-lift/gap-b-quickbooks-journal-entry.md §6.2).
 *
 * **Why this entity exists at all.** A summary journal entry has no natural
 * record to hang an external id on: `qboCustomerId` hangs on a `contact`,
 * `qboInvoiceId` on an `invoice`, but "the 2026-08-18 daily fulfillment summary"
 * is none of those. Without a row of its own, idempotency collapses to querying
 * QuickBooks by `DocNumber` — which only DETECTS a double-post and cannot
 * prevent one, because `DocNumber` uniqueness depends on a company preference
 * the API cannot even read.
 *
 * With this row, `(postingType, periodKey)` makes double-posting
 * **unrepresentable at the source** rather than merely detected at the
 * destination — and the app-owned `qboJournalEntryId` identity field
 * (declared in the QuickBooks app's `fields.ts`) carries the write-through
 * `RecordIdentity` mirror for free.
 *
 * Hidden system entity: seeded for every org but written only by the poster,
 * mirroring `payment`. Gap G's close console is the intended read surface.
 */
export const GL_POSTING_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique GL posting identifier',
  },

  docNumber: {
    id: toFieldId('docNumber'),
    key: 'docNumber',
    label: 'Document Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'gl_posting_doc_number',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    placeholder: 'AUXX-FUL-20260818',
    description:
      'Deterministic natural key, also written to QuickBooks DocNumber. Max 21 characters — the QuickBooks limit. Derived from posting type and period, never random',
  },

  postingType: {
    id: toFieldId('postingType'),
    key: 'postingType',
    label: 'Posting Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'gl_posting_posting_type',
    systemSortOrder: 'a2',
    nullable: false,
    options: { options: GlPostingType.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    placeholder: 'Select posting type',
    description: 'Which of the accrual entry types this posting represents',
  },

  periodKey: {
    id: toFieldId('periodKey'),
    key: 'periodKey',
    label: 'Period',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'gl_posting_period_key',
    systemSortOrder: 'a3',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    placeholder: '2026-08-18',
    description:
      'The summarization window — a day (2026-08-18) for daily entries, a month (2026-08) for month-end ones. Together with posting type this is what makes a double-post unrepresentable',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'gl_posting_status',
    systemSortOrder: 'a4',
    nullable: false,
    options: { options: GlPostingStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Select status',
    description:
      'pending until the journal entry lands, then posted or failed. A pending row that outlives its run is the signal to reconcile against QuickBooks before retrying',
  },

  totalDebit: {
    id: toFieldId('totalDebit'),
    key: 'totalDebit',
    label: 'Total Debit',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'gl_posting_total_debit',
    systemSortOrder: 'a5',
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
      'What was posted, in minor units. Computed from our own lines — QuickBooks TotalAmt is always zero on a journal entry and would read as $0',
  },

  postedAt: {
    id: toFieldId('postedAt'),
    key: 'postedAt',
    label: 'Posted At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'gl_posting_posted_at',
    systemSortOrder: 'a6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description: 'When the journal entry was accepted by QuickBooks. Null until it posts',
  },

  failureReason: {
    id: toFieldId('failureReason'),
    key: 'failureReason',
    label: 'Failure Reason',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'gl_posting_failure_reason',
    systemSortOrder: 'a7',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description:
      'The QuickBooks fault, verbatim, including its numeric code. Kept verbatim on purpose — a paraphrased accounting error is not diagnosable',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a8',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the GL posting is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'a9',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the GL posting is modified',
  },

  // Reverse relationship: lines (from gl_posting_line.glPosting)
  lines: {
    id: toFieldId('lines'),
    key: 'lines',
    label: 'Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'gl_posting_lines',
    showInPanel: false,
    systemSortOrder: 'c0',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'gl_posting_line:glPosting' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description:
      'The double-entry lines of this posting - account CODE plus a positive amount and a direction',
  },
}
