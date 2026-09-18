// packages/lib/src/apps/lambda/__tests__/prepare-lambda-context.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface MintedTokenParams {
  scope: string
  userId?: string
}

const mockCreateCallbackToken = vi.fn((_params: MintedTokenParams) => 'token')

vi.mock('@auxx/credentials/lambda-auth', () => ({
  createCallbackToken: (params: MintedTokenParams) => mockCreateCallbackToken(params),
}))

import { prepareLambdaContext } from '../prepare-lambda-context'

const BASE_PARAMS = {
  appId: 'app_1',
  installationId: 'inst_1',
  organizationId: 'org_1',
  organizationHandle: 'acme',
  userEmail: null,
  userName: null,
}

describe('prepareLambdaContext — userId signed into the entities token only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LAMBDA_INVOKE_SECRET = 'test-secret'
  })

  it('signs a real userId into the entities scope only, never webhooks/settings/storage', () => {
    prepareLambdaContext({ ...BASE_PARAMS, userId: 'usr_1', includeEntitiesScope: true })

    const calls = mockCreateCallbackToken.mock.calls.map(([params]) => params)
    for (const params of calls) {
      if (params.scope === 'entities') expect(params.userId).toBe('usr_1')
      else expect(params.userId).toBeUndefined()
    }
    expect(calls.some((params) => params.scope === 'entities')).toBe(true)
  })

  it('treats the "system" sentinel as absent — never signed, never looked up', () => {
    prepareLambdaContext({ ...BASE_PARAMS, userId: 'system', includeEntitiesScope: true })

    const entitiesCall = mockCreateCallbackToken.mock.calls.find(
      ([params]) => params.scope === 'entities'
    )
    expect(entitiesCall?.[0].userId).toBeUndefined()
  })

  it('treats a missing userId as absent', () => {
    prepareLambdaContext({ ...BASE_PARAMS, includeEntitiesScope: true })

    const entitiesCall = mockCreateCallbackToken.mock.calls.find(
      ([params]) => params.scope === 'entities'
    )
    expect(entitiesCall?.[0].userId).toBeUndefined()
  })

  it('mints no entities token at all without includeEntitiesScope, real userId or not', () => {
    prepareLambdaContext({ ...BASE_PARAMS, userId: 'usr_1' })

    const scopes = mockCreateCallbackToken.mock.calls.map(([params]) => params.scope)
    expect(scopes).not.toContain('entities')
  })
})
