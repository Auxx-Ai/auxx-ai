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
 * ## What is deliberately still the processor's job
 *
 * {@link prepareUpload} calls `processor.processConfig(init)`, not the pure
 * `buildUploadConfig` that PR 4a shipped. That is not an oversight.
 *
 * PR 4a landed `UPLOAD_HANDLERS` and `buildUploadConfig` alongside the processor
 * chain and guarded them with `__tests__/handler-processor-parity.test.ts`, which
 * compares **four declarative fields** per entity plus one end-to-end config for
 * `FILE`. The processor chain does more than those four fields: it also runs
 * `validateEntityAccess` (a database read), requires an `entityId` for every
 * attachment-backed type, and lets `CUSTOM_FIELD` narrow its MIME list from the
 * org cache. Swapping the config source is PR 4d's job, and doing it here would
 * smuggle a behaviour change into a PR whose whole point is that the *route*
 * stops orchestrating.
 *
 * What this PR buys 4d is that the swap is now **one line in one function**
 * rather than a route rewrite: replace the two lines below with
 * `getUploadHandler` + `buildUploadConfig` + `handler.refineConfig` +
 * `handler.validateEntity`, and every caller is already correct.
 *
 * ## `ctx` is here for 4d, and it is not decoration
 *
 * Nothing in this function reads `ctx.db` today — the processors carry their own
 * database. `handler.refineConfig(ctx, …)` and `handler.validateEntity(ctx, …)`
 * both take a `FilesCtx`, so the parameter is the seam those hooks land on. It
 * also carries the organization scope, which is the one thing a route must never
 * let the request body supply.
 */

import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { FilesCtx, FilesDeps } from '../ctx'
import { guard, unwrap } from '../guard'
import { presignUpload, startMultipartUpload } from '../storage/presign'
import type { UploadInitConfig } from './init-types'
import { ensureProcessorsInitialized, ProcessorRegistry } from './processors'
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
  /** Non-fatal notes from config building. Always empty today; carried through. */
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
 * @returns `err(BadRequestError)` for an entity type with no processor,
 *   `err(AuxxError)` when the provider refuses to sign.
 */
export async function prepareUpload(
  ctx: FilesCtx,
  deps: PrepareUploadDeps,
  init: UploadInitConfig
): Promise<Result<PreparedUpload, AuxxError>> {
  return guard(
    async () => {
      ensureProcessorsInitialized()
      const processor = ProcessorRegistry.getForEntityType(init.entityType, ctx.organizationId)
      const { config, warnings } = await processor.processConfig(init)

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
