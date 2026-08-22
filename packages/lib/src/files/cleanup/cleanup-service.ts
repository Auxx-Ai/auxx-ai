// packages/lib/src/files/cleanup/cleanup-service.ts

import { enqueueOrphanedStorageObjectCleanup } from '../../jobs/maintenance/orphaned-storage-object-job'
import type { ProviderId } from '../adapters/base-adapter'

/**
 * Compensation shim for orphaned storage objects.
 *
 * This used to be a `CleanupService` whose every persistence method was a
 * `// TODO` stub that logged and returned — `scheduleCleanup` persisted nothing,
 * so a failed upload transaction leaked its S3 object forever
 * (`docs/files-upload-architecture-guide.md` §11.2).
 *
 * It now forwards to a real BullMQ job on the maintenance queue. The object
 * shape is kept only so the existing compensation call site in
 * `apps/web/src/app/api/files/upload/[sessionId]/complete/route.ts` keeps
 * compiling; new code should call {@link enqueueOrphanedStorageObjectCleanup}
 * directly.
 *
 * @deprecated Call `enqueueOrphanedStorageObjectCleanup` from `@auxx/lib/jobs`.
 */
export const cleanupService = {
  /**
   * Durably schedule deletion of an orphaned storage object.
   *
   * @param params.bucket - The bucket the object actually lives in (the upload
   *   session's `bucket`). Without it the delete targets the provider default,
   *   which for a PUBLIC upload is the wrong bucket — S3 answers 204 and the
   *   real object leaks.
   */
  async scheduleCleanup(params: {
    provider: ProviderId
    storageKey: string
    bucket?: string
    credentialId?: string
    reason: string
    organizationId?: string
  }): Promise<void> {
    await enqueueOrphanedStorageObjectCleanup({
      provider: params.provider,
      bucket: params.bucket,
      key: params.storageKey,
      credentialId: params.credentialId,
      organizationId: params.organizationId,
      reason: params.reason,
    })
  },
}
