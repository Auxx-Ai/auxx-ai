// packages/lib/src/agents/restrictions/__tests__/var-registry.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolContext } from '../../../ai/agent-framework/tool-context'

// Mock FieldValueService so the resolver's direct-field path is observable
// without a real DB. The mock captures the batchGetValues args and returns a
// canned TypedFieldValueResult.
const batchGetValues = vi.fn()
vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    batchGetValues = batchGetValues
  },
}))

// The org-cache helpers pull in the real cache provider graph (→ @auxx/services
// prebuilt dist), which can't resolve under the test alias. Stub them; the
// app-identity resolver path drives `getCachedEntityDefId`, `getCachedFieldMap`,
// and `getCachedInstalledApps`, so those are controllable spies.
const getCachedEntityDefId = vi.fn()
const getCachedFieldMap = vi.fn()
const getCachedInstalledApps = vi.fn()
vi.mock('../../../cache/org-cache-helpers', () => ({
  getCachedEntityDefId: (...args: unknown[]) => getCachedEntityDefId(...args),
  getCachedResourceFields: vi.fn(),
  getCachedFieldMap: (...args: unknown[]) => getCachedFieldMap(...args),
  getCachedInstalledApps: (...args: unknown[]) => getCachedInstalledApps(...args),
  getCachedAppByInstallationId: vi.fn(),
}))

import { buildResolveVar } from '../var-registry'

/** Build a ToolContext with the given invocation identity. */
function ctxWith(invocation: ToolContext['invocation']): ToolContext {
  return { organizationId: 'org-1', db: {}, invocation } as unknown as ToolContext
}

describe('buildResolveVar', () => {
  beforeEach(() => {
    batchGetValues.mockReset()
  })

  it('resolves visitor:self to the invocation contactId', async () => {
    const resolve = buildResolveVar('org-1')
    const result = await resolve('visitor:self', ctxWith({ threadId: 't1', contactId: 'c-123' }))
    expect(result).toBe('c-123')
    expect(batchGetValues).not.toHaveBeenCalled()
  })

  it('resolves thread:self to the invocation threadId', async () => {
    const resolve = buildResolveVar('org-1')
    const result = await resolve('thread:self', ctxWith({ threadId: 't-9', contactId: null }))
    expect(result).toBe('t-9')
  })

  it('returns null when the anchor identity is absent (anonymous / internal)', async () => {
    const resolve = buildResolveVar('org-1')
    // No contactId → visitor anchor null → gate fires.
    expect(await resolve('visitor:self', ctxWith({ threadId: 't1', contactId: null }))).toBeNull()
    // No invocation at all (internal turn).
    expect(await resolve('visitor:self', ctxWith(undefined))).toBeNull()
    expect(batchGetValues).not.toHaveBeenCalled()
  })

  it('resolves a direct field via batchGetValues and extracts the scalar', async () => {
    batchGetValues.mockResolvedValue({
      values: [
        {
          recordId: 'contact:c-123',
          fieldRef: 'contact:primary_email',
          value: { type: 'text', value: 'visitor@example.com' },
          fieldType: 'EMAIL',
        },
      ],
    })
    const resolve = buildResolveVar('org-1')
    const result = await resolve(
      'visitor:contact:primary_email',
      ctxWith({ threadId: 't1', contactId: 'c-123' })
    )
    expect(result).toBe('visitor@example.com')
    // Anchor RecordId is slug-prefixed; the ref keeps its full ResourceFieldId.
    expect(batchGetValues).toHaveBeenCalledWith({
      recordIds: ['contact:c-123'],
      fieldReferences: ['contact:primary_email'],
    })
  })

  it('unwraps the first entry of a multi-value field result', async () => {
    batchGetValues.mockResolvedValue({
      values: [
        {
          recordId: 'contact:c-123',
          fieldRef: 'contact:cf-1',
          value: [
            { type: 'text', value: 'first' },
            { type: 'text', value: 'second' },
          ],
          fieldType: 'TEXT',
        },
      ],
    })
    const resolve = buildResolveVar('org-1')
    const result = await resolve(
      'visitor:contact:cf-1',
      ctxWith({ threadId: 't1', contactId: 'c-123' })
    )
    expect(result).toBe('first')
  })

  it('returns null when the direct field has no value', async () => {
    batchGetValues.mockResolvedValue({
      values: [
        { recordId: 'contact:c-123', fieldRef: 'contact:cf-1', value: null, fieldType: 'TEXT' },
      ],
    })
    const resolve = buildResolveVar('org-1')
    expect(
      await resolve('visitor:contact:cf-1', ctxWith({ threadId: 't1', contactId: 'c-123' }))
    ).toBeNull()
  })

  it('returns null for an unknown / garbage var id', async () => {
    const resolve = buildResolveVar('org-1')
    expect(await resolve('garbage', ctxWith({ threadId: 't1', contactId: 'c-123' }))).toBeNull()
    expect(await resolve('', ctxWith({ threadId: 't1', contactId: 'c-123' }))).toBeNull()
    expect(await resolve('nope:self', ctxWith({ threadId: 't1', contactId: 'c-123' }))).toBeNull()
    expect(await resolve('visitor:', ctxWith({ threadId: 't1', contactId: 'c-123' }))).toBeNull()
    expect(batchGetValues).not.toHaveBeenCalled()
  })
})

