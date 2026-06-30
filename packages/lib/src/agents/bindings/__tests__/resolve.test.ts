// packages/lib/src/agents/bindings/__tests__/resolve.test.ts

import type { ResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Subject, ToolContext } from '../../../ai/agent-framework/tool-context'

// Observe the resolver's batchGetValues read without a real DB.
const batchGetValues = vi.fn()
vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    batchGetValues = batchGetValues
  },
}))

// Stub the org-cache helpers the @app: pre-pass drives.
const findCachedResource = vi.fn()
const getCachedFieldMap = vi.fn()
const getCachedInstalledApps = vi.fn()
vi.mock('../../../cache/org-cache-helpers', () => ({
  findCachedResource: (...args: unknown[]) => findCachedResource(...args),
  getCachedFieldMap: (...args: unknown[]) => getCachedFieldMap(...args),
  getCachedInstalledApps: (...args: unknown[]) => getCachedInstalledApps(...args),
}))

import { buildResolveVarSource, resolveConnectorFieldRef } from '../resolve'

/** Subject with the given anchors (slug → RecordId). */
function subjectWith(anchors: Record<string, string>): Subject {
  return { anchors: anchors as Subject['anchors'], identityVerified: 'contact' in anchors }
}

function ctxWith(appAccounts?: Record<string, { credId: string }>): ToolContext {
  return { organizationId: 'org-1', db: {}, appAccounts } as unknown as ToolContext
}

const VERIFIED = subjectWith({
  thread: 'thread:t1',
  participant: 'participant:p1',
  contact: 'contact:c-123',
})
const ANON = subjectWith({ thread: 'thread:t1', participant: 'participant:p1' })

describe('buildResolveVarSource', () => {
  beforeEach(() => {
    batchGetValues.mockReset()
    findCachedResource.mockReset()
    getCachedFieldMap.mockReset()
    getCachedInstalledApps.mockReset()
  })

  it('const → the literal value, regardless of subject', async () => {
    const resolve = buildResolveVarSource(ctxWith())
    expect(await resolve({ kind: 'const', value: 'EU' }, ANON)).toBe('EU')
    expect(batchGetValues).not.toHaveBeenCalled()
  })

  it('model → undefined (left to the LLM)', async () => {
    const resolve = buildResolveVarSource(ctxWith())
    expect(await resolve({ kind: 'model' }, VERIFIED)).toBeUndefined()
  })

  it('var contact:self → the contact anchor id (no batchGetValues)', async () => {
    const resolve = buildResolveVarSource(ctxWith())
    const result = await resolve({ kind: 'var', ref: 'contact:self' as ResourceFieldId }, VERIFIED)
    expect(result).toBe('c-123')
    expect(batchGetValues).not.toHaveBeenCalled()
  })

  it('var participant:email resolves on every turn (participant always present)', async () => {
    batchGetValues.mockResolvedValue({
      values: [{ value: { type: 'text', value: 'v@x.com' }, fieldType: 'EMAIL' }],
    })
    const resolve = buildResolveVarSource(ctxWith())
    const result = await resolve({ kind: 'var', ref: 'participant:email' as ResourceFieldId }, ANON)
    expect(result).toBe('v@x.com')
    expect(batchGetValues).toHaveBeenCalledWith({
      recordIds: ['participant:p1'],
      fieldReferences: ['participant:email'],
    })
  })

  it('var contact:primary_email → batchGetValues scalar on a verified turn', async () => {
    batchGetValues.mockResolvedValue({
      values: [{ value: { type: 'text', value: 'visitor@example.com' }, fieldType: 'EMAIL' }],
    })
    const resolve = buildResolveVarSource(ctxWith())
    const result = await resolve(
      { kind: 'var', ref: 'contact:primary_email' as ResourceFieldId },
      VERIFIED
    )
    expect(result).toBe('visitor@example.com')
    expect(batchGetValues).toHaveBeenCalledWith({
      recordIds: ['contact:c-123'],
      fieldReferences: ['contact:primary_email'],
    })
  })

  it('var contact:primary_email → undefined on an anonymous turn (no contact anchor)', async () => {
    const resolve = buildResolveVarSource(ctxWith())
    const result = await resolve(
      { kind: 'var', ref: 'contact:primary_email' as ResourceFieldId },
      ANON
    )
    expect(result).toBeUndefined()
    expect(batchGetValues).not.toHaveBeenCalled()
  })

  it('var FieldPath traversal → batchGetValues with the path (zero new code)', async () => {
    batchGetValues.mockResolvedValue({
      values: [{ value: { type: 'text', value: 'Acme' }, fieldType: 'TEXT' }],
    })
    const resolve = buildResolveVarSource(ctxWith())
    const ref = ['contact:company', 'company:name'] as [ResourceFieldId, ResourceFieldId]
    const result = await resolve({ kind: 'var', ref }, VERIFIED)
    expect(result).toBe('Acme')
    expect(batchGetValues).toHaveBeenCalledWith({
      recordIds: ['contact:c-123'],
      fieldReferences: [ref],
    })
  })

  describe('@app: segment (turn-time connection resolution)', () => {
    beforeEach(() => {
      // Agent-binding ref keys the leading segment by entityType ('contact').
      findCachedResource.mockResolvedValue({
        id: 'contact',
        entityDefinitionId: 'contact',
        entityType: 'contact',
        apiSlug: 'contacts',
      })
      getCachedInstalledApps.mockResolvedValue([
        { installationId: 'inst-1', app: { slug: 'shopify' } },
      ])
      getCachedFieldMap.mockResolvedValue(
        new Map([
          [
            'cf-cust',
            {
              id: 'cf-cust',
              appFieldKey: 'customerId',
              connectionId: 'cred-1',
              appInstallationId: 'inst-1',
            },
          ],
        ])
      )
    })

    it('resolves contact:@app:shopify:customerId off the bound store', async () => {
      batchGetValues.mockResolvedValue({
        values: [{ value: { type: 'text', value: '6789012345' }, fieldType: 'TEXT' }],
      })
      const resolve = buildResolveVarSource(ctxWith({ shopify: { credId: 'cred-1' } }))
      const result = await resolve(
        { kind: 'var', ref: 'contact:@app:shopify:customerId' as ResourceFieldId },
        VERIFIED
      )
      expect(result).toBe('6789012345')
      // The @app: segment is rewritten to the concrete connection-scoped field.
      expect(batchGetValues).toHaveBeenCalledWith({
        recordIds: ['contact:c-123'],
        fieldReferences: ['contact:cf-cust'],
      })
    })

    it('→ undefined when no store is connected (connect-a-store gate)', async () => {
      const resolve = buildResolveVarSource(ctxWith({}))
      const result = await resolve(
        { kind: 'var', ref: 'contact:@app:shopify:customerId' as ResourceFieldId },
        VERIFIED
      )
      expect(result).toBeUndefined()
      expect(batchGetValues).not.toHaveBeenCalled()
    })

    it('→ undefined on an anonymous turn even with a connected store (no contact anchor)', async () => {
      const resolve = buildResolveVarSource(ctxWith({ shopify: { credId: 'cred-1' } }))
      const result = await resolve(
        { kind: 'var', ref: 'contact:@app:shopify:customerId' as ResourceFieldId },
        ANON
      )
      expect(result).toBeUndefined()
      expect(batchGetValues).not.toHaveBeenCalled()
    })
  })
})

