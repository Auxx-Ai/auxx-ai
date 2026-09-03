// packages/lib/src/data-connectors/__test-helpers.ts
//
// Shared test-only fixtures for the data-connector sync sinks.
//
// `SyncCtx` is the single object every sink entry point takes, and it keeps
// growing (`manifest` in B2, `connectionMeta` in the identity plan, `sweep`,
// `driftByMapping`). Each sink test used to hand-roll the whole thing, so every
// new required member broke N fixtures at once — and the nine-field
// `counters` block was copied verbatim in three files.
//
// Build one here instead. Defaults mirror what production supplies for a run
// with nothing subscribed; pass overrides for whatever the case asserts on.

import type { Database } from '@auxx/database'
import {
  createManifestCollector,
  type ManifestCollector,
} from '../record-rules/sync-manifest-collector'
import { newRecordFailureTally } from './record-failure-tally'
import type { SyncCtx } from './sinks/types'

/**
 * A real, always-on {@link ManifestCollector} with ZERO rule subscriptions — exactly
 * what production builds for an org with no enabled record rules (plan 07: the
 * collector is always real; empty subscriptions just mean `subscriptionsFor` answers
 * undefined for every def, so tier-2 delta capture never fires). Pure and DB-free.
 */
export function emptyManifestCollector(): ManifestCollector {
  return createManifestCollector({})
}

/** A zeroed {@link SyncCtx.counters} — mirrors `newRunCounters()` in `./service`. */
export function zeroRunCounters(): SyncCtx['counters'] {
  return {
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    archived: 0,
    deleted: 0,
    failed: 0,
    relationshipWarnings: 0,
    errorSample: [],
  }
}

/**
 * Build a {@link SyncCtx} for a sink test. Every required member gets a
 * production-shaped default; `crud`/`ownedCrud` default to an empty stub, so a
 * case that exercises writes must pass its own spies.
 */
export function makeSyncCtx(over: Partial<SyncCtx> = {}): SyncCtx {
  return {
    db: {} as Database,
    orgId: 'org1',
    connector: { id: 'dc1', credentialId: 'cred1' } as SyncCtx['connector'],
    runId: 'run1',
    crud: {} as SyncCtx['crud'],
    ownedCrud: {} as SyncCtx['ownedCrud'],
    relationshipCrud: {} as SyncCtx['relationshipCrud'],
    counters: zeroRunCounters(),
    failureTally: newRecordFailureTally(),
    manifest: emptyManifestCollector(),
    touchedDefs: new Set<string>(),
    ...over,
  }
}

// ── Catalog-update fixtures (plans/money/tasks/41) ────────────────────────────
//
// A small Shopify-shaped app catalog in two versions, plus the org lookups the shape
// derivation needs, so `catalog-shape` / `catalog-diff` / `catalog-update` tests share
// one story: v2 turns `part_sku` into an exclusive match, makes `part_title`
// fill-blank, binds `note -> notes` on the contact, drops the contact `phone` binding,
// flips the customer stream to incremental, and adds a `fulfillment` stream.

import type { CatalogConnectorStream, CatalogDataConnector } from '@auxx/database'
import type { ContributingTargetField } from './app-catalog'
import {
  type DerivedStream,
  hashMappingShape,
  hashStreamShape,
  type PersistedShapeContext,
  type ShapeResolver,
} from './catalog-shape'
import type { StreamWithRawMappings } from './service'

export const FIXTURE_DEF_IDS: Record<string, string> = {
  product: 'def_product',
  part: 'def_part',
  catalog_item: 'def_catalog',
  contact: 'def_contact',
  fulfillment: 'def_fulfillment',
}

export const FIXTURE_DEF_FIELDS: Record<string, ContributingTargetField[]> = {
  def_product: [
    { id: 'f_ptitle', name: 'Title', systemAttribute: 'product_title', type: 'TEXT' },
    { id: 'f_parts', name: 'Parts', systemAttribute: 'product_parts', type: 'RELATIONSHIP' },
  ],
  def_part: [
    { id: 'f_sku', name: 'SKU', systemAttribute: 'part_sku', type: 'TEXT' },
    { id: 'f_title', name: 'Title', systemAttribute: 'part_title', type: 'TEXT' },
    {
      id: 'f_ci',
      name: 'Catalog Items',
      systemAttribute: 'part_catalog_items',
      type: 'RELATIONSHIP',
    },
  ],
  def_catalog: [
    {
      id: 'f_price',
      name: 'Default Unit Price',
      systemAttribute: 'catalog_item_default_unit_price',
      type: 'CURRENCY',
    },
  ],
  def_contact: [
    { id: 'f_email', name: 'Email', systemAttribute: 'primary_email', type: 'EMAIL' },
    { id: 'f_first', name: 'First name', systemAttribute: 'first_name', type: 'TEXT' },
    { id: 'f_phone', name: 'Phone', systemAttribute: 'phone', type: 'PHONE_INTL' },
    { id: 'f_notes', name: 'Notes', systemAttribute: 'notes', type: 'RICH_TEXT' },
    {
      id: 'f_store',
      name: 'Store domain',
      systemAttribute: null,
      type: 'TEXT',
      appFieldKey: 'storeDomain',
      appSlug: 'shopify',
    },
  ],
  def_fulfillment: [
    { id: 'f_status', name: 'Status', systemAttribute: 'fulfillment_status', type: 'TEXT' },
  ],
}

/** A `ShapeResolver` over the fixture defs (no owned defs to adopt). */
export function fixtureResolver(): ShapeResolver {
  return {
    entityDefIdByKind: (kind) => FIXTURE_DEF_IDS[kind],
    fieldsByDefId: (defId) => FIXTURE_DEF_FIELDS[defId] ?? [],
    ownedDefIdByEntityKey: () => null,
  }
}

