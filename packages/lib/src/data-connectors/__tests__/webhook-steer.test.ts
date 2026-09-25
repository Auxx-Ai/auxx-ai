// packages/lib/src/data-connectors/__tests__/webhook-steer.test.ts

import { describe, expect, it } from 'vitest'
import type { StreamRequestConfig, StreamWebhookTrigger } from '../connectors/types'
import { isSteerableDelivery, resolveWebhookSteer, steerTokenKey } from '../webhook-steer'

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

describe('app streams steer by idPath (v14 §4.1)', () => {
  const app: StreamWebhookTrigger = {
    filter: { topic: 'inventory_levels/update' },
    idPath: 'resourceId',
    idKind: 'inventoryItem',
  }

  it('resolves to an ids query carrying the declared idKind', () => {
    expect(resolveWebhookSteer(app, { resourceId: 42 })).toEqual({
      kind: 'ids',
      query: { ids: ['42'], idKind: 'inventoryItem' },
    })
  })

  it('omits idKind for the stream’s own ids', () => {
    expect(resolveWebhookSteer({ idPath: 'payload.id' }, { payload: { id: 'o1' } })).toEqual({
      kind: 'ids',
      query: { ids: ['o1'] },
    })
  })

  it('is steerable only when idPath resolves', () => {
    const rc: StreamRequestConfig = { webhookTrigger: app }
    expect(isSteerableDelivery(rc, { resourceId: '42' })).toBe(true)
    expect(isSteerableDelivery(rc, { topic: 'inventory_levels/update' })).toBe(false)
    expect(isSteerableDelivery(rc, { resourceId: '' })).toBe(false)
  })

  it('keys the debounce on the id, so two records never coalesce', () => {
    const a = steerTokenKey(resolveWebhookSteer(app, { resourceId: '1' }))
    const b = steerTokenKey(resolveWebhookSteer(app, { resourceId: '2' }))
    expect(a).toBe('ids=1')
    expect(a).not.toBe(b)
  })
})

describe('isSteerableDelivery', () => {
  it('returns false when the stream declares no webhookTrigger', () => {
    expect(isSteerableDelivery({}, { resourceId: '123' })).toBe(false)
  })

  // No {token} request template, so requiredSteerTokens() is vacuously []: the declared
  // paths ARE the contract.
  describe('paths without a request template', () => {
    const requestConfig: StreamRequestConfig = { webhookTrigger: base }

    it('is steerable when every declared path resolves', () => {
      expect(isSteerableDelivery(requestConfig, { resourceId: '123' })).toBe(true)
    })

    it('is NOT steerable when a declared path is missing', () => {
      expect(isSteerableDelivery(requestConfig, { topic: 'inventory_levels/update' })).toBe(false)
    })

    it('is NOT steerable when paths is empty', () => {
      const rc: StreamRequestConfig = { webhookTrigger: { ...base, paths: [] } }
      expect(isSteerableDelivery(rc, { resourceId: '123' })).toBe(false)
    })
  })

  describe('generic-REST streams (unchanged behavior)', () => {
    const requestConfig: StreamRequestConfig = {
      path: 'orders/{resourceId}.json',
      webhookTrigger: base,
    }

    it('is steerable when the required {token} resolves', () => {
      expect(isSteerableDelivery(requestConfig, { resourceId: '123' })).toBe(true)
    })

    it('is NOT steerable when the required {token} is missing', () => {
      expect(isSteerableDelivery(requestConfig, { topic: 'orders/create' })).toBe(false)
    })

    it('is steerable even if a declared path beyond the required tokens is missing', () => {
      const rc: StreamRequestConfig = {
        path: 'orders/{resourceId}.json',
        webhookTrigger: { ...base, paths: ['resourceId', 'extra'] },
      }
      expect(isSteerableDelivery(rc, { resourceId: '123' })).toBe(true)
    })
  })

  describe('delete deliveries', () => {
    const trigger: StreamWebhookTrigger = {
      ...base,
      deleteWhen: { topicEquals: 'orders/delete' },
      deleteExternalIdPath: 'resourceId',
    }
    const requestConfig: StreamRequestConfig = { webhookTrigger: trigger }

    it('is steerable when the externalId resolves', () => {
      expect(
        isSteerableDelivery(requestConfig, { topic: 'orders/delete', resourceId: '123' })
      ).toBe(true)
    })

    it('is NOT steerable when no deleteExternalIdPath is declared', () => {
      const rc: StreamRequestConfig = {
        webhookTrigger: { ...trigger, deleteExternalIdPath: undefined },
      }
      expect(isSteerableDelivery(rc, { topic: 'orders/delete' })).toBe(false)
    })
  })
})
