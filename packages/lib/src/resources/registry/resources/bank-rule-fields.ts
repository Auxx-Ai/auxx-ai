// packages/lib/src/resources/registry/resources/bank-rule-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/** Which raw column a rule matches against. Mirrors bank plan 03 §4's input list. */
export const BANK_RULE_MATCH_FIELD_OPTIONS = [
  { label: 'Description', value: 'description', color: 'gray' },
  { label: 'Match Key', value: 'matchKey', color: 'blue' },
] as const

/**
 * How `matchValue` is compared against the chosen field.
 *
 * `regex` is refused by `evaluateRules` when the pattern is over 200 characters
 * or carries a nested quantifier - a hand-typed rule runs on every incoming
 * line forever, so a catastrophic pattern is a denial-of-service the ingest
 * path must never be exposed to.
 */
export const BANK_RULE_MATCH_OPERATOR_OPTIONS = [
  { label: 'Contains', value: 'contains', color: 'gray' },
  { label: 'Equals', value: 'equals', color: 'blue' },
  { label: 'Starts with', value: 'starts_with', color: 'teal' },
  { label: 'Regex', value: 'regex', color: 'amber' },
] as const

/** Which side of the ledger a matching line must be on. `any` matches both. */
export const BANK_RULE_DIRECTION_OPTIONS = [
  { label: 'Money in', value: 'in', color: 'green' },
  { label: 'Money out', value: 'out', color: 'red' },
  { label: 'Any', value: 'any', color: 'gray' },
] as const

/**
 * What a matching rule proposes. Mirrors the three review-queue treatments
 * (bank plan 03 §3) minus `match` - a rule proposes a category or a transfer,
 * never a link to a specific document, because it has no way to know which one.
 */
export const BANK_RULE_ACTION_OPTIONS = [
  { label: 'Code', value: 'code', color: 'teal' },
  { label: 'Exclude', value: 'exclude', color: 'gray' },
  { label: 'Transfer', value: 'transfer', color: 'purple' },
] as const

/**
 * Field definitions for the Bank Rule resource
 * (plans/bank-connection/03-categorization-and-gl.md §4, HANDOFF slot 3C).
 *
 * ## Why this entity exists, and why it is second
 *
 * `suggestFromHistory` is the PRIMARY categorisation mechanism - Stripe FC
 * gives a `description` string and nothing else, so "the last 6 lines
 * matching this key were coded to 6100" is the best signal available before a
 * single rule is written. A `bank_rule` is the opt-in, ORDERED layer a
 * reviewer adds on top of that once a pattern is confirmed - `evaluateRules`
 * runs in `priority` order and the first match wins.
 *
 * ## `autoApply` is off by default, and that default is load-bearing
 *
 * 🛑 A rule that silently posts to the ledger is a rule that silently posts a
 * WRONG entry to the ledger, and once a period is locked that is a reversal,
 * not an edit (bank plan 03 §4). `applySuggestions` only performs the
 * `code`/`exclude`/`transfer` action without a human click when this is
 * `true`; otherwise it fills `suggestedGlAccount` etc. on `bank_transaction`
 * and leaves `reviewStatus` at `suggested`, awaiting one click.
 *
 * ## `bankAccount`, `counterpartBankAccount` and `contact` are TEXT, not
 * RELATIONSHIP - a departure from the literal ask
 *
 * The bank plan and this slot's brief both ask for real RELATIONSHIP fields
 * here. This file departs on purpose: a RELATIONSHIP needs a paired inverse
 * field on the TARGET entity (`linkNewRelationships`, entity-migrations
 * `helpers.ts`) or the picker renders "Missing entity definition"
 * (`field-input-adapter.tsx`'s `getRelatedEntityDefinitionId`), and adding
 * that inverse means editing `bank-account-fields.ts` and `contact-fields.ts`
 * - files this slot does not own and that a concurrent wave-3 agent may be
 * touching. TEXT holding the target's entity-instance id is the same
 * departure `bank_transaction.matchedRecordId` already takes for exactly this
 * reason, and it costs nothing at read time: `banking/rules/` resolves the id
 * directly, and the Rules UI builds its own picker against `bank_account`/
 * `contact` records rather than the generic RELATIONSHIP input. One later
 * migration can convert all of these together, the `bank_account.glAccount`
 * precedent (decision `P2`).
 *
 * `contact` is chosen over a second `company` field per this slot's "pick one
 * or document": a coded line's payee is a vendor or a customer, and both are
 * reached through `contact` in this codebase's money subsystem
 * (`invoice.contact`, `vendor_bill.vendor` excepted). A rule that needs a
 * company can still be built without this field; it is a convenience, not the
 * match logic.
 *
 * ## Money and dates
 *
 * `amountMin`/`amountMax` are integer minor units, both optional - a rule with
 * neither matches any amount. `appliedCount`/`lastAppliedAt` are written by
 * `applySuggestions` each time this rule fires, so "how much of my queue is
 * automatic" (03 §4) is answerable per rule, not just in aggregate.
 */
