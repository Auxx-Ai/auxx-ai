// packages/lib/src/data-connectors/edit-impact.test.ts
// The mapping-edit classifier is pure — exhaustively test every level + the
// mergeStrategy `ignore`→writing exception. DB-free, so no harness (the drizzle
// columns are undefined under vitest anyway — see project memory).

import { describe, expect, it } from 'vitest'
import {
  classifyConnectorChange,
  classifyMappingChange,
  classifyStreamRequestChange,
  maxLevel,
} from './edit-impact'
import type { DataConnectorMappingRow, DataConnectorRow, DataConnectorStreamRow } from './service'
import type { FieldMapping } from './types'

// ── Minimal row builders (only the fields the classifier reads matter) ─────────

function mapping(over: Partial<DataConnectorMappingRow> = {}): DataConnectorMappingRow {
  return {
    rootPath: 'data[]',
    linkMode: 'upsert',
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'ignore',
    entityDefinitionId: 'def_1',
    targetMode: 'contributing',
    fieldMappings: [],
    ...over,
  } as DataConnectorMappingRow
}

function fm(over: Partial<FieldMapping> = {}): FieldMapping {
  return {
    id: 'fm_1',
    targetFieldRef: 'def_1:field_a' as FieldMapping['targetFieldRef'],
    expression: '{name}',
    sourceFields: { name: 'name' },
    ...over,
  }
}

describe('classifyMappingChange — cosmetic', () => {
  it('relationshipFieldKey + orphanBehavior are cosmetic', () => {
    const prev = mapping()
    expect(
      classifyMappingChange(prev, { relationshipFieldKey: 'x', orphanBehavior: 'archive' }).level
    ).toBe('cosmetic')
  })

  it('a no-op patch (same values) is cosmetic', () => {
    const prev = mapping({ rootPath: 'data[]' })
    expect(classifyMappingChange(prev, { rootPath: 'data[]' }).level).toBe('cosmetic')
  })

  it('removing a (non-match) field is cosmetic — no re-crawl repairs a stranded value', () => {
    const prev = mapping({ fieldMappings: [fm({ id: 'a' }), fm({ id: 'b' })] })
    expect(classifyMappingChange(prev, { fieldMappings: [fm({ id: 'a' })] }).level).toBe('cosmetic')
  })

  it('a non-identity mergeStrategy change is cosmetic', () => {
    const prev = mapping({ fieldMappings: [fm({ id: 'a', mergeStrategy: 'fill_blank' })] })
    const next = [fm({ id: 'a', mergeStrategy: 'overwrite' })]
    expect(classifyMappingChange(prev, { fieldMappings: next }).level).toBe('cosmetic')
  })
})

describe('classifyMappingChange — rebind (identity)', () => {
  it.each([
    ['rootPath', { rootPath: 'items[]' }],
    ['parentMappingId', { parentMappingId: 'map_parent' }],
    ['entityDefinitionId', { entityDefinitionId: 'def_2' }],
    ['targetMode', { targetMode: 'owned' as const }],
    ['linkMode', { linkMode: 'reference' as const }],
  ])('%s change is rebind', (_label, patch) => {
    expect(classifyMappingChange(mapping(), patch).level).toBe('rebind')
  })

  it('adding a match flag is rebind', () => {
    const prev = mapping({ fieldMappings: [fm({ id: 'a' })] })
    const next = [fm({ id: 'a', match: { normalize: 'email' } })]
    const out = classifyMappingChange(prev, { fieldMappings: next })
    expect(out.level).toBe('rebind')
    expect(out.reasons).toContain('identity-match')
  })

  it('removing a match flag is rebind', () => {
    const prev = mapping({ fieldMappings: [fm({ id: 'a', match: { normalize: 'email' } })] })
    const next = [fm({ id: 'a' })]
    expect(classifyMappingChange(prev, { fieldMappings: next }).level).toBe('rebind')
  })

  it('changing the match normalizer is rebind', () => {
    const prev = mapping({ fieldMappings: [fm({ id: 'a', match: { normalize: 'email' } })] })
    const next = [fm({ id: 'a', match: { normalize: 'phone' } })]
    expect(classifyMappingChange(prev, { fieldMappings: next }).level).toBe('rebind')
  })

  it('removing a match-flagged field entirely is rebind', () => {
    const prev = mapping({
      fieldMappings: [fm({ id: 'a' }), fm({ id: 'b', match: { normalize: 'email' } })],
    })
    expect(classifyMappingChange(prev, { fieldMappings: [fm({ id: 'a' })] }).level).toBe('rebind')
  })
})

