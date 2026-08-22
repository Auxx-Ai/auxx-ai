// packages/lib/src/files/__tests__/support/fixtures.ts

/**
 * Row and id fixtures for `files/` tests.
 *
 * Every builder takes a partial override and spreads it last, so a test states
 * only the field under test and the rest is plausible-but-obviously-fake. The
 * asset and storage-location builders return the **real** Drizzle entity types,
 * so a schema change breaks the fixture at compile time rather than letting
 * tests assert against a shape the database no longer has.
 */

import type { MediaAssetEntity, StorageLocationEntity } from '@auxx/database/types'
import { DEFAULT_TEST_INSTANT } from './clock'

/** The ids every fixture defaults to, exported so assertions can name them. */
export const TEST_IDS = {
  organizationId: 'org_test',
  userId: 'usr_test',
  assetId: 'ast_test',
  versionId: 'ver_test',
  storageLocationId: 'loc_test',
  credentialId: 'cred_test',
} as const

/** The bucket names fixtures use. Distinct on purpose: a wrong-bucket bug must be visible in a diff. */
export const TEST_BUCKETS = {
  private: 'test-private-bucket',
  public: 'test-public-bucket',
} as const

const AT = new Date(DEFAULT_TEST_INSTANT)

/**
 * The minimum of an organization that `files/` code ever reads.
 *
 * Deliberately not `OrganizationEntity`: nothing under `files/` touches an org
 * row beyond its id, and a full 20-field fixture would be noise that drifts.
 */
export interface TestOrg {
  id: string
  name: string
}

/** Same reasoning as {@link TestOrg} — `files/` only ever needs the actor's id. */
export interface TestUser {
  id: string
  name: string
  email: string
}

/** An organization, defaulting to {@link TEST_IDS}.organizationId. */
export function anOrg(overrides: Partial<TestOrg> = {}): TestOrg {
  return { id: TEST_IDS.organizationId, name: 'Test Org', ...overrides }
}

/** A user, defaulting to {@link TEST_IDS}.userId. */
export function aUser(overrides: Partial<TestUser> = {}): TestUser {
  return { id: TEST_IDS.userId, name: 'Test User', email: 'test@example.com', ...overrides }
}

/**
 * A `MediaAsset` row.
 *
 * Defaults to private (`isPrivate: true`) because that is the safe default the
 * production code assumes, and to a live row (`deletedAt: null`) so a
 * soft-delete test has to opt in to the deleted case explicitly.
 */
export function anAsset(overrides: Partial<MediaAssetEntity> = {}): MediaAssetEntity {
  return {
    id: TEST_IDS.assetId,
    organizationId: TEST_IDS.organizationId,
    kind: 'IMAGE',
    name: 'test-image.png',
    mimeType: 'image/png',
    size: 1024,
    isPrivate: true,
    deletedAt: null,
    currentVersionId: TEST_IDS.versionId,
    createdById: TEST_IDS.userId,
    createdAt: AT,
    updatedAt: AT,
    expiresAt: null,
    purpose: 'ORIGINAL',
    ...overrides,
  }
}

/**
 * A `StorageLocation` row.
 *
 * `metadata.bucket` is populated because that is where every adapter looks for
 * it, and a fixture that left it out would let a test pass against code that
 * silently falls back to the configured default bucket.
 */
export function aStorageLocation(
  overrides: Partial<StorageLocationEntity> = {}
): StorageLocationEntity {
  const key = `${TEST_IDS.organizationId}/media-asset/${TEST_IDS.assetId}/test-image.png`
  return {
    id: TEST_IDS.storageLocationId,
    provider: 'S3',
    externalId: key,
    externalUrl: `https://cdn.test/${key}`,
    externalRev: 'etag-test',
    organizationId: TEST_IDS.organizationId,
    credentialId: null,
    size: 1024,
    mimeType: 'image/png',
    createdAt: AT,
    deletedAt: null,
    metadata: { bucket: TEST_BUCKETS.private, key },
    ...overrides,
  }
}
