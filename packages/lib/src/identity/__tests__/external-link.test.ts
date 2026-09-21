// packages/lib/src/identity/__tests__/external-link.test.ts

import type { RecordId } from '@auxx/types/resource'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCachedIdentityLink = vi.fn()
const getCachedResourceFields = vi.fn()
vi.mock('../../cache', () => ({
  getCachedIdentityLink: (...args: unknown[]) => getCachedIdentityLink(...args),
  getCachedResourceFields: (...args: unknown[]) => getCachedResourceFields(...args),
}))

const getCredential = vi.fn()
vi.mock('@auxx/credentials/store', () => ({
  getCredential: (...args: unknown[]) => getCredential(...args),
}))

const readFieldScalars = vi.fn()
const readFieldRelations = vi.fn()
vi.mock('../../field-values/read-field-scalars', () => ({
  readFieldScalars: (...args: unknown[]) => readFieldScalars(...args),
  readFieldRelations: (...args: unknown[]) => readFieldRelations(...args),
}))

const getRecordIdentitiesForRecords = vi.fn()
vi.mock('../batch', () => ({
  getRecordIdentitiesForRecords: (...args: unknown[]) => getRecordIdentitiesForRecords(...args),
}))

import { resolveExternalLink } from '../external-link'

const RECORD = 'def_order:inst_1' as RecordId
const PARENT = 'def_order_parent:inst_parent' as RecordId

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ri_1',
    organizationId: 'org_1',
    entityInstanceId: 'inst_1',
    entityDefinitionId: 'def_order',
    source: 'shopify',
    appInstallationId: 'inst_shopify',
    connectionId: 'conn_us',
    appFieldKey: 'shopifyOrderId',
    fieldId: 'field_1',
    externalId: '450789469',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/** Identity rows keyed by the RecordId the caller asked for. */
function identities(map: Record<string, unknown[]>) {
  getRecordIdentitiesForRecords.mockImplementation(
    async (_org: string, recordIds: RecordId[]) =>
      new Map(recordIds.map((id) => [id, map[id] ?? []]))
  )
}

function resolve(source = 'shopify', connectionId: string | null = 'conn_us') {
  return resolveExternalLink(undefined, {
    organizationId: 'org_1',
    recordId: RECORD,
    source,
    connectionId,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  identities({ [RECORD]: [row()] })
  getCachedResourceFields.mockResolvedValue([])
  readFieldScalars.mockResolvedValue(new Map())
  readFieldRelations.mockResolvedValue(new Map())
  getCredential.mockResolvedValue(ok({ metadata: { __identity: 'acme.myshopify.com' } }))
})

describe('resolveExternalLink', () => {
  it('resolves a flat template from the identity row alone', async () => {
    getCachedIdentityLink.mockResolvedValue(
      'https://app.qbo.intuit.com/app/customerdetail?nameId={externalId}'
    )
    const result = await resolve()
    expect(result._unsafeUnwrap()).toBe(
      'https://app.qbo.intuit.com/app/customerdetail?nameId=450789469'
    )
    expect(getCredential).not.toHaveBeenCalled()
  })

  it("resolves {connection.identity} from the credential's plaintext metadata", async () => {
    getCachedIdentityLink.mockResolvedValue(
      'https://{connection.identity}/admin/orders/{externalId}'
    )
    const result = await resolve()
    expect(result._unsafeUnwrap()).toBe('https://acme.myshopify.com/admin/orders/450789469')
    expect(getCredential).toHaveBeenCalledWith('conn_us', 'org_1')
  })

  it("follows a one-hop via to the parent's identity row", async () => {
    getCachedIdentityLink.mockResolvedValue(
      'https://{connection.identity}/admin/orders/{via.credit_memo_order.shopifyOrderId}'
    )
    getCachedResourceFields.mockResolvedValue([
      {
        id: 'f_rel',
        systemAttribute: 'credit_memo_order',
        relationship: { inverseResourceFieldId: 'def_order_parent:f_inv' },
      },
    ])
    readFieldRelations.mockResolvedValue(new Map([['inst_1', new Map([['f_rel', 'inst_parent']])]]))
    identities({
      [RECORD]: [row()],
      [PARENT]: [row({ entityInstanceId: 'inst_parent', externalId: '111' })],
    })

    const result = await resolve()
    expect(result._unsafeUnwrap()).toBe('https://acme.myshopify.com/admin/orders/111')
  })

  it('yields no link when the via hop has no parent', async () => {
    getCachedIdentityLink.mockResolvedValue(
      'https://{connection.identity}/admin/orders/{via.credit_memo_order.shopifyOrderId}'
    )
    getCachedResourceFields.mockResolvedValue([
      { id: 'f_rel', systemAttribute: 'credit_memo_order' },
    ])
    readFieldRelations.mockResolvedValue(new Map())

    expect((await resolve())._unsafeUnwrap()).toBeNull()
  })

  it('resolves {field.<key>} from a scalar value on the same record', async () => {
    getCachedIdentityLink.mockResolvedValue('{field.url}')
    getCachedResourceFields.mockResolvedValue([{ id: 'f_url', appFieldKey: 'url' }])
    readFieldScalars.mockResolvedValue(
      new Map([['inst_1', new Map([['f_url', 'https://github.com/a/b/issues/7']])]])
    )

    expect((await resolve())._unsafeUnwrap()).toBe('https://github.com/a/b/issues/7')
  })

  it('yields no link when a variable resolves to nothing', async () => {
    getCachedIdentityLink.mockResolvedValue('https://{connection.shop}/admin/orders/{externalId}')
    getCredential.mockResolvedValue(ok({ metadata: {} }))

    expect((await resolve())._unsafeUnwrap()).toBeNull()
  })

  it('refuses a resolved URL that is not https', async () => {
    getCachedIdentityLink.mockResolvedValue('{field.url}')
    getCachedResourceFields.mockResolvedValue([{ id: 'f_url', appFieldKey: 'url' }])
    readFieldScalars.mockResolvedValue(
      new Map([['inst_1', new Map([['f_url', 'http://insecure.example/x']])]])
    )

    expect((await resolve())._unsafeUnwrap()).toBeNull()
  })

  it('yields no link when the app declares no template', async () => {
    getCachedIdentityLink.mockResolvedValue(null)
    expect((await resolve())._unsafeUnwrap()).toBeNull()
  })

  it('ignores identity rows for another source or connection', async () => {
    getCachedIdentityLink.mockResolvedValue('https://x/{externalId}')
    expect((await resolve('stripe'))._unsafeUnwrap()).toBeNull()
    expect((await resolve('shopify', 'conn_eu'))._unsafeUnwrap()).toBeNull()
  })

  it('returns err when the template is malformed', async () => {
    getCachedIdentityLink.mockResolvedValue('https://x/{nope}')
    expect((await resolve()).isErr()).toBe(true)
  })
})
