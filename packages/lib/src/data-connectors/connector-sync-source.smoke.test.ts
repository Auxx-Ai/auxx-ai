// Smoke: the wired SyncSource module imports cleanly under vitest (its static
// crud/reconciliation imports must not drag server-only deps that break).
import { describe, expect, it } from 'vitest'
import { createConnectorStreamSyncSource } from './connector-sync-source'

describe('connector-sync-source module', () => {
  it('exports the factory', () => {
    expect(typeof createConnectorStreamSyncSource).toBe('function')
  })
})
