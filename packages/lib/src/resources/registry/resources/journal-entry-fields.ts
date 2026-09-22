// packages/lib/src/resources/registry/resources/journal-entry-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { JournalEntryKind } from '../enum-values'
import { defineResourceFields } from '../system-attributes'

/**
 * Field definitions for the Journal Entry resource - a hand-authored posting as a
 * document, like a bill: its lines are `journal_entry_line` children, Post builds
 * the entry from them and stamps `journal_entry_gl_posting_id`, Void reverses (91 D5).
 * The opening trial balance is the same record with `kind: 'opening_balance'`.
 *
 * Hidden system entity (`isVisible: false`), like `gl_account` beside it: the
 * ledger page and the JE drawer are the doors.
 */
export const JOURNAL_ENTRY_FIELDS = defineResourceFields({
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
    description: 'Unique journal entry identifier',
  },

  number: {
    id: toFieldId('number'),
    key: 'number',
    label: 'Number',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'journal_entry_number',
    systemSortOrder: 'a1',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      // RecordSequence-issued on create, the `build` / `order` /
      // `purchase_order` precedent - `JOURNAL_ENTRY_HOOKS` is the ONLY writer.
      //
      // 🛑 It is also the entry's `periodKey`, which is why it may never be
      // hand-set or changed: `doc-number.ts` keys `manual_journal` on the record
      // number rather than on a date, because many entries can post in one day
      // and a date key would make the second collide with the first on the
      // claim's unique index and come back `already_posted`.
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically generated journal entry number',
  },

  date: {
    id: toFieldId('date'),
    key: 'date',
    label: 'Date',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'journal_entry_date',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    // A DATE and not a DATETIME, deliberately. The accounting date carries no
    // time and no zone; giving it one pushes a month-end entry across a day
    // boundary for any reader east or west of the driver's assumption, which is
    // the one presentation bug a bookkeeper cannot argue with.
    description: 'The accounting date this entry posts on - the period lock reads it',
  },

  memo: {
    id: toFieldId('memo'),
    key: 'memo',
    label: 'Memo',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'journal_entry_memo',
    systemSortOrder: 'a3',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Why this entry exists',
    description: 'Why this entry was made - carried onto every line that has no memo of its own',
  },

  kind: {
    id: toFieldId('kind'),
    key: 'kind',
    label: 'Kind',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'journal_entry_kind',
    systemSortOrder: 'a5',
    nullable: false,
    defaultValue: JournalEntryKind.MANUAL,
    options: { options: JournalEntryKind.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      // Set once at creation. An opening balance that became a manual entry
      // would be posted under the wrong posting type, and the posting type is
      // what `doc-number.ts` keys on and what `regime.ts` declares against.
      updatable: false,
      configurable: false,
    },
    description: 'What this entry is - an adjustment, the opening trial balance, or a template',
  },

  attachment: {
    id: toFieldId('attachment'),
    key: 'attachment',
    label: 'Attachment',
    type: BaseType.FILE,
    fieldType: FieldType.FILE,
    isSystem: true,
    systemAttribute: 'journal_entry_attachment',
    systemSortOrder: 'a7',
    // Surfaced through the documents card, never as an editable text box - the
    // same treatment `vendor_bill_document` gets, and for the same reason.
    showInPanel: false,
    nullable: true,
    options: {
      file: { allowMultiple: true, maxFiles: 10, allowedFileTypes: ['document', 'image'] },
    },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      "The evidence behind the entry - the accountant's memo, a statement, a photo of the paper",
  },

  glPostingId: {
    id: toFieldId('glPostingId'),
    key: 'glPostingId',
    label: 'GL Posting',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'journal_entry_gl_posting_id',
    systemSortOrder: 'a8',
    nullable: true,
    // TEXT and not a RELATIONSHIP: `GlPosting` is a Drizzle table (decision G6).
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      // Stamped only by Post; a hand-set value would assert a posting exists.
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description: 'The GlPosting row this entry became once it was posted',
  },

  lines: {
    id: toFieldId('lines'),
    key: 'lines',
    label: 'Lines',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'journal_entry_lines',
    systemSortOrder: 'aD',
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'journal_entry_line:journalEntry' as ResourceFieldId,
      relationshipType: 'has_many',
      onDelete: 'cascade',
      isInverse: true,
    },
    description: 'The lines of this entry - one per account, side and amount',
  },

  recurrenceRuleId: {
    id: toFieldId('recurrenceRuleId'),
    key: 'recurrenceRuleId',
    label: 'Recurrence Rule',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'journal_entry_recurrence_rule_id',
    systemSortOrder: 'aB',
    nullable: true,
    // TEXT for the same reason `glPostingId` is: `RecurrenceRule` is a Drizzle
    // table, so there is no `EntityDefinition` a relationship could point at.
    //
    // 🛑 Written only on an entry the sweep GENERATED (`kind: 'recurring'`),
    // never on the template itself - the template is the rule's `subjectId`,
    // and pointing back would make a cycle out of a one-way edge.
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      // Set once by the materializer. Together with `occurrenceDate` it is what
      // the posting's `periodKey` is hashed from, so an edit would re-key the
      // entry and defeat the claim index that stops a double post.
      updatable: false,
      configurable: false,
    },
    description: 'The RecurrenceRule that generated this entry - null on a hand-authored one',
  },

  occurrenceDate: {
    id: toFieldId('occurrenceDate'),
    key: 'occurrenceDate',
    label: 'Occurrence',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'journal_entry_occurrence_date',
    systemSortOrder: 'aC',
    nullable: true,
    // 🛑 TEXT and not DATE, unlike `journal_entry_date` beside it, and the two
    // are different facts. `date` is the ACCOUNTING date - it moves if somebody
    // re-dates the draft, and the period lock reads it. This is the SLOT
    // IDENTITY the expander produced (`WorkOrderVisit.occurrenceDate` is the
    // same idea), and it must never move, because it is half of the hash the
    // claim index keys on. A `timestamptz` would also make the check-then-write
    // dedupe an instant comparison across zones instead of a string equality.
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: false,
      configurable: false,
    },
    description: 'The recurrence slot this entry fills, YYYY-MM-DD - never the accounting date',
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
    description: 'Automatically set when the journal entry is created',
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
    showInPanel: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the journal entry is updated',
  },

  createdBy: CREATED_BY_FIELD,
})