describe('classifyMappingChange — rebackfill (re-projection)', () => {
  it('adding a writing field is rebackfill', () => {
    const prev = mapping({ fieldMappings: [fm({ id: 'a' })] })
    const next = [fm({ id: 'a' }), fm({ id: 'b', targetFieldRef: 'def_1:field_b' as never })]
    const out = classifyMappingChange(prev, { fieldMappings: next })
    expect(out.level).toBe('rebackfill')
    expect(out.reasons).toContain('field-added')
  })

  it('editing an expression is rebackfill', () => {
    const prev = mapping({ fieldMappings: [fm({ id: 'a', expression: '{name}' })] })
    const next = [
      fm({ id: 'a', expression: '{first} {last}', sourceFields: { first: 'f', last: 'l' } }),
    ]
    expect(classifyMappingChange(prev, { fieldMappings: next }).level).toBe('rebackfill')
  })

  it('retargeting A→B is rebackfill', () => {
    const prev = mapping({
      fieldMappings: [fm({ id: 'a', targetFieldRef: 'def_1:field_a' as never })],
    })
    const next = [fm({ id: 'a', targetFieldRef: 'def_1:field_b' as never })]
    const out = classifyMappingChange(prev, { fieldMappings: next })
    expect(out.level).toBe('rebackfill')
    expect(out.reasons).toContain('field-retargeted')
  })

  it('mergeStrategy ignore→writing is rebackfill (the exception)', () => {
    const prev = mapping({ fieldMappings: [fm({ id: 'a', mergeStrategy: 'ignore' })] })
    const next = [fm({ id: 'a', mergeStrategy: 'overwrite' })]
    const out = classifyMappingChange(prev, { fieldMappings: next })
    expect(out.level).toBe('rebackfill')
    expect(out.reasons).toContain('merge-ignore-to-write')
  })

  it('adding an ignore-only field is NOT rebackfill (writes nothing)', () => {
    const prev = mapping({ fieldMappings: [fm({ id: 'a' })] })
    const next = [fm({ id: 'a' }), fm({ id: 'b', mergeStrategy: 'ignore' })]
    expect(classifyMappingChange(prev, { fieldMappings: next }).level).toBe('cosmetic')
  })
})

describe('classifyMappingChange — precedence', () => {
  it('a rebind reason wins over a co-occurring rebackfill reason', () => {
    const prev = mapping({ fieldMappings: [fm({ id: 'a', expression: '{name}' })] })
    // expression edit (rebackfill) + rootPath change (rebind) → rebind.
    const out = classifyMappingChange(prev, {
      rootPath: 'items[]',
      fieldMappings: [fm({ id: 'a', expression: '{x}', sourceFields: { x: 'x' } })],
    })
    expect(out.level).toBe('rebind')
    expect(out.reasons).toEqual(expect.arrayContaining(['rootPath', 'expression']))
  })
})

describe('classifyConnectorChange', () => {
  function connector(over: Partial<DataConnectorRow> = {}): DataConnectorRow {
    return {
      credentialId: 'cred_1',
      config: { endpoint: { baseUrl: 'https://a' } },
      ...over,
    } as DataConnectorRow
  }

  it('credential change is rebackfill (never rebind)', () => {
    expect(classifyConnectorChange(connector(), { credentialId: 'cred_2' }).level).toBe(
      'rebackfill'
    )
  })

  it('config change is rebackfill', () => {
    const out = classifyConnectorChange(connector(), {
      config: { endpoint: { baseUrl: 'https://b' } },
    })
    expect(out.level).toBe('rebackfill')
    expect(out.reasons).toContain('config')
  })

  it('an unchanged config is cosmetic', () => {
    const prev = connector()
    expect(
      classifyConnectorChange(prev, { config: { endpoint: { baseUrl: 'https://a' } } }).level
    ).toBe('cosmetic')
  })
})

describe('classifyStreamRequestChange', () => {
  function stream(over: Partial<DataConnectorStreamRow> = {}): DataConnectorStreamRow {
    return {
      requestConfig: { path: '/v1/a' },
      syncMode: 'snapshot',
      ...over,
    } as DataConnectorStreamRow
  }

  it('requestConfig change is rebackfill', () => {
    expect(classifyStreamRequestChange(stream(), { requestConfig: { path: '/v1/b' } }).level).toBe(
      'rebackfill'
    )
  })

  it('syncMode flip is rebackfill', () => {
    const out = classifyStreamRequestChange(stream(), {
      requestConfig: { path: '/v1/a' },
      syncMode: 'incremental',
    })
    expect(out.level).toBe('rebackfill')
    expect(out.reasons).toContain('sync-mode')
  })

  it('an unchanged request config is cosmetic', () => {
    expect(classifyStreamRequestChange(stream(), { requestConfig: { path: '/v1/a' } }).level).toBe(
      'cosmetic'
    )
  })
})

describe('maxLevel', () => {
  it('picks the higher-ranked level', () => {
    expect(maxLevel('cosmetic', 'rebackfill')).toBe('rebackfill')
    expect(maxLevel('rebind', 'rebackfill')).toBe('rebind')
    expect(maxLevel('cosmetic', 'cosmetic')).toBe('cosmetic')
  })
})
