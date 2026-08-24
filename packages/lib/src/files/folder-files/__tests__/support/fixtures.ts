// packages/lib/src/files/folder-files/__tests__/support/fixtures.ts

/**
 * `FolderFile` / `FileVersion` row builders, local to this module's tests.
 *
 * Kept here rather than in `files/__tests__/support/fixtures.ts` on purpose: the
 * shared kit is edited by every `files/` PR at once, and two PRs adding a
 * builder to the same file is a merge conflict for no benefit. The shared kit
 * holds what more than one module needs (`anAsset`, `aStorageLocation`,
 * `TEST_IDS`); these two shapes have exactly one consumer.
 *
 * It lives under `__tests__/support/` because `vitest.config.ts` includes
 * `src/**‍/__tests__/**‍/*` as suites and excludes only `__tests__/support/**` —
 * a helper anywhere else under `__tests__/` is collected and fails with "No test
 * suite found in file".
 *
 * Both return the **real** Drizzle entity types, so a schema change breaks the
 * fixture at compile time rather than letting tests assert against a shape the
 * database no longer has.
 */

import type { FileVersionEntity, FolderFileEntity } from '@auxx/database/types'
import { aStorageLocation, DEFAULT_TEST_INSTANT, TEST_IDS } from '../../../__tests__/support'

/** Ids these fixtures default to, exported so assertions can name them. */
export const FILE_IDS = {
  fileId: 'fil_test',
  versionId: 'fve_test',
  folderId: 'fld_test',
} as const

const AT = new Date(DEFAULT_TEST_INSTANT)

/**
 * A live, unarchived `FolderFile` row.
 *
 * `deletedAt: null` and `isArchived: false` are the defaults so a soft-delete or
 * archive test has to opt in explicitly — the download path refuses both.
 */
export function aFolderFile(overrides: Partial<FolderFileEntity> = {}): FolderFileEntity {
  return {
    id: FILE_IDS.fileId,
    organizationId: TEST_IDS.organizationId,
    folderId: FILE_IDS.folderId,
    name: 'contract.pdf',
    path: '/Legal/contract.pdf',
    ext: 'pdf',
    mimeType: 'application/pdf',
    size: 2048,
    checksum: null,
    currentVersionId: FILE_IDS.versionId,
    isArchived: false,
    deletedAt: null,
    createdById: TEST_IDS.userId,
    createdAt: AT,
    updatedAt: AT,
    provider: 'S3',
    ...overrides,
  }
}

/** A `FileVersion` row shaped the way the relational query returns it (location joined in). */
export function aFileVersion(
  overrides: Partial<FileVersionEntity> & {
    storageLocation?: ReturnType<typeof aStorageLocation> | null
  } = {}
) {
  const { storageLocation, ...columns } = overrides
  const location = storageLocation === undefined ? aStorageLocation() : storageLocation
  return {
    id: FILE_IDS.versionId,
    fileId: FILE_IDS.fileId,
    versionNumber: 1,
    size: 2048,
    checksum: null,
    mimeType: 'application/pdf',
    createdAt: AT,
    storageLocationId: location?.id ?? TEST_IDS.storageLocationId,
    ...columns,
    storageLocation: location,
  }
}
