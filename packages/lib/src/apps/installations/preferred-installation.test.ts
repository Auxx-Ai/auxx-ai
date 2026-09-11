// packages/lib/src/apps/installations/preferred-installation.test.ts
//
// The rule an org's two live installations of one app are chosen by. It was
// written out by hand in seven places and one of them — the engine's own
// `resolveActiveInstallationId` — disagreed, which is what made a workflow
// block execute as the development installation while the settings page wrote
// `allowWrites` to the production one.

import { describe, expect, it } from 'vitest'
import {
  PREFERRED_INSTALLATION_TYPE,
  pickPreferredInstallation,
  pickPreferredInstallationPerApp,
} from './preferred-installation'

const dev = { id: 'dev_1', installationType: 'development' }
const prod = { id: 'prod_1', installationType: 'production' }

describe('pickPreferredInstallation', () => {
  it('prefers production when both are live', () => {
    expect(pickPreferredInstallation([dev, prod])?.id).toBe('prod_1')
  })

  it('prefers production regardless of the order the rows arrive in', () => {
    // The whole point: an unordered `findFirst` gets either row, so the pick
    // must not depend on position.
    expect(pickPreferredInstallation([prod, dev])?.id).toBe('prod_1')
  })

  it('falls back to the only installation when it is development', () => {
    expect(pickPreferredInstallation([dev])?.id).toBe('dev_1')
  })

  it('falls back to the first row when no type is production', () => {
    const odd = [
      { id: 'a', installationType: null },
      { id: 'b', installationType: 'staging' },
    ]
    expect(pickPreferredInstallation(odd)?.id).toBe('a')
  })

  it('returns undefined for no installations — the app is not installed', () => {
    expect(pickPreferredInstallation([])).toBeUndefined()
  })

  it('names the preferred type as a constant the callers can assert on', () => {
    expect(PREFERRED_INSTALLATION_TYPE).toBe('production')
  })
})

describe('pickPreferredInstallationPerApp', () => {
  const xDev = { id: 'x_dev', installationType: 'development', app: { id: 'app_x' } }
  const xProd = { id: 'x_prod', installationType: 'production', app: { id: 'app_x' } }
  const yDev = { id: 'y_dev', installationType: 'development', app: { id: 'app_y' } }
  const rows = [xDev, xProd, yDev]

  it('returns one row per app', () => {
    expect(pickPreferredInstallationPerApp(rows).map((r) => r.app.id)).toEqual(['app_x', 'app_y'])
  })

  it('keeps the production row for an app that has both', () => {
    expect(pickPreferredInstallationPerApp(rows).find((r) => r.app.id === 'app_x')?.id).toBe(
      'x_prod'
    )
  })

  it('keeps production even when it arrives first', () => {
    const reordered = [xProd, xDev, yDev]
    expect(pickPreferredInstallationPerApp(reordered).find((r) => r.app.id === 'app_x')?.id).toBe(
      'x_prod'
    )
  })

  it('keeps an app that only has a development installation', () => {
    expect(pickPreferredInstallationPerApp(rows).find((r) => r.app.id === 'app_y')?.id).toBe(
      'y_dev'
    )
  })

  it('is empty for an empty list', () => {
    expect(pickPreferredInstallationPerApp([])).toEqual([])
  })
})
