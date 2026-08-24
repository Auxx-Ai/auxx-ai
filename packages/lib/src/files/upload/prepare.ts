// packages/lib/src/files/upload/prepare.ts

/**
 * Turning an upload request into a session the client can write bytes against.
 *
 * ## What moved here, and from where
 *
 * `POST /api/files/upload/sessions` used to inline all of this: resolve a
 * processor, build the config, create the Redis session, branch on
 * single-vs-multipart, presign, patch the session with what the provider
 * answered, and shape a response. Six steps, one of which (the presign) is the
 * only part a route has any business knowing about.
 *
 * The route now keeps exactly two responsibilities (plan §4.7): **authenticate**
 * — including the two gates that must not live in lib, `files.manage` and the
 * storage quota — and **translate `Result` → `Response`**.
 *
 * ## The four steps the processor chain used to interleave
 *
 * `processConfig` was a four-level `super` chain that mixed pure configuration
 * with two database reads and one cache read, in an order you could only learn
 * by reading all four levels. They are four named steps here, in this order:
 *
 * 1. **Resolve the handler.** An unknown entity type is a 400, never a fallback
 *    to the file-library handler (#1816).
 * 2. **Require an `entityId` where the strategy needs one.** `Attachment.entityId`
 *    is `NOT NULL`, so an `asset+attachment` upload without one cannot complete —
 *    refusing at the front door beats a 500 after the bytes are already in S3.
 * 3. **Check the entity exists in this organization.** Identity only; who is
 *    allowed to upload is the route's question (`docs/lib-module-guide.md` §6).
 * 4. **Build the config, then refine it.** {@link buildUploadConfig} is pure and
 *    total; `handler.refineConfig` is the one hook allowed to read, and only
 *    `CUSTOM_FIELD` has one. It runs *before* the presign, so the narrowed
 *    policy is both the one `enforceUploadPolicy` judges and the one persisted
 *    on the session.
 *
 * ## `ctx` is what steps 3 and 4 stand on
 *
 * `handler.validateEntity(ctx, …)` and `handler.refineConfig(ctx, …)` both read
 * through it. It also carries the organization scope, which is the one thing a
 * route must never let the request body supply.
 */

import type { Result } from 'neverthrow'
import { type AuxxError, BadRequestError } from '../../errors'
import type { FilesCtx, FilesDeps } from '../ctx'
import { guard, unwrap } from '../guard'
import { presignUpload, startMultipartUpload } from '../storage/presign'
import { buildUploadConfig } from './config'
import { getUploadHandler, requiresEntityId } from './handlers'
import type { UploadInitConfig } from './init-types'
import { createUploadSession, patchUploadSession, type UploadSessionRedis } from './session'

/**
 * Everything the client needs to start writing bytes.
 *
 * Two names differ from the wire body the route emits, on purpose:
 *
 * - **`strategy`**, not `uploadMethod`. The response calls this `uploadMethod`
 *   (`'single' | 'multipart'`) *and* `PresignedUploadSession.uploadMethod` is
 *   the HTTP verb (`'PUT' | 'POST'`). One name for two unrelated things is how
 *   the session ended up storing `'PUT'` in a field the response uses for
 *   `'multipart'`; it is not propagated inward.
 * - **`httpMethod`**, not `uploadType`, for the same reason.
 *
 * The route maps both back to the legacy wire names, which are unchanged.
 */
export interface PreparedUpload {
  sessionId: string
  /** Whether the client uploads in one request or in parts. */
  strategy: 'single' | 'multipart'
  storageKey: string
  expiresAt: Date
  /**
   * Non-fatal notes about the prepared upload.
   *
   * Always empty since the handler conversion. The processor chain produced two
   * strings — "EntityId was automatically set to the authenticated user ID" and
   * "EntityType suggests attachment processor, but file processor is being
   * used", the second of which was unreachable once the registry stopped
   * defaulting. Both restated something the response already shows, and nothing
   * in `apps/web`, `packages/ui` or `packages/sdk` renders the field. Kept on the
   * wire because the uploader's `transport/types.ts` still declares it.
   */
  warnings: string[]
  /** Single only: the verb the presigned URL was signed for. */
  httpMethod?: 'PUT' | 'POST'
  /** Single only. */
  presignedUrl?: string
  /** Single only, and only for a presigned POST — a PUT carries no form fields. */
  presignedFields?: Record<string, string>
  /** Multipart only: the id every later part presign and the completion must name. */
  uploadId?: string
}

