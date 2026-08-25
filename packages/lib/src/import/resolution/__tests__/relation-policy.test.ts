// packages/lib/src/import/resolution/__tests__/relation-policy.test.ts

import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import type { ResourceField } from '../../../resources/registry/field-types'
import type { Resource } from '../../../resources/registry/types'
import { BaseType } from '../../../resources/types'
import {
  buildRelationColumnPolicy,
  canCreateOnNoMatch,
  defaultOnNoMatch,
  defaultRelationLinkMode,
  deriveRelationResolutionType,
  effectiveOnNoMatch,
  explainCreateUnavailable,
  matchesDisplayField,
  relationFieldWriteMode,
  resolveDefaultMatchFieldKey,
  resolveDisplayFieldKey,
} from '../relation-policy'

/**
 * `company` as the org cache really shapes it: the display config points at the
 * CustomField ROW ID, and `name` there is the human LABEL, two characters of
 * difference from the key in one case (`Title`/`title`) and a whole word in the
 * other (`Company Name`/`name`).
 */
const company = {
  type: 'custom',
  id: 'company',
  label: 'Company',
  entityDefinitionId: 'def-company',
  organizationId: 'org-1',
  fields: [
    { id: 'cf-name', key: 'name', type: BaseType.STRING },
    { id: 'cf-vat', key: 'vat_number', type: BaseType.STRING },
  ],
  display: { primaryDisplayField: { id: 'cf-name', name: 'Company Name', type: 'TEXT' } },
} as unknown as Resource

const part = {
  type: 'custom',
  id: 'part',
  label: 'Part',
  entityDefinitionId: 'def-part',
  organizationId: 'org-1',
  fields: [
    { id: 'cf-title', key: 'title', type: BaseType.STRING },
    { id: 'cf-sku', key: 'sku', type: BaseType.STRING },
  ],
  display: { primaryDisplayField: { id: 'cf-title', name: 'Title', type: 'TEXT' } },
} as unknown as Resource

const userSystem = {
  type: 'system',
  id: 'user',
  label: 'User',
  dbName: 'User',
  entityDefinitionId: 'user',
  fields: [{ key: 'email', dbColumn: 'email', type: BaseType.EMAIL }],
  display: { primaryDisplayField: { id: 'email', name: 'Email', type: 'EMAIL' } },
} as unknown as Resource

describe('resolveDisplayFieldKey, Defect E', () => {
  it('resolves through the resource fields, not the display LABEL', () => {
    // The whole point: `Company Name` is not `name`, and no case-insensitive
    // compare turns one into the other.
    expect(company.display.primaryDisplayField?.name).toBe('Company Name')
    expect(resolveDisplayFieldKey(company)).toBe('name')
  })

  it('is not a lowercase compare, `Title` resolves to `title` via the field id', () => {
    expect(resolveDisplayFieldKey(part)).toBe('title')
  })

  it('handles system resources, whose display id already IS a key', () => {
    expect(resolveDisplayFieldKey(userSystem)).toBe('email')
  })

  it('falls back to `id` when the resource declares no display field', () => {
    const none = { ...company, display: { primaryDisplayField: null } } as unknown as Resource
    expect(resolveDisplayFieldKey(none)).toBe('id')
  })
})

describe('create-on-no-match eligibility', () => {
  it('allows create when the match field IS the display field', () => {
    expect(matchesDisplayField(company, 'name')).toBe(true)
    expect(canCreateOnNoMatch(company, 'name')).toBe(true)
    expect(explainCreateUnavailable(company, 'name')).toBeUndefined()
  })

  it('allows create for a match-field-less column, the default IS the display field', () => {
    expect(canCreateOnNoMatch(company, undefined)).toBe(true)
  })

  it('refuses create on a non-display field, and says why', () => {
    // Creating a company from a VAT-number match mints a company NAMED after a
    // VAT number. That is the entire reason the default is conditional.
    expect(canCreateOnNoMatch(company, 'vat_number')).toBe(false)
    expect(explainCreateUnavailable(company, 'vat_number')).toContain('Company Name')
  })

  it('refuses create when matching on Record ID', () => {
    expect(canCreateOnNoMatch(company, 'id')).toBe(false)
    expect(explainCreateUnavailable(company, 'id')).toContain('Record ID')
  })

  it('refuses create for table-backed system resources', () => {
    expect(canCreateOnNoMatch(userSystem, 'email')).toBe(false)
  })
})

describe('policy defaults', () => {
  it("defaults to 'create' on the display field and 'fail' otherwise", () => {
    expect(defaultOnNoMatch(company, 'name')).toBe('create')
    expect(defaultOnNoMatch(company, 'vat_number')).toBe('fail')
  })

  it("clamps a persisted 'create' back to 'fail' when the match field moved off display", () => {
    expect(effectiveOnNoMatch(company, { matchField: 'vat_number', onNoMatch: 'create' })).toBe(
      'fail'
    )
  })

  it("keeps an explicit 'blank' regardless of the match field", () => {
    expect(effectiveOnNoMatch(company, { matchField: 'vat_number', onNoMatch: 'blank' })).toBe(
      'blank'
    )
  })

  it("defaults multi-valued relations to 'add' so the file never drops unmentioned links", () => {
    expect(defaultRelationLinkMode('has_many')).toBe('add')
    expect(defaultRelationLinkMode('many_to_many')).toBe('add')
    expect(defaultRelationLinkMode('belongs_to')).toBe('set')
  })

  it('maps link mode onto FieldWriteModes only for multi-valued sides', () => {
    expect(relationFieldWriteMode('has_many')).toBe('add')
    expect(relationFieldWriteMode('has_many', 'set')).toBe('set')
    expect(relationFieldWriteMode('many_to_many')).toBe('add')
    // Single-valued relations must not appear in FieldWriteModes at all.
    expect(relationFieldWriteMode('belongs_to')).toBeUndefined()
    expect(relationFieldWriteMode('has_one', 'add')).toBeUndefined()
  })
})