describe('buildResolveVar — app identity vars (visitor:app:<slug>:<key>)', () => {
  const VAR = 'visitor:app:shopify:customerId'

  beforeEach(() => {
    batchGetValues.mockReset()
    getCachedEntityDefId.mockReset()
    getCachedFieldMap.mockReset()
    getCachedInstalledApps.mockReset()
    // Default happy-path cache fixtures (overridden per-test as needed).
    getCachedEntityDefId.mockResolvedValue('edf-contact')
    getCachedInstalledApps.mockResolvedValue([
      { installationId: 'inst-1', app: { slug: 'shopify', title: 'Shopify' } },
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

  it('resolves to the batchGetValues scalar when bound + identified', async () => {
    batchGetValues.mockResolvedValue({
      values: [
        {
          recordId: 'contact:c-123',
          fieldRef: 'edf-contact:cf-cust',
          value: { type: 'text', value: 'gid://shopify/Customer/42' },
          fieldType: 'TEXT',
        },
      ],
    })
    const resolve = buildResolveVar('org-1', { appAccounts: { shopify: { credId: 'cred-1' } } })
    const result = await resolve(VAR, ctxWith({ threadId: 't1', contactId: 'c-123' }))
    expect(result).toBe('gid://shopify/Customer/42')
    // The resolved CustomField id is composed into a ResourceFieldId and read off
    // the visitor's contact record.
    expect(batchGetValues).toHaveBeenCalledWith({
      recordIds: ['contact:c-123'],
      fieldReferences: ['edf-contact:cf-cust'],
    })
  })

  it('falls back to an installation-scoped field (null connectionId)', async () => {
    getCachedFieldMap.mockResolvedValue(
      new Map([
        [
          'cf-inst',
          {
            id: 'cf-inst',
            appFieldKey: 'customerId',
            connectionId: null,
            appInstallationId: 'inst-1',
          },
        ],
      ])
    )
    batchGetValues.mockResolvedValue({
      values: [
        {
          recordId: 'contact:c-123',
          fieldRef: 'edf-contact:cf-inst',
          value: { type: 'text', value: 'cust-7' },
          fieldType: 'TEXT',
        },
      ],
    })
    const resolve = buildResolveVar('org-1', { appAccounts: { shopify: { credId: 'cred-1' } } })
    const result = await resolve(VAR, ctxWith({ threadId: 't1', contactId: 'c-123' }))
    expect(result).toBe('cust-7')
    expect(batchGetValues).toHaveBeenCalledWith({
      recordIds: ['contact:c-123'],
      fieldReferences: ['edf-contact:cf-inst'],
    })
  })

  it('returns null when the app has no bound account (connect-a-store deferral)', async () => {
    const resolve = buildResolveVar('org-1', { appAccounts: {} })
    const result = await resolve(VAR, ctxWith({ threadId: 't1', contactId: 'c-123' }))
    expect(result).toBeNull()
    expect(batchGetValues).not.toHaveBeenCalled()
  })

  it('returns null when there is no invocation contact (anonymous visitor)', async () => {
    const resolve = buildResolveVar('org-1', { appAccounts: { shopify: { credId: 'cred-1' } } })
    expect(await resolve(VAR, ctxWith({ threadId: 't1', contactId: null }))).toBeNull()
    expect(await resolve(VAR, ctxWith(undefined))).toBeNull()
    expect(batchGetValues).not.toHaveBeenCalled()
  })

  it('returns null when no CustomField matches the appFieldKey + connection', async () => {
    getCachedFieldMap.mockResolvedValue(new Map())
    const resolve = buildResolveVar('org-1', { appAccounts: { shopify: { credId: 'cred-1' } } })
    expect(await resolve(VAR, ctxWith({ threadId: 't1', contactId: 'c-123' }))).toBeNull()
    expect(batchGetValues).not.toHaveBeenCalled()
  })

  it('returns null when another app owns a field with the same appFieldKey', async () => {
    // Field belongs to inst-2 (a different app), not the shopify installation.
    getCachedInstalledApps.mockResolvedValue([
      { installationId: 'inst-1', app: { slug: 'shopify', title: 'Shopify' } },
      { installationId: 'inst-2', app: { slug: 'other', title: 'Other' } },
    ])
    getCachedFieldMap.mockResolvedValue(
      new Map([
        [
          'cf-other',
          {
            id: 'cf-other',
            appFieldKey: 'customerId',
            connectionId: 'cred-1',
            appInstallationId: 'inst-2',
          },
        ],
      ])
    )
    const resolve = buildResolveVar('org-1', { appAccounts: { shopify: { credId: 'cred-1' } } })
    expect(await resolve(VAR, ctxWith({ threadId: 't1', contactId: 'c-123' }))).toBeNull()
    expect(batchGetValues).not.toHaveBeenCalled()
  })
})
