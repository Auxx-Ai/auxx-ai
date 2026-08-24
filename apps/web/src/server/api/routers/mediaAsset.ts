// apps/web/src/server/api/routers/mediaAsset.ts

import { convertTempAssetToPermanent } from '@auxx/lib/files/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { toFilesCtx } from '~/server/lib/files-ctx'

/**
 * MediaAsset router for managing media assets
 */
export const mediaAssetRouter = createTRPCRouter({
  /**
   * Convert TEMP_UPLOAD MediaAsset to a permanent kind
   *
   * The organization is no longer a third argument: `convertTempAssetToPermanent`
   * reads it off the `FilesCtx`, so the read and the `UPDATE` cannot be scoped to
   * different tenants. The legacy `convertTempToPermanent(id, kind, organizationId)`
   * took one from the caller *and* had one on the service.
   */
  convertTempToPermanent: protectedProcedure
    .input(
      z.object({
        mediaAssetId: z.string(),
        newKind: z.enum([
          'USER_AVATAR',
          'INLINE_IMAGE',
          'THUMBNAIL',
          'SYSTEM_BLOB',
          'EMAIL_ATTACHMENT',
          'DOCUMENT',
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // A no-op for an asset that is not a `TEMP_UPLOAD`, which is the legacy
      // behaviour and what a retried upload completion relies on.
      const result = await convertTempAssetToPermanent(
        toFilesCtx(ctx),
        input.mediaAssetId,
        input.newKind
      )
      if (result.isErr()) throw result.error

      return { success: true }
    }),
})
