// packages/lib/src/workflow-engine/catalog/derive-trigger-server.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowTriggerType } from '../core/types'

// Leaf-module mock (not a shared barrel — safe to replace wholesale): keeps
// `@auxx/database` out of the test process.
const resolveActiveInstallationId = vi.fn()
vi.mock('../../apps/installations/resolve-active-installation', () => ({
  resolveActiveInstallationId: (...args: unknown[]) => resolveActiveInstallationId(...args),
}))

const { deriveTriggerLinkColumns } = await import('./derive-trigger-server')

const ALL_CLEAR = {
  triggerAppId: null,
  triggerTriggerId: null,
  triggerInstallationId: null,
  triggerConnectionId: null,
  triggerWebhookEndpointId: null,
  triggerTopic: null,
}

const appNode = {
  data: {
    type: 'someapp:new-row',
    appId: 'app_1',
    triggerId: 'order-created',
    connectionId: 'conn_1',
    installationId: 'inst_stored',
  },
}

/**
 * Pins the column updates `workflow-service.update` used to build inline —
 * behavior-preserving move, so every arm must write (or withhold) exactly the
 * same keys the service did.
 */
describe('deriveTriggerLinkColumns', () => {
  beforeEach(() => {
    resolveActiveInstallationId.mockReset()
  })

  it('returns {} (leave columns alone) when there is nothing to derive', async () => {
    expect(await deriveTriggerLinkColumns('org_1', undefined, [appNode])).toEqual({})
    // App trigger whose node is missing — the service wrote no updates here.
    expect(await deriveTriggerLinkColumns('org_1', WorkflowTriggerType.APP_TRIGGER, [])).toEqual({})
    expect(resolveActiveInstallationId).not.toHaveBeenCalled()
  })

  it('writes the app columns with the installation resolved at save time', async () => {
    resolveActiveInstallationId.mockResolvedValue(ok('inst_active'))

    const result = await deriveTriggerLinkColumns('org_1', WorkflowTriggerType.APP_TRIGGER, [
      appNode,
    ])

    expect(resolveActiveInstallationId).toHaveBeenCalledWith('app_1', 'org_1')
    expect(result).toEqual({
      triggerAppId: 'app_1',
      triggerTriggerId: 'order-created',
      triggerConnectionId: 'conn_1',
      triggerInstallationId: 'inst_active',
    })
    // The webhook columns are NOT cleared on the app arm — preserved verbatim.
    expect('triggerWebhookEndpointId' in result).toBe(false)
    expect('triggerTopic' in result).toBe(false)
  })

  it('falls back to the node-stored installationId when resolution fails', async () => {
    resolveActiveInstallationId.mockResolvedValue(err(new Error('not installed')))

    const result = await deriveTriggerLinkColumns(
      'org_1',
      WorkflowTriggerType.APP_POLLING_TRIGGER,
      [appNode]
    )
    expect(result.triggerInstallationId).toBe('inst_stored')

    // Legacy node without a stored installationId → explicit null.
    const bare = await deriveTriggerLinkColumns('org_1', WorkflowTriggerType.APP_TRIGGER, [
      { data: { appId: 'app_1', triggerId: 'order-created' } },
    ])
    expect(bare.triggerInstallationId).toBeNull()
  })

  it('persists (webhookEndpointId, topic) and clears the app columns for webhook-endpoint', async () => {
    const result = await deriveTriggerLinkColumns('org_1', WorkflowTriggerType.WEBHOOK_ENDPOINT, [
      { data: { webhookEndpointId: 'whep_1', topic: 'orders/create' } },
    ])
    expect(result).toEqual({
      ...ALL_CLEAR,
      triggerWebhookEndpointId: 'whep_1',
      triggerTopic: 'orders/create',
    })
    expect(resolveActiveInstallationId).not.toHaveBeenCalled()
  })

  it('clears all six columns when switching to any other trigger type', async () => {
    expect(
      await deriveTriggerLinkColumns('org_1', WorkflowTriggerType.SCHEDULED, [appNode])
    ).toEqual(ALL_CLEAR)
    // Webhook-endpoint without a posted graph falls through to the clear arm.
    expect(
      await deriveTriggerLinkColumns('org_1', WorkflowTriggerType.WEBHOOK_ENDPOINT, undefined)
    ).toEqual(ALL_CLEAR)
  })
})
