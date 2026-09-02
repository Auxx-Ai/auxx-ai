// packages/lib/src/data-connectors/preflight/__tests__/support/fixtures.ts
// Small builders for the row shapes the pre-flight's tests need.

import type { DataConnectorRow } from '../../../service'

/**
 * A minimal, valid `DataConnectorRow` — defaults to the real `fixture`
 * connector type (`data-connectors/connectors/fixture.ts`), which the registry
 * resolves with zero network/DB access, so a test can drive
 * `sweepProductVariants` end to end against real connector resolution without
 * a live credential.
 */
export function makeConnectorRow(overrides: Partial<DataConnectorRow> = {}): DataConnectorRow {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'connector_1',
    organizationId: 'org_1',
    createdById: null,
    type: 'fixture',
    definitionKind: 'builtin',
    templateId: null,
    name: 'Test Connector',
    credentialId: null,
    appInstallationId: null,
    config: {},
    syncBehavior: 'manual',
    scheduleConfig: null,
    status: 'ready',
    state: {},
    resyncPending: null,
    schemaHash: null,
    lastSyncedAt: null,
    lastWebhookEventAt: null,
    lastJobId: null,
    itemCount: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as DataConnectorRow
}

/** One fixture product record, in the shape `fixtureConnector` expects under `config.filters.fixtures`. */
export function makeFixtureProductRecord(input: {
  externalId: string
  displayName?: string
  variants: Array<{ id: string; sku: string | null; title?: string }>
}) {
  return {
    streamKey: 'product',
    externalId: input.externalId,
    displayName: input.displayName ?? input.externalId,
    fields: {
      id: input.externalId,
      title: input.displayName ?? input.externalId,
      variants: input.variants.map((v) => ({ id: v.id, sku: v.sku, title: v.title ?? null })),
    },
  }
}
