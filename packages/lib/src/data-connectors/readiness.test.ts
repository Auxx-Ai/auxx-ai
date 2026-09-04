// packages/lib/src/data-connectors/readiness.test.ts
// Predicate matrix for `getConnectorReadiness` (v3 §1). Pure — no DB harness.

import { describe, expect, it } from 'vitest'
import { getConnectorReadiness, type ReadinessStream } from './readiness'

type Connector = Parameters<typeof getConnectorReadiness>[0]

const genericRest = (config: Connector['config'], status = 'live'): Connector => ({
  status,
  definitionKind: 'generic-rest',
  config,
  credentialId: null,
})

const app = (credentialId: string | null, status = 'live'): Connector => ({
  status,
  definitionKind: 'app',
  config: null,
  credentialId,
})

const withBaseUrl = genericRest({ endpoint: { baseUrl: 'https://api.example.com' } })

/** A fully-configured generic-rest stream. Override fields to break it. */
const completeStream = (over: Partial<ReadinessStream> = {}): ReadinessStream => ({
  enabled: true,
  sourceSchema: { id: { type: 'string' } },
  requestConfig: { path: '/orders' },
  mappings: [{ entityDefinitionId: 'def_1', fieldMappings: [{ id: 'fm_1' }] }],
  ...over,
})

describe('getConnectorReadiness — canSample (endpoint)', () => {
  it('generic-rest with no base URL → no-endpoint', () => {
    const r = getConnectorReadiness(genericRest(null), [])
    expect(r.canSample).toBe(false)
    expect(r.canSync).toBe(false)
    expect(r.problems[0]).toBe('no-endpoint')
  })

  it('generic-rest with empty base URL → no-endpoint', () => {
    const r = getConnectorReadiness(genericRest({ endpoint: { baseUrl: '' } }), [])
    expect(r.canSample).toBe(false)
    expect(r.problems[0]).toBe('no-endpoint')
  })

  it('app connector with no bound connection → no-endpoint', () => {
    const r = getConnectorReadiness(app(null), [])
    expect(r.canSample).toBe(false)
    expect(r.problems[0]).toBe('no-endpoint')
  })

  it('app connector with a bound connection → canSample (but not canSync yet)', () => {
    const r = getConnectorReadiness(app('cred_1'), [])
    expect(r.canSample).toBe(true)
    expect(r.canSync).toBe(false)
    expect(r.problems[0]).toBe('no-stream')
  })

  it('generic-rest with a base URL → canSample', () => {
    const r = getConnectorReadiness(withBaseUrl, [])
    expect(r.canSample).toBe(true)
    expect(r.problems[0]).toBe('no-stream')
  })
})

describe('getConnectorReadiness — canSync (streams)', () => {
  it('no enabled stream → no-stream', () => {
    const r = getConnectorReadiness(withBaseUrl, [completeStream({ enabled: false })])
    expect(r.canSync).toBe(false)
    expect(r.problems[0]).toBe('no-stream')
  })

  it('stream missing a request path → stream-no-path', () => {
    const r = getConnectorReadiness(withBaseUrl, [completeStream({ requestConfig: null })])
    expect(r.canSync).toBe(false)
    expect(r.problems[0]).toBe('stream-no-path')
  })

  it('a user-facing name is not required to sync → an unnamed but complete stream syncs', () => {
    // The stable streamId is the functional key; a blank name never blocks sync.
    const r = getConnectorReadiness(withBaseUrl, [completeStream()])
    expect(r.canSync).toBe(true)
    expect(r.problems).toEqual([])
  })

  it('stream with path but no schema → stream-no-schema', () => {
    const r = getConnectorReadiness(withBaseUrl, [completeStream({ sourceSchema: null })])
    expect(r.canSync).toBe(false)
    expect(r.problems[0]).toBe('stream-no-schema')
  })

  it('empty-object schema counts as no schema → stream-no-schema', () => {
    const r = getConnectorReadiness(withBaseUrl, [completeStream({ sourceSchema: {} })])
    expect(r.problems[0]).toBe('stream-no-schema')
  })

  it('stream with schema+path but no targeted mapping → no-mapping', () => {
    const r = getConnectorReadiness(withBaseUrl, [
      completeStream({ mappings: [{ entityDefinitionId: null, fieldMappings: [{ id: 'fm' }] }] }),
    ])
    expect(r.canSync).toBe(false)
    expect(r.problems[0]).toBe('no-mapping')
  })

  it('mapping with a def but zero field mappings → no-mapping', () => {
    const r = getConnectorReadiness(withBaseUrl, [
      completeStream({ mappings: [{ entityDefinitionId: 'def_1', fieldMappings: [] }] }),
    ])
    expect(r.problems[0]).toBe('no-mapping')
  })

  it('fully-configured generic-rest stream → canSync, no problems', () => {
    const r = getConnectorReadiness(withBaseUrl, [completeStream()])
    expect(r.canSample).toBe(true)
    expect(r.canSync).toBe(true)
    expect(r.problems).toEqual([])
  })

  it('app connector skips the path requirement → canSync without requestConfig', () => {
    const r = getConnectorReadiness(app('cred_1'), [completeStream({ requestConfig: null })])
    expect(r.canSync).toBe(true)
    expect(r.problems).toEqual([])
  })

  it('multi-stream: one complete is enough → canSync', () => {
    const r = getConnectorReadiness(withBaseUrl, [
      completeStream({ sourceSchema: null }), // incomplete second stream mid-build
      completeStream(),
    ])
    expect(r.canSync).toBe(true)
    expect(r.problems).toEqual([])
  })

  it('multi-stream none complete: reports the closest-to-complete stream reason', () => {
    const r = getConnectorReadiness(withBaseUrl, [
      completeStream({ requestConfig: null }), // fails earliest (path)
      completeStream({ mappings: [{ entityDefinitionId: null, fieldMappings: null }] }), // fails latest (mapping)
    ])
    expect(r.canSync).toBe(false)
    expect(r.problems[0]).toBe('no-mapping')
  })
})

