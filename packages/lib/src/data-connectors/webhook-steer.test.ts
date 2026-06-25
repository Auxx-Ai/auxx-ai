// packages/lib/src/data-connectors/webhook-steer.test.ts

import { describe, expect, it } from 'vitest'
import type { StreamWebhookTrigger } from './connectors/types'
import { resolveWebhookSteer } from './webhook-steer'

const base: StreamWebhookTrigger = {
  paths: ['resourceId'],
}

describe('resolveWebhookSteer', () => {
  it('extracts envelope-relative paths into a fetch context (path = placeholder key)', () => {
    const steer = resolveWebhookSteer(base, { resourceId: '123', topic: 'orders/create' })
    expect(steer).toEqual({ kind: 'fetch', triggerContext: { resourceId: '123' } })
  })

  it('reads nested dotted paths', () => {
    const steer = resolveWebhookSteer({ ...base, paths: ['payload.id'] }, { payload: { id: 999 } })
    expect(steer).toEqual({ kind: 'fetch', triggerContext: { 'payload.id': '999' } })
  })

  it('comma-joins array path values', () => {
    const steer = resolveWebhookSteer(
      { ...base, paths: ['resourceIds'] },
      { resourceIds: [1, 2, 3] }
    )
    expect(steer).toEqual({ kind: 'fetch', triggerContext: { resourceIds: '1,2,3' } })
  })

  it('omits paths that return nothing (the fetch then fails them)', () => {
    const steer = resolveWebhookSteer(base, { topic: 'orders/create' })
    expect(steer).toEqual({ kind: 'fetch', triggerContext: {} })
  })

  it('routes a topicEquals delete to an archive directive', () => {
    const trigger: StreamWebhookTrigger = {
      ...base,
      deleteWhen: { topicEquals: 'orders/delete' },
      deleteExternalIdPath: 'resourceId',
    }
    const steer = resolveWebhookSteer(trigger, { topic: 'orders/delete', resourceId: '123' })
    expect(steer).toEqual({ kind: 'delete', externalId: '123' })
  })

  it('routes a tokenTruthy delete to an archive directive', () => {
    const trigger: StreamWebhookTrigger = {
      ...base,
      deleteWhen: { tokenTruthy: 'payload.deleted' },
      deleteExternalIdPath: 'resourceId',
    }
    const steer = resolveWebhookSteer(trigger, { payload: { deleted: true }, resourceId: '7' })
    expect(steer).toEqual({ kind: 'delete', externalId: '7' })
  })

  it('does not treat a non-matching topic as a delete', () => {
    const trigger: StreamWebhookTrigger = {
      ...base,
      deleteWhen: { topicEquals: 'orders/delete' },
      deleteExternalIdPath: 'resourceId',
    }
    const steer = resolveWebhookSteer(trigger, { topic: 'orders/create', resourceId: '1' })
    expect(steer.kind).toBe('fetch')
  })
})
