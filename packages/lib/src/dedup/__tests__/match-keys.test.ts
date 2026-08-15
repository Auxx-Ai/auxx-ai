// packages/lib/src/dedup/__tests__/match-keys.test.ts
//
// Pure — no db. `deriveMatchKeys` reads the fields the caller already has from
// `getCachedResourceFields`, so there is nothing to mock.

import type { FieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import type { ResourceField } from '../../resources/registry/field-types'
import { getDedupConfig } from '../config'
import { deriveMatchKeys } from '../match-keys'

/** Minimal `ResourceField` shaped like the registry's `mapCustomFieldsToResourceFields` output. */
function field(overrides: Partial<ResourceField> & { key: string }): ResourceField {
  const { capabilities, ...rest } = overrides
  return {
    id: `fld_${overrides.key}` as FieldId,
    label: overrides.key,
    type: 'string' as ResourceField['type'],
    ...rest,
    key: overrides.key,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: true,
      ...capabilities,
    },
  }
}

const primaryEmail = field({
  key: 'primaryEmail',
  fieldType: 'EMAIL',
  systemAttribute: 'primary_email',
  isUnique: true,
  options: { multi: true },
})
const phone = field({
  key: 'phone',
  fieldType: 'PHONE_INTL',
  systemAttribute: 'phone',
  isUnique: false,
  options: { multi: true },
})
const companyDomain = field({
  key: 'companyDomain',
  fieldType: 'TEXT',
  systemAttribute: 'company_domain',
})
const firstName = field({ key: 'firstName', fieldType: 'TEXT', systemAttribute: 'first_name' })

describe('deriveMatchKeys — which fields become strong exact keys', () => {
  it('takes EMAIL and PHONE_INTL from the field TYPE, with no unique flag needed', () => {
    const keys = deriveMatchKeys([primaryEmail, phone, firstName])
    expect(keys.map((k) => k.fieldKey).sort()).toEqual(['phone', 'primaryEmail'])
    // Phone is DELIBERATELY never unique (households and companies share a line),
    // which is exactly why it is the steady exact producer.
    expect(keys.find((k) => k.fieldKey === 'phone')?.signalType).toBe('phone')
    expect(keys.find((k) => k.fieldKey === 'primaryEmail')?.signalType).toBe('email')
  })

  it('ignores a plain TEXT field that is neither unique nor promoted', () => {
    expect(deriveMatchKeys([firstName])).toEqual([])
  })

  it('takes a custom isUnique field, whatever its type', () => {
    const accountNumber = field({ key: 'accountNumber', fieldType: 'TEXT', isUnique: true })
    const keys = deriveMatchKeys([accountNumber])
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({ fieldKey: 'accountNumber', signalType: 'unique', multi: false })
  })

  it('reads isUnique off capabilities too, not only the convenience flag', () => {
    const legacy = field({
      key: 'legacyId',
      fieldType: 'TEXT',
      capabilities: {
        filterable: true,
        sortable: true,
        creatable: true,
        updatable: true,
        configurable: true,
        unique: true,
      },
    })
    expect(deriveMatchKeys([legacy])).toHaveLength(1)
  })

  it('promotes company_domain, which no other rule would reach', () => {
    // Plain TEXT with no `unique` capability — nothing anywhere enforces it, so
    // the type rule and the isUnique rule both skip the best company signal.
    const keys = deriveMatchKeys([companyDomain], getDedupConfig('company') ?? undefined)
    expect(keys.map((k) => k.systemAttribute)).toEqual(['company_domain'])
    expect(keys[0]?.signalType).toBe('unique')
  })

  it('does not promote systemAttributes the type has not asked for', () => {
    // contact's config carries an EMPTY promotion list — its strong keys all come
    // from field types and isUnique.
    const keys = deriveMatchKeys([companyDomain], getDedupConfig('contact') ?? undefined)
    expect(keys).toEqual([])
  })

  it('emits ONE key for a field that qualifies twice, typed by the field type', () => {
    // primary_email is both EMAIL-typed and isUnique. Two keys would double-count
    // the same evidence and label the chip "unique" instead of "email".
    const keys = deriveMatchKeys([primaryEmail])
    expect(keys).toHaveLength(1)
    expect(keys[0]?.signalType).toBe('email')
  })

  it('skips fields whose value is not in a scalar column', () => {
    const rel = field({ key: 'company', fieldType: 'RELATIONSHIP', isUnique: true })
    const select = field({ key: 'tier', fieldType: 'SINGLE_SELECT', isUnique: true })
    const file = field({ key: 'contract', fieldType: 'FILE', isUnique: true })
    expect(deriveMatchKeys([rel, select, file])).toEqual([])
  })

  it('folds the legacy PHONE spelling onto PHONE_INTL', () => {
    // The pg enum still lists PHONE and dev rows still hold it; no migration ever
    // rewrote them. Dropping those fields would silently disarm phone blocking.
    const legacyPhone = field({
      key: 'phone',
      fieldType: 'PHONE' as ResourceField['fieldType'],
      options: { multi: true },
    })
    const keys = deriveMatchKeys([legacyPhone])
    expect(keys[0]).toMatchObject({ fieldType: 'PHONE_INTL', signalType: 'phone' })
  })

  it('skips inactive fields', () => {
    expect(deriveMatchKeys([field({ ...primaryEmail, active: false })])).toEqual([])
  })
})

describe('deriveMatchKeys — the multi flag is what makes blocking fan out', () => {
  it('flags options.multi and bounds the fan-out at MAX_MULTI_VALUES', () => {
    const keys = deriveMatchKeys([primaryEmail, phone])
    for (const key of keys) {
      expect(key.multi).toBe(true)
      expect(key.maxValues).toBe(10)
    }
  })

  it('bounds a single-value field to exactly one value', () => {
    const keys = deriveMatchKeys([companyDomain], getDedupConfig('company') ?? undefined)
    expect(keys[0]?.multi).toBe(false)
    expect(keys[0]?.maxValues).toBe(1)
  })

  it('routes NUMBER keys at the numeric column and text keys at valueText', () => {
    const memberNo = field({ key: 'memberNo', fieldType: 'NUMBER', isUnique: true })
    expect(deriveMatchKeys([memberNo])[0]?.column).toBe('valueNumber')
    expect(deriveMatchKeys([primaryEmail])[0]?.column).toBe('valueText')
  })
})
