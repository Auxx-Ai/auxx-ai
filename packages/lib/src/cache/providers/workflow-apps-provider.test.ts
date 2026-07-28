// packages/lib/src/cache/providers/workflow-apps-provider.test.ts
// Pure matcher test for `byWebhookEndpoint`: enabled `webhook-endpoint` workflows match
// on `(endpointId, topic)` and respect `enabled`. Built over a fake dataFn (the accessor
// reads through it) so no DB/cache is involved.

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
    ownerType: null,
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
          triggerWebhookEndpointId: null,
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

describe('byWebhookEndpoint', () => {
  const webhook = (overrides: Partial<CachedPublishedWorkflow>) => ({
    triggerType: 'webhook-endpoint',
    triggerWebhookEndpointId: 'ep1',
    triggerTopic: 'orders/create',
    ...overrides,
  })

  it('matches enabled webhook-endpoint workflows on (endpointId, topic)', async () => {
    const accessor = accessorOver([
      app('match', true, webhook({})),
      app('other-topic', true, webhook({ triggerTopic: 'orders/delete' })),
      app('other-endpoint', true, webhook({ triggerWebhookEndpointId: 'ep2' })),
      app('wrong-type', true, { triggerType: 'app-trigger', triggerWebhookEndpointId: 'ep1' }),
    ])
    const matched = await accessor.byWebhookEndpoint({
      endpointId: 'ep1',
      topic: 'orders/create',
    })
    expect(matched.map((a) => a.id)).toEqual(['match'])
  })

  it('excludes disabled apps', async () => {
    const accessor = accessorOver([app('disabled', false, webhook({}))])
    const matched = await accessor.byWebhookEndpoint({
      endpointId: 'ep1',
      topic: 'orders/create',
    })
    expect(matched).toEqual([])
  })
})

/**
 * `list({ excludeIds })` — the per-member access exclusion (plan 30). This is
 * where the workflow list actually paginates (the "query" is this in-memory
 * accessor, not SQL), so it is the one place that decides whether `total` and
 * `hasMore` describe the set the caller may see or the set before filtering.
 */
describe('list — excludeIds is applied BEFORE pagination', () => {
  // Six enabled apps with identical `updatedAt`, so the sort is stable and the
  // order stays a..f.
  const six = () => ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => app(id, true, null))

  it('total and hasMore describe the FILTERED set', async () => {
    const { workflows, total, hasMore } = await accessorOver(six()).list({
      excludeIds: ['c', 'd'],
      limit: 2,
      offset: 0,
    })
    expect(workflows.map((w: CachedWorkflowApp) => w.id)).toEqual(['a', 'b'])
    expect(total).toBe(4)
    expect(hasMore).toBe(true)
  })

  it('a full page stays full — excluded rows do not eat page slots', async () => {
    // Post-pagination filtering would slice [a,b] and then drop nothing here but
    // return a SHORT page for any window overlapping c/d. Excluding first keeps
    // every page dense.
    const { workflows } = await accessorOver(six()).list({
      excludeIds: ['b', 'c'],
      limit: 2,
      offset: 0,
    })
    expect(workflows.map((w: CachedWorkflowApp) => w.id)).toEqual(['a', 'd'])
  })

  it('never returns an empty page alongside hasMore: true', async () => {
    // The pathology the fix exists for: with post-pagination filtering, page 2
    // (offset 2, limit 2) sliced [c,d], dropped BOTH, and still reported
    // `hasMore: true` against the unfiltered total of 6 — an empty page that
    // tells the client to keep going. Filtering first, page 2 is [e,f] and the
    // list ends honestly.
    const { workflows, total, hasMore } = await accessorOver(six()).list({
      excludeIds: ['c', 'd'],
      limit: 2,
      offset: 2,
    })
    expect(workflows.map((w: CachedWorkflowApp) => w.id)).toEqual(['e', 'f'])
    expect(workflows).not.toHaveLength(0)
    expect(total).toBe(4)
    expect(hasMore).toBe(false)
  })

  it('composes with the other predicates rather than replacing them', async () => {
    const apps = [...six(), { ...app('sys', true, null), ownerType: 'sequence' }]
    const { workflows, total } = await accessorOver(apps).list({
      excludeIds: ['a'],
      search: 'b',
      limit: 50,
      offset: 0,
    })
    expect(workflows.map((w: CachedWorkflowApp) => w.id)).toEqual(['b'])
    expect(total).toBe(1)
  })

  it('is a no-op when nothing is excluded (the common case)', async () => {
    const { workflows, total, hasMore } = await accessorOver(six()).list({
      excludeIds: [],
      limit: 3,
      offset: 0,
    })
    expect(workflows.map((w: CachedWorkflowApp) => w.id)).toEqual(['a', 'b', 'c'])
    expect(total).toBe(6)
    expect(hasMore).toBe(true)
  })
})

/**
 * `list({ includeIds })` — the INVERSE filter (plan 25 §2): a member composing
 * `workflows: None` who holds explicit instance grants may see exactly those
 * workflows, and the denied set (every row-less workflow in the org) is
 * unbounded, so only an allow-list can express it.
 */
describe('list — includeIds narrows to an allow-list, also BEFORE pagination', () => {
  const six = () => ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => app(id, true, null))

  it('returns only the named ids, and total describes THAT set', async () => {
    const { workflows, total, hasMore } = await accessorOver(six()).list({
      includeIds: ['b', 'e'],
      limit: 50,
      offset: 0,
    })
    expect(workflows.map((w: CachedWorkflowApp) => w.id)).toEqual(['b', 'e'])
    expect(total).toBe(2)
    expect(hasMore).toBe(false)
  })

  it('paginates over the narrowed set', async () => {
    const { workflows, total, hasMore } = await accessorOver(six()).list({
      includeIds: ['b', 'd', 'f'],
      limit: 2,
      offset: 0,
    })
    expect(workflows.map((w: CachedWorkflowApp) => w.id)).toEqual(['b', 'd'])
    expect(total).toBe(3)
    expect(hasMore).toBe(true)
  })

  it('ignores ids that name no workflow (foreign instance-access ids)', async () => {
    // `restrictedInstanceIds` is org-wide across datasets/KBs/dashboards, so an
    // allow-list built from it can name a dataset id while listing workflows.
    const { workflows, total } = await accessorOver(six()).list({
      includeIds: ['b', 'ds_shared'],
      limit: 50,
      offset: 0,
    })
    expect(workflows.map((w: CachedWorkflowApp) => w.id)).toEqual(['b'])
    expect(total).toBe(1)
  })

  it('an EMPTY allow-list is treated as "not set", never as "show nothing"', async () => {
    // `instanceListScope` returns `kind: 'none'` for that case and the router
    // short-circuits, so an empty array must never reach here — but if it does,
    // silently blanking the list would be the worst possible reading.
    const { workflows, total } = await accessorOver(six()).list({
      includeIds: [],
      limit: 50,
      offset: 0,
    })
    expect(workflows).toHaveLength(6)
    expect(total).toBe(6)
  })

  it('composes with the other predicates rather than replacing them', async () => {
    const apps = [...six(), { ...app('sys', true, null), ownerType: 'sequence' }]
    const { workflows, total } = await accessorOver(apps).list({
      includeIds: ['a', 'b', 'sys'],
      search: 'b',
      limit: 50,
      offset: 0,
    })
    expect(workflows.map((w: CachedWorkflowApp) => w.id)).toEqual(['b'])
    expect(total).toBe(1)
  })
})