/** The matching `PersistedShapeContext` (labels resolve def ids back to kinds). */
export function fixturePersistedContext(): PersistedShapeContext {
  const kindByDefId = new Map(Object.entries(FIXTURE_DEF_IDS).map(([k, id]) => [id, k]))
  return {
    fieldsByDefId: (defId) => FIXTURE_DEF_FIELDS[defId] ?? [],
    ownedEntityKeyByDefId: () => undefined,
    entityKeyByApiSlug: () => undefined,
    entityKindByDefId: (defId) => kindByDefId.get(defId),
  }
}

function productStream(v2: boolean): CatalogConnectorStream {
  return {
    key: 'product',
    syncMode: 'incremental',
    mappings: [
      {
        rootPath: '',
        target: { entityKind: 'product' },
        fields: [{ sourcePath: 'title', target: 'product_title' }],
      },
      {
        rootPath: 'variants[]',
        relationshipFieldKey: 'system:product_parts',
        target: { entityKind: 'part' },
        fields: v2
          ? [
              { sourcePath: 'title', target: 'part_title', mergeStrategy: 'fill_blank' },
              { sourcePath: 'sku', target: 'part_sku', match: 'exclusive' },
            ]
          : [
              { sourcePath: 'title', target: 'part_title' },
              { sourcePath: 'sku', target: 'part_sku' },
            ],
      },
      {
        rootPath: 'variants[]',
        parentRootPath: 'variants[]',
        relationshipFieldKey: 'system:part_catalog_items',
        target: { entityKind: 'catalog_item' },
        fields: [{ sourcePath: 'price', target: 'catalog_item_default_unit_price' }],
      },
    ],
  }
}

function customerStream(v2: boolean): CatalogConnectorStream {
  return {
    key: 'customer',
    syncMode: v2 ? 'incremental' : 'snapshot',
    mappings: [
      {
        rootPath: '',
        target: { entityKind: 'contact' },
        fields: [
          { sourcePath: 'email', target: 'primary_email', match: true },
          {
            sourcePath: 'first_name',
            target: 'first_name',
            mergeStrategy: v2 ? 'connector_owned_only' : 'fill_blank',
          },
          ...(v2 ? [] : [{ sourcePath: 'phone', target: 'phone' as const }]),
          ...(v2
            ? [
                {
                  sourcePath: 'note',
                  target: 'notes' as const,
                  mergeStrategy: 'fill_blank' as const,
                },
              ]
            : []),
        ],
        connectionFields: [{ appField: 'storeDomain', from: 'label' }],
      },
    ],
  }
}

const fulfillmentStream: CatalogConnectorStream = {
  key: 'fulfillment',
  syncMode: 'incremental',
  mappings: [
    {
      rootPath: '',
      target: { entityKind: 'fulfillment' },
      fields: [{ sourcePath: 'status', target: 'fulfillment_status' }],
    },
  ],
}

function catalogFixture(v2: boolean): CatalogDataConnector {
  return {
    id: 'shopify',
    label: 'Shopify',
    description: null,
    requiresConnection: true,
    iconKey: null,
    configJsonSchema: {},
    streams: [productStream(v2), customerStream(v2), ...(v2 ? [fulfillmentStream] : [])],
  }
}

/** The catalog the fixture connector was seeded from. */
export function catalogFixtureV1(): CatalogDataConnector {
  return catalogFixture(false)
}

/** The catalog the installation moved to. */
export function catalogFixtureV2(): CatalogDataConnector {
  return catalogFixture(true)
}

/**
 * Fabricate the rows the seeder would have written for `streams` (what `listStreams`
 * returns), with `catalogHash` stamped unless `withHash: false`. `edit` lets a test
 * hand-edit a mapping row (by stream key + stored rootPath + target def) before the
 * rows are handed to the diff.
 */
export function persistedRowsFromDerived(
  streams: readonly DerivedStream[],
  options: { withHash?: boolean } = {}
): StreamWithRawMappings[] {
  const withHash = options.withHash ?? true
  const now = new Date('2026-09-01T00:00:00Z')
  let n = 0
  return streams.map((stream) => {
    const streamId = `s_${stream.key}`
    const idByKey = new Map<string, string>()
    const mappings = stream.mappings.map((m) => {
      const id = `m_${++n}`
      idByKey.set(m.key, id)
      return {
        id,
        dataConnectorStreamId: streamId,
        organizationId: 'org1',
        rootPath: m.rootPath,
        linkMode: m.linkMode,
        parentMappingId: m.parentKey ? (idByKey.get(m.parentKey) ?? null) : null,
        relationshipFieldKey: m.storedRelationshipFieldKey,
        targetMode: m.targetMode,
        entityDefinitionId: m.entityDefinitionId,
        fieldMappings: m.fieldMappings.map((fm) => ({ ...fm })),
        orphanBehavior: m.orphanBehavior,
        catalogHash: withHash ? hashMappingShape(m) : null,
        createdAt: now,
        updatedAt: now,
      }
    })
    return {
      id: streamId,
      dataConnectorId: 'dc1',
      organizationId: 'org1',
      streamKey: stream.key,
      enabled: true,
      sourceSchema: stream.sourceSchema,
      schemaSource: 'catalog',
      syncMode: stream.syncMode,
      requestConfig: stream.webhookTrigger ? { webhookTrigger: stream.webhookTrigger } : null,
      state: {},
      sampleRunId: null,
      catalogHash: withHash ? hashStreamShape(stream) : null,
      createdAt: now,
      updatedAt: now,
      mappings,
    } as StreamWithRawMappings
  })
}