describe('deriveRelationResolutionType', () => {
  it("derives 'relation:create' from the policy instead of hardcoding match", () => {
    expect(deriveRelationResolutionType({ matchField: 'name', onNoMatch: 'create' })).toBe(
      'relation:create'
    )
  })

  it("keeps 'relation:match' for blank and fail, they differ only after the miss", () => {
    expect(deriveRelationResolutionType({ matchField: 'name', onNoMatch: 'blank' })).toBe(
      'relation:match'
    )
    expect(deriveRelationResolutionType({ matchField: 'name', onNoMatch: 'fail' })).toBe(
      'relation:match'
    )
    expect(deriveRelationResolutionType(undefined)).toBe('relation:match')
  })

  it("uses 'relation:id' when the cell carries the target's record id", () => {
    expect(deriveRelationResolutionType({ matchField: 'id', onNoMatch: 'create' })).toBe(
      'relation:id'
    )
  })
})

describe('buildRelationColumnPolicy, the auto-map path', () => {
  it('sets an EXPLICIT match field so nothing depends on the resolver fallback', () => {
    expect(buildRelationColumnPolicy(company, 'belongs_to')).toEqual({
      matchField: 'name',
      onNoMatch: 'create',
      linkMode: 'set',
      resolutionType: 'relation:create',
    })
  })

  it('respects an already-chosen match field and downgrades create accordingly', () => {
    expect(buildRelationColumnPolicy(company, 'has_many', { matchField: 'vat_number' })).toEqual({
      matchField: 'vat_number',
      onNoMatch: 'fail',
      linkMode: 'add',
      resolutionType: 'relation:match',
    })
  })
})

/**
 * The DEFAULT match field — a real business key if the target has one, else the
 * display field.
 *
 * Display alone was wrong for `part`: no BOM and no price list carries part
 * TITLES, they carry SKUs, so every row of a parts-relation file resolved to
 * nothing until the user changed the dropdown by hand — while the picker sat
 * there labelling SKU "recommended".
 */
describe('resolveDefaultMatchFieldKey', () => {
  const fieldsOf = (id: string) =>
    Object.values(RESOURCE_FIELD_REGISTRY[id] ?? {}) as ResourceField[]

  it('defaults a part relation to SKU, not Title', () => {
    const part = {
      id: 'part',
      fields: fieldsOf('part'),
      display: { primaryDisplayField: { id: 'title' } },
    } as unknown as Resource
    expect(resolveDefaultMatchFieldKey(part)).toBe('sku')
    // …and the display field is still `title`, so this is a real divergence and
    // not the two happening to agree.
    expect(resolveDisplayFieldKey(part)).toBe('title')
  })

  // 🛑 The case that makes "just use the identifier" wrong. `company`'s ONLY
  // tier-1 identifier is `id`. Defaulting to it would match every supplier cell
  // against a CUID no CSV carries — every row failing — and `matchField === 'id'`
  // is additionally a hard stop in `canCreateOnNoMatch`, so supplier auto-create
  // would go dark too. It must fall through to the display field.
  it('falls back to the display field when the only identifier is `id`', () => {
    const company = {
      id: 'company',
      fields: fieldsOf('company'),
      display: { primaryDisplayField: { id: 'companyName' } },
    } as unknown as Resource
    expect(resolveDefaultMatchFieldKey(company)).toBe('companyName')
    expect(resolveDefaultMatchFieldKey(company)).toBe(resolveDisplayFieldKey(company))
  })

  // `id` is never chosen AS the business key. It can still be the answer when a
  // resource has no display field either — that is the pre-existing last-resort
  // fallback, unchanged here — so the invariant is stated against resources that
  // do have one.
  it('never picks `id` as the business key when a display field exists', () => {
    for (const id of Object.keys(RESOURCE_FIELD_REGISTRY)) {
      const fields = fieldsOf(id)
      const display = fields.find((f) => f.key !== 'id' && f.type === BaseType.STRING)
      if (!display) continue
      const resource = {
        id,
        fields,
        display: { primaryDisplayField: { id: display.key } },
      } as unknown as Resource
      expect(resolveDefaultMatchFieldKey(resource), `${id} defaulted to id`).not.toBe('id')
    }
  })

  // A partially-built resource must be judged, not throw: this runs on resources
  // the policy layer did not construct.
  it('tolerates fields with no capabilities rather than throwing', () => {
    const bare = {
      id: 'x',
      fields: [{ id: 'name', key: 'name', label: 'Name', type: BaseType.STRING }],
      display: { primaryDisplayField: { id: 'name' } },
    } as unknown as Resource
    expect(() => resolveDefaultMatchFieldKey(bare)).not.toThrow()
    expect(resolveDefaultMatchFieldKey(bare)).toBe('name')
  })
})
