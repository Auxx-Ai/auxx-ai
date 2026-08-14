// packages/lib/src/workflow-engine/catalog/derive-trigger.test.ts

import { describe, expect, it } from 'vitest'
import { WorkflowTriggerType } from '../core/types'
import { deriveTriggerColumns, deriveTriggerLinks } from './derive-trigger'

/**
 * The trigger-columns derivation moved from `use-workflow-save.ts` (browser)
 * to lib — these pin the behavior it must preserve, in particular the two
 * load-bearing quirks from `plans/kopilot/workflow/05-resource-model.md` §4.
 */
describe('deriveTriggerColumns', () => {
  it('returns empty when the graph has no trigger node', () => {
    const nodes = [{ data: { type: 'http' } }, { data: { type: 'if-else' } }]
    expect(deriveTriggerColumns(nodes)).toEqual({})
  })

  it('maps a manual node to FORM, not MANUAL', () => {
    const result = deriveTriggerColumns([{ data: { type: 'manual' } }])
    expect(result.triggerType).toBe(WorkflowTriggerType.FORM)
    expect(result.entityDefinitionId).toBeUndefined()
  })

  it('derives scheduled and message-received from the catalog', () => {
    expect(deriveTriggerColumns([{ data: { type: 'scheduled' } }]).triggerType).toBe(
      WorkflowTriggerType.SCHEDULED
    )
    expect(deriveTriggerColumns([{ data: { type: 'message-received' } }]).triggerType).toBe(
      WorkflowTriggerType.MESSAGE_RECEIVED
    )
  })

  it('maps a fully configured resource-trigger to the operation-specific type + entity id', () => {
    const result = deriveTriggerColumns([
      { data: { type: 'resource-trigger', operation: 'created', entityDefinitionId: 'ticket' } },
    ])
    expect(result.triggerType).toBe(WorkflowTriggerType.CREATED)
    expect(result.entityDefinitionId).toBe('ticket')
  })

  it('leaves a half-configured resource-trigger at the generic type with no entity id', () => {
    // Missing entityDefinitionId (the pre-panel-backfill draft state)
    const noEntity = deriveTriggerColumns([
      { data: { type: 'resource-trigger', operation: 'created' } },
    ])
    expect(noEntity.triggerType).toBe(WorkflowTriggerType.RESOURCE_TRIGGER)
    expect(noEntity.entityDefinitionId).toBeUndefined()

    // Missing operation
    const noOperation = deriveTriggerColumns([
      { data: { type: 'resource-trigger', entityDefinitionId: 'ticket' } },
    ])
    expect(noOperation.triggerType).toBe(WorkflowTriggerType.RESOURCE_TRIGGER)
    expect(noOperation.entityDefinitionId).toBeUndefined()
  })

  it('uses the FIRST trigger node in graph order', () => {
    const result = deriveTriggerColumns([
      { data: { type: 'code' } },
      { data: { type: 'scheduled' } },
      { data: { type: 'manual' } },
    ])
    expect(result.triggerType).toBe(WorkflowTriggerType.SCHEDULED)
  })

  it('consults a caller-supplied resolver for types the catalog cannot see', () => {
    const result = deriveTriggerColumns([{ data: { type: 'someapp:new-row' } }], {
      resolveTriggerType: (nodeType) =>
        nodeType === 'someapp:new-row' ? WorkflowTriggerType.APP_TRIGGER : undefined,
    })
    expect(result.triggerType).toBe(WorkflowTriggerType.APP_TRIGGER)
  })
})

/**
 * The app/webhook trigger-column branches moved out of
 * `workflow-service.update` — these pin the branch behavior it inlined,
 * including the "no updates at all" (`none`) arms a naive rewrite would
 * collapse into clears.
 */
describe('deriveTriggerLinks', () => {
  const appNode = {
    data: {
      type: 'someapp:new-row',
      appId: 'app_1',
      triggerId: 'order-created',
      connectionId: 'conn_1',
      installationId: 'inst_stored',
    },
  }

  it('returns none without a trigger type — the caller leaves the columns alone', () => {
    expect(deriveTriggerLinks(undefined, [appNode])).toEqual({ kind: 'none' })
    expect(deriveTriggerLinks(null, [appNode])).toEqual({ kind: 'none' })
  })

  it('extracts the app trigger fields from the node carrying appId + triggerId', () => {
    expect(
      deriveTriggerLinks(WorkflowTriggerType.APP_TRIGGER, [{ data: { type: 'note' } }, appNode])
    ).toEqual({
      kind: 'app-trigger',
      appId: 'app_1',
      triggerId: 'order-created',
      connectionId: 'conn_1',
      storedInstallationId: 'inst_stored',
    })
    expect(deriveTriggerLinks(WorkflowTriggerType.APP_POLLING_TRIGGER, [appNode]).kind).toBe(
      'app-trigger'
    )
  })

  it('nulls missing connection/installation on an app trigger node', () => {
    const result = deriveTriggerLinks(WorkflowTriggerType.APP_TRIGGER, [
      { data: { appId: 'app_1', triggerId: 'order-created' } },
    ])
    expect(result).toEqual({
      kind: 'app-trigger',
      appId: 'app_1',
      triggerId: 'order-created',
      connectionId: null,
      storedInstallationId: null,
    })
  })

  it('returns none for an app trigger whose node is missing — never a clear', () => {
    // A node needs BOTH appId and triggerId to count.
    expect(
      deriveTriggerLinks(WorkflowTriggerType.APP_TRIGGER, [{ data: { appId: 'app_1' } }])
    ).toEqual({ kind: 'none' })
    expect(deriveTriggerLinks(WorkflowTriggerType.APP_TRIGGER, [])).toEqual({ kind: 'none' })
    // No graph posted at all.
    expect(deriveTriggerLinks(WorkflowTriggerType.APP_TRIGGER, undefined)).toEqual({ kind: 'none' })
  })

  it('extracts (webhookEndpointId, topic) for a webhook-endpoint trigger', () => {
    const result = deriveTriggerLinks(WorkflowTriggerType.WEBHOOK_ENDPOINT, [
      { data: { type: 'webhook-trigger', webhookEndpointId: 'whep_1', topic: 'orders/create' } },
    ])
    expect(result).toEqual({
      kind: 'webhook-endpoint',
      webhookEndpointId: 'whep_1',
      topic: 'orders/create',
    })
  })

  it('writes explicit nulls when the webhook-endpoint node is missing from the graph', () => {
    expect(
      deriveTriggerLinks(WorkflowTriggerType.WEBHOOK_ENDPOINT, [{ data: { type: 'note' } }])
    ).toEqual({ kind: 'webhook-endpoint', webhookEndpointId: null, topic: null })
  })

  it('falls back to clear for a webhook-endpoint trigger without a posted graph', () => {
    // Preserved quirk: without `graph.nodes` the original branch chain fell
    // through to the clear arm, nulling the webhook columns too.
    expect(deriveTriggerLinks(WorkflowTriggerType.WEBHOOK_ENDPOINT, undefined)).toEqual({
      kind: 'clear',
    })
  })

  it('clears the link columns when switching to any other trigger type', () => {
    expect(deriveTriggerLinks(WorkflowTriggerType.SCHEDULED, [appNode])).toEqual({ kind: 'clear' })
    expect(deriveTriggerLinks(WorkflowTriggerType.MESSAGE_RECEIVED, undefined)).toEqual({
      kind: 'clear',
    })
  })
})
