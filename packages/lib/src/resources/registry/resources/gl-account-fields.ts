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
 * **There is no `role` field here, and that is decision `G19`.** A posting role
 * maps to an account through the `GlRoleAssignment` TABLE, not through a
 * SINGLE_SELECT on this row. The field that used to live here enforced the
 * constraint *and its converse*: `unique: true` meant one role per account, but
 * it also meant one account could serve only one role — and an org that runs DTC
 * and dealer revenue through a single account is the ordinary case `G19` names.
 * A unique index on `(organizationId, role)` expresses exactly the required
 * direction and nothing more. Do not reintroduce the field; two sources of truth
 * for where money lands is the worst state this subsystem can be in.
 *
 * Hidden system entity (`isVisible: false`), seeded with the accrual plan's
 * chart — the same shape `payment` uses: a def that exists in every org and is
 * written by system code rather than through the generic create dialog.
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
    description: 'The unique code used to identify this account',
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
    description: 'The name used to identify this account',
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
    description: 'The financial category for this account',
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
    description: 'Whether this account is available for new postings',
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
