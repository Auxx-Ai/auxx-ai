// packages/lib/src/resources/registry/resources/tariff-rate-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Tariff Rate resource - the dated schedule behind a
 * `tariff_code` (plans/money/tasks/29-tariff-schedule.md §1.2).
 *
 * **Resolution: sum the latest row per `authority`, as of the lookup date.** A
 * blank `authority` counts as its own authority. One rule covers both shapes
 * people actually enter: if every row is left blank it degrades exactly to
 * "the latest row wins", and the day someone wants MFN and 301 apart they start
 * filling `authority` in and nothing else changes. The rule itself is
 * `resolveTariffRate` in `bom/vendor-cost.ts` - pure, and shared with the
 * drawer through `bom/client.ts`.
 *
 * 🛑 **Every row carries a date. There is no null-means-current row and there
 * is no `effectiveTo`** (§1.4). "Current" is derivable as
 * `max(effectiveFrom) <= lookupDate`, so one rule answers both "what is the
 * rate today" and "what was it on Jan 15". An undated row would be a second
 * representation of the same fact, and it creates an ordering question with no
 * good answer: when the March 2 rate is added, is the undated row edited,
 * deleted, or does it now shadow March? A rate that expires back to nothing is
 * an explicit row at `0`.
 *
 * 🛑 **Adding a rate is an APPEND, never an edit.** Editing February to say 20%
 * silently restates every estimate produced that month. The rows are history.
 *
 * **This is an entity and not JSON on the code record** (§12 f). Rates as rows
 * are importable, queryable across codes - "which codes carry a row with
 * `9903.88.03`" is §0's literal scenario - and audited per row, which a blob
 * rewritten wholesale cannot be.
 *
 * No natural key is declared. `(tariffCode, authority, effectiveFrom)` is the
 * tuple that identifies a row, but `authority` is nullable and a natural key
 * leg that can be NULL matches nothing, so declaring it would make the importer
 * offer a key that silently never hits. See §12 (e), which is still open.
 */
export const TARIFF_RATE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique tariff rate identifier',
  },

  tariffCode: {
    id: toFieldId('tariffCode'),
    key: 'tariffCode',
    label: 'Tariff Code',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'tariff_rate_tariff_code',
    systemSortOrder: 'a1',
    showInPanel: false, // rates are viewed in the context of their code
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: false,
      required: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'tariff_code:rates' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    relationshipConfig: {
      relatedEntityType: 'tariff_code',
      relationshipType: 'belongs_to',
      inverseName: 'Rates',
      inverseSystemAttribute: 'tariff_code_rates',
    },
    description: 'The classification and origin this rate applies to',
  },

  rate: {
    id: toFieldId('rate'),
    key: 'rate',
    label: 'Rate (%)',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'tariff_rate_rate',
    systemSortOrder: 'a2',
    nullable: false,
    required: true,
    options: { decimals: 2, displayAs: 'percentage' },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: '25',
    // 🛑 A percentage of the CUSTOMS VALUE, which is the unit price - shipping
    // and brokerage stay outside the multiplicand. `computeLandedCost` already
    // gets this right and must keep doing so.
    description:
      'A percentage of the unit price, matching the supplier-offer override - 25 means 25%. ' +
      'Specific duties ($0.20/kg) cannot be expressed and have to be blended into a percentage ' +
      'by hand',
  },

  effectiveFrom: {
    id: toFieldId('effectiveFrom'),
    key: 'effectiveFrom',
    label: 'Effective From',
    type: BaseType.DATE,
    fieldType: FieldType.DATE,
    isSystem: true,
    systemAttribute: 'tariff_rate_effective_from',
    systemSortOrder: 'a3',
    nullable: false,
    required: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Select the date this rate took effect',
    // ⚠️ Compared in the org's book timezone, never UTC. A rate that starts on
    // March 2 compared in UTC values a March 1 evening lookup on the wrong side
    // of the change, silently and by exactly one day.
    description:
      'The day this rate took effect. Required on every row - there is no "current" row, and ' +
      "no end date: the next row's start is this row's end",
  },

  authority: {
    id: toFieldId('authority'),
    key: 'authority',
    label: 'Authority',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'tariff_rate_authority',
    systemSortOrder: 'a4',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Section 301 List 3',
    // 🛑 The summing rule keys on this. A code with a 301 row and no base row
    // resolves to 25% rather than 27% and nothing looks wrong about it.
    description:
      'What imposes this rate - MFN, Section 301 List 3, IEEPA fentanyl. The latest row per ' +
      'authority is summed, and a blank counts as its own authority',
  },

  chapter99Code: {
    id: toFieldId('chapter99Code'),
    key: 'chapter99Code',
    label: 'Chapter 99 Code',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'tariff_rate_chapter99_code',
    systemSortOrder: 'a5',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '9903.88.03',
    // ⚠️ Documentation, never an input. It earns its field because it lets
    // someone reconcile an estimate against the broker's entry summary line by
    // line, and know which rows to touch when a Federal Register notice moves
    // `9903.88.03`. Do not mistake it for something the arithmetic reads.
    description:
      'The Chapter 99 heading this action is entered under. Carried for reconciliation against ' +
      'the entry summary - the rate calculation never reads it',
  },

  note: {
    id: toFieldId('note'),
    key: 'note',
    label: 'Note',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'tariff_rate_note',
    systemSortOrder: 'a6',
    nullable: true,
    options: { multiline: true, rows: 2 },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: '90 FR 12345, or whatever the broker said',
    description: 'Where this rate came from - a Federal Register cite, or a broker note',
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
    description: 'Automatically set when the rate row is created',
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
    description: 'Automatically updated when the rate row is modified',
  },

  createdBy: CREATED_BY_FIELD,
}
