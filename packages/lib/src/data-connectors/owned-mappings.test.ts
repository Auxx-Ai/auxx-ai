// packages/lib/src/data-connectors/owned-mappings.test.ts
// Pure-helper coverage for owned-mode app default-mapping materialization
// (step-11 gap 2). The DB orchestration in `createConnectorFromAppCatalog` has no
// vitest harness; these cover the ref-binding logic that's easy to get wrong.

import { toResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import { buildOwnedFieldMappings, ownedParentRootPath, ownedProvisionSpecs } from './mutations'

type CatalogField = Parameters<typeof ownedProvisionSpecs>[0][number]

const FIELDS: CatalogField[] = [
  { fieldKey: 'id', sourcePath: 'id', type: 'TEXT', name: 'GitHub ID' },
  { fieldKey: 'title', sourcePath: 'title', type: 'TEXT', name: 'Title' },
  // fieldKey differs from sourcePath — the provisioned column keys on fieldKey,
  // the projection expression keys on sourcePath.
  { fieldKey: 'author', sourcePath: 'user_login', type: 'TEXT', name: 'Author' },
  {
    fieldKey: 'secret',
    sourcePath: 'secret',
    type: 'TEXT',
    name: 'Secret',
    capabilities: { hidden: true },
  },
]

describe('ownedProvisionSpecs', () => {
  it('derives one connector-read-only spec per declared field, hidden honoring capabilities', () => {
    const specs = ownedProvisionSpecs(FIELDS)
    expect(specs).toEqual([
      {
        appFieldKey: 'id',
        name: 'GitHub ID',
        type: 'TEXT',
        isHidden: false,
        isUpdatable: false,
        isCreatable: false,
      },
      {
        appFieldKey: 'title',
        name: 'Title',
        type: 'TEXT',
        isHidden: false,
        isUpdatable: false,
        isCreatable: false,
      },
      {
        appFieldKey: 'author',
        name: 'Author',
        type: 'TEXT',
        isHidden: false,
        isUpdatable: false,
        isCreatable: false,
      },
      {
        appFieldKey: 'secret',
        name: 'Secret',
        type: 'TEXT',
        isHidden: true,
        isUpdatable: false,
        isCreatable: false,
      },
    ])
  })
})

describe('buildOwnedFieldMappings', () => {
  const defId = 'def_issues'
  const fieldIdByKey: Record<string, string> = {
    id: 'f_id',
    title: 'f_title',
    author: 'f_author',
    // `secret` intentionally absent — simulates a name collision with a user field.
  }

  it('binds concrete refs and keys the projection expression on sourcePath', () => {
    const mappings = buildOwnedFieldMappings(defId, fieldIdByKey, FIELDS)

    // `secret` (no provisioned id) is dropped.
    expect(mappings).toHaveLength(3)

    const author = mappings.find((m) => m.targetFieldRef === toResourceFieldId(defId, 'f_author'))
    expect(author).toBeDefined()
    // Expression reads `source.fields[sourcePath]`, not the fieldKey.
    expect(author?.expression).toBe('{user_login}')
    expect(author?.sourceFields).toEqual({ user_login: 'user_login' })
    expect(author?.id).toBeTruthy()
  })

  it('points every ref at the owned def', () => {
    const mappings = buildOwnedFieldMappings(defId, fieldIdByKey, FIELDS)
    for (const m of mappings) {
      expect(m.targetFieldRef?.startsWith(`${defId}:`)).toBe(true)
    }
  })
})

describe('ownedParentRootPath', () => {
  // The fan-out's `parentRelation` only forms when each child mapping carries a
  // `parentMappingId` — derived from rootPath nesting at materialization.
  const ALL = ['', 'line_items[]', 'line_items[].variants[]']

  it('a root mapping has no parent', () => {
    expect(ownedParentRootPath('', ALL)).toBeNull()
  })

  it('a one-level child parents to the root', () => {
    expect(ownedParentRootPath('line_items[]', ALL)).toBe('')
  })

  it('a nested child parents to the LONGEST proper prefix, not the root', () => {
    expect(ownedParentRootPath('line_items[].variants[]', ALL)).toBe('line_items[]')
  })

  it('rejects a bare prefix that does not end on a path boundary', () => {
    // `line_items` is a textual prefix of `line_items_extra[]` but not a path parent.
    expect(ownedParentRootPath('line_items_extra[]', ['', 'line_items[]'])).toBe('')
  })

  it('returns null when no candidate prefix exists (no root declared)', () => {
    expect(ownedParentRootPath('orders[].lines[]', ['orders[].lines[]', 'customers[]'])).toBeNull()
  })
})
