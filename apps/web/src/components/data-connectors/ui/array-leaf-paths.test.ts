// apps/web/src/components/data-connectors/ui/array-leaf-paths.test.ts
// The builder's source tree and the runtime spell a leaf inside a named array
// differently — `emails[].value` vs `emails[0].value` — and these are the tests that
// keep the translation between them honest in BOTH directions.
//
// Why it matters, in the two failure modes this pins:
//  • WRITE — `map-record.getByPath` matches `/^(.*?)\[(\d+)\]$/`, so a digit-less
//    `emails[]` segment is read as a literal key and the path resolves `undefined`.
//    A binding minted from the raw node path therefore looked correct in the builder
//    and wrote nothing at sync (verified against `mapRecord`: `[0]` → the value,
//    `[]` → the key present carrying `undefined`).
//  • READ — an indexed binding keyed by its exact string matched no leaf in the tree
//    and was not a formula row either, so it rendered NOWHERE. That is how four of
//    the Quo contacts template's six mappings looked unmapped while being stored
//    correctly.

import { describe, expect, it } from 'vitest'
import type { SourcePath } from '../hooks/use-source-paths'
import type { FieldMapping } from '../hooks/use-stream-mutations'
import type { DraftMapping } from '../stores/connector-draft-store'
import {
  bareTokenNodePath,
  bindingFor,
  removeBindingForSource,
  toBindingPath,
  toNodePath,
  upsertBinding,
} from './field-mapping-edits'
import { computeMappingView } from './mapping-view'

describe('array-leaf path translation', () => {
  it('node → binding addresses the first element', () => {
    expect(toBindingPath('defaultFields.emails[].value')).toBe('defaultFields.emails[0].value')
  })

  it('binding → node array-normalizes any index', () => {
    expect(toNodePath('defaultFields.emails[0].value')).toBe('defaultFields.emails[].value')
    expect(toNodePath('defaultFields.emails[3].value')).toBe('defaultFields.emails[].value')
  })

  it('leaves plain paths untouched in both directions', () => {
    expect(toBindingPath('defaultFields.firstName')).toBe('defaultFields.firstName')
    expect(toNodePath('defaultFields.firstName')).toBe('defaultFields.firstName')
  })

  it('never rewrites a TRAILING [] — that is a fan-out rootPath, not a leaf', () => {
    expect(toBindingPath('line_items[]')).toBe('line_items[]')
    expect(toNodePath('line_items[]')).toBe('line_items[]')
  })

  it('translates every hop of a doubly-nested path', () => {
    expect(toBindingPath('a[].b[].c')).toBe('a[0].b[0].c')
    expect(toNodePath('a[0].b[2].c')).toBe('a[].b[].c')
  })
})

describe('bindings minted from a tree node path', () => {
  it('stores the runtime-resolvable indexed form, not the node form', () => {
    const b = bindingFor('defaultFields.emails[].value', 'def1:email')
    expect(b.expression).toBe('{defaultFields.emails[0].value}')
    expect(b.sourceFields).toEqual({
      'defaultFields.emails[0].value': 'defaultFields.emails[0].value',
    })
  })

  it('re-binding the same leaf replaces rather than duplicates, across spellings', () => {
    const existing: FieldMapping[] = [
      {
        id: 'old',
        targetFieldRef: 'def1:email',
        expression: '{defaultFields.emails[0].value}',
        sourceFields: { 'defaultFields.emails[0].value': 'defaultFields.emails[0].value' },
      },
    ]
    // The UI re-binds using the NODE path it renders.
    const next = upsertBinding(existing, 'defaultFields.emails[].value', 'def1:other')
    expect(next).toHaveLength(1)
    expect(next[0]?.targetFieldRef).toBe('def1:other')
  })

  it('clears a stored indexed binding when asked by node path', () => {
    const existing: FieldMapping[] = [
      {
        id: 'old',
        targetFieldRef: 'def1:email',
        expression: '{defaultFields.emails[0].value}',
        sourceFields: { 'defaultFields.emails[0].value': 'defaultFields.emails[0].value' },
      },
    ]
    expect(removeBindingForSource(existing, 'defaultFields.emails[].value')).toEqual([])
  })
})

describe('computeMappingView renders an indexed binding on its leaf', () => {
  // The Quo contacts shape, trimmed to the two bindings that used to vanish.
  const sourcePaths: SourcePath[] = [
    { path: 'defaultFields', type: 'object', depth: 0, isBranch: true },
    { path: 'defaultFields.firstName', type: 'string', depth: 1, isBranch: false },
    { path: 'defaultFields.emails', type: 'array', depth: 1, isBranch: true },
    { path: 'defaultFields.emails[].value', type: 'string', depth: 2, isBranch: false },
  ]

  const mapping = {
    id: 'm1',
    rootPath: '',
    parentMappingId: null,
    linkMode: 'upsert',
    entityDefinitionId: 'def1',
    fieldMappings: [
      {
        id: 'e1',
        targetFieldRef: 'def1:email',
        expression: '{defaultFields.emails[0].value}',
        sourceFields: { 'defaultFields.emails[0].value': 'defaultFields.emails[0].value' },
      },
      {
        id: 'e2',
        targetFieldRef: 'def1:first',
        expression: '{defaultFields.firstName}',
        sourceFields: { 'defaultFields.firstName': 'defaultFields.firstName' },
      },
    ],
  } as unknown as DraftMapping

  const view = computeMappingView(
    mapping,
    sourcePaths,
    new Map([['m1', mapping]]),
    new Map([['m1', []]])
  )

  it('keys the indexed binding on its array leaf node path', () => {
    expect(view.sourceToEntry.get('defaultFields.emails[].value')?.id).toBe('e1')
  })

  it('still keys plain leaves unchanged', () => {
    expect(view.sourceToEntry.get('defaultFields.firstName')?.id).toBe('e2')
  })

  it('does not exile the indexed binding to a formula row', () => {
    expect(view.formulaEntries.map((e) => e.id)).toEqual([])
  })

  it('bareTokenNodePath is the key the tree looks up with', () => {
    expect(bareTokenNodePath('{defaultFields.emails[0].value}')).toBe(
      'defaultFields.emails[].value'
    )
  })
})
