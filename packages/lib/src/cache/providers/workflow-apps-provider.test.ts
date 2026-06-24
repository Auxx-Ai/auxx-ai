// packages/lib/src/cache/providers/workflow-apps-provider.test.ts
// Pure matcher test for `byConnectionWebhook` (Direction 2): enabled `webhook-trigger`
// workflows match on `(connectionId, topic)` and respect `enabled`. Built over a fake
// dataFn (the accessor reads through it) so no DB/cache is involved.

import { describe, expect, it } from 'vitest'
import type { CachedPublishedWorkflow, CachedWorkflowApp } from './workflow-apps-provider'
import { workflowAppsProvider } from './workflow-apps-provider'

function app(
  id: string,
  enabled: boolean,
  published: Partial<CachedPublishedWorkflow> | null
): CachedWorkflowApp {
  return {
    id,
    organizationId: 'org1',
    enabled,
    workflowId: published ? `wf-${id}` : null,
    name: id,
    description: null,
    icon: null,
    updatedAt: '2026-06-24T00:00:00.000Z',
    createdAt: '2026-06-24T00:00:00.000Z',
    isPublic: false,
    isUniversal: false,
    draftTriggerType: null,
    publishedWorkflow: published
      ? {
          id: `wf-${id}`,
          version: 1,
          triggerType: null,
          entityDefinitionId: null,
          triggerAppId: null,
          triggerTriggerId: null,
          triggerInstallationId: null,
          triggerConnectionId: null,
          triggerTopic: null,
          graph: null,
          envVars: null,
          variables: null,
          createdById: null,
          ...published,
        }
      : null,
  }
}

function accessorOver(apps: CachedWorkflowApp[]) {
  return workflowAppsProvider.createAccessor(async () => apps)
}

describe('byConnectionWebhook', () => {
  const webhook = (overrides: Partial<CachedPublishedWorkflow>) => ({
    triggerType: 'webhook-trigger',
    triggerConnectionId: 'conn1',
    triggerTopic: 'orders/create',
    ...overrides,
  })

  it('matches enabled webhook-trigger workflows on (connectionId, topic)', async () => {
    const accessor = accessorOver([
      app('match', true, webhook({})),
      app('other-topic', true, webhook({ triggerTopic: 'orders/delete' })),
      app('other-conn', true, webhook({ triggerConnectionId: 'conn2' })),
      app('wrong-type', true, { triggerType: 'app-trigger', triggerConnectionId: 'conn1' }),
    ])
    const matched = await accessor.byConnectionWebhook({
      connectionId: 'conn1',
      topic: 'orders/create',
    })
    expect(matched.map((a) => a.id)).toEqual(['match'])
  })

  it('excludes disabled apps', async () => {
    const accessor = accessorOver([app('disabled', false, webhook({}))])
    const matched = await accessor.byConnectionWebhook({
      connectionId: 'conn1',
      topic: 'orders/create',
    })
    expect(matched).toEqual([])
  })
})
