// packages/lib/src/data-connectors/webhook-steer.test.ts

import { describe, expect, it } from 'vitest'
import type { StreamRequestConfig, StreamWebhookTrigger } from './connectors/types'
import { isSteerableDelivery, resolveWebhookSteer } from './webhook-steer'

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

describe('isSteerableDelivery', () => {
  it('returns false when the stream declares no webhookTrigger', () => {
    expect(isSteerableDelivery({}, { resourceId: '123' })).toBe(false)
  })

  // Token-less (app / fixed-model) streams: no {token} request template, so
  // requiredSteerTokens() is vacuously []. The declared paths ARE the contract.
  describe('token-less (app) streams', () => {
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
