// packages/services/src/app-versions/__tests__/promote-to-production.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertValues = vi.fn().mockReturnThis()
const insertReturning = vi.fn()
const insert = vi.fn((..._args: unknown[]) => ({
  values: insertValues,
  returning: insertReturning,
}))

const findFirst = vi.fn()

vi.mock('@auxx/database', () => ({
  database: {
    query: {
      AppDeployment: { findFirst: (...args: unknown[]) => findFirst(...args) },
    },
    insert: (...args: unknown[]) => insert(...args),
  },
  schema: {
    AppDeployment: { id: 'AppDeployment.id' },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}))

vi.mock('../reconcile-app-review-state', () => ({
  reconcileAppReviewState: vi.fn().mockResolvedValue({ isOk: () => true }),
}))

vi.mock('../calculate-next-version', () => ({
  calculateNextVersion: vi.fn().mockResolvedValue('1.0.0'),
}))

import { promoteToProduction } from '../promote-to-production'

const SOURCE_CATALOG = {
  agent: {
    tools: [{ name: 'do_thing' }],
    triggers: [],
    toolsets: [],
  },
  actions: [{ name: 'reply' }],
}

const SOURCE_DEPLOYMENT = {
  id: 'dep_dev_1',
  appId: 'app_1',
  deploymentType: 'development' as const,
  clientBundleId: 'bundle_client_1',
  serverBundleId: 'bundle_server_1',
  settingsSchema: { organization: { foo: 'bar' } },
  catalog: SOURCE_CATALOG,
  targetOrganizationId: 'org_1',
  environmentVariables: { KEY: 'value' },
  version: null,
  status: 'active',
  releaseNotes: null,
  metadata: { cliVersion: '0.1.0' },
  createdById: 'user_dev',
  createdAt: new Date(),
}

const PROMOTED_DEPLOYMENT = {
  ...SOURCE_DEPLOYMENT,
  id: 'dep_prod_1',
  deploymentType: 'production',
  targetOrganizationId: null,
  environmentVariables: null,
  version: '1.0.0',
  createdById: 'user_admin',
}

beforeEach(() => {
  vi.clearAllMocks()
  findFirst.mockResolvedValue(SOURCE_DEPLOYMENT)
  insertReturning.mockResolvedValue([PROMOTED_DEPLOYMENT])
})

describe('promoteToProduction', () => {
  it('copies the catalog from the source deployment to the new production deployment', async () => {
    const result = await promoteToProduction({
      sourceDeploymentId: 'dep_dev_1',
      userId: 'user_admin',
      version: '1.0.0',
    })

    expect(result.isOk()).toBe(true)
    expect(insertValues).toHaveBeenCalledTimes(1)

    const inserted = insertValues.mock.calls[0]?.[0]
    expect(inserted).toBeDefined()
    expect(inserted.catalog).toBe(SOURCE_CATALOG)
  })

  it('copies the catalog even when it is null', async () => {
    findFirst.mockResolvedValueOnce({ ...SOURCE_DEPLOYMENT, catalog: null })

    const result = await promoteToProduction({
      sourceDeploymentId: 'dep_dev_1',
      userId: 'user_admin',
      version: '1.0.0',
    })

    expect(result.isOk()).toBe(true)
    const inserted = insertValues.mock.calls[0]?.[0]
    expect(inserted.catalog).toBeNull()
  })
})
