// apps/web/src/server/api/routers/attachment.ts

import { AttachmentService, FileService, MediaAssetService } from '@auxx/lib/files'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/**
 * Attachment router for managing file attachments to entities
 */
export const attachmentRouter = createTRPCRouter({
  /**
   * Get attachments by their IDs
   * Returns attachment with either asset (MediaAsset) or file (FolderFile) data
   */
  getByIds: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string()),
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.ids.length === 0) return []

      const attachmentService = new AttachmentService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )

      const attachments = await Promise.all(input.ids.map((id) => attachmentService.get(id)))
      const validAttachments = attachments.filter(Boolean)

      // Enrich with asset or file data
      const enriched = await Promise.all(
        validAttachments.map(async (attachment) => {
          // Handle MediaAsset attachments
          if (attachment.assetId) {
            const mediaAssetService = new MediaAssetService(
              ctx.session.organizationId,
              ctx.session.user.id,
              ctx.db
            )
            const asset = await mediaAssetService.get(attachment.assetId)
            return { ...attachment, asset }
          }

          // Handle FolderFile attachments
          if (attachment.fileId) {
            const fileService = new FileService(
              ctx.session.organizationId,
              ctx.session.user.id,
              ctx.db
            )
            const file = await fileService.get(attachment.fileId)
            // Map file data to asset-like structure for consistent UI rendering
            return {
              ...attachment,
              asset: file
                ? {
                    id: file.id,
                    name: file.name,
                    mimeType: file.mimeType,
                    size: file.size,
                  }
                : null,
            }
          }

          return null
        })
      )

      return enriched.filter(Boolean)
    }),

  /**
   * Create attachment for custom field value
   * Supports either fileId (for FolderFile) or assetId (for MediaAsset)
   */
  createForCustomField: protectedProcedure
    .input(
      z
        .object({
          customFieldValueId: z.string(),
          fileId: z.string().optional(),
          assetId: z.string().optional(),
          role: z.string().default('ATTACHMENT'),
        })
        .refine((data) => !!data.fileId !== !!data.assetId, {
          message: 'Provide exactly one of fileId or assetId',
        })
    )
    .mutation(async ({ ctx, input }) => {
      const attachmentService = new AttachmentService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )

      return await attachmentService.create({
        entityType: 'CUSTOM_FIELD_VALUE',
        entityId: input.customFieldValueId,
        role: input.role as any,
        fileId: input.fileId,
        assetId: input.assetId,
        createdById: ctx.session.user.id,
        organizationId: ctx.session.organizationId,
      })
    }),

  /**
   * Remove attachment from custom field
   */
  removeFromCustomField: protectedProcedure
    .input(
      z.object({
        attachmentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const attachmentService = new AttachmentService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db
      )

      await attachmentService.delete(input.attachmentId)
    }),
})
