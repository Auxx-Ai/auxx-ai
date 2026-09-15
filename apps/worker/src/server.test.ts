// apps/worker/src/server.test.ts
//
// One question: does the worker register the accounting providers before it
// starts any worker that posts?
//
// plans/accounting/tasks/27-a-settlement-from-anywhere.md §1.5: the worker ran
// `payoutSyncJob` with no `registerAccountingProviders()` call, so every entry
// it posted resolved to the null provider and landed as `not_required`. Nothing
// in the type system asks for the call - the registry is a module-level map
// that is simply empty until somebody fills it - and nothing at runtime
// complains, because an empty registry is a SUPPORTED configuration for an org
// with nothing connected.
//
// ⚠️ A source-text assertion, on purpose. `server.ts` starts queues, workers,
// pollers and an HTTP server at import time and installs process signal
// handlers, so it cannot be imported by a test. The behavioural half - that the
// registration makes a connected org resolve to its adapter instead of `none` -
// is `packages/lib/src/money/__tests__/accounting-providers.test.ts`. This file
// pins the one thing that test cannot see: that THIS process calls it, and
// calls it before the workers start.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'server.ts'), 'utf8')

describe('worker boot sequence', () => {
  it('imports the shared accounting-provider registration from lib', () => {
    expect(source).toMatch(
      /import \{ registerAccountingProviders \} from '@auxx\/lib\/money\/accounting-providers'/
    )
  })

  it('calls registerAccountingProviders() before startWorkers()', () => {
    const registration = source.indexOf('registerAccountingProviders()')
    const workersStart = source.indexOf('await startWorkers()')
    expect(registration).toBeGreaterThan(-1)
    expect(workersStart).toBeGreaterThan(-1)
    expect(registration).toBeLessThan(workersStart)
  })

  it('registers the accounting providers alongside the channel hooks, in the same boot step', () => {
    // Both are "lib registry filled from the app layer" hooks, and both apps
    // call both. If one is ever moved out of `initializeApp`, the other should
    // go with it.
    const init = source.slice(source.indexOf('async function initializeApp'))
    expect(init).toContain('registerChannelHooks()')
    expect(init).toContain('registerAccountingProviders()')
  })

  // brief 27 §4 / §7: the payout pipeline knows only the `PayoutSource`
  // interface. `payoutSyncJob` runs here, and with an empty registry it finds
  // no context for any org and syncs nothing - silently, like the provider
  // registry above.
  it('imports the shared payout-source registration from lib', () => {
    expect(source).toMatch(
      /import \{ registerPayoutSources \} from '@auxx\/lib\/money\/payout-sources'/
    )
  })

  it('calls registerPayoutSources() before startWorkers(), in the same boot step', () => {
    const registration = source.indexOf('registerPayoutSources()')
    const workersStart = source.indexOf('await startWorkers()')
    expect(registration).toBeGreaterThan(-1)
    expect(registration).toBeLessThan(workersStart)
    const init = source.slice(source.indexOf('async function initializeApp'))
    expect(init).toContain('registerPayoutSources()')
  })
})
