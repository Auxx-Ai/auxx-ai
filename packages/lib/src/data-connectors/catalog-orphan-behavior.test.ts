// packages/lib/src/data-connectors/catalog-orphan-behavior.test.ts
// `orphanBehavior` from the app manifest → the persisted mapping row (v12 Phases 5+6).
//
// This closes a defect that would have made the whole feature inert on any existing
// installation. `orphanBehavior` was ALREADY part of `hashMappingShape`, so changing it
// in a manifest changed `catalogHash` — but the diff only ever emitted a
// `mapping-change` for `relationshipFieldKey`, and the apply only ever patched that one
// column. So a manifest that started declaring `archive` would:
//   • produce no diff entry, so nobody could accept it;
//   • never write the column, so reconciliation kept reading `'ignore'` forever; and
//   • present the changed hash to `editedWithoutOld` as "the user edited this row".
//
// Both halves are now wired, and the policy change must stay NON-STRUCTURAL: it changes
// no identity, target or binding, so it must never force a rebind or a re-backfill.

import type { CatalogConnectorStream, CatalogDataConnector } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCachedCustomFields, getCachedEntityDefId, getOrgCache } from '../cache'
import {
  FIXTURE_DEF_FIELDS,
  FIXTURE_DEF_IDS,
  fixturePersistedContext,
  fixtureResolver,
  persistedRowsFromDerived,
} from './__test-helpers'
import { diffConnectorCatalog } from './catalog-diff'
import { deriveConnectorShape, shapeFromPersistedStreams } from './catalog-shape'
import type { OrphanBehavior } from './types'

vi.mock('../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cache')>()
  return {
    ...actual,
    getCachedEntityDefId: vi.fn(),
    getCachedCustomFields: vi.fn(),
    getOrgCache: vi.fn(),
  }
})

beforeEach(() => {
  vi.mocked(getCachedEntityDefId).mockImplementation(async (_org, kind) => FIXTURE_DEF_IDS[kind])
  vi.mocked(getCachedCustomFields).mockImplementation(
    async (_org, defId) => (FIXTURE_DEF_FIELDS[defId] ?? []) as never
  )
  vi.mocked(getOrgCache).mockReturnValue({
    get: async (_org: string, key: string) => (key === 'entityDefs' ? FIXTURE_DEF_IDS : {}),
  } as never)
})

/**
 * The Shopify product stream in miniature: the product root plus its `variants[]`
 * parts, both CONTRIBUTING into shared platform defs. `declare` is what the manifest
 * says about each, which is the whole point of the test.
 */
function catalog(declare: {
  product?: OrphanBehavior
  part?: OrphanBehavior
  syncMode?: 'snapshot' | 'incremental'
}): CatalogDataConnector {
  const stream: CatalogConnectorStream = {
    key: 'product',
    syncMode: declare.syncMode ?? 'incremental',
    mappings: [
      {
        rootPath: '',
        target: { entityKind: 'product' },
        ...(declare.product ? { orphanBehavior: declare.product } : {}),
        fields: [{ sourcePath: 'title', target: 'product_title' }],
      },
      {
        rootPath: 'variants[]',
        relationshipFieldKey: 'system:product_parts',
        target: { entityKind: 'part' },
        ...(declare.part ? { orphanBehavior: declare.part } : {}),
        fields: [{ sourcePath: 'sku', target: 'part_sku' }],
      },
    ],
  }
  return {
    id: 'shopify',
    label: 'Shopify',
    requiresConnection: true,
    streams: [stream],
  } as CatalogDataConnector
}

function derive(cat: CatalogDataConnector) {
  return deriveConnectorShape(cat, [], 'shopify', fixtureResolver())
}

/** Behavior per mapping rootPath, as the derived shape carries it. */
function derivedBehaviors(cat: CatalogDataConnector): Record<string, string> {
  const out: Record<string, string> = {}
  for (const stream of derive(cat)) {
    for (const m of stream.mappings) out[m.rootPath] = m.orphanBehavior
  }
  return out
}

describe('orphanBehavior · declaration reaches the derived shape', () => {
  // The safe default has to survive, because every mapping in the tree relies on it:
  // a bug here would silently arm archival on every connector at once.
  it('defaults to ignore when the manifest says nothing', () => {
    expect(derivedBehaviors(catalog({}))).toEqual({ '': 'ignore', 'variants[]': 'ignore' })
  })

  it('carries a declared behavior per mapping, independently', () => {
    expect(derivedBehaviors(catalog({ product: 'archive', part: 'mark_deleted' }))).toEqual({
      '': 'archive',
      'variants[]': 'mark_deleted',
    })
  })

  // A CONTRIBUTING mapping is the case that matters: Shopify's products and parts both
  // contribute into shared platform defs, and before v12 the derivation hardcoded
  // `'ignore'` for them (and for owned mappings) no matter what any manifest said.
  it('honours a declaration on a contributing mapping', () => {
    expect(derivedBehaviors(catalog({ product: 'archive' }))['']).toBe('archive')
  })
})

describe('orphanBehavior · roll-forward', () => {
  function diffFor(from: CatalogDataConnector, to: CatalogDataConnector) {
    const oldDerived = derive(from)
    const persisted = shapeFromPersistedStreams(
      persistedRowsFromDerived(oldDerived),
      fixturePersistedContext()
    )
    return diffConnectorCatalog(persisted, derive(to), oldDerived)
  }

  it('emits a mapping-change entry naming the field', () => {
    const diff = diffFor(catalog({}), catalog({ product: 'archive' }))
    const entry = diff.entries.find((e) => e.change.kind === 'mapping')
    expect(entry).toBeDefined()
    expect(entry?.change).toMatchObject({ op: 'change', fields: ['orphanBehavior'] })
  })

  // Non-structural: nothing about identity, target or bindings moved, so a policy flip
  // must not re-crawl the whole stream or invalidate the bindings.
  it('classifies the change as non-structural (no rebind, no re-backfill)', () => {
    const diff = diffFor(catalog({}), catalog({ product: 'archive' }))
    const entry = diff.entries.find((e) => e.change.kind === 'mapping')!
    expect(entry.impact.level).not.toBe('rebind')
    expect(entry.impact.level).not.toBe('rebackfill')
  })

  it('emits nothing when the behavior is unchanged', () => {
    const diff = diffFor(catalog({ product: 'archive' }), catalog({ product: 'archive' }))
    expect(diff.entries.filter((e) => e.change.kind === 'mapping')).toHaveLength(0)
  })

  it('emits one entry per changed mapping', () => {
    const diff = diffFor(catalog({}), catalog({ product: 'archive', part: 'mark_deleted' }))
    expect(diff.entries.filter((e) => e.change.kind === 'mapping')).toHaveLength(2)
  })

  // The apply step carries the derived mapping, and `catalog-update` reads
  // `derived.orphanBehavior` off it. Without this the entry would be acceptable in the
  // UI and still never write the column — the exact shape of the original defect.
  it('hands the apply step the new behavior to write', () => {
    const diff = diffFor(catalog({}), catalog({ product: 'archive' }))
    const entry = diff.entries.find((e) => e.change.kind === 'mapping')!
    const step = diff.steps.get(entry.id)
    expect(step?.kind).toBe('mapping-change')
    const derived = step?.kind === 'mapping-change' ? step.derived : null
    expect(derived?.orphanBehavior).toBe('archive')
  })
})
