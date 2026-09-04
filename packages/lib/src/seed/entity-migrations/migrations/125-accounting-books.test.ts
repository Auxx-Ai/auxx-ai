// packages/lib/src/seed/entity-migrations/migrations/125-accounting-books.test.ts
//
// Migration 125 is eight small steps over registries that already exist, so
// what can silently go wrong is never the write: it is the WIRING around it.
//
//  - the id must be unique across a space shared with `data-migrations/`, which
//    has already collided once at 103, and the migration must sort after 108,
//    whose chart and defs three of its steps depend on;
//  - a new entity type is a hand-edit across several files, and getting one
//    wrong creates a def the app can half see: the records path resolves it and
//    the seeder does not, or the reverse;
//  - a relationship has to name a counterpart that resolves, or
//    `linkNewRelationships` skips it with a debug line and the inverse side
//    reads empty forever;
//  - the registry keys the steps name by hand must exist, or a step quietly
//    creates one field fewer than it claims to;
//  - the option append must preserve every stored entry, because
//    `FieldValue.optionId` stores the `value` key, not a position.

import { FieldType, ModelTypeMeta, ModelTypes, ModelTypeValues } from '@auxx/database/enums'
import { ENTITY_DEFINITION_TYPES } from '@auxx/types/resource'
import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { getIdentifierEligibility } from '../../../import/fields/identifier-eligibility'
import { ACCOUNT_ROLES } from '../../../postings/build-entry'
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../../postings/default-chart'
import { getHooksForAttribute } from '../../../resources/hooks'
import {
  INVOICE_ACTION_STATUS_MESSAGE,
  INVOICE_ACTION_STATUSES,
} from '../../../resources/hooks/lifecycle-status-guard'
import { JournalEntryKind, JournalEntryStatus } from '../../../resources/registry/enum-values'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import { BANK_ACCOUNT_FIELDS } from '../../../resources/registry/resources/bank-account-fields'
import { BANK_DEPOSIT_FIELDS } from '../../../resources/registry/resources/bank-deposit-fields'
import { BANK_RULE_FIELDS } from '../../../resources/registry/resources/bank-rule-fields'
import { BANK_TRANSACTION_FIELDS } from '../../../resources/registry/resources/bank-transaction-fields'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { INVOICE_STATUS_OPTIONS } from '../../../resources/registry/resources/invoice-fields'
import { JOURNAL_ENTRY_FIELDS } from '../../../resources/registry/resources/journal-entry-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { PAYMENT_FIELDS } from '../../../resources/registry/resources/payment-fields'
import { BaseType } from '../../../resources/types'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { appendMissingOptions } from './124-build-batch-source-and-period'
import {
  migration125AccountingBooks,
  RECEIVABLE_CODE,
  RECEIVABLE_NAME,
} from './125-accounting-books'

const MIGRATION_ID = '125-accounting-books'

describe('migration 125 registration', () => {
  it('is registered exactly once, with a unique id, after 108', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('108-purchasing'))
    expect(migration125AccountingBooks.id).toBe(MIGRATION_ID)
  })

  // The original assertion here was "125 is the only id at or above 125-",
  // which read as a collision guard but was really a CEILING - and the id space
  // is meant to grow, so 126 and 128 broke it simply by existing. What the guard
  // is actually for is that no OTHER migration claims 125's own number, and the
  // shared space is `data-migrations/migrations/` plus this folder, so it is the
  // numeric prefix that has to be unique, not the whole id.
  it('is the only migration claiming the number 125 in the shared space', () => {
    const claiming125 = ALL_ENTITY_MIGRATIONS.map((m) => m.id).filter((id) => id.startsWith('125-'))
    expect(claiming125).toEqual([MIGRATION_ID])
  })

  it('leaves every registered id on a distinct number', () => {
    const numbers = ALL_ENTITY_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(new Set(numbers).size).toBe(numbers.length)
  })
})

// ─── Step 1: the chart of accounts ───────────────────────────────────

