// apps/web/src/components/resources/hooks/use-resource.test.ts
// `useResource` must return EFFECTIVE fields, not the hydration snapshot.
// `resourceMap` is written once by `setResources` and never touched by field
// actions, so a raw `resource.fields` read shows pre-mutation state — the bug
// behind inline tag creation on the record-create dialog, where a full
// option-list replace built on the stale snapshot cascade-deleted other tags'
// values (plans/custom-fields/inline-option-creation-broken-v2.md).

import type { CustomResource, ResourceField } from '@auxx/lib/resources/client'
import { toResourceFieldId } from '@auxx/types/field'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getResourceStoreState } from '../store/resource-store'
import { useResource } from './use-resource'
import { useResourceFields } from './use-resource-fields'

const tagsFieldKey = toResourceFieldId('def_orders', 'cf_tags')

const tagsField = {
  id: 'cf_tags',
  key: 'tags',
  label: 'Tags',
  type: 'multiselect',
  fieldType: 'TAGS',
  capabilities: {
    filterable: true,
    sortable: true,
    creatable: true,
    updatable: true,
    configurable: true,
  },
  resourceFieldId: tagsFieldKey,
  options: {
    options: [
      { value: 'opt_example', label: 'example' },
      { value: 'opt_qwe', label: 'qwe' },
    ],
  },
} as unknown as ResourceField

const ordersResource = {
  id: 'def_orders',
  type: 'custom',
  apiSlug: 'orders',
  entityType: 'order',
  entityDefinitionId: 'def_orders',
  organizationId: 'org_1',
  label: 'Order',
  plural: 'Orders',
  icon: 'box',
  color: 'blue',
  isVisible: true,
  fields: [tagsField],
  display: {
    primaryDisplayField: null,
    secondaryDisplayField: null,
    avatarField: null,
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },
} as unknown as CustomResource

const fieldOptions = (resource: { fields: ResourceField[] } | undefined) =>
  (resource?.fields.find((f) => f.id === 'cf_tags')?.options?.options ?? []) as Array<{
    value: string
    label: string
  }>

beforeEach(() => {
  getResourceStoreState().reset()
  getResourceStoreState().setResources([ordersResource])
})

describe('useResource effective fields', () => {
  it('returns the field content from the snapshot after hydration', () => {
    const { result } = renderHook(() => useResource('def_orders'))
    expect(fieldOptions(result.current.resource).map((o) => o.label)).toEqual(['example', 'qwe'])
  })

  it('resolves by apiSlug alias with the same effective fields', () => {
    const { result } = renderHook(() => useResource('orders'))
    expect(fieldOptions(result.current.resource).map((o) => o.label)).toEqual(['example', 'qwe'])
  })

  it('reflects an optimistic option-list update before the server confirms', () => {
    const { result } = renderHook(() => useResource('def_orders'))

    act(() => {
      getResourceStoreState().setFieldOptimistic(tagsFieldKey, {
        options: {
          options: [
            ...fieldOptions(result.current.resource),
            { value: 'opt_new', label: 'urgent' },
          ],
        },
      } as Partial<ResourceField>)
    })

    expect(fieldOptions(result.current.resource).map((o) => o.label)).toEqual([
      'example',
      'qwe',
      'urgent',
    ])
  })

  it('reverts to the snapshot content on rollback', () => {
    const { result } = renderHook(() => useResource('def_orders'))

    act(() => {
      getResourceStoreState().setFieldOptimistic(tagsFieldKey, {
        options: { options: [{ value: 'opt_new', label: 'urgent' }] },
      } as Partial<ResourceField>)
    })
    expect(fieldOptions(result.current.resource).map((o) => o.label)).toEqual(['urgent'])

    act(() => {
      getResourceStoreState().rollbackFieldUpdate(tagsFieldKey)
    })
    expect(fieldOptions(result.current.resource).map((o) => o.label)).toEqual(['example', 'qwe'])
  })

  it('hides an optimistically deleted field and restores it on rollback', () => {
    const { result } = renderHook(() => useResource('def_orders'))

    act(() => {
      getResourceStoreState().markFieldDeleted(tagsFieldKey)
    })
    expect(result.current.resource?.fields.find((f) => f.id === 'cf_tags')).toBeUndefined()

    act(() => {
      getResourceStoreState().rollbackFieldDelete(tagsFieldKey)
    })
    expect(result.current.resource?.fields.find((f) => f.id === 'cf_tags')).toBeDefined()
  })

  it('includes an optimistically created field before the server confirms', () => {
    const { result } = renderHook(() => useResource('def_orders'))

    const tempKey = toResourceFieldId('def_orders', 'temp_1')
    act(() => {
      getResourceStoreState().addOptimisticField(tempKey, {
        ...tagsField,
        id: 'temp_1',
        resourceFieldId: tempKey,
        label: 'Priority',
      } as ResourceField)
    })

    expect(result.current.resource?.fields.map((f) => f.label)).toEqual(['Tags', 'Priority'])
  })

  it('keeps a stable resource reference across unrelated re-renders', () => {
    const { result, rerender } = renderHook(() => useResource('def_orders'))
    const first = result.current.resource
    rerender()
    expect(result.current.resource).toBe(first)
  })

  // The churn guard: an unrelated store write (loading flips on every fetch)
  // must NOT mint a new resource object, or every useResource consumer
  // re-renders on every fetch cycle. A field mutation is exactly when a new
  // identity is wanted.
  it('changes resource identity on field mutations and ONLY on field mutations', () => {
    const { result } = renderHook(() => useResource('def_orders'))
    const initial = result.current.resource

    act(() => {
      getResourceStoreState().setLoading(true)
    })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.resource).toBe(initial)

    act(() => {
      getResourceStoreState().setFieldOptimistic(tagsFieldKey, {
        options: { options: [{ value: 'opt_new', label: 'fresh' }] },
      } as Partial<ResourceField>)
    })
    expect(result.current.resource).not.toBe(initial)
  })

  // The invariant that kills the original bug class: the two field read paths
  // (`useResource(...).resource.fields` and `useResourceFields(...).fields`)
  // must never disagree again, through every optimistic phase. If this fails,
  // a surface reading one path shows different fields than a surface reading
  // the other — which is exactly how a stale full-list write once
  // cascade-deleted live tag values.
  it('always agrees with useResourceFields, through every optimistic phase', () => {
    const { result } = renderHook(() => ({
      viaResource: useResource('def_orders').resource?.fields,
      viaFields: useResourceFields('def_orders').fields,
    }))
    const expectParity = () => expect(result.current.viaResource).toEqual(result.current.viaFields)

    expectParity() // after hydration

    act(() => {
      getResourceStoreState().setFieldOptimistic(tagsFieldKey, {
        options: { options: [{ value: 'opt_new', label: 'urgent' }] },
      } as Partial<ResourceField>)
    })
    expectParity() // pending optimistic update

    act(() => {
      getResourceStoreState().addOptimisticField(toResourceFieldId('def_orders', 'temp_1'), {
        ...tagsField,
        id: 'temp_1',
        resourceFieldId: toResourceFieldId('def_orders', 'temp_1'),
        label: 'Priority',
      } as ResourceField)
    })
    expectParity() // optimistic new field

    act(() => {
      getResourceStoreState().markFieldDeleted(tagsFieldKey)
    })
    expectParity() // optimistic delete

    act(() => {
      getResourceStoreState().rollbackFieldDelete(tagsFieldKey)
      getResourceStoreState().rollbackFieldUpdate(tagsFieldKey)
    })
    expectParity() // rolled back
  })
})
