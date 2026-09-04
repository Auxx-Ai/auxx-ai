// packages/lib/src/resources/registry/resources/bank-transaction-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * What the BANK says about this line.
 *
 * ⚠️ **Two unrelated things mean "pending"** (plans/bank-connection/02 §6). This
 * one is the transaction's state at the bank. The account's
 * `transaction_refresh.status` is `pending | succeeded | failed` for the FETCH.
 * They are named apart on purpose so that nobody ever writes `if (tx.pending)`.
 *
 * 🛑 `void` is a STATE CHANGE on a row we already hold, never a deletion. The
 * row stays, and if it carried a posting that posting is REVERSED. This is the
 * movement ledger's rule and the reason Stripe FC's model suits us better than
 * a `removed[]` array.
 */
export const BANK_TRANSACTION_BANK_STATUS_OPTIONS = [
  { label: 'Pending', value: 'pending', color: 'amber' },
  { label: 'Posted', value: 'posted', color: 'green' },
  { label: 'Void', value: 'void', color: 'gray' },
] as const

/** Where the row came from. The dedupe key must work across BOTH (02 §7). */
export const BANK_TRANSACTION_SOURCE_OPTIONS = [
  { label: 'Feed', value: 'feed', color: 'blue' },
  { label: 'Import', value: 'import', color: 'purple' },
] as const

/**
 * What a human has decided about this line, and the ONE field group the
 * connector may never touch.
 *
 * `for_review` is the arrival state; `suggested` means a rule or the org's own
 * history proposed a treatment nobody has accepted yet; `matched` links to an
 * existing document and posts NOTHING (decision **B5**); `coded` produced a
 * posting of its own; `excluded` is a deliberate "this is not ours".
 */
export const BANK_TRANSACTION_REVIEW_STATUS_OPTIONS = [
  { label: 'For review', value: 'for_review', color: 'amber' },
  { label: 'Suggested', value: 'suggested', color: 'blue' },
  { label: 'Matched', value: 'matched', color: 'green' },
  { label: 'Coded', value: 'coded', color: 'teal' },
  { label: 'Excluded', value: 'excluded', color: 'gray' },
] as const

/**
 * Field definitions for the Bank Transaction resource
 * (plans/bank-connection/02-connection-architecture.md §6, HANDOFF slot 2I).
 *
 * ## The two field groups, and the split IS the design
 *
 * **Connector-owned (raw):** {@link BANK_TRANSACTION_FIELDS.externalId},
 * `bankAccount`, `postedAt`, `description`, `amountMinor`, `bankStatus`,
 * `matchKey`, `importBatchId`, `source`. The feed may correct any of them.
 *
 * **Auxx-owned (review):** `reviewStatus`, `glAccount`, `matchedRecordId`,
 * `matchedRecordType`, `excludeReason`, `reviewedAt`, `reviewedByUserId`,
 * `glPostingId`, `ruleId`. The feed may never touch any of them.
 *
 * 🛑 **This def is a CONTRIBUTING-mode target, never an owned one** (02 §5.1).
 * The def is a system entity seeded by an entity migration and owned by auxx;
 * the feed contributes to it with per-field ownership, so orphan-archive is
 * structurally unavailable. A reconciliation sweep that could archive a row
 * because it fell out of the upstream window would be deleting a posted journal
 * entry's source document.
 *
 * ⚠️ Once {@link BANK_TRANSACTION_FIELDS.glPostingId} is set the connector may
 * not mutate the RAW fields either (02 §5.2): a pending charge of $1,240.00 that
 * posts at $1,255.00 must raise an amendment for a human to resolve by
 * reversing, not silently rewrite a posting's source. That is a rule in the
 * connector plus a `setConnectorFieldPin`, not a capability here - the fields
 * stay `updatable: true` because the review path itself has to go through them.
 *
 * ## Why `amountMinor` is the one signed money column in the ledger
 *
 * 🛑 Every GL amount in this codebase is positive with direction in its own
 * field (rule `G2`). **This column is deliberately different**: it mirrors what
 * the bank said, and the bank says `-1000`. Splitting the sign off at ingest
 * would make the row disagree with the statement it is a copy of, and
 * reconciliation is precisely the act of comparing the two. The split into
 * `Math.abs(amount)` plus a direction happens at the BUILDER boundary, once,
 * when a reviewed line becomes an entry - never here. The LEDGER lines stay
 * unsigned.
 *
 * ✅ It is already integer minor units by luck: Stripe FC's `amount` is cents,
 * so there is no float, no decimal parse and no conversion boundary.
 *
 * ## Importable by the shared CSV importer
 *
 * File import is not optional (02 §7, 01 §4.1): the API reaches back 180 days,
 * an institution may not be covered at all, and a dead feed mid-close still has
 * to be finished. So this def is a first-class target for
 * `apps/web/src/components/data-import/`: {@link BANK_TRANSACTION_FIELDS.externalId}
 * is a `unique`, filterable, creatable TEXT identifier (tier 1 in
 * `import/fields/identifier-eligibility.ts`), and every raw field is `creatable`
 * so a column can map onto it.
 *
 * ⚠️ **The dedupe key must work for two sources from day one** (02 §7). An
 * overlap where a file and the API both cover the same fortnight is the NORMAL
 * case. `externalId` carries the provider id for a feed row and a
 * deterministic composite for an imported one; `importBatchId` and `source` are
 * what make a bad import undoable.
 */