describe('the chart carries what step 1 seeds', () => {
  const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]))

  it('has the six new accounts', () => {
    for (const code of ['1050', '3000', '3100', '3900', '4020', '6300']) {
      expect(byCode.get(code), code).toBeDefined()
    }
  })

  it('names 1100 plainly, so the rename target and the seed agree', () => {
    expect(byCode.get(RECEIVABLE_CODE)?.name).toBe(RECEIVABLE_NAME)
    expect(byCode.get(RECEIVABLE_CODE)?.role).toBe(ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)
  })

  it('puts the two equity roles on equity accounts and leaves 3000 role-less', () => {
    expect(byCode.get('3100')?.role).toBe(ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS)
    expect(byCode.get('3900')?.role).toBe(ACCOUNT_ROLES.EQUITY_OPENING_BALANCE)
    expect(byCode.get('3000')?.accountType).toBe('equity')
    expect(byCode.get('3000')?.role).toBeUndefined()
  })

  it('routes cheques through undeposited funds and fees through 6100', () => {
    expect(byCode.get('1050')?.role).toBe(ACCOUNT_ROLES.UNDEPOSITED_FUNDS)
    expect(byCode.get('6100')?.role).toBe(ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES)
  })
})

// ─── Steps 2, 3, 4 and 8: the five new entity types ──────────────────

// A new entity type is a hand-edit across several files. Getting one wrong
// creates a def the app can half see: the records path resolves it and the
// seeder does not, or the reverse. This is the checklist, executable.
describe('every new entity type is registered everywhere a def has to be', () => {
  it.each([
    ['journal_entry', 'journal-entries', JOURNAL_ENTRY_FIELDS],
    ['bank_deposit', 'bank-deposits', BANK_DEPOSIT_FIELDS],
    ['bank_account', 'bank-accounts', BANK_ACCOUNT_FIELDS],
    ['bank_transaction', 'bank-transactions', BANK_TRANSACTION_FIELDS],
    ['bank_rule', 'bank-rules', BANK_RULE_FIELDS],
  ] as const)('%s', (entityType, apiSlug, fields) => {
    expect(ModelTypeValues).toContain(entityType)
    expect(ModelTypeMeta[entityType].apiSlug).toBe(apiSlug)
    expect(ModelTypeMeta[entityType].dbTable).toBe('EntityInstance')
    // No `/app/<slug>/[id]` route exists for any of them; claiming one puts a
    // fullscreen button on the drawer that 404s.
    expect(ModelTypeMeta[entityType].hasDetailPage).toBe(false)

    expect(ENTITY_DEFINITION_TYPES).toContain(entityType)
    expect(RESOURCE_FIELD_REGISTRY[entityType]).toBe(fields)

    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === entityType)
    expect(entity).toBeDefined()
    expect(entity?.apiSlug).toBe(apiSlug)
    // Every door is a purpose-built screen (the ledger page, the deposits page,
    // settings, the review queue, the rules tab). An auto-linked sidebar entry
    // would be a second, dumber way into the rows.
    expect(entity?.isVisible).toBe(false)

    for (const field of Object.values(fields)) {
      expect(SYSTEM_ATTRIBUTES).toContain(field.systemAttribute)
    }
  })

  it('declares the payment side of the deposit link too', () => {
    expect(SYSTEM_ATTRIBUTES).toContain('payment_bank_deposit')
  })

  it('names journal_entry in the ModelTypes map, with the plural the UI reads', () => {
    expect(ModelTypes.JOURNAL_ENTRY).toBe('journal_entry')
    expect(ModelTypeMeta.journal_entry?.plural).toBe('Journal Entries')
  })

  // `computeDisplayValue` has no fallback: a null PRIMARY renders the row
  // nameless, and both halves must be real registry keys.
  it.each([
    ['journal_entry', { primaryDisplayField: 'number', secondaryDisplayField: 'memo' }],
    ['bank_deposit', { primaryDisplayField: 'number', secondaryDisplayField: 'depositDate' }],
    ['bank_account', { primaryDisplayField: 'name', secondaryDisplayField: 'institution' }],
    ['bank_transaction', { primaryDisplayField: 'description', secondaryDisplayField: 'postedAt' }],
    ['bank_rule', { primaryDisplayField: 'name', secondaryDisplayField: 'matchValue' }],
  ] as const)('%s displays as fields that exist', (entityType, config) => {
    expect(DISPLAY_FIELD_CONFIG[entityType]).toEqual(config)
    const fields = RESOURCE_FIELD_REGISTRY[entityType]
    expect(fields?.[config.primaryDisplayField]).toBeDefined()
    expect(fields?.[config.secondaryDisplayField]).toBeDefined()
  })

  it('keeps the two primaries that can never be null non-nullable', () => {
    expect(BANK_ACCOUNT_FIELDS.name?.nullable).toBe(false)
    expect(BANK_RULE_FIELDS.name?.nullable).toBe(false)
  })
})