export const BANK_RULE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique bank rule identifier',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_rule_name',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Monthly bank fee',
    description: 'The display name a reviewer picks the rule out of a list by',
  },

  enabled: {
    id: toFieldId('enabled'),
    key: 'enabled',
    label: 'Enabled',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'bank_rule_enabled',
    systemSortOrder: 'a2',
    nullable: false,
    defaultValue: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Whether evaluateRules considers this rule at all. A disabled rule is skipped',
  },

  autoApply: {
    id: toFieldId('autoApply'),
    key: 'autoApply',
    label: 'Auto-apply',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'bank_rule_auto_apply',
    systemSortOrder: 'a3',
    nullable: false,
    defaultValue: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'When on, a matching bank transaction is coded, excluded or transferred and POSTED ' +
      'without review. Off by default - a rule that silently posts to the ledger is a rule ' +
      'that silently posts a WRONG entry, and once a period is locked that is a reversal, ' +
      'not an edit',
  },

  priority: {
    id: toFieldId('priority'),
    key: 'priority',
    label: 'Priority',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'bank_rule_priority',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '0',
    description:
      'Lower runs first. evaluateRules walks enabled rules in ascending priority order and ' +
      'the first match wins - two rules that could both match a line are not both applied',
  },

  matchField: {
    id: toFieldId('matchField'),
    key: 'matchField',
    label: 'Match Field',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_rule_match_field',
    systemSortOrder: 'a5',
    nullable: false,
    options: { options: [...BANK_RULE_MATCH_FIELD_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select field',
    defaultValue: 'matchKey',
    description:
      'description is the raw bank string; matchKey is it normalised (trailing digits, ' +
      'dates and reference numbers stripped) - the stable field a hand-written rule should ' +
      'usually match against',
  },

  matchOperator: {
    id: toFieldId('matchOperator'),
    key: 'matchOperator',
    label: 'Match Operator',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_rule_match_operator',
    systemSortOrder: 'a6',
    nullable: false,
    options: { options: [...BANK_RULE_MATCH_OPERATOR_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select operator',
    defaultValue: 'contains',
    description:
      'How matchValue is compared. regex patterns over 200 characters or with a nested ' +
      'quantifier are refused by evaluateRules before they ever run against a line',
  },

  matchValue: {
    id: toFieldId('matchValue'),
    key: 'matchValue',
    label: 'Match Value',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_rule_match_value',
    systemSortOrder: 'a7',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'MONTHLY SVC FEE',
    description: 'The text or pattern compared against matchField with matchOperator',
  },

  amountMin: {
    id: toFieldId('amountMin'),
    key: 'amountMin',
    label: 'Amount Min',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'bank_rule_amount_min',
    systemSortOrder: 'a8',
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
      'Integer minor units, inclusive, unsigned - compared against the absolute value of ' +
      'the transaction amount. Null means no floor',
  },

  amountMax: {
    id: toFieldId('amountMax'),
    key: 'amountMax',
    label: 'Amount Max',
    type: BaseType.CURRENCY,
    fieldType: FieldType.CURRENCY,
    isSystem: true,
    systemAttribute: 'bank_rule_amount_max',
    systemSortOrder: 'a9',
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
    description: 'Integer minor units, inclusive, unsigned. Null means no ceiling',
  },

  direction: {
    id: toFieldId('direction'),
    key: 'direction',
    label: 'Direction',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_rule_direction',
    systemSortOrder: 'aA',
    nullable: false,
    options: { options: [...BANK_RULE_DIRECTION_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select direction',
    defaultValue: 'any',
    description: 'Which side of the ledger a matching line must be on. any matches both',
  },

  bankAccount: {
    id: toFieldId('bankAccount'),
    key: 'bankAccount',
    label: 'Bank Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_rule_bank_account',
    systemSortOrder: 'aB',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The bank_account entity-instance id this rule is scoped to, or null to match any ' +
      'account. TEXT rather than a RELATIONSHIP - see the file header',
  },

  action: {
    id: toFieldId('action'),
    key: 'action',
    label: 'Action',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'bank_rule_action',
    systemSortOrder: 'aC',
    nullable: false,
    options: { options: [...BANK_RULE_ACTION_OPTIONS] },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Select action',
    defaultValue: 'code',
    description:
      'What a match proposes. code needs glAccount; transfer needs counterpartBankAccount; ' +
      'exclude needs neither. Never match - a rule cannot know which specific document a ' +
      'line corroborates',
  },

  glAccount: {
    id: toFieldId('glAccount'),
    key: 'glAccount',
    label: 'GL Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_rule_gl_account',
    systemSortOrder: 'aD',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '6100',
    description: 'The account CODE a code action proposes, from the org own chart',
  },

  counterpartBankAccount: {
    id: toFieldId('counterpartBankAccount'),
    key: 'counterpartBankAccount',
    label: 'Counterpart Bank Account',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_rule_counterpart_bank_account',
    systemSortOrder: 'aE',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The bank_account entity-instance id a transfer action proposes as the other leg. ' +
      'TEXT rather than a RELATIONSHIP - see the file header',
  },

  contact: {
    id: toFieldId('contact'),
    key: 'contact',
    label: 'Contact',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_rule_contact',
    systemSortOrder: 'aF',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'The contact entity-instance id a code action proposes as the vendor or customer, if ' +
      'any. Optional context, not part of the match logic. TEXT - see the file header',
  },

  memo: {
    id: toFieldId('memo'),
    key: 'memo',
    label: 'Memo',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'bank_rule_memo',
    systemSortOrder: 'aG',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'The memo copied onto a code or transfer entry this rule produces',
  },

  appliedCount: {
    id: toFieldId('appliedCount'),
    key: 'appliedCount',
    label: 'Applied Count',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'bank_rule_applied_count',
    systemSortOrder: 'aH',
    nullable: true,
    defaultValue: 0,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description:
      'How many times this rule has matched, incremented by applySuggestions. What answers ' +
      '"how much of my queue is automatic" per rule',
  },

  lastAppliedAt: {
    id: toFieldId('lastAppliedAt'),
    key: 'lastAppliedAt',
    label: 'Last Applied',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'bank_rule_last_applied_at',
    systemSortOrder: 'aI',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description: 'When this rule last matched a line. Null for a rule that has never fired',
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
    description: 'Automatically set when the rule is created',
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
    description: 'Automatically updated when the rule changes',
  },

  createdBy: CREATED_BY_FIELD,
}
