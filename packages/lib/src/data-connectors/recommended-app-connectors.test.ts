// packages/lib/src/data-connectors/recommended-app-connectors.test.ts
// The eligibility predicate behind the "Connect a source" recommendations
// (v9): published AND verified AND has a published production deployment that
// declares a connector AND isn't already installed. Every arm of that AND is a
// case here, because dropping any one of them either advertises something the
// org can't install or nags about something it already has.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCachedPublishedApps = vi.fn()
const getCachedInstalledApps = vi.fn()
vi.mock('../cache', () => ({
  getCachedPublishedApps: () => getCachedPublishedApps(),
  getCachedInstalledApps: (orgId: string) => getCachedInstalledApps(orgId),
}))

import { listRecommendedAppConnectors } from './recommended-app-connectors'

const ORG = 'org_1'

function publishedApp(over: Record<string, unknown> = {}) {
  return {
    id: 'app_shopify',
    slug: 'shopify',
    title: 'Shopify',
    description: 'Ecommerce platform',
    avatarUrl: 'https://cdn.auxx.ai/shopify.png',
    verified: true,
    developerAccount: { title: 'Auxx', logoUrl: null },
    latestDeployment: { id: 'dep_1', version: '1.0.0', status: 'published' },
    ...over,
  }
}

function declaredConnector(over: Record<string, unknown> = {}) {
  return {
    id: 'shopify',
    label: 'Shopify Orders',
    description: 'Sync orders into records',
    requiresConnection: true,
    iconKey: 'brand:shopify',
    configJsonSchema: {},
    streams: [],
    ...over,
  }
}

/** A db whose single `select().from().where()` chain resolves to `rows`. */
function dbReturning(rows: unknown[]): Database {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
  } as unknown as Database
}

function dbThrowing(): Database {
  return {
    select: () => ({ from: () => ({ where: () => Promise.reject(new Error('boom')) }) }),
  } as unknown as Database
}

beforeEach(() => {
  getCachedInstalledApps.mockResolvedValue([])
})

describe('listRecommendedAppConnectors', () => {
  it('projects a published, verified app’s declared connector', async () => {
    getCachedPublishedApps.mockResolvedValue([publishedApp()])
    const db = dbReturning([{ id: 'dep_1', dataConnectors: [declaredConnector()] }])

    const result = await listRecommendedAppConnectors(db, ORG)

    expect(result).toEqual([
      {
        type: 'app:shopify',
        appSlug: 'shopify',
        appTitle: 'Shopify',
        appIconId: 'https://cdn.auxx.ai/shopify.png',
        developerTitle: 'Auxx',
        connectorId: 'shopify',
        label: 'Shopify Orders',
        description: 'Sync orders into records',
        iconKey: 'brand:shopify',
        requiresConnection: true,
        requestModel: 'fixed',
      },
    ])
  })

  it('excludes an unverified app', async () => {
    // Not cosmetic: `apps.install` puts unverified apps behind the
    // `unverifiedApps` feature gate, so this row's only CTA would dead-end.
    getCachedPublishedApps.mockResolvedValue([publishedApp({ verified: false })])
    const db = dbReturning([{ id: 'dep_1', dataConnectors: [declaredConnector()] }])

    expect(await listRecommendedAppConnectors(db, ORG)).toEqual([])
  })

  it('excludes an app with no published production deployment', async () => {
    getCachedPublishedApps.mockResolvedValue([publishedApp({ latestDeployment: null })])
    const db = dbReturning([])

    expect(await listRecommendedAppConnectors(db, ORG)).toEqual([])
  })

  it('excludes a deployment whose catalog declares no connectors', async () => {
    getCachedPublishedApps.mockResolvedValue([publishedApp()])

    expect(await listRecommendedAppConnectors(dbReturning([]), ORG)).toEqual([])
    expect(
      await listRecommendedAppConnectors(dbReturning([{ id: 'dep_1', dataConnectors: null }]), ORG)
    ).toEqual([])
    expect(
      await listRecommendedAppConnectors(dbReturning([{ id: 'dep_1', dataConnectors: [] }]), ORG)
    ).toEqual([])
  })

  it('excludes an app that is already installed — including a development install', async () => {
    // Matching on slug rather than installation id is the point: an org running
    // a dev build of Shopify must not be told to go install Shopify.
    getCachedPublishedApps.mockResolvedValue([publishedApp()])
    getCachedInstalledApps.mockResolvedValue([
      { installationId: 'inst_1', app: { slug: 'shopify' }, installationType: 'development' },
    ])
    const db = dbReturning([{ id: 'dep_1', dataConnectors: [declaredConnector()] }])

    expect(await listRecommendedAppConnectors(db, ORG)).toEqual([])
  })

  it('falls back to the app description, then to empty', async () => {
    getCachedPublishedApps.mockResolvedValue([publishedApp()])
    const db = dbReturning([
      { id: 'dep_1', dataConnectors: [declaredConnector({ description: null })] },
    ])
    expect((await listRecommendedAppConnectors(db, ORG))[0]?.description).toBe('Ecommerce platform')

    getCachedPublishedApps.mockResolvedValue([publishedApp({ description: null })])
    expect((await listRecommendedAppConnectors(db, ORG))[0]?.description).toBe('')
  })

  it('emits one row per declared connector, sorted by app title', async () => {
    getCachedPublishedApps.mockResolvedValue([
      publishedApp(),
      publishedApp({
        id: 'app_github',
        slug: 'github',
        title: 'GitHub',
        latestDeployment: { id: 'dep_2', version: '2.0.0', status: 'published' },
      }),
    ])
    const db = dbReturning([
      { id: 'dep_1', dataConnectors: [declaredConnector()] },
      {
        id: 'dep_2',
        dataConnectors: [
          declaredConnector({ id: 'github.issues', label: 'Issues' }),
          declaredConnector({ id: 'github.prs', label: 'Pull requests' }),
        ],
      },
    ])

    const result = await listRecommendedAppConnectors(db, ORG)

    expect(result.map((r) => r.label)).toEqual(['Issues', 'Pull requests', 'Shopify Orders'])
  })

  it('caps the list at 8', async () => {
    getCachedPublishedApps.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) =>
        publishedApp({
          id: `app_${i}`,
          slug: `app-${i}`,
          title: `App ${String(i).padStart(2, '0')}`,
          latestDeployment: { id: `dep_${i}`, version: '1.0.0', status: 'published' },
        })
      )
    )
    const db = dbReturning(
      Array.from({ length: 12 }, (_, i) => ({
        id: `dep_${i}`,
        dataConnectors: [declaredConnector()],
      }))
    )

    expect(await listRecommendedAppConnectors(db, ORG)).toHaveLength(8)
  })

  it('returns [] when the deployment read fails, instead of throwing', async () => {
    // The installed half of the picker must keep working when discovery breaks.
    getCachedPublishedApps.mockResolvedValue([publishedApp()])

    await expect(listRecommendedAppConnectors(dbThrowing(), ORG)).resolves.toEqual([])
  })
})
