// packages/lib/src/workflow-engine/catalog/derive-trigger.test.ts

import { describe, expect, it } from 'vitest'
import { WorkflowTriggerType } from '../core/types'
import { deriveTriggerColumns } from './derive-trigger'

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
