// packages/lib/src/resources/registry/resources/gl-account-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { GlAccountType } from '../enum-values'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the GL Account resource — **our** chart of accounts
 * (plans/purchasing/01-build-plan.md §7.2, decisions P1/P2).
 *
 * **Why we own a chart at all.** P1 says auxx.ai is the system of record for
 * purchase to receipt to bill to posting, and the accounting system is an
 * *exporter*. P2 is what that costs in practice: postings are stored as
 * double-entry lines keyed on an account **CODE** (`'1310'`), never on a
 * provider account id. Codes need somewhere to live and something to validate
 * against, and that is this entity.
 *
 * **The provider's id is an app-owned identity field, not a column.** QuickBooks'
 * own id for an account arrives as `qboAccountId` declared in the QuickBooks
 * app's `fields.ts` and hung off this row — the identical pattern `gl_posting`
 * already uses for `qboJournalEntryId`. A second accounting provider therefore
 * adds a second identity field and changes nothing else here. That is the whole
 * point of the seam: nothing in the ledger has to be rewritten to swap, replay
 * or audit a provider.
 *
 * It also closes a gap the QuickBooks push already has today — `Account.AcctNum`
 * is never read anywhere in that app, so `"2160 GRNI"` cannot be resolved to an
 * id at all. One resolver, written once against this chart, serves both the
 * journal-entry push and the posting lines.
 *
 * Hidden system entity (`isVisible: false`), seeded with the accrual plan's
 * chart — the same shape `gl_posting` and `payment` use: a def that exists in
 * every org and is written by system code rather than through the generic
 * create dialog.
 */
export const GL_ACCOUNT_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique GL account identifier',
  },

  code: {
    id: toFieldId('code'),
    key: 'code',
    label: 'Code',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'gl_account_code',
    systemSortOrder: 'a1',
    nullable: false,
    required: true,
    // The account code IS the identity, unique per org: it is the value every
    // posting line, every seeded chart entry and every provider resolver
    // actually carries, and a cuid appears in none of them.
    //
    // `isIdentifier` and NOT `naturalKeyPosition: 1`. A natural key is a
    // COMPOSITE - `vendor_part` is keyed on (part, supplier), `subpart` on
    // (parentPart, childPart). A lone position-1 leg is the single-field case
    // wearing the composite's clothes, and `identifier-fields.test.ts` rejects
    // it by name.
    isIdentifier: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      unique: true,
      configurable: false,
    },
    placeholder: '1310',
    description:
      'The account code, unique per org. This is the key `gl_posting_line.accountCode` ' +
      'points at, and the value a provider resolver maps to a provider id — never the ' +
      "provider's id itself",
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'gl_account_name',
    systemSortOrder: 'a2',
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
    placeholder: 'Raw Materials',
    description: 'Human-readable account name, e.g. Raw Materials or GRNI',
  },

  accountType: {
    id: toFieldId('accountType'),
    key: 'accountType',
    label: 'Account Type',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'gl_account_type',
    systemSortOrder: 'a3',
    nullable: false,
    options: { options: GlAccountType.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Select account type',
    description:
      'asset, liability, equity, revenue or expense. Ours rather than the provider ' +
      'classification, so a posting can be sanity-checked before it is pushed anywhere',
  },

  isActive: {
    id: toFieldId('isActive'),
    key: 'isActive',
    label: 'Active',
    type: BaseType.BOOLEAN,
    fieldType: FieldType.CHECKBOX,
    isSystem: true,
    systemAttribute: 'gl_account_is_active',
    systemSortOrder: 'a4',
    nullable: false,
    defaultValue: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description:
      'Whether the account can still be coded to. Retired accounts are deactivated, never ' +
      'deleted — historical postings reference the code and must stay explainable',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a5',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the GL account is created',
  },

  updatedAt: {
    id: toFieldId('updatedAt'),
    key: 'updatedAt',
    label: 'Updated',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'updated_at',
    systemSortOrder: 'a6',
    dbColumn: 'updatedAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically updated when the GL account is modified',
  },
}
