// packages/lib/src/files/attachments/index.ts

/**
 * `Attachment` reads and writes written to the `files/` {@link ../ctx.FilesCtx}
 * contract. Explicit named exports only — an implicit surface is how
 * `core/attachment-service.ts` reached 1,386 lines across 39 methods, only 12
 * of which anything called.
 */

export type {
  CreateAttachmentInput,
  UpdateAttachmentInput,
} from './attachment-mutations'
export {
  assertExactlyOneTarget,
  createAttachment,
  deleteAttachment,
  updateAttachment,
} from './attachment-mutations'
export type {
  AttachmentSide,
  GroupedAttachmentInfo,
  ResolvedAttachmentVersion,
} from './attachment-queries'
export {
  fetchAttachmentsForEntities,
  getAttachment,
  getEntityAttachments,
  requireAttachment,
  requireResolvedVersion,
  resolveAttachmentVersion,
} from './attachment-queries'
