// packages/lib/src/workflow-engine/parity/declaration-only.resolvability.test.ts

/**
 * Supplementary, DECLARATION-ONLY check (no processor execution, no mocks) —
 * not one of the three resolvability invariants (`harness.ts`), and not part
 * of the scenario × invariant coverage table. Exists to close a specific gap
 * named in the suite's self-check: would this suite catch it if "the
 * empty-fields status variables disappeared again"?
 *
 * Both `generateFindNodeVariablesFromFields` and
 * `generateCrudNodeVariablesFromFields` (`resources/variable-generators.ts`)
 * carry an explicit comment that a resource with zero VISIBLE fields (every
 * field hidden, or genuinely none) must still declare its unconditional
 * status block — `count`/`query_info` for find, `success`/`operation`/
 * `resourceType`/`error`/`errorDetails` for crud — even though the main
 * record-shaped variable itself is correctly skipped. That is a
 * DECLARATION-time property (`resolveOutputs()`'s output, independent of any
 * run), not a resolvability one — none of `find.resolvability.test.ts` /
 * `crud.resolvability.test.ts`'s fixtures have a zero-field resource, so
 * their full walks never exercise this branch. This file closes that gap
 * directly, cheaply, without needing a third fixture entity wired through
 * the cache/DB mocks.
 */

import { describe, expect, it } from 'vitest'
import type { CrudNodeData } from '../catalog/nodes/crud'
import { CrudErrorStrategy, crudManifest } from '../catalog/nodes/crud'
import type { FindNodeData } from '../catalog/nodes/find'
import { findManifest } from '../catalog/nodes/find'
import { ALL_RESOURCES, EMPTY_FIELDS_DEF_ID, EMPTY_FIELDS_RESOURCE } from './fixtures'

const emptyContext = {
  resource: EMPTY_FIELDS_RESOURCE,
  allResources: [...ALL_RESOURCES, EMPTY_FIELDS_RESOURCE],
  resolveVariable: () => undefined,
}

describe('declaration-only: empty-fields status variables', () => {
  it('find findOne still declares count and query_info with zero visible fields', () => {
    const data = {
      resourceType: EMPTY_FIELDS_DEF_ID,
      findMode: 'findOne',
      conditions: [],
      conditionGroups: [],
    } as unknown as FindNodeData
    const ids = findManifest.resolveOutputs!(data, 'find_empty', emptyContext).map((v) => v.id)

    expect(ids).toContain('find_empty.count')
    expect(ids).toContain('find_empty.query_info')
    // The main record variable IS correctly absent — nothing to shape it from.
    expect(ids).not.toContain(`find_empty.${EMPTY_FIELDS_DEF_ID}`)
  })

  it('find findMany still declares count and query_info with zero visible fields', () => {
    const data = {
      resourceType: EMPTY_FIELDS_DEF_ID,
      findMode: 'findMany',
      conditions: [],
      conditionGroups: [],
    } as unknown as FindNodeData
    const ids = findManifest.resolveOutputs!(data, 'find_empty_many', emptyContext).map((v) => v.id)

    expect(ids).toContain('find_empty_many.count')
    expect(ids).toContain('find_empty_many.query_info')
  })

  it('crud create still declares the status block with zero visible fields', () => {
    const data = {
      resourceType: EMPTY_FIELDS_DEF_ID,
      mode: 'create',
      data: {},
      error_strategy: CrudErrorStrategy.fail,
      default_values: [],
    } as unknown as CrudNodeData
    const ids = crudManifest.resolveOutputs!(data, 'crud_empty', emptyContext).map((v) => v.id)

    expect(ids).toContain('crud_empty.success')
    expect(ids).toContain('crud_empty.operation')
    expect(ids).toContain('crud_empty.resourceType')
    expect(ids).toContain('crud_empty.error')
    expect(ids).toContain('crud_empty.errorDetails')
    // create/update still declare `id`/`record` regardless of field count
    // (`getCrudNodeOutputVariables` pushes them unconditionally for `mode !== 'delete'`).
    expect(ids).toContain('crud_empty.id')
    expect(ids).toContain('crud_empty.record')
    // The main record variable IS correctly absent.
    expect(ids).not.toContain(`crud_empty.${EMPTY_FIELDS_DEF_ID}`)
  })

  it('crud delete still declares deleted/id and the status block with zero visible fields', () => {
    const data = {
      resourceType: EMPTY_FIELDS_DEF_ID,
      mode: 'delete',
      resourceId: 'whatever',
      data: {},
      error_strategy: CrudErrorStrategy.fail,
      default_values: [],
    } as unknown as CrudNodeData
    const ids = crudManifest.resolveOutputs!(data, 'crud_empty_delete', emptyContext).map(
      (v) => v.id
    )

    expect(ids).toContain('crud_empty_delete.deleted')
    expect(ids).toContain('crud_empty_delete.id')
    expect(ids).toContain('crud_empty_delete.success')
    expect(ids).toContain('crud_empty_delete.operation')
    expect(ids).toContain('crud_empty_delete.resourceType')
    expect(ids).toContain('crud_empty_delete.error')
    expect(ids).toContain('crud_empty_delete.errorDetails')
  })
})
