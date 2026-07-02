// packages/lib/src/data-connectors/provisioning.test.ts
// Pure-helper coverage for the create-vs-reuse provisioning invariant: a field is
// provisioned ONLY from a `provision` hint; a concrete `targetFieldRef` reuses an
// existing field and yields no spec. Guards the duplicate-field regression where an
// owned mapping onto an existing def created a TEXT column named after each target
// field's own id. The DB orchestration (`materializeConnectorTargets`/`provisionTarget`)
// has no vitest harness — this locks the derivation it feeds, plus the steady-state
// fast-path predicate and the `app:<slug>` type parse.

import type { FieldType } from '@auxx/database/types'
import { toResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import {
  appSlugFromConnectorType,
  mappingNeedsProvisioning,
  provisionSpecsForMapping,
} from './provisioning'
import type { DecodedMapping } from './service'
import type { FieldMapping } from './types'

const DEF = 'def_contact'

function mapping(
  targetMode: 'owned' | 'contributing',
  fieldMappings: FieldMapping[]
): DecodedMapping {
  return {
    row: { id: 'm1' } as DecodedMapping['row'],
    rootPath: 'customer',
    linkMode: 'upsert',
    targetMode,
    entityDefinitionId: DEF,
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'ignore',
    fieldMappings,
  }
}

function fm(over: Partial<FieldMapping>): FieldMapping {
  return { id: 'e1', targetFieldRef: null, expression: '', sourceFields: {}, ...over }
}

describe('provisionSpecsForMapping', () => {
  it('yields NO spec for a concrete targetFieldRef (reused existing field) — owned', () => {
    // The regression: an owned mapping onto the existing contact def, bound to the
    // real First/Last/Email fields. None of these may be re-provisioned.
    const m = mapping('owned', [
      fm({ targetFieldRef: toResourceFieldId(DEF, 'f_first') }),
      fm({ targetFieldRef: toResourceFieldId(DEF, 'f_last') }),
      fm({ targetFieldRef: toResourceFieldId(DEF, 'f_email') }),
    ])
    expect(provisionSpecsForMapping(m)).toEqual([])
  })

  it('yields NO spec for a concrete targetFieldRef — contributing', () => {
    const m = mapping('contributing', [fm({ targetFieldRef: toResourceFieldId(DEF, 'f_email') })])
    expect(provisionSpecsForMapping(m)).toEqual([])
  })

  it('yields NO spec for an unassigned draft (null ref, no hint)', () => {
    const m = mapping('owned', [fm({ targetFieldRef: null })])
    expect(provisionSpecsForMapping(m)).toEqual([])
  })

  it('provisions a field ONLY from a `provision` hint, keyed by the hint name', () => {
    const m = mapping('owned', [
      fm({ targetFieldRef: toResourceFieldId(DEF, 'f_email') }), // reused → no spec
      fm({
        targetFieldRef: null,
        provision: { name: 'total_price', type: 'NUMBER' as FieldType, isHidden: true },
      }),
    ])
    expect(provisionSpecsForMapping(m)).toMatchObject([
      {
        appFieldKey: 'total_price',
        name: 'total_price',
        type: 'NUMBER',
        icon: undefined,
        isHidden: true,
        isIdentity: false,
        isUpdatable: false,
        isCreatable: false,
      },
    ])
  })

  it('marks a provisioned owned external-id field as identity (from identityRole)', () => {
    const m = mapping('owned', [
      fm({
        targetFieldRef: null,
        identityRole: { kind: 'externalId' },
        provision: { name: 'shopify_id', type: 'TEXT' as FieldType, appFieldKey: 'shopify_id' },
      }),
    ])
    expect(provisionSpecsForMapping(m)).toMatchObject([
      { appFieldKey: 'shopify_id', isIdentity: true },
    ])
  })
})

describe('mappingNeedsProvisioning', () => {
  it('false when every provision hint already has a concrete ref (steady state)', () => {
    expect(
      mappingNeedsProvisioning([
        fm({
          targetFieldRef: toResourceFieldId(DEF, 'f_total'),
          provision: { name: 'total_price', type: 'NUMBER' as FieldType },
        }),
        fm({ targetFieldRef: toResourceFieldId(DEF, 'f_email') }), // no hint
      ])
    ).toBe(false)
  })

  it('false for hint-less mappings — concrete refs and unassigned drafts alike', () => {
    expect(
      mappingNeedsProvisioning([
        fm({ targetFieldRef: toResourceFieldId(DEF, 'f_email') }),
        fm({ targetFieldRef: null }), // draft, no hint → nothing to provision
      ])
    ).toBe(false)
    expect(mappingNeedsProvisioning([])).toBe(false)
  })

  it('true when a provision hint is still unresolved (null ref)', () => {
    expect(
      mappingNeedsProvisioning([
        fm({ targetFieldRef: toResourceFieldId(DEF, 'f_email') }),
        fm({
          targetFieldRef: null,
          provision: { name: 'total_price', type: 'NUMBER' as FieldType },
        }),
      ])
    ).toBe(true)
  })
})

describe('appSlugFromConnectorType', () => {
  it('parses the app slug from an `app:<slug>` connector type', () => {
    expect(appSlugFromConnectorType('app:shopify')).toBe('shopify')
  })

  it('yields null for builtin/generic-rest types and missing values', () => {
    expect(appSlugFromConnectorType('generic-rest')).toBeNull()
    expect(appSlugFromConnectorType(null)).toBeNull()
    expect(appSlugFromConnectorType(undefined)).toBeNull()
    expect(appSlugFromConnectorType('')).toBeNull()
  })
})
