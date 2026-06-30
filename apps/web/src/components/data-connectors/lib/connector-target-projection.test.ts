// apps/web/src/components/data-connectors/lib/connector-target-projection.test.ts

import { describe, expect, it } from 'vitest'
import type { DraftMapping } from '../stores/connector-draft-store'
import {
  potentialFieldRef,
  projectPotentialResource,
  projectProvisionFields,
  provisionKey,
} from './connector-target-projection'

/** A lazy owned mapping: null def, a targetSpec, provision-spec field mappings. */
function lazyOwned(): DraftMapping {
  return {
    id: 'm1',
    parentMappingId: null,
    rootPath: '',
    relationshipFieldKey: null,
    linkMode: 'upsert',
    targetMode: 'owned',
    entityDefinitionId: null,
    targetSpec: {
      ownedDef: { apiSlug: 'shopify_orders', singular: 'Shopify Order', plural: 'Shopify Orders' },
    },
    orphanBehavior: 'ignore',
    fieldMappings: [
      {
        id: 'f1',
        targetFieldRef: null,
        expression: '{name}',
        sourceFields: { name: 'name' },
        provision: { name: 'Order Name', appFieldKey: 'name', type: 'TEXT' },
      },
      // A bound entry (already provisioned) — not projected (defers to the global store).
      {
        id: 'f2',
        targetFieldRef: 'def_x:f_total',
        expression: '{total}',
        sourceFields: { total: 'total' },
      },
    ],
  }
}

describe('projectPotentialResource', () => {
  it('projects a potential entity for a lazy owned mapping with willCreate', () => {
    const r = projectPotentialResource(lazyOwned())
    expect(r).toEqual({
      id: null,
      label: 'Shopify Order',
      plural: 'Shopify Orders',
      icon: 'box',
      willCreate: true,
    })
  })

  it('returns null once the mapping has a real def (defer to the global store)', () => {
    const m = { ...lazyOwned(), entityDefinitionId: 'def_real' }
    expect(projectPotentialResource(m)).toBeNull()
  })

  it('returns null for a mapping with no owned-def spec (contributing)', () => {
    const m = { ...lazyOwned(), targetSpec: null }
    expect(projectPotentialResource(m)).toBeNull()
  })
})

describe('projectProvisionFields', () => {
  it('emits a synthetic field per unprovisioned entry, keyed by the @potential ref', () => {
    const fields = projectProvisionFields(lazyOwned())
    expect(fields).toHaveLength(1)
    expect(fields[0]?.label).toBe('Order Name')
    expect(fields[0]?.resourceFieldId).toBe(potentialFieldRef('name'))
    expect(fields[0]?.fieldType).toBe('TEXT')
  })
})

describe('provisionKey', () => {
  it('prefers appFieldKey, falls back to name', () => {
    expect(provisionKey({ appFieldKey: 'name', name: 'Order Name' })).toBe('name')
    expect(provisionKey({ name: 'Order Name' })).toBe('Order Name')
  })
})
