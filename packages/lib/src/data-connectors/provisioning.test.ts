// packages/lib/src/data-connectors/provisioning.test.ts
// Pure-helper coverage for the create-vs-reuse provisioning invariant: a field is
// provisioned ONLY from a `provision` hint; a concrete `targetFieldRef` reuses an
// existing field and yields no spec. Guards the duplicate-field regression where an
// owned mapping onto an existing def created a TEXT column named after each target
// field's own id. The DB orchestration (`provisionConnectorMappings`/`provisionTarget`)
// has no vitest harness — this locks the derivation it feeds.

import type { Database } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { toResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import { provisionSpecsForMapping, resolveRelationshipTargetDefId } from './provisioning'
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
    expect(provisionSpecsForMapping(m)).toEqual([
      {
        appFieldKey: 'total_price',
        name: 'total_price',
        type: 'NUMBER',
        icon: undefined,
        isHidden: true,
        isUpdatable: false,
        isCreatable: false,
      },
    ])
  })
})

describe('resolveRelationshipTargetDefId', () => {
  const ORG = 'org_1'
  // A db that explodes if touched — proves the owned/apiSlug branches never query.
  const noDb = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('db must not be touched')
      },
    }
  ) as unknown as Database

  it('an owned child (no targetRef) resolves to its OWN provisioned def', async () => {
    const id = await resolveRelationshipTargetDefId(noDb, ORG, undefined, 'def_line_item', {})
    expect(id).toBe('def_line_item')
  })

  it('a cross-stream ownedApiSlug resolves from the connector-wide pass-1 map', async () => {
    const id = await resolveRelationshipTargetDefId(
      noDb,
      ORG,
      { ownedApiSlug: 'product' },
      'def_line_item',
      { product: 'def_product', order: 'def_order' }
    )
    expect(id).toBe('def_product')
  })

  it('an unresolved ownedApiSlug (disabled stream) returns null — caller skips the edge', async () => {
    const id = await resolveRelationshipTargetDefId(
      noDb,
      ORG,
      { ownedApiSlug: 'product' },
      'def_line_item',
      {}
    )
    expect(id).toBeNull()
  })

  it('an entityKind targetRef resolves the system/contributing def by kind', async () => {
    const calls: unknown[] = []
    const fakeDb = {
      query: {
        EntityDefinition: {
          findFirst: async (args: unknown) => {
            calls.push(args)
            return { id: 'def_contact' }
          },
        },
      },
    } as unknown as Database
    const id = await resolveRelationshipTargetDefId(
      fakeDb,
      ORG,
      { entityKind: 'contact' },
      'def_line_item',
      {}
    )
    expect(id).toBe('def_contact')
    expect(calls).toHaveLength(1)
  })
})