/**
 * What preparing an upload is allowed to touch.
 *
 * A narrowed {@link FilesDeps} slice (`files/ctx.ts`) plus Redis, which is not
 * in the bundle because only the two session-owning functions in this module
 * need it — putting it in `FilesDeps` would make every read path that presigns a
 * download construct a Redis client.
 *
 * There is no `queue` and no `cache` here, and the signature is the guarantee:
 * preparing an upload enqueues nothing and busts nothing.
 */
export type PrepareUploadDeps = Pick<FilesDeps, 'storage' | 'now'> & {
  redis: UploadSessionRedis
}

/**
 * Create an upload session and presign the write.
 *
 * Performs **no permission check** (`docs/lib-module-guide.md` §6) and no quota
 * check. Both are the calling surface's, and both stay in the route: the
 * `files.manage` gate because authorization is not lib's question, and the
 * storage quota because its 403 body (`{ error: 'USAGE_LIMIT', details }`) is a
 * shape the UI parses, not the generic upload-error body.
 *
 * @param ctx Scope. `ctx.organizationId` is the organization the session is
 *   created for; the request body never supplies it.
 * @param deps Storage, clock and Redis — see {@link PrepareUploadDeps}.
 * @param init The parsed request, already org- and user-scoped by the route.
 * @returns `err(BadRequestError)` for an entity type with no handler or an
 *   attachment-backed upload with no `entityId`, `err(NotFoundError)` when the
 *   named entity is not in this organization, `err(UnprocessableEntityError)`
 *   when the request breaks the handler's policy, `err(AuxxError)` when the
 *   provider refuses to sign.
 */
export async function prepareUpload(
  ctx: FilesCtx,
  deps: PrepareUploadDeps,
  init: UploadInitConfig
): Promise<Result<PreparedUpload, AuxxError>> {
  return guard(
    async () => {
      const handler = getUploadHandler(init.entityType)

      // The handler's own pure rewrite, applied here as well as inside
      // `buildUploadConfig` — `normalizeInit` is required to be idempotent, and
      // the checks below have to see what the config will be built from.
      // `USER_PROFILE` defaults `entityId` to the uploader, so validating the
      // raw request would ask about the wrong user (or about nobody).
      const request = handler.normalizeInit ? handler.normalizeInit(init) : init

      if (requiresEntityId(handler) && !request.entityId) {
        throw new BadRequestError(`Entity ID is required for ${handler.entityType} attachments`)
      }

      // Mirrors `BaseAssetProcessor`'s `if (init.entityId)` guard: an upload
      // that names no entity has nothing to check.
      if (handler.validateEntity && request.entityId) {
        await handler.validateEntity(ctx, request)
      }

      const built = buildUploadConfig(handler, request, deps.now)
      const config = handler.refineConfig ? await handler.refineConfig(ctx, built, request) : built
      const warnings: string[] = []

      const session = await createUploadSession(deps.redis, config, deps.now)

      // The S3 object metadata the presign carries. Deliberately REPLACES
      // `config.metadata` rather than merging it: `config.metadata` is
      // application data (`role`, `datasetId`, `title`) typed `any`, while
      // object metadata is a flat string map that rides on every request to the
      // object. The port merges the org/uploader/entity trio underneath.
      const plan = { ...config, metadata: { sessionId: session.id } }

      if (config.uploadPlan.strategy === 'single') {
        const presigned = unwrap(await presignUpload(deps.storage, plan))
        const httpMethod = presigned.method ?? 'PUT'

        await patchUploadSession(
          deps.redis,
          session.id,
          {
            presignedUrl: presigned.url,
            presignedFields: presigned.fields,
            uploadMethod: httpMethod,
          },
          deps.now
        )

        return {
          sessionId: session.id,
          strategy: 'single' as const,
          storageKey: session.storageKey,
          expiresAt: session.expiresAt,
          warnings,
          httpMethod,
          presignedUrl: presigned.url,
          // A presigned PUT has no form fields; sending an empty object would
          // make the uploader build a multipart form for a raw-body upload.
          presignedFields: httpMethod === 'POST' ? presigned.fields : undefined,
        }
      }

      const multipart = unwrap(await startMultipartUpload(deps.storage, plan))

      // `partPresignEndpoint` is NOT persisted: the client reads it off the
      // response body, so storing it on the session was a write nothing read.
      await patchUploadSession(
        deps.redis,
        session.id,
        { uploadId: multipart.uploadId, uploadMethod: 'PUT' },
        deps.now
      )

      return {
        sessionId: session.id,
        strategy: 'multipart' as const,
        storageKey: session.storageKey,
        expiresAt: session.expiresAt,
        warnings,
        uploadId: multipart.uploadId,
      }
    },
    'Failed to prepare upload',
    {
      entityType: init.entityType,
      organizationId: ctx.organizationId,
      fileName: init.fileName,
      expectedSize: init.expectedSize,
    }
  )
}
