// packages/lib/src/data-connectors/history-coverage-plan.ts
// Pure coverage arithmetic — see plans/data-connectors/v15/history-window.md §4 D and §5.

import type { ConnectorStreamQueryDecl, ConnectorStreamState } from './types'

/** Days of history before the books start that the coverage check asks for (D3). */
export const HISTORY_LOOKBACK_DAYS = 60

/** A new connector's default history window when accounting asks for nothing earlier (D1). */
export const DEFAULT_HISTORY_MONTHS = 12

const DAY_MS = 86_400_000

/** How a date-bounded stream fills a gap: a period re-import, a rescan sync, or a generic-REST re-crawl. */
export type CoverageStreamKind = 'reimport' | 'rescan' | 'window'

/** One stream as the coverage check sees it. */
export interface CoverageStream {
  id: string
  key: string
  enabled: boolean
  /** The app catalog's declaration; absent on built-in streams. */
  decl?: ConnectorStreamQueryDecl
  /** A generic-REST stream carrying a `backfillWindow` param. */
  backfillWindow: boolean
  state: ConnectorStreamState
}

/** The earliest moment the books need connector data from: cutover − 60 days, ISO; null without accounting. */
export function coverageNeedsFrom(cutoverStart: Date | null): string | null {
  if (!cutoverStart) return null
  return new Date(cutoverStart.getTime() - HISTORY_LOOKBACK_DAYS * DAY_MS).toISOString()
}

/** A new connector's `historyStartDate`: 12 months back, or the books' need when that is earlier. */
export function defaultHistoryStartDate(cutoverStart: Date | null, today: Date): string {
  const twelveMonths = new Date(today)
  twelveMonths.setUTCMonth(twelveMonths.getUTCMonth() - DEFAULT_HISTORY_MONTHS)
  const needs = coverageNeedsFrom(cutoverStart)
  const pick = needs && Date.parse(needs) < twelveMonths.getTime() ? new Date(needs) : twelveMonths
  return pick.toISOString().slice(0, 10)
}

/** The stream's gap-filling kind, or null when no date bounds it (snapshot, since-only, disabled). */
export function coverageStreamKind(stream: CoverageStream): CoverageStreamKind | null {
  if (!stream.enabled) return null
  if (stream.decl?.period) return stream.decl.since ? 'reimport' : 'rescan'
  return stream.backfillWindow ? 'window' : null
}

/** The floor a sync would use (mirrors `historyFloor`), ISO; null = everything. */
export function projectedFloor(
  historyStartDate: string | undefined,
  cutoverStart: Date | null
): string | null {
  const ms = historyStartDate ? Date.parse(historyStartDate) : Number.NaN
  if (!Number.isFinite(ms)) return null
  const cutover = cutoverStart?.getTime()
  return new Date(cutover !== undefined && cutover < ms ? cutover : ms).toISOString()
}

/**
 * How far back a stream reaches. A stream that never recorded coverage (not synced yet, or
 * synced before coverage existed) is taken to reach its floor, since those backfills were uncapped.
 */
export function streamCoverageFrom(state: ConnectorStreamState, floor: string | null) {
  return state.coverageFrom !== undefined ? state.coverageFrom : floor
}

/** The coverage that reaches least far back; null (everything) only when every value is null. */
export function latestCoverage(values: readonly (string | null)[]): string | null {
  let latest: string | null = null
  for (const value of values) {
    if (value !== null && (latest === null || Date.parse(value) > Date.parse(latest))) {
      latest = value
    }
  }
  return latest
}

/** Whether `coverageFrom` reaches back to `needsFrom`. */
export function isCovered(coverageFrom: string | null, needsFrom: string): boolean {
  return coverageFrom === null || Date.parse(coverageFrom) <= Date.parse(needsFrom)
}

/** What "Import missing history" does for one connector. */
export interface HistoryImportPlan {
  /** The new `historyStartDate`; undefined leaves it unchanged (it only ever moves earlier). */
  historyStartDate: string | undefined
  /** One period re-import over every finished `since` stream with a gap; `to` exclusive. */
  reimport: { streamIds: string[]; period: { from: string; to: string } } | null
  /** Rescan streams re-read the floor on every run, so a plain sync fills them. */
  syncNow: boolean
  /** Generic-REST window streams to stamp `resyncPending` on; the banner offers the re-crawl. */
  resyncStreamIds: string[]
  /** Keys of `since` streams whose first sync has not finished; it reads to the new date itself. */
  waiting: string[]
}

/** Plan the gap import for one connector against `needsFrom` (never capped, D4). */
export function planHistoryImport(input: {
  needsFrom: string
  historyStartDate: string | undefined
  cutoverStart: Date | null
  streams: readonly CoverageStream[]
}): HistoryImportPlan {
  const { needsFrom, historyStartDate, cutoverStart } = input
  const needsDay = needsFrom.slice(0, 10)
  // Absent = everything, which is already as early as it gets.
  const nextStart = historyStartDate && needsDay < historyStartDate ? needsDay : undefined
  const floor = projectedFloor(historyStartDate, cutoverStart)

  const reimportIds: string[] = []
  const reimportCoverage: string[] = []
  const resyncStreamIds: string[] = []
  const waiting: string[] = []
  let syncNow = false
  for (const stream of input.streams) {
    const kind = coverageStreamKind(stream)
    if (!kind) continue
    const coverage = streamCoverageFrom(stream.state, floor)
    if (coverage === null || isCovered(coverage, needsFrom)) continue
    if (kind === 'rescan') syncNow = true
    else if (kind === 'window') resyncStreamIds.push(stream.id)
    else if (stream.state.phase === 'steady') {
      reimportIds.push(stream.id)
      reimportCoverage.push(coverage)
    } else waiting.push(stream.key)
  }

  const latest = latestCoverage(reimportCoverage)
  return {
    historyStartDate: nextStart,
    // +1s: `to` is exclusive and records sharing the boundary second may sit on an unread page.
    reimport:
      reimportIds.length > 0 && latest
        ? {
            streamIds: reimportIds,
            period: { from: needsFrom, to: new Date(Date.parse(latest) + 1000).toISOString() },
          }
        : null,
    syncNow,
    resyncStreamIds,
    waiting,
  }
}
