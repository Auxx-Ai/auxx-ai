// packages/lib/src/data-connectors/history-coverage-queries.ts
// see plans/data-connectors/v15/history-window.md §4 D

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { createGuard } from '../utils/guard'
import { loadAppCatalogConnector } from './connectors/app-connector-adapter'
import {
  type CoverageStream,
  coverageNeedsFrom,
  coverageStreamKind,
  defaultHistoryStartDate,
  isCovered,
  latestCoverage,
  projectedFloor,
  streamCoverageFrom,
} from './history-coverage-plan'
import type { DataConnectorRow } from './service'
import type { ConnectorStreamState, DataConnectorConfig, StreamRequestConfig } from './types'

const guard = createGuard('data-connectors:coverage')

/** Statuses whose connector is gone or going; they never count toward coverage. */
const EXCLUDED_STATUSES = ['disconnected', 'deleting', 'delete_failed'] as const

/** One connector's coverage, as the setup screens list it. */
export interface ConnectorCoverageRow {
  connectorId: string
  name: string
  type: string
  status: string
  /** `config.historyStartDate`, `YYYY-MM-DD`; null = everything. */
  historyStartDate: string | null
  /** How far back the date-bounded streams reach (the least far back of them), ISO; null = everything. */
  coverageFrom: string | null
  /** Whether `coverageFrom` reaches `needsFrom`; null without accounting. */
  ok: boolean | null
  /** A sync or re-import is running; the row points at the Runs panel. */
  importing: boolean
}

export interface ConnectorCoverageReport {
  /** Books start − 60 days, ISO; null when accounting is not active. */
  needsFrom: string | null
  rows: ConnectorCoverageRow[]
}

/** A connector with its date-bounded streams, as coverage reads and plans it. */
export interface CoverageConnector {
  connector: DataConnectorRow
  historyStartDate: string | undefined
  streams: CoverageStream[]
}

/** The cutover start of an accounting-active org; lazy so accounting stays out of connector tests. */
export async function readCoverageCutover(organizationId: string): Promise<Date | null> {
  const { readActiveCutoverStart } = await import('../accounting/ledger/setup/cutover-start')
  return readActiveCutoverStart(organizationId)
}

/** A new connector's `historyStartDate` (D1): 12 months back, or books start − 60 days when earlier. */
export async function readDefaultHistoryStartDate(
  organizationId: string,
  today = new Date()
): Promise<string> {
  return defaultHistoryStartDate(await readCoverageCutover(organizationId), today)
}

/**
 * Live connectors (paused included) that have at least one date-bounded stream, with those
 * streams. `connectorId` narrows to one.
 */
export async function loadCoverageConnectors(
  db: Database,
  organizationId: string,
  connectorId?: string
): Promise<CoverageConnector[]> {
  const C = schema.DataConnector
  const connectors = await db.query.DataConnector.findMany({
    where: and(
      eq(C.organizationId, organizationId),
      notInArray(C.status, [...EXCLUDED_STATUSES]),
      ...(connectorId ? [eq(C.id, connectorId)] : [])
    ),
    orderBy: C.name,
  })
  if (connectors.length === 0) return []
  const S = schema.DataConnectorStream
  const streamRows = await db.query.DataConnectorStream.findMany({
    where: inArray(
      S.dataConnectorId,
      connectors.map((c) => c.id)
    ),
  })

  const out: CoverageConnector[] = []
  for (const connector of connectors) {
    const catalog =
      connector.definitionKind === 'app'
        ? await loadAppCatalogConnector(organizationId, connector)
        : null
    const streams = streamRows
      .filter((s) => s.dataConnectorId === connector.id && s.streamKey)
      .map(
        (s): CoverageStream => ({
          id: s.id,
          key: s.streamKey ?? '',
          enabled: s.enabled,
          decl: catalog?.streams.find((c) => c.key === s.streamKey)?.query,
          backfillWindow:
            connector.definitionKind !== 'app' &&
            !!(s.requestConfig as StreamRequestConfig | null)?.backfillWindow,
          state: (s.state ?? {}) as ConnectorStreamState,
        })
      )
      .filter((s) => coverageStreamKind(s) !== null)
    if (streams.length === 0) continue
    const config = (connector.config ?? {}) as DataConnectorConfig
    out.push({ connector, historyStartDate: config.historyStartDate, streams })
  }
  return out
}

/** One row per connector whose history a date can bound, judged against the books start − 60 days. */
export function toCoverageRow(
  item: CoverageConnector,
  cutoverStart: Date | null,
  needsFrom: string | null
): ConnectorCoverageRow {
  const floor = projectedFloor(item.historyStartDate, cutoverStart)
  const coverageFrom = latestCoverage(item.streams.map((s) => streamCoverageFrom(s.state, floor)))
  const { connector } = item
  return {
    connectorId: connector.id,
    name: connector.name,
    type: connector.type,
    status: connector.status,
    historyStartDate: item.historyStartDate ?? null,
    coverageFrom,
    ok: needsFrom ? isCovered(coverageFrom, needsFrom) : null,
    importing: connector.status === 'syncing' || connector.status === 'provisioning',
  }
}

/** How far back every connector's history reaches, and whether that covers the books. */
export async function readConnectorCoverage(
  db: Database,
  organizationId: string
): Promise<Result<ConnectorCoverageReport, Error>> {
  return guard(
    async () => {
      const [items, cutoverStart] = await Promise.all([
        loadCoverageConnectors(db, organizationId),
        readCoverageCutover(organizationId),
      ])
      const needsFrom = coverageNeedsFrom(cutoverStart)
      return { needsFrom, rows: items.map((item) => toCoverageRow(item, cutoverStart, needsFrom)) }
    },
    'Failed to read connector coverage',
    { organizationId }
  )
}