export const BANK_TRANSACTION_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique bank transaction identifier',
  },

  // ── Connector-owned (raw) ─────────────────────────────────────────────

  externalId: {
    id: toFieldId('externalId'),
    key: 'externalId',
    label: 'External ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_external_id',
    systemSortOrder: 'a1',
    nullable: true,
    isIdentifier: true,
    isUnique: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      unique: true,
      configurable: false,
    },
    placeholder: 'fctxn_1LXp9RGxLVUXRs6HtTSVfxse',
    description:
      'The dedupe key, and the CSV importer match key. The provider id for a feed row; a ' +
      'deterministic composite for an imported one. Designed for two sources from day one - ' +
      'a file and the API both covering the same fortnight is the normal case, not an edge',
  },

  bankAccount: {
    id: toFieldId('bankAccount'),
    key: 'bankAccount',
    label: 'Bank Account',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'bank_transaction_bank_account',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'bank_account:transactions' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'bank_account',
      relationshipType: 'belongs_to',
      inverseName: 'Transactions',
      inverseSystemAttribute: 'bank_account_transactions',
    },
    description:
      'The account this line is on. A real RELATIONSHIP, unlike every GL pointer nearby - ' +
      'bank_account is an entity in the same org and there is nothing to renumber',
  },

  postedAt: {
    id: toFieldId('postedAt'),
    key: 'postedAt',
    label: 'Date',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'bank_transaction_posted_at',
    systemSortOrder: 'a3',
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
      'THE accounting date, and period membership is decided by it. Carries the provider ' +
      'transacted_at (when the economic event happened), NOT posted_at - the two routinely ' +
      'differ across a month boundary and posted_at is a processing artefact. The Unix ' +
      'timestamp is converted to a wall-clock date in accounting.bookTimeZone at ingest',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_description',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The raw string the bank sent, verbatim - trace numbers, dates, padding and all. ' +
      'Stripe FC has NO merchant enrichment and NO categories, so this is the only text ' +
      'there is; the cleaned form lives in matchKey',
  },

  amountMinor: {
    id: toFieldId('amountMinor'),
    key: 'amountMinor',
    label: 'Amount',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'bank_transaction_amount',
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
      'Integer minor units, SIGNED - the one signed money column in the books. It mirrors ' +
      'the bank, and the bank says -1000. Splitting the sign off here would make the row ' +
      'disagree with the statement it is a copy of, and reconciling is comparing the two. ' +
      'The split into a positive amount plus a direction happens once, at the builder ' +
      'boundary; the LEDGER lines stay unsigned',
  },

  bankStatus: {
    id: toFieldId('bankStatus'),
    key: 'bankStatus',
    label: 'Bank Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_transaction_bank_status',
    systemSortOrder: 'a6',
    nullable: true,
    options: { options: [...BANK_TRANSACTION_BANK_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'posted',
    description:
      'The state at the BANK - not the state of the fetch, which is a different pending. ' +
      'void is a state change on a row we keep; a posting it carried is reversed, never deleted',
  },

  matchKey: {
    id: toFieldId('matchKey'),
    key: 'matchKey',
    label: 'Match Key',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_match_key',
    systemSortOrder: 'a7',
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
      'description, normalised - trailing digits, dates and reference numbers stripped. ' +
      'Shaped in the connector fetch, never by a CALC expression (those have no regex). ' +
      'With no provider categories at all, "the last 6 lines matching this key went to 6100" ' +
      'is the PRIMARY categorisation signal rather than a supplement',
  },

  importBatchId: {
    id: toFieldId('importBatchId'),
    key: 'importBatchId',
    label: 'Import Batch',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_import_batch_id',
    systemSortOrder: 'a8',
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
      'The import job that produced this row, or null for a feed row. What makes a bad ' +
      'statement import undoable as a unit',
  },

  source: {
    id: toFieldId('source'),
    key: 'source',
    label: 'Source',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_transaction_source',
    systemSortOrder: 'a9',
    nullable: true,
    options: { options: [...BANK_TRANSACTION_SOURCE_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select source',
    defaultValue: 'import',
    description:
      'feed or import. Not decoration - the two overlap by design, and which door a row ' +
      'came through is what a duplicate sweep argues from',
  },

  // ── Auxx-owned (review). The connector may never write these ──────────

  reviewStatus: {
    id: toFieldId('reviewStatus'),
    key: 'reviewStatus',
    label: 'Review Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_transaction_review_status',
    systemSortOrder: 'b1',
    nullable: false,
    options: { options: [...BANK_TRANSACTION_REVIEW_STATUS_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select status',
    defaultValue: 'for_review',
    description:
      'The head of the auxx-owned group. matched LINKS to an existing document and posts ' +
      'nothing (decision B5) - only coded creates an entry, because a bank line corroborating ' +
      'a vendor payment we already posted would credit cash twice and still balance',
  },

  glAccount: {
    id: toFieldId('glAccount'),
    key: 'glAccount',
    label: 'GL Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_gl_account',
    systemSortOrder: 'b2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '6100',
    description:
      'The account CODE a coded line posts to, from the org own chart. The bank_account ' +
      'side of the entry comes from the account mapping, not from here',
  },

  matchedRecordId: {
    id: toFieldId('matchedRecordId'),
    key: 'matchedRecordId',
    label: 'Matched Record',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_matched_record_id',
    systemSortOrder: 'b3',
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
      'The document this line corroborates - a payment we received, a payment we made, a ' +
      'bank_deposit. ' +
      'TEXT plus matchedRecordType rather than N relationship fields, because the target is ' +
      'polymorphic and a FieldValue cannot express that',
  },

  matchedRecordType: {
    id: toFieldId('matchedRecordType'),
    key: 'matchedRecordType',
    label: 'Matched Record Type',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_matched_record_type',
    systemSortOrder: 'b4',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'payment',
    description: 'The entity type of matchedRecordId. Half of one polymorphic pointer',
  },

  excludeReason: {
    id: toFieldId('excludeReason'),
    key: 'excludeReason',
    label: 'Exclude Reason',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_exclude_reason',
    systemSortOrder: 'b5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Why a line was excluded. Required in the UI when reviewStatus is excluded - an ' +
      'unexplained exclusion is indistinguishable from an unreviewed one six months later',
  },

  reviewedAt: {
    id: toFieldId('reviewedAt'),
    key: 'reviewedAt',
    label: 'Reviewed At',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'bank_transaction_reviewed_at',
    systemSortOrder: 'b6',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'When a human decided. Null for every line still in the queue',
  },

  reviewedByUserId: {
    id: toFieldId('reviewedByUserId'),
    key: 'reviewedByUserId',
    label: 'Reviewed By',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_reviewed_by_user_id',
    systemSortOrder: 'b7',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Who decided. TEXT, the created_by precedent - a User is not an org entity',
  },

  glPostingId: {
    id: toFieldId('glPostingId'),
    key: 'glPostingId',
    label: 'GL Posting',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_gl_posting_id',
    systemSortOrder: 'b8',
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
      'The GlPosting this line produced. A denormalized backlink for the drawer - the ' +
      'AUTHORITY is the posting own sourceType/sourceId pair. Also the FREEZE marker: once ' +
      'set, the connector may not rewrite this row raw fields (02 §5.2)',
  },

  ruleId: {
    id: toFieldId('ruleId'),
    key: 'ruleId',
    label: 'Rule',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_rule_id',
    systemSortOrder: 'b9',
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
      'The bank_rule that proposed or applied this treatment, if any. Null for a hand ' +
      'decision, which is what makes "how much of my queue is automatic" answerable',
  },

  // ── Suggestion (HANDOFF slot 3C, bank plan 03 §4) ──────────────────────
  // Written by suggestFromHistory / evaluateRules, never by the connector.
  // reviewStatus flips to `suggested` when one of these is set on a
  // `for_review` line; accepting the suggestion is still a human act that goes
  // through the normal match/code/transfer treatment in `banking/review/`.

  suggestedGlAccount: {
    id: toFieldId('suggestedGlAccount'),
    key: 'suggestedGlAccount',
    label: 'Suggested GL Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_suggested_gl_account',
    systemSortOrder: 'bA',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '6100',
    description:
      'The account CODE a "code" suggestion proposes, from the org own chart. Set by a ' +
      'matching bank_rule or by suggestFromHistory; null for a transfer suggestion',
  },

  suggestedRecordId: {
    id: toFieldId('suggestedRecordId'),
    key: 'suggestedRecordId',
    label: 'Suggested Record',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_suggested_record_id',
    systemSortOrder: 'bB',
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
      'Half of one polymorphic pointer, the matchedRecordId precedent. For a transfer ' +
      'suggestion, the counterpart bank_account id; unused for a code suggestion',
  },

  suggestedRecordType: {
    id: toFieldId('suggestedRecordType'),
    key: 'suggestedRecordType',
    label: 'Suggested Record Type',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_suggested_record_type',
    systemSortOrder: 'bC',
    showInPanel: false,
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'bank_account',
    description: 'The entity type of suggestedRecordId. The other half of the pointer',
  },

  suggestionReason: {
    id: toFieldId('suggestionReason'),
    key: 'suggestionReason',
    label: 'Suggestion Reason',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_transaction_suggestion_reason',
    systemSortOrder: 'bD',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'One explainable sentence, e.g. "The last 6 lines matching this key were coded to ' +
      '6100." What the review queue badge and the code panel both render verbatim - the ' +
      'explanation IS the product per bank plan 03 §4, not a debug string',
  },

  suggestionSource: {
    id: toFieldId('suggestionSource'),
    key: 'suggestionSource',
    label: 'Suggestion Source',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_transaction_suggestion_source',
    systemSortOrder: 'bE',
    nullable: true,
    options: {
      options: [
        { label: 'History', value: 'history', color: 'blue' },
        { label: 'Rule', value: 'rule', color: 'purple' },
        { label: 'Transfer', value: 'transfer', color: 'teal' },
      ],
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select source',
    description:
      'Which mechanism produced the suggestion. history is suggestFromHistory (the PRIMARY ' +
      'mechanism per bank plan 03 §4 - Stripe FC has no categories); rule is a matching ' +
      'bank_rule; transfer is the opposite-leg auto-detector',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'c0',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the line is first seen',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'c1',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the line changes',
  },

  createdBy: CREATED_BY_FIELD,
}