describe('both relationship pairs resolve in both directions', () => {
  it('pairs payment.bankDeposit (owning) with bank_deposit.payments (inverse)', () => {
    const owning = PAYMENT_FIELDS.bankDeposit
    expect(owning?.relationship).toEqual({
      inverseResourceFieldId: 'bank_deposit:payments',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(owning?.relationshipConfig?.relatedEntityType).toBe('bank_deposit')

    const inverse = BANK_DEPOSIT_FIELDS.payments
    expect(inverse?.relationship).toEqual({
      inverseResourceFieldId: 'payment:bankDeposit',
      relationshipType: 'has_many',
      isInverse: true,
    })
  })

  it('pairs bank_transaction.bankAccount (owning) with bank_account.transactions (inverse)', () => {
    const owning = BANK_TRANSACTION_FIELDS.bankAccount
    expect(owning?.relationship).toEqual({
      inverseResourceFieldId: 'bank_account:transactions',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(owning?.relationshipConfig?.relatedEntityType).toBe('bank_account')

    const inverse = BANK_ACCOUNT_FIELDS.transactions
    expect(inverse?.relationship).toEqual({
      inverseResourceFieldId: 'bank_transaction:bankAccount',
      relationshipType: 'has_many',
      isInverse: true,
    })
  })

  it('is belongs_to on both owning sides, never has_many or many_to_many', () => {
    // A has_many on the payment side would let a cheque sit in two deposits;
    // a statement line on two accounts would be counted twice by every
    // reconciliation and every coverage read.
    expect(PAYMENT_FIELDS.bankDeposit?.relationship?.relationshipType).toBe('belongs_to')
    expect(BANK_TRANSACTION_FIELDS.bankAccount?.relationship?.relationshipType).toBe('belongs_to')
  })
})

// ─── Step 2: journal_entry's own shape ───────────────────────────────

describe('the journal_entry fields the ledger depends on', () => {
  it('carries all eight declared fields, each with a systemAttribute', () => {
    for (const key of [
      'number',
      'date',
      'memo',
      'status',
      'kind',
      'lines',
      'attachment',
      'glPostingId',
    ]) {
      expect(JOURNAL_ENTRY_FIELDS[key], key).toBeDefined()
    }
    for (const [key, field] of Object.entries(JOURNAL_ENTRY_FIELDS)) {
      expect(field.systemAttribute, key).toBeTruthy()
    }
  })

  // 🛑 The number IS the posting's `periodKey` (`doc-number.ts` keys
  // `manual_journal` on the record number, not on a date, because many entries
  // can post in one day). A hand-set or re-issued number would re-key an entry
  // that may already be in the ledger under the old one.
  it('makes number hook-issued and permanently immutable', () => {
    const number = JOURNAL_ENTRY_FIELDS.number
    expect(number?.capabilities?.creatable).toBe(false)
    expect(number?.capabilities?.updatable).toBe(false)
    expect(number?.systemAttribute).toBe('journal_entry_number')
  })

  // The kind decides the posting type, which decides the document-number key
  // and the regime declaration. Changing it after the fact posts the entry as
  // something it is not.
  it('makes kind settable once and never changeable', () => {
    expect(JOURNAL_ENTRY_FIELDS.kind?.capabilities?.creatable).toBe(true)
    expect(JOURNAL_ENTRY_FIELDS.kind?.capabilities?.updatable).toBe(false)
  })

  // A person asserting "this posted" with no posting behind it is the one claim
  // this record must not be able to make on its own.
  it('makes glPostingId system-written only', () => {
    expect(JOURNAL_ENTRY_FIELDS.glPostingId?.capabilities?.creatable).toBe(false)
    expect(JOURNAL_ENTRY_FIELDS.glPostingId?.capabilities?.updatable).toBe(true)
  })

  it('keeps the accounting date a DATE, with no time and no zone', () => {
    // A DATETIME here pushes a month-end entry across a day boundary for any
    // reader east or west of the driver's assumption.
    expect(JOURNAL_ENTRY_FIELDS.date?.fieldType).toBe('DATE')
  })

  it('stores the draft lines as JSON, not as a child entity', () => {
    expect(JOURNAL_ENTRY_FIELDS.lines?.fieldType).toBe('JSON')
    expect(JOURNAL_ENTRY_FIELDS.lines?.capabilities?.updatable).toBe(true)
  })

  it('has exactly the three statuses, draft first and default', () => {
    expect(JournalEntryStatus.values.map((o) => o.value)).toEqual(['draft', 'posted', 'reversed'])
    expect(JOURNAL_ENTRY_FIELDS.status?.defaultValue).toBe(JournalEntryStatus.DRAFT)
  })

  // Reserved now because adding an option to a MATERIALISED SINGLE_SELECT later
  // costs its own migration - `031-` and `033-` are two that exist only to fix
  // a field's stored options after the fact.
  it('reserves recurring_template alongside the two kinds that post', () => {
    expect(JournalEntryKind.values.map((o) => o.value)).toEqual([
      'manual',
      'opening_balance',
      'recurring_template',
    ])
    expect(JOURNAL_ENTRY_FIELDS.kind?.defaultValue).toBe(JournalEntryKind.MANUAL)
  })

  it('gives every option a distinct colour, in both lists', () => {
    for (const list of [JournalEntryStatus.values, JournalEntryKind.values]) {
      const colors = list.map((o) => o.color)
      expect(new Set(colors).size).toBe(colors.length)
    }
  })
})

// ─── Step 3: bank_deposit's own shape ────────────────────────────────

describe('the bank_deposit fields the ledger and the bank matcher depend on', () => {
  it('leaves the number to the create hook alone', () => {
    // RecordSequence-issued, and the posting's docNumber keys on it. A
    // creatable/updatable number would let two deposits share one, and the
    // document-number unique index would reject the second entry with a message
    // nobody could connect to this field.
    expect(BANK_DEPOSIT_FIELDS.number?.capabilities?.creatable).toBe(false)
    expect(BANK_DEPOSIT_FIELDS.number?.capabilities?.updatable).toBe(false)
    expect(getHooksForAttribute('bank_deposit', 'bank_deposit_number')).toHaveLength(1)
  })

  it('mirrors the vendor payment side three bank columns by name', () => {
    expect(BANK_DEPOSIT_FIELDS.bankTransactionId?.systemAttribute).toBe(
      'bank_deposit_bank_transaction_id'
    )
    expect(BANK_DEPOSIT_FIELDS.clearedAt?.systemAttribute).toBe('bank_deposit_cleared_at')
    expect(BANK_DEPOSIT_FIELDS.reconciledAt?.systemAttribute).toBe('bank_deposit_reconciled_at')
  })

  it('keeps the deposit slip pointer hidden and backend-owned', () => {
    // A user-writable pointer would let an uploaded file be republished as our
    // slip: a hand-uploaded asset has no contentHash, so the reuse comparison in
    // `ensureDocumentPdf` always fails.
    expect(BANK_DEPOSIT_FIELDS.pdfAsset?.capabilities?.updatable).toBe(false)
    expect(BANK_DEPOSIT_FIELDS.pdfAsset?.capabilities?.creatable).toBe(false)
    expect(BANK_DEPOSIT_FIELDS.pdfAsset?.capabilities?.hidden).toBe(true)
  })

  it('carries a two-value status with no void - a deposit is corrected by reversing', () => {
    expect(optionValues(BANK_DEPOSIT_FIELDS.status?.options)).toEqual(['pending', 'cleared'])
  })
})

// ─── Step 4: the two bank defs' own shape ────────────────────────────

describe('bank_account carries the mapping and the coverage record', () => {
  it('holds the GL account as a CODE in TEXT, not a relationship', () => {
    // 🛑 Departs from bank plan 02 §6 on purpose: there is no `gl_account`
    // relationship anywhere in the registry, and `resolveRoles` takes a code
    // with no foreign key (decision P2). One later migration converts every GL
    // pointer in the money subsystem together.
    expect(BANK_ACCOUNT_FIELDS.glAccount?.type).toBe(BaseType.STRING)
    expect(BANK_ACCOUNT_FIELDS.glAccount?.fieldType).toBe(FieldType.TEXT)
    expect(BANK_ACCOUNT_FIELDS.glAccount?.relationship).toBeUndefined()
  })

  it('separates the date we TRUST from the date we HOLD', () => {
    // A feed can deliver rows before the cutover that nobody has agreed to
    // book, so collapsing these two would silently book them.
    expect(BANK_ACCOUNT_FIELDS.feedStartDate?.systemAttribute).toBe('bank_account_feed_start_date')
    expect(BANK_ACCOUNT_FIELDS.coverageFrom?.systemAttribute).toBe('bank_account_coverage_from')
    expect(BANK_ACCOUNT_FIELDS.coverageGaps?.systemAttribute).toBe('bank_account_coverage_gaps')
  })

  it('offers depository and credit, and nothing else', () => {
    // A credit account is a LIABILITY whose signs invert, asserted once from
    // this field. A third value would have no answer to "which way do the signs
    // go", and the balance sheet would still balance.
    expect(optionValues(BANK_ACCOUNT_FIELDS.type?.options)).toEqual(['depository', 'credit'])
  })

  it('offers manual, connected and disconnected, with no delete', () => {
    // Disconnecting keeps every row: a coded and posted bank line is the source
    // document of a journal entry.
    expect(optionValues(BANK_ACCOUNT_FIELDS.status?.options)).toEqual([
      'manual',
      'connected',
      'disconnected',
    ])
    expect(BANK_ACCOUNT_FIELDS.status?.defaultValue).toBe('manual')
  })
})

describe('bank_transaction is a contributing-mode target and an import target', () => {
  it('makes externalId a tier-1 import identifier', () => {
    // File import is a hard prerequisite, not roadmap: the API reaches back 180
    // days and an overlap where a file and the feed both cover the same
    // fortnight is the NORMAL case. Without a recommended match key the
    // planner auto-selects something else and the overlap double-counts cash.
    const eligibility = getIdentifierEligibility(BANK_TRANSACTION_FIELDS.externalId!)
    expect(eligibility?.tier).toBe(1)
    expect(eligibility?.compositeOnly).toBe(false)
    expect(BANK_TRANSACTION_FIELDS.externalId?.capabilities.creatable).toBe(true)
    expect(BANK_TRANSACTION_FIELDS.externalId?.capabilities.filterable).toBe(true)
  })

  it('leaves every raw column mappable by the CSV importer', () => {
    for (const key of [
      'externalId',
      'bankAccount',
      'postedAt',
      'description',
      'amountMinor',
      'bankStatus',
      'matchKey',
      'importBatchId',
      'source',
    ]) {
      const field = BANK_TRANSACTION_FIELDS[key]
      expect(field, key).toBeDefined()
      expect(field?.capabilities.creatable, key).toBe(true)
      expect(field?.capabilities.hidden, key).toBeUndefined()
    }
  })

  it('keeps every review column writable, because the review path goes through them', () => {
    // Per-field ownership is what stops the CONNECTOR writing these; it is not a
    // capability, or the queue itself could not code a line.
    for (const key of [
      'reviewStatus',
      'glAccount',
      'matchedRecordId',
      'matchedRecordType',
      'excludeReason',
      'reviewedAt',
      'reviewedByUserId',
      'glPostingId',
      'ruleId',
    ]) {
      expect(BANK_TRANSACTION_FIELDS[key]?.capabilities.updatable, key).toBe(true)
    }
  })

  it('names the bank status apart from the fetch status', () => {
    // 🛑 Two unrelated things mean "pending". `bankStatus` is the state at the
    // BANK; `transaction_refresh.status` is the state of the FETCH. Named apart
    // so that nobody ever writes `if (tx.pending)`.
    expect(BANK_TRANSACTION_FIELDS.bankStatus?.key).toBe('bankStatus')
    expect(optionValues(BANK_TRANSACTION_FIELDS.bankStatus?.options)).toEqual([
      'pending',
      'posted',
      'void',
    ])
  })

  it('arrives for_review, with the five treatments the queue offers', () => {
    expect(optionValues(BANK_TRANSACTION_FIELDS.reviewStatus?.options)).toEqual([
      'for_review',
      'suggested',
      'matched',
      'coded',
      'excluded',
    ])
    expect(BANK_TRANSACTION_FIELDS.reviewStatus?.defaultValue).toBe('for_review')
  })
})

// ─── Step 5: the 1099/W-9 fields and written_off ─────────────────────

describe('the five 1099/W-9 fields on company', () => {
  const keys = ['taxClassification', 'tin', 'w9OnFile', 'is1099Eligible', 'default1099Box'] as const

  it('all exist in the registry, as system fields, under the five named attributes', () => {
    for (const key of keys) {
      expect(COMPANY_FIELDS[key]?.isSystem).toBe(true)
    }
    expect(COMPANY_FIELDS.taxClassification?.systemAttribute).toBe('company_tax_classification')
    expect(COMPANY_FIELDS.tin?.systemAttribute).toBe('company_tin')
    expect(COMPANY_FIELDS.w9OnFile?.systemAttribute).toBe('company_w9_on_file')
    expect(COMPANY_FIELDS.is1099Eligible?.systemAttribute).toBe('company_is_1099_eligible')
    expect(COMPANY_FIELDS.default1099Box?.systemAttribute).toBe('company_default_1099_box')
  })

  it('taxClassification carries the six W-9 §3 boxes', () => {
    const values = COMPANY_FIELDS.taxClassification?.options?.options?.map((o) => o.value)
    expect(values).toEqual([
      'individual_sole_proprietor',
      'c_corporation',
      's_corporation',
      'partnership',
      'llc',
      'other',
    ])
  })

  it('default1099Box carries the four boxes, none first', () => {
    const values = COMPANY_FIELDS.default1099Box?.options?.options?.map((o) => o.value)
    expect(values).toEqual(['none', 'nec_1', 'misc_1_rents', 'misc_3_other'])
  })

  it('w9OnFile and is1099Eligible are CHECKBOX fields defaulting false', () => {
    for (const key of ['w9OnFile', 'is1099Eligible'] as const) {
      expect(COMPANY_FIELDS[key]?.fieldType).toBe('CHECKBOX')
      expect(COMPANY_FIELDS[key]?.defaultValue).toBe(false)
    }
  })

  it('tin is not filterable - never a lookup key', () => {
    expect(COMPANY_FIELDS.tin?.capabilities.filterable).toBe(false)
  })

  it('do not collide with an existing sort order on the company def', () => {
    const collisions = (key: string) =>
      Object.entries(COMPANY_FIELDS).filter(
        ([name, f]) => name !== key && f.systemSortOrder === COMPANY_FIELDS[key]?.systemSortOrder
      )
    for (const key of keys) expect(collisions(key)).toEqual([])
  })
})

describe('written_off joins the invoice status vocabulary', () => {
  it('is in INVOICE_STATUS_OPTIONS, after void', () => {
    const values = INVOICE_STATUS_OPTIONS.map((o) => o.value)
    expect(values).toContain('written_off')
    expect(values.indexOf('written_off')).toBeGreaterThan(values.indexOf('void'))
  })

  it('is walled off from a manual drawer edit, like every other action status', () => {
    expect(INVOICE_ACTION_STATUSES).toContain('written_off')
    expect(INVOICE_ACTION_STATUS_MESSAGE).toMatch(/Write off/)
  })

  it('appendMissingOptions adds only written_off, preserving stored entries verbatim', () => {
    const stored = [
      { value: 'draft', label: 'Draft', color: 'gray' },
      { value: 'sent', label: 'Sent', color: 'blue' },
      { value: 'partially_paid', label: 'Partially paid', color: 'amber' },
      { value: 'paid', label: 'Paid', color: 'green' },
      { value: 'void', label: 'Void', color: 'gray' },
    ]
    const next = appendMissingOptions(stored, INVOICE_STATUS_OPTIONS)
    expect(next?.map((o) => o.value)).toEqual([
      'draft',
      'sent',
      'partially_paid',
      'paid',
      'void',
      'written_off',
    ])
    // Every pre-existing entry is the SAME object, never rewritten.
    for (let i = 0; i < stored.length; i++) {
      expect(next?.[i]).toBe(stored[i])
    }
  })

  it('returns null once written_off is already present, so a re-run writes nothing', () => {
    const stored = INVOICE_STATUS_OPTIONS.map((o) => ({ ...o }))
    expect(appendMissingOptions(stored, INVOICE_STATUS_OPTIONS)).toBeNull()
  })
})

// ─── Step 6: the order shipment log ──────────────────────────────────

describe('the registry agrees with step 6: order_fulfillments', () => {
  it('is a nullable JSON field on the order', () => {
    const field = ORDER_FIELDS.fulfillments
    expect(field).toBeDefined()
    expect(field?.systemAttribute).toBe('order_fulfillments')
    // Single-value JSON: the module wraps the array in an object because a
    // top-level array is read as a MULTI-VALUE write, which `setFieldValues`
    // logs and swallows.
    expect(field?.fieldType).toBe(FieldType.JSON)
    expect(field?.nullable).toBe(true)
  })

  it('is updatable but NOT creatable - a shipment is recorded by fulfilling', () => {
    expect(ORDER_FIELDS.fulfillments?.capabilities?.updatable).toBe(true)
    expect(ORDER_FIELDS.fulfillments?.capabilities?.creatable).toBe(false)
  })

  it('stays out of the panel, the dialogs and the table - it is machine state', () => {
    expect(ORDER_FIELDS.fulfillments?.showInPanel).toBe(false)
    expect(ORDER_FIELDS.fulfillments?.showInDialogs).toBe(false)
    expect(ORDER_FIELDS.fulfillments?.showInTable).toBe(false)
  })
})

// ─── Step 8: bank_rule's own shape ───────────────────────────────────

describe('the bank_rule pointer fields are TEXT, not RELATIONSHIP', () => {
  it.each(['bankAccount', 'counterpartBankAccount', 'contact'] as const)('%s', (key) => {
    // A RELATIONSHIP needs a paired inverse field on the target entity
    // (linkNewRelationships); this step adds none, so a half-wired
    // RELATIONSHIP would render "Missing entity definition" in the UI. See
    // bank-rule-fields.ts's file header for the full reasoning.
    expect(BANK_RULE_FIELDS[key]?.type).toBe(BaseType.STRING)
    expect(BANK_RULE_FIELDS[key]?.fieldType).toBe(FieldType.TEXT)
    expect(BANK_RULE_FIELDS[key]?.relationship).toBeUndefined()
  })
})

describe('the bank_rule vocabularies match the plan', () => {
  it('offers description and matchKey for matchField', () => {
    expect(optionValues(BANK_RULE_FIELDS.matchField?.options)).toEqual(['description', 'matchKey'])
  })

  it('offers contains, equals, starts_with and regex for matchOperator', () => {
    expect(optionValues(BANK_RULE_FIELDS.matchOperator?.options)).toEqual([
      'contains',
      'equals',
      'starts_with',
      'regex',
    ])
  })

  it('offers in, out and any for direction', () => {
    expect(optionValues(BANK_RULE_FIELDS.direction?.options)).toEqual(['in', 'out', 'any'])
  })

  it('offers code, exclude and transfer for action, and nothing else', () => {
    // Never match - a rule cannot know which specific document a line
    // corroborates, only suggest-from-history-style categorisation.
    expect(optionValues(BANK_RULE_FIELDS.action?.options)).toEqual(['code', 'exclude', 'transfer'])
  })

  it('defaults autoApply to false and enabled to true', () => {
    expect(BANK_RULE_FIELDS.autoApply?.defaultValue).toBe(false)
    expect(BANK_RULE_FIELDS.enabled?.defaultValue).toBe(true)
  })
})

describe('bank_transaction carries the suggestion fields, connector-adjacent but auxx-owned', () => {
  it('keeps every suggestion column writable and declared', () => {
    for (const key of [
      'suggestedGlAccount',
      'suggestedRecordId',
      'suggestedRecordType',
      'suggestionReason',
      'suggestionSource',
    ]) {
      const field = BANK_TRANSACTION_FIELDS[key]
      expect(field, key).toBeDefined()
      expect(field?.capabilities.updatable, key).toBe(true)
      expect(SYSTEM_ATTRIBUTES).toContain(field?.systemAttribute)
    }
  })

  it('offers history, rule and transfer for suggestionSource', () => {
    expect(optionValues(BANK_TRANSACTION_FIELDS.suggestionSource?.options)).toEqual([
      'history',
      'rule',
      'transfer',
    ])
  })
})

/** Read the `value` list off a materialised SINGLE_SELECT's options. */
function optionValues(options: unknown): string[] | undefined {
  return options && typeof options === 'object' && 'options' in options
    ? (options as { options?: { value: string }[] }).options?.map((o) => o.value)
    : undefined
}
