// apps/web/src/components/workflow/parity/catalog-coverage.test.ts

import {
  getManifest,
  listManifests,
  NOT_YET_MIGRATED,
  NodeCategory,
  type NodeManifest,
} from '@auxx/lib/workflow-engine/client'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineFromManifest } from '../nodes/define-from-manifest'
import { NodeType } from '../types/node-types'

/**
 * Catalog migration coverage (node-catalog Phase 1).
 *
 * Every builder `NodeType` lives in EXACTLY one of two places: the lib
 * catalog's registered manifests, or its explicit `NOT_YET_MIGRATED` list.
 * Asserted as exact set equality in both directions, so:
 *   - migrating a type without deleting its list entry fails;
 *   - adding a new NodeType without deciding its catalog status fails;
 *   - registering a manifest for a type the builder doesn't know fails.
 *
 * The NOT_YET_MIGRATED list is the migration tracker and may only shrink.
 * App blocks (`appId:blockId` dynamic types) are outside NodeType and outside
 * this contract — they get a declarative adapter in a later wave.
 */
describe('node catalog coverage', () => {
  const nodeTypes = new Set<string>(Object.values(NodeType))
  const migrated = new Set(listManifests().map((manifest) => manifest.id))
  const notYetMigrated = new Set(NOT_YET_MIGRATED)

  it('covers every NodeType exactly once across {manifests, NOT_YET_MIGRATED}', () => {
    const uncovered = [...nodeTypes].filter((t) => !migrated.has(t) && !notYetMigrated.has(t))
    const doubleCovered = [...nodeTypes].filter((t) => migrated.has(t) && notYetMigrated.has(t))
    expect({ uncovered, doubleCovered }).toEqual({ uncovered: [], doubleCovered: [] })
  })

  it('lists no unknown types in NOT_YET_MIGRATED and registers no unknown manifests', () => {
    const unknownListed = [...notYetMigrated].filter((t) => !nodeTypes.has(t))
    const unknownRegistered = [...migrated].filter((t) => !nodeTypes.has(t))
    expect({ unknownListed, unknownRegistered }).toEqual({
      unknownListed: [],
      unknownRegistered: [],
    })
  })

  it('every manifest default parses against its own configSchema', () => {
    // The legacy NodeDefinition.schema was `any` and never parsed — the code
    // node's dead `output.type?.type` read and resource-trigger's
    // schema-failing defaults both hid behind that. Manifests don't get to.
    const failures = listManifests()
      .map((manifest) => ({
        id: manifest.id,
        result: manifest.configSchema.safeParse(manifest.defaultData()),
      }))
      .filter(({ result }) => !result.success)
      .map(({ id, result }) => ({ id, error: (result as { error?: unknown }).error }))
    expect(failures).toEqual([])
  })
})

describe('defineFromManifest', () => {
  const fakeManifest: NodeManifest<{ title: string }> = {
    id: 'fake-node',
    category: NodeCategory.UTILITY,
    displayName: 'Fake Node',
    description: 'Merge-helper unit fixture',
    icon: 'box',
    color: 'gray',
    defaultData: () => ({ title: 'Untitled' }),
    configSchema: z.object({ title: z.string() }),
    validate: (config) => ({
      isValid: config.title.length > 0,
      errors: config.title.length > 0 ? [] : [{ field: 'title', message: 'Required' }],
    }),
    connection: { canConnect: true, maxOutgoingConnections: 1 },
    agent: { authorable: true, usage: 'test only', examples: [] },
  }

  it('builds a NodeDefinition every registry consumer can read', () => {
    const definition = defineFromManifest(fakeManifest, {
      outputVariables: () => [],
    })

    expect(definition.id).toBe('fake-node')
    expect(definition.category).toBe(NodeCategory.UTILITY)
    expect(definition.displayName).toBe('Fake Node')
    expect(definition.icon).toBe('box')
    expect(definition.defaultData).toEqual({ title: 'Untitled' })
    expect(definition.schema).toBe(fakeManifest.configSchema)
    expect(definition.canConnect).toBe(true)
    expect(definition.maxOutgoingConnections).toBe(1)
    expect(definition.validator?.({ title: '' }).isValid).toBe(false)
    expect(definition.validator?.({ title: 'ok' }).isValid).toBe(true)
  })

  it('keeps getManifest empty-safe for unmigrated types', () => {
    expect(getManifest('wait')).toBeUndefined()
  })
})
