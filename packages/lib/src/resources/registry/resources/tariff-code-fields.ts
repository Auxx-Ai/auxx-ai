// packages/lib/src/resources/registry/resources/tariff-code-fields.ts

import { FieldType } from '@auxx/database/enums'
import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'
import { ISO_COUNTRY_OPTIONS } from '../iso-country-options'

/**
 * Field definitions for the Tariff Code resource - the classification registry
 * (plans/money/tasks/29-tariff-schedule.md §1.1).
 *
 * **One record per `(code, country)` pair.** `8481.80.9005 CN` and
 * `8481.80.9005 DE` are two records, because a duty rate is a function of
 * (classification, origin, date) and the origin is half of the key. The label
 * a picker shows is composed from the two fields; it is never stored.
 *
 * 🛑 **Named `tariff_code`, not `hs_code`.** The record is a classification FOR
 * AN ORIGIN, which is strictly more than an HS code is, and the name should not
 * promise otherwise.
 *
 * **Visible, with ordinary record CRUD** (§12 d). `gl_account` is invisible
 * because `record.create` on it would let a records-Full / ledger-None actor
 * decide where money lands; a tariff code is reference data, not a control
 * surface. Visible also gets the importer for free, which matters because
 * loading a schedule is a bulk job.
 *
 * ⚠️ `part.hsCode` is untouched and stays the decorative free text it already
 * is. It can seed the code half of a picker; retiring it is a separate call
 * (§12 c).
 */
export const TARIFF_CODE_FIELDS: Record<string, ResourceField> = {
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
    description: 'Unique tariff code identifier',
  },

  code: {
    id: toFieldId('code'),
    key: 'code',
    label: 'Code',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'tariff_code_code',
    systemSortOrder: 'a1',
    nullable: false,
    required: true,
    // Leg 1 of the natural key `(code, country)`. Neither half identifies a
    // record on its own - the same classification is registered once per origin
    // - so this pair is the only identity the record has, and the only way a
    // re-imported schedule updates rather than duplicates.
    naturalKeyPosition: 1,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: '8481.80.9005',
    // ⚠️ No length validation on purpose. The 6-digit HS is the INTERNATIONAL
    // part; US duty rates attach at the 8 or 10-digit HTS level, so a 6-digit
    // code cannot resolve a correct US rate - but other jurisdictions differ
    // and a hard rule here would refuse a legitimate one.
    description:
      'The Chapter 1-97 classification. The first 6 digits are the international HS; US duty ' +
      'rates attach at the 8 or 10-digit HTS level, so a 6-digit code will not resolve a ' +
      'correct US rate',
  },

  country: {
    id: toFieldId('country'),
    key: 'country',
    label: 'Country of Origin',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'tariff_code_country',
    systemSortOrder: 'a2',
    nullable: false,
    required: true,
    // Leg 2 of the natural key `(code, country)`. See the code leg above.
    naturalKeyPosition: 2,
    // 🛑 A closed, seeded option set rather than free text, and `configurable:
    // false` so an org cannot edit it. The country is half of an identity: two
    // people spelling the United Kingdom `UK` and `GB`, or one leaving a
    // trailing space, fork the key into two records resolving to two different
    // schedules, silently (§12 g).
    options: { options: ISO_COUNTRY_OPTIONS },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      required: true,
      configurable: false,
    },
    placeholder: 'Select country of origin',
    // ⚠️ Origin, not the vendor's address. A US distributor selling
    // Chinese-made goods is the ordinary case.
    description:
      'Where the goods were MADE, not where the supplier is based - a US distributor selling ' +
      'Chinese-made goods is origin CN',
  },

  // 🛑 DERIVED - `{code} {country}` - and the record's PRIMARY DISPLAY FIELD.
  // Stamped by `field-hooks/pre/tariff-code-label.ts` on create and whenever
  // either leg changes; never creatable or updatable by a person. It exists
  // because a relation column on import matches ONE field and this record's
  // identity is two: matched on `code`, `8481.80.9005` resolves to the CN and
  // DE records interchangeably and the import succeeds pointing half the
  // Chinese offers at the German classification (30 §8). This does not reopen
  // §1.1's "compose, never store": nothing parses it, and `code` / `country`
  // remain the only inputs.
  label: {
    id: toFieldId('label'),
    key: 'label',
    label: 'Tariff Code',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'tariff_code_label',
    systemSortOrder: 'a2b',
    nullable: true,
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description:
      'The code and country of origin as one label, e.g. 8481.80.9005 CN. Derived from the two ' +
      'fields above; this is what a spreadsheet column names when it points at a tariff code',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'tariff_code_description',
    systemSortOrder: 'a3',
    nullable: true,
    options: { multiline: true, rows: 2 },
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    placeholder: 'Taps, cocks, valves - other',
    description: 'What this classification covers, in words',
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
    description: 'Automatically set when the tariff code is created',
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
    description: 'Automatically updated when the tariff code is modified',
  },

  // Reverse relationship: rates (from tariff_rate.tariffCode)
  rates: {
    id: toFieldId('rates'),
    key: 'rates',
    label: 'Rates',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'tariff_code_rates',
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
      inverseResourceFieldId: 'tariff_rate:tariffCode' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'The dated rate rows behind this classification',
  },

  // Reverse relationship: vendorParts (from vendor_part.tariffCode)
  vendorParts: {
    id: toFieldId('vendorParts'),
    key: 'vendorParts',
    label: 'Supplier Offers',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'tariff_code_vendor_parts',
    showInPanel: false,
    systemSortOrder: 'c1',
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'vendor_part:tariffCode' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    // This is the answer §0 actually wants: when a rate moves, the affected
    // SUPPLIER OFFERS are the useful list, not the affected parts.
    description: 'Supplier offers classified under this code - what a rate change reprices',
  },

  createdBy: CREATED_BY_FIELD,
}
