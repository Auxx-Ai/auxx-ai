// packages/lib/src/resources/registry/resources/journal-entry-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import { JournalEntryKind, JournalEntryStatus } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Journal Entry resource - the **draft** of a
 * hand-authored posting, and the only record in the accounting module a person
 * types line by line (plans/accounting/tasks/02-manual-journal-entry.md).
 *
 * ## Why an entity at all, when `GlPosting` is already a table
 *
 * Three things a `GlPosting` structurally cannot hold, and each one on its own
 * would be enough:
 *
 * 1. **A draft.** `GlPosting.status` is `pending | posted | failed | reversed`,
 *    and `pending` means *claimed and mid-push* - it holds the period's unique
 *    index. There is nowhere for "somebody is half way through typing this".
 * 2. **An attachment.** A file hangs off a FILE field on an `EntityInstance`
 *    (`docs/files-upload-architecture-guide.md`); `GlPosting` is a Drizzle table
 *    with no `MediaAsset` route to it at all.
 * 3. **A recurrence.** `RecurrenceRule.subjectId` is `NOT NULL` and references
 *    `EntityInstance`, so tier 2's recurring journal entries have no subject
 *    unless the draft is a record. `kind: 'recurring_template'` is the slot,
 *    reserved now so the shape does not have to change later.
 *
 * The opening trial balance is the same record with `kind: 'opening_balance'`
 * (handoff decision 6.7). It is a draft while the wizard is being filled in,
 * previews through the same `ledger.preview`, and posts through the same door -
 * so the org's first journal entry is an ordinary one and reversing it is the
 * ordinary path rather than a bespoke "unfreeze".
 *
 * ## The relationship to the posting it becomes
 *
 * One-way and by ID, not a RELATIONSHIP: `glPostingId` is TEXT because
 * `GlPosting` is a table and there is no `EntityDefinition` to point a
 * relationship at. The reverse direction already exists and is the one that
 * matters for audit - every `GlPostingLine` carries
 * `sourceType: 'journal_entry'` and `sourceId` = this record's id, which is
 * what `ledger.listPostingsForSource` reads.
 *
 * 🛑 **`lines` is the draft's lines, never the posted entry's.** Once
 * `glPostingId` is set, the ledger is the authority and this JSON is a record of
 * what was typed. It stays editable only while `status = 'draft'`;
 * `updateJournalEntry` refuses otherwise, because an entry is corrected by
 * REVERSAL and never by edit (ground rule 6).
 *
 * Hidden system entity (`isVisible: false`), like `gl_account` beside it: the
 * ledger page and the JE drawer are the doors, and an auto-linked sidebar entry
 * would be a second, dumber way into the same records with no line grid.
 */
export const JOURNAL_ENTRY_FIELDS: Record<string, ResourceField> = {
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

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'journal_entry_status',
    systemSortOrder: 'a4',
    nullable: false,
    defaultValue: JournalEntryStatus.DRAFT,
    options: { options: JournalEntryStatus.values },
    // Written by `postJournalEntry` / `reverseJournalEntry`, never by a person:
    // the status is a REPORT of what the ledger did, and a hand-set `posted` on
    // a record with no `glPostingId` is a claim nothing backs.
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description: 'Draft until posted; reversed once a second, opposite entry backs it out',
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

  lines: {
    id: toFieldId('lines'),
    key: 'lines',
    label: 'Lines',
    type: BaseType.JSON,
    fieldType: FieldType.JSON,
    isSystem: true,
    systemAttribute: 'journal_entry_lines',
    systemSortOrder: 'a6',
    nullable: true,
    // JSON on the record rather than a `journal_entry_line` child entity, and
    // the `inbox_settings` precedent is the shape. Two reasons, both about what
    // a draft IS:
    //
    // 1. A draft's lines have no independent identity - nothing links to them,
    //    nothing reports on them, and they are replaced wholesale on every save.
    //    A child entity would add N EntityInstances and 4N FieldValues per
    //    saved keystroke for rows nobody addresses.
    // 2. The POSTED lines are already normalised, in `GlPostingLine`, which is
    //    the table every report reads. A second normalised copy would be two
    //    sources of truth for what the entry says.
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
      'The draft lines - account code, direction, amount in minor units, memo. Replaced wholesale on save',
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
    // TEXT and not a RELATIONSHIP: `GlPosting` is a Drizzle table (decision G6),
    // so there is no `EntityDefinition` for a relationship to point at. The
    // audit direction that matters runs the other way and already exists -
    // every `GlPostingLine` carries `sourceType: 'journal_entry'` and this
    // record's id as `sourceId`.
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: false,
      // System-written only. `postJournalEntry` stamps it inside the same step
      // that flips `status`; a person setting it by hand would be asserting a
      // posting exists, which is the one claim this record must not be able to
      // make on its own.
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description: 'The GlPosting row this entry became once it was posted',
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
}