// ── Lifecycle refusals (task 44 §7.11 / D-6) ─────────────────────────────────
//
// The regression these pin: uninstalling an app PRESERVES the connector's
// credential, so a `disconnected` app connector is structurally perfect — every
// config check passes and the manual door used to wave it through. One "Sync now"
// then knocked it to `error`, discarding the Disconnected banner and putting it
// outside `reconnectConnectorsForInstallation`'s `status = 'disconnected'` scope,
// so a reinstall no longer repaired it.
describe('getConnectorReadiness — lifecycle refusals', () => {
  it('refuses a disconnected connector that is otherwise fully configured', () => {
    const r = getConnectorReadiness(app('cred_1', 'disconnected'), [completeStream()])
    expect(r.canSync).toBe(false)
    expect(r.canSample).toBe(false)
    expect(r.problems).toEqual(['disconnected'])
  })

  it('refuses a disconnected generic-rest connector too', () => {
    const connector = genericRest(
      { endpoint: { baseUrl: 'https://api.example.com' } },
      'disconnected'
    )
    const r = getConnectorReadiness(connector, [completeStream()])
    expect(r.canSync).toBe(false)
    expect(r.problems).toEqual(['disconnected'])
  })

  it('refuses a connector whose teardown is in flight', () => {
    const r = getConnectorReadiness(app('cred_1', 'deleting'), [completeStream()])
    expect(r.canSync).toBe(false)
    expect(r.canSample).toBe(false)
    expect(r.problems).toEqual(['removing'])
  })

  // 🛑 The exact shape the defect took: same connector, same streams, only the
  // status differs. If the guard is removed, this is the assertion that flips.
  it('the SAME connector syncs when live and refuses when disconnected', () => {
    const streams = [completeStream()]
    expect(getConnectorReadiness(app('cred_1', 'live'), streams).canSync).toBe(true)
    expect(getConnectorReadiness(app('cred_1', 'disconnected'), streams).canSync).toBe(false)
  })

  // ⚠️ Deliberately allowed — a merchant who paused a connector and presses Sync now
  // plausibly means it, and they can resume it themselves. Only `disconnected` is a
  // state they cannot get back once a click discards it.
  it('still allows a paused connector to sync', () => {
    const r = getConnectorReadiness(app('cred_1', 'paused'), [completeStream()])
    expect(r.canSync).toBe(true)
    expect(r.problems).toEqual([])
  })

  it.each([
    'live',
    'ready',
    'syncing',
    'error',
    'paused',
    'pending',
    'provisioning',
  ])('does not add a lifecycle problem for status %s', (status) => {
    const r = getConnectorReadiness(app('cred_1', status), [completeStream()])
    expect(r.problems).not.toContain('disconnected')
    expect(r.problems).not.toContain('removing')
  })
})
