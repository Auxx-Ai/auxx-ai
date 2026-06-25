// packages/lib/src/webhooks/inbound/spec.test.ts
// Unit tests for the WebhookSpec compiler + helpers: topic glob, stream-key fallback,
// missing-id drops, topic-segment derivation, and body-flag deletes.

import { describe, expect, it } from 'vitest'
import type { WebhookSpec } from './spec'
import { compileWebhookSpec, resolveWebhookActions, topicGlob } from './spec'

const noHooks = {
  topics: [],
  register: async () => [],
  unregister: async () => {},
}

describe('topicGlob', () => {
  it('matches a leading-* suffix glob', () => {
    expect(topicGlob('*/delete', 'orders/delete')).toBe(true)
    expect(topicGlob('*/delete', 'products/update')).toBe(false)
    expect(topicGlob('*.deleted', 'customer.deleted')).toBe(true)
    expect(topicGlob('*.deleted', 'customer.updated')).toBe(false)
  })

  it('matches an exact pattern with no wildcard', () => {
    expect(topicGlob('orders/create', 'orders/create')).toBe(true)
    expect(topicGlob('orders/create', 'orders/update')).toBe(false)
  })
})

describe('resolveWebhookActions', () => {
  const resolve: WebhookSpec['resolve'] = {
    topic: { from: 'header', name: 'x-topic' },
    streamKey: { from: 'topicSegment', index: 0 },
    externalId: { from: 'body', path: 'id' },
    fields: { from: 'body', path: '' },
    deleteWhen: { topicMatches: '*/delete' },
  }

  it('derives the stream key from the first topic segment', () => {
    const actions = resolveWebhookActions(
      resolve,
      { 'x-topic': 'orders/create' },
      { id: 1, n: 'a' }
    )
    expect(actions).toEqual([
      {
        kind: 'upsert',
        streamKey: 'orders',
        record: { streamKey: 'orders', externalId: '1', fields: { id: 1, n: 'a' } },
      },
    ])
  })

  it('drops a delivery with no external id', () => {
    expect(resolveWebhookActions(resolve, { 'x-topic': 'orders/create' }, { n: 'a' })).toEqual([])
  })

  it('drops a delivery with no resolvable stream key', () => {
    expect(resolveWebhookActions(resolve, {}, { id: 1 })).toEqual([])
  })

  it('keeps an id of 0 (faithful != null rule), drops an empty-string id', () => {
    expect(
      resolveWebhookActions(resolve, { 'x-topic': 'orders/create' }, { id: 0 })[0]
    ).toMatchObject({ kind: 'upsert', record: { externalId: '0' } })
    expect(resolveWebhookActions(resolve, { 'x-topic': 'orders/create' }, { id: '' })).toEqual([])
  })

  it('applies a stream-key fallback then a literal default', () => {
    const withFallback: WebhookSpec['resolve'] = {
      ...resolve,
      topic: { from: 'body', path: 'type' },
      streamKey: {
        from: 'body',
        path: 'data.object.object',
        fallback: { from: 'topicSegment', index: 0, separator: '.' },
        default: 'event',
      },
      externalId: { from: 'body', path: 'data.object.id' },
      fields: { from: 'body', path: 'data.object' },
      deleteWhen: { topicMatches: '*.deleted' },
    }
    // Primary present.
    expect(
      resolveWebhookActions(
        withFallback,
        {},
        { type: 'x.y', data: { object: { id: 'a', object: 'cust' } } }
      )[0]
    ).toMatchObject({ streamKey: 'cust' })
    // Primary absent → topic-segment fallback.
    expect(
      resolveWebhookActions(
        withFallback,
        {},
        { type: 'invoice.paid', data: { object: { id: 'b' } } }
      )[0]
    ).toMatchObject({ streamKey: 'invoice' })
  })

  it('resolves a body flag to a delete', () => {
    const flagResolve: WebhookSpec['resolve'] = {
      ...resolve,
      topic: { from: 'body', path: 'topic' },
      streamKey: { from: 'body', path: 'streamKey' },
      externalId: { from: 'body', path: 'externalId' },
      fields: { from: 'body', path: 'fields' },
      deleteWhen: { bodyFlag: { path: 'deleted' } },
    }
    expect(
      resolveWebhookActions(flagResolve, {}, { streamKey: 's', externalId: 'e', deleted: true })
    ).toEqual([{ kind: 'delete', streamKey: 's', externalId: 'e' }])
  })
})

describe('compileWebhookSpec', () => {
  const spec: WebhookSpec = {
    verify: { scheme: 'shared-token', header: 'x-token' },
    unsignedOk: true,
    eventId: { from: 'body', path: 'id' },
    resolve: {
      topic: { from: 'body', path: 'type' },
      streamKey: { from: 'body', path: 'stream' },
      externalId: { from: 'body', path: 'ref' },
      fields: { from: 'body', path: '' },
      deleteWhen: { topicMatches: '*.gone' },
    },
  }

  it('treats a missing secret as verified when unsignedOk', () => {
    const cap = compileWebhookSpec(spec, noHooks)
    expect(cap.verify({ rawBody: '{}', headers: {}, secret: null })).toBe(true)
  })

  it('extracts the event id from the parsed body, null on bad JSON', () => {
    const cap = compileWebhookSpec(spec, noHooks)
    expect(cap.eventId({ rawBody: JSON.stringify({ id: 'evt_9' }), headers: {} })).toBe('evt_9')
    expect(cap.eventId({ rawBody: 'not json', headers: {} })).toBe(null)
  })

  it('exposes the coded registration hooks unchanged', async () => {
    const cap = compileWebhookSpec(spec, {
      topics: ['t1'],
      register: async ({ topics }) => topics.map((t) => ({ topic: t, externalId: `s:${t}` })),
      unregister: async () => {},
    })
    expect(cap.topics).toEqual(['t1'])
    expect(
      await cap.register({
        callbackUrl: 'u',
        secret: 's',
        topics: ['t1'],
        credential: null,
        config: {},
      })
    ).toEqual([{ topic: 't1', externalId: 's:t1' }])
  })
})
