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
const getCachedEntityDefId = vi.fn()
const getCachedFieldMap = vi.fn()
const getCachedInstalledApps = vi.fn()
vi.mock('../../../cache/org-cache-helpers', () => ({
  getCachedEntityDefId: (...args: unknown[]) => getCachedEntityDefId(...args),
  getCachedFieldMap: (...args: unknown[]) => getCachedFieldMap(...args),
  getCachedInstalledApps: (...args: unknown[]) => getCachedInstalledApps(...args),
}))

import { buildResolveVarSource } from '../resolve'

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
    getCachedEntityDefId.mockReset()
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
      getCachedEntityDefId.mockResolvedValue('contact')
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
