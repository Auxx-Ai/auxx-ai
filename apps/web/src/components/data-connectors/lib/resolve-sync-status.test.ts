// apps/web/src/components/data-connectors/lib/resolve-sync-status.test.ts
import { describe, expect, it } from 'vitest'
import { classifyConnectorError, resolveSyncStatus } from './resolve-sync-status'

const NOW = Date.parse('2026-06-22T12:00:00.000Z')

describe('classifyConnectorError', () => {
  it('flags auth/connection failures as reconnect', () => {
    for (const msg of [
      'Request failed: 401 Unauthorized',
      'Forbidden (403)',
      'invalid api key',
      'OAuth token expired',
      'authentication failed',
      'permission denied',
    ]) {
      expect(classifyConnectorError(msg)).toBe('auth')
    }
  })

  it('treats generic failures as retry', () => {
    expect(classifyConnectorError('ECONNRESET')).toBe('generic')
    expect(classifyConnectorError('sync stalled — checkpoint heartbeat went cold')).toBe('generic')
    expect(classifyConnectorError(null)).toBe('generic')
    expect(classifyConnectorError(undefined)).toBe('generic')
  })
})

describe('resolveSyncStatus', () => {
  it('maps pending → idle', () => {
    const r = resolveSyncStatus({ status: 'pending' }, NOW)
    expect(r.state).toBe('idle')
    expect(r.primaryAction).toBe('sync')
  })

  it('maps ready → idle with a distinct label/detail from pending', () => {
    const r = resolveSyncStatus({ status: 'ready' }, NOW)
    expect(r).toMatchObject({ state: 'idle', label: 'Ready', primaryAction: 'sync' })
    expect(r.detail).not.toBe('Add a source and field mappings to start syncing.')
  })

  it('maps paused → paused with resume', () => {
    const r = resolveSyncStatus({ status: 'paused' }, NOW)
    expect(r).toMatchObject({ state: 'paused', primaryAction: 'resume' })
  })

  it('maps a sample-parked connector → positive "Sample ready" with a sync (not resume) action', () => {
    const r = resolveSyncStatus(
      { status: 'paused', latestRun: { status: 'partial', pausedReason: 'sample' } },
      NOW
    )
    expect(r).toMatchObject({ state: 'paused', label: 'Sample ready', primaryAction: 'sync' })
    expect(r.detail).toContain('sync everything')
  })

  it('keeps a plain (non-sample) park reading as Paused/resume', () => {
    const r = resolveSyncStatus(
      { status: 'paused', latestRun: { status: 'partial', pausedReason: 'ingest-ceiling' } },
      NOW
    )
    expect(r).toMatchObject({ state: 'paused', label: 'Paused', primaryAction: 'resume' })
  })

  it('maps an auth error → action-needed/reconnect', () => {
    const r = resolveSyncStatus({ status: 'error', error: '401 Unauthorized' }, NOW)
    expect(r).toMatchObject({ state: 'action-needed', primaryAction: 'reconnect' })
  })

  it('maps a generic error → error/retry and surfaces the message', () => {
    const r = resolveSyncStatus({ status: 'error', error: 'upstream 500' }, NOW)
    expect(r).toMatchObject({ state: 'error', primaryAction: 'retry', detail: 'upstream 500' })
  })

  it('derives rate-limited from a future rateLimitedUntil while syncing', () => {
    const until = new Date(NOW + 28_000).toISOString()
    const r = resolveSyncStatus(
      { status: 'syncing', latestRun: { status: 'running', rateLimitedUntil: until } },
      NOW
    )
    expect(r.state).toBe('rate-limited')
    expect(r.countdownUntil).toBe(until)
    expect(r.primaryAction).toBeUndefined()
  })

  it('falls through to plain syncing once the rate-limit window passes', () => {
    const until = new Date(NOW - 1_000).toISOString() // already elapsed
    const r = resolveSyncStatus(
      {
        status: 'syncing',
        latestRun: { status: 'running', rateLimitedUntil: until, recordsSeen: 0 },
      },
      NOW
    )
    expect(r.state).toBe('syncing')
  })

  it('shows live backfill counts with the active stream noun', () => {
    const r = resolveSyncStatus(
      {
        status: 'syncing',
        latestRun: {
          status: 'running',
          phase: 'backfill',
          recordsSeen: 3250,
          primaryStreamLabel: 'orders',
        },
      },
      NOW
    )
    expect(r).toMatchObject({ state: 'syncing', primaryAction: 'pause' })
    expect(r.detail).toBe('Importing orders — 3,250 records so far')
  })

  it('does not show "records so far" for a steady run', () => {
    const r = resolveSyncStatus(
      { status: 'syncing', latestRun: { status: 'running', phase: 'steady', recordsSeen: 9999 } },
      NOW
    )
    expect(r.detail).toBe('Syncing…')
  })

  it('labels provisioning distinctly', () => {
    expect(resolveSyncStatus({ status: 'provisioning' }, NOW).label).toBe('Provisioning')
  })

  it('maps live → synced with a per-run delta', () => {
    const r = resolveSyncStatus(
      { status: 'live', latestRun: { status: 'completed', created: 3, updated: 12 } },
      NOW
    )
    expect(r).toMatchObject({ state: 'synced', primaryAction: 'sync' })
    expect(r.detail).toBe('Last run: +12 updated, +3 new')
  })

  it('maps live with no changes → "Up to date."', () => {
    const r = resolveSyncStatus({ status: 'live', latestRun: { status: 'completed' } }, NOW)
    expect(r.detail).toBe('Up to date.')
  })
})
