// apps/web/src/test/logger-mock.ts

import type { Logger } from '@auxx/logger'
import { vi } from 'vitest'

/**
 * The one way `apps/web` tests should mock `@auxx/logger`.
 *
 * Same hazard as `~/test/database-mock`, one module over: 21 web test files
 * hand-write `vi.mock('@auxx/logger', () => ({ createScopedLogger: … }))`, which
 * REPLACES the module and drops `registerLogSink` and `_registerRunLogWriter`.
 * The file then dies at COLLECTION — reported as a suite with **0 tests**, which
 * reads as an empty file rather than a regression — the first time anything in
 * its import graph touches one of those exports. That is how
 * `app/api/outlook/webhook/route.test.ts` failed after its `@auxx/database` mock
 * was fixed: the very next full-replacement mock in the same file took over.
 *
 * This one is built on `vi.importActual`, not an enumerated list, so it cannot
 * go stale: a new export added to `@auxx/logger` flows through automatically.
 * Only `createScopedLogger` is replaced, which is the part tests actually want
 * silenced.
 *
 * ```ts
 * vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())
 * ```
 *
 * See `plans/testing/database-mock-collection-hazard.md`.
 */
export async function mockAuxxLogger(
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<typeof import('@auxx/logger')>('@auxx/logger')
  return { ...actual, createScopedLogger: () => createSilentLogger(), ...overrides }
}

/**
 * A `Logger` whose every method is a `vi.fn()` and whose `.with()` returns
 * itself, so chained `logger.with({ … }).warn(…)` calls are inert but still
 * assertable.
 */
export function createSilentLogger(): Logger {
  const logger: Logger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    with: vi.fn(() => logger),
  }
  return logger
}