describe('resolveConnectorFieldRef', () => {
  beforeEach(() => {
    findCachedResource.mockReset()
    getCachedFieldMap.mockReset()
    getCachedInstalledApps.mockReset()
    getCachedInstalledApps.mockResolvedValue([
      { installationId: 'inst-1', app: { slug: 'shopify' } },
    ])
  })

  it('resolves an owned-def @app: ref by apiSlug (entityType null) — the bug fix', async () => {
    // Connector-owned def: apiSlug set, entityType null. The old entityType-only
    // lookup missed this and dropped the field; findCachedResource matches apiSlug.
    findCachedResource.mockResolvedValue({
      id: 'p2r4bk3q',
      entityDefinitionId: 'p2r4bk3q',
      entityType: null,
      apiSlug: 'shopify_products',
    })
    getCachedFieldMap.mockResolvedValue(
      new Map([
        [
          'fg1hf3go',
          {
            id: 'fg1hf3go',
            appFieldKey: 'title',
            connectionId: 'ou13',
            appInstallationId: 'inst-1',
          },
        ],
      ])
    )

    const resolved = await resolveConnectorFieldRef(
      'shopify_products:@app:shopify:title' as ResourceFieldId,
      'org-1',
      'ou13'
    )

    expect(resolved).toBe('p2r4bk3q:fg1hf3go')
    expect(findCachedResource).toHaveBeenCalledWith('org-1', 'shopify_products')
  })

  it('resolves an agent-binding @app: ref by entityType (no regression)', async () => {
    findCachedResource.mockResolvedValue({
      id: 'mzxt3cxy',
      entityDefinitionId: 'mzxt3cxy',
      entityType: 'contact',
      apiSlug: 'contacts',
    })
    getCachedFieldMap.mockResolvedValue(
      new Map([
        [
          'cf-order-total',
          {
            id: 'cf-order-total',
            appFieldKey: 'orderTotal',
            connectionId: 'ou13',
            appInstallationId: 'inst-1',
          },
        ],
      ])
    )

    const resolved = await resolveConnectorFieldRef(
      'contact:@app:shopify:orderTotal' as ResourceFieldId,
      'org-1',
      'ou13'
    )

    expect(resolved).toBe('mzxt3cxy:cf-order-total')
    expect(findCachedResource).toHaveBeenCalledWith('org-1', 'contact')
  })

  it('passes a concrete defId:fieldId ref through unchanged (no @app:, no cache read)', async () => {
    const resolved = await resolveConnectorFieldRef(
      'mzxt3cxy:l34o9dzv' as ResourceFieldId,
      'org-1',
      'ou13'
    )
    expect(resolved).toBe('mzxt3cxy:l34o9dzv')
    expect(findCachedResource).not.toHaveBeenCalled()
  })

  it('→ null when the owned def is missing from the resources cache', async () => {
    findCachedResource.mockResolvedValue(null)
    const resolved = await resolveConnectorFieldRef(
      'shopify_products:@app:shopify:title' as ResourceFieldId,
      'org-1',
      'ou13'
    )
    expect(resolved).toBeNull()
  })

  it('→ null when no connection is bound (connect-a-store gate)', async () => {
    const resolved = await resolveConnectorFieldRef(
      'shopify_products:@app:shopify:title' as ResourceFieldId,
      'org-1',
      undefined
    )
    expect(resolved).toBeNull()
    expect(findCachedResource).not.toHaveBeenCalled()
  })
})
