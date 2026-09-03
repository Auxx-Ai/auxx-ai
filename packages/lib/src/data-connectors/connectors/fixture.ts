// packages/lib/src/data-connectors/connectors/fixture.ts
// Static-fixture connector — proves the sync spine with no external dependency.
// Not user-facing. The fixture set is read from `config.filters.fixtures` (an
// array of records keyed by stream) so tests/seeders can drive the engine
// deterministically.

import { createScopedLogger } from '@auxx/logger'
import type {
  ConnectorFetchArgs,
  ConnectorRecord,
  DataConnectorDefinition,
  FetchResult,
} from './types'

const logger = createScopedLogger('data-connector-fixture')

/** One fixture record as authored in connector config. */
interface FixtureRecord {
  streamKey: string
  externalId: string
  displayName: string
  fields: Record<string, unknown>
  deleted?: boolean
}

/**
 * Read the fixture record set for a stream from connector config. Authored under
 * `config.filters.fixtures` as a flat array; filtered by `streamKey` here.
 */
function fixturesFor(args: ConnectorFetchArgs): FixtureRecord[] {
  const all = (args.config.filters?.fixtures as FixtureRecord[] | undefined) ?? []
  return all.filter((r) => r.streamKey === args.streamKey)
}

async function* yieldFixtures(records: FixtureRecord[]): AsyncIterable<ConnectorRecord> {
  for (const r of records) {
    yield {
      streamKey: r.streamKey,
      externalId: r.externalId,
      displayName: r.displayName,
      fields: r.fields,
      deleted: r.deleted,
    }
  }
}

/**
 * The fixture connector. `fetch` returns the configured records for the stream
 * as an async-iterable and a no-op next cursor (fixtures are always a full
 * snapshot).
 */
export const fixtureConnector: DataConnectorDefinition = {
  type: 'fixture',
  schemaVersion: 1,
  streams: [],

  async fetch(args: ConnectorFetchArgs): Promise<FetchResult> {
    const records = fixturesFor(args)
    logger.debug('fixture fetch', { streamKey: args.streamKey, count: records.length })
    return {
      records: yieldFixtures(records),
      // No `backfillComplete` — removed with the field itself (task 43 §4); `phase`
      // is the completion signal and nothing ever read this back.
      nextState: { ...args.state },
    }
  },

  resolveDelete(event: unknown) {
    const e = event as { streamKey?: string; externalId?: string } | null
    if (e?.streamKey && e?.externalId) {
      return { streamKey: e.streamKey, externalId: e.externalId }
    }
    return null
  },
}
