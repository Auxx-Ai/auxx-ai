// apps/worker/src/boot/run-pending-migrations.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const runPendingDataMigrations = vi.fn()
const info = vi.fn()
const error = vi.fn()

vi.mock('@auxx/lib/data-migrations', () => ({
  runPendingDataMigrations: (...args: unknown[]) => runPendingDataMigrations(...args),
}))
vi.mock('@auxx/database', () => ({ database: { marker: 'db' } }))
vi.mock('@auxx/config/client', () => ({
  getAppVersion: () => ({ version: '0.1.235', sha: 'abc1234', buildTime: null }),
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info, error, warn: vi.fn(), debug: vi.fn() }),
}))

const { runPendingMigrationsInProcess } = await import('./run-pending-migrations')

/** Let the floating promise inside the function settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('runPendingMigrationsInProcess', () => {
  beforeEach(() => {
    runPendingDataMigrations.mockReset()
    info.mockReset()
    error.mockReset()
  })

  it('runs the migrations in this process rather than enqueueing a job', async () => {
    runPendingDataMigrations.mockResolvedValue({ applied: ['151-x'], skipped: [] })

    runPendingMigrationsInProcess()
    await settle()

    // The point of the whole fix: the runner is CALLED here, with this process's
    // database handle. A queue dispatch could be answered by the outgoing build.
    expect(runPendingDataMigrations).toHaveBeenCalledWith({ marker: 'db' })
  })

  it('does not block the caller', () => {
    // Boot must not await a long backfill, or a slow migration trips the healthcheck
    // timeout and fails the deploy.
    runPendingDataMigrations.mockReturnValue(new Promise(() => {}))

    expect(runPendingMigrationsInProcess()).toBeUndefined()
  })

  it('stamps the build on both log lines', async () => {
    runPendingDataMigrations.mockResolvedValue({ applied: [], skipped: ['001-x'] })

    runPendingMigrationsInProcess()
    await settle()

    // `applied: []` is indistinguishable from a correct no-op unless the log says
    // which build produced it — that is what the 2026-09-11 incident lacked.
    for (const call of info.mock.calls) {
      expect(call[1]).toMatchObject({ build: { version: '0.1.235', sha: 'abc1234' } })
    }
    expect(info).toHaveBeenCalledWith(
      'Boot data-migrations run finished',
      expect.objectContaining({ summary: { applied: [], skipped: ['001-x'] } })
    )
  })

  it('logs a rejection instead of leaving it unhandled', async () => {
    runPendingDataMigrations.mockRejectedValue(new Error('advisory lock exploded'))

    runPendingMigrationsInProcess()
    await settle()

    // Nothing awaits the promise, so a missing catch is both invisible AND fatal:
    // an unhandled rejection takes the worker process down.
    expect(error).toHaveBeenCalledWith(
      'Boot data-migrations run failed',
      expect.objectContaining({ error: 'advisory lock exploded' })
    )
  })
})
