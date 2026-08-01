// apps/web/src/components/resources/store/resource-store.test.ts
// `getFieldByRef` is the chokepoint behind useField/useFields (resolve-late-bound-app
// -field-refs-plan): a concrete `${defId}:${fieldId}` ref hits the fieldMap fast path,
// a late-bound `${apiSlug}:@app:${appSlug}:${appFieldKey}` ref resolves via the
// installed resource's `appFieldKey`.

import type { CustomResource, ResourceField } from '@auxx/lib/resources/client'
import { toResourceFieldId } from '@auxx/types/field'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useField } from '../hooks/use-field'
import { getResourceStoreState } from './resource-store'

const idField = {
  id: 'cf_1',
  key: 'cf_1',
  label: 'Order ID',
  type: 'string',
  capabilities: {
    filterable: true,
    sortable: true,
    creatable: true,
    updatable: true,
    configurable: true,
  },
  resourceFieldId: toResourceFieldId('def_orders', 'cf_1'),
  appFieldKey: 'id',
  appInstallationId: 'inst_1',
  isAppOwned: true,
} as unknown as ResourceField

/**
 * A system-attributed field, as the Kopilot agents-builder addresses it:
 * canonical ref is `def_orders:cf_2`, static key is `status`, and the
 * systemAttribute — the form `list_entity_fields` reports — is `order_status`.
 */
const statusField = {
  id: 'cf_2',
  key: 'status',
  label: 'Status',
  type: 'string',
  capabilities: {
    filterable: true,
    sortable: true,
    creatable: true,
    updatable: true,
    configurable: true,
  },
  resourceFieldId: toResourceFieldId('def_orders', 'cf_2'),
  systemAttribute: 'order_status',
} as unknown as ResourceField

const ordersResource = {
  id: 'def_orders',
  type: 'custom',
  apiSlug: 'shopify_orders',
  entityType: 'shopify_order',
  entityDefinitionId: 'def_orders',
  organizationId: 'org_1',
  label: 'Order',
  plural: 'Orders',
  icon: 'box',
  color: 'blue',
  isVisible: true,
  fields: [idField, statusField],
  display: {
    primaryDisplayField: null,
    secondaryDisplayField: null,
    avatarField: null,
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },
} as unknown as CustomResource

beforeEach(() => {
  getResourceStoreState().reset()
  getResourceStoreState().setResources([ordersResource])
})

describe('getFieldByRef', () => {
  it('resolves a concrete ref via the fieldMap fast path', () => {
    const field = getResourceStoreState().getFieldByRef('def_orders:cf_1')
    expect(field?.id).toBe('cf_1')
  })

  it('resolves a late-bound @app: ref to the installed column by appFieldKey', () => {
    const field = getResourceStoreState().getFieldByRef('shopify_orders:@app:shopify:id')
    expect(field?.id).toBe('cf_1')
    expect(field?.resourceFieldId).toBe('def_orders:cf_1')
  })

  it('returns undefined for an unresolvable late-bound ref', () => {
    expect(
      getResourceStoreState().getFieldByRef('shopify_orders:@app:shopify:missing')
    ).toBeUndefined()
  })

  it('matches by appFieldKey regardless of the ref slug (store passes no slug map)', () => {
    // Unambiguous in practice — one app owns a def's column (plan §8). A def with two
    // apps sharing a key needs the slug-aware `resolveFieldRef` overload directly.
    const field = getResourceStoreState().getFieldByRef('shopify_orders:@app:other-app:id')
    expect(field?.id).toBe('cf_1')
  })

  it('returns undefined for an unknown concrete ref and for null/undefined', () => {
    expect(getResourceStoreState().getFieldByRef('def_orders:nope')).toBeUndefined()
    expect(getResourceStoreState().getFieldByRef(null)).toBeUndefined()
    expect(getResourceStoreState().getFieldByRef(undefined)).toBeUndefined()
  })

  // Alias spellings. The agents-builder writes persona chips the way
  // `list_entity_fields` reports fields (apiSlug def half + systemAttribute
  // field half), and the server accepts that form — so the badge renderers
  // behind useField have to resolve it too, or every AI-authored field chip
  // renders as an unknown-field badge.
  it('resolves an apiSlug def half against a canonical field half', () => {
    const field = getResourceStoreState().getFieldByRef('shopify_orders:cf_1')
    expect(field?.resourceFieldId).toBe('def_orders:cf_1')
  })

  it('resolves an entityType def half against a static key field half', () => {
    const field = getResourceStoreState().getFieldByRef('shopify_order:status')
    expect(field?.resourceFieldId).toBe('def_orders:cf_2')
  })

  it('resolves a systemAttribute field half under every def spelling', () => {
    for (const ref of [
      'def_orders:order_status',
      'shopify_orders:order_status',
      'shopify_order:order_status',
    ]) {
      expect(getResourceStoreState().getFieldByRef(ref)?.resourceFieldId).toBe('def_orders:cf_2')
    }
  })

  it('does not resolve a systemAttribute against the wrong definition', () => {
    expect(getResourceStoreState().getFieldByRef('def_missing:order_status')).toBeUndefined()
  })
})

describe('useField', () => {
  it('resolves a concrete ref', () => {
    const { result } = renderHook(() => useField(toResourceFieldId('def_orders', 'cf_1')))
    expect(result.current?.id).toBe('cf_1')
  })

  it('resolves a late-bound @app: ref the same as the concrete one', () => {
    const { result } = renderHook(() => useField('shopify_orders:@app:shopify:id'))
    expect(result.current?.resourceFieldId).toBe('def_orders:cf_1')
  })

  it('returns undefined for an unresolvable ref', () => {
    const { result } = renderHook(() => useField('shopify_orders:@app:shopify:missing'))
    expect(result.current).toBeUndefined()
  })

  it('resolves an apiSlug + systemAttribute ref the same as the concrete one', () => {
    const { result } = renderHook(() => useField('shopify_orders:order_status'))
    expect(result.current?.resourceFieldId).toBe('def_orders:cf_2')
    expect(result.current?.label).toBe('Status')
  })
})
