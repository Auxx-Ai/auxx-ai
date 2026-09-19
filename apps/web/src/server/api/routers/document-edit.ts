// apps/web/src/server/api/routers/document-edit.ts
//
// The edit-in-place lane for a finalized accounting document (74 §1.3). One set
// of procedures for every family; `routers/document.ts` is the dataset
// document pipeline and is unrelated.

import {
  cancelDocumentEdit,
  DOCUMENT_EDIT_FAMILIES,
  openDocumentEdit,
  readDocumentEditState,
  saveDocumentEdit,
} from '@auxx/lib/accounting/documents/edit-in-place'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

const target = z.object({
  family: z.enum(DOCUMENT_EDIT_FAMILIES),
  /** The header's `EntityInstance` id. */
  recordId: z.string().min(1),
})

export const documentEditRouter = createTRPCRouter({
  /** Is this document unlocked, and is it waiting on a drafted entry? */
  readState: permissionProcedure(PermissionKey.ledgerView)
    .input(target)
    .query(async ({ ctx, input }) => {
      return readDocumentEditState(ctx.db, {
        organizationId: ctx.session.organizationId,
        entityInstanceId: input.recordId,
      })
    }),

  /**
   * Unlock a finalized document: capture its snapshot, which IS the edit flag.
   * The ledger is untouched until Save.
   *
   * 🛑 `ledgerPost`, like Post and Void. This is not "may I edit a record" — it
   * is permission to move what is already in the books, and Save reverses and
   * re-posts the entry.
   */
  open: permissionProcedure(PermissionKey.ledgerPost)
    .input(target)
    .mutation(async ({ ctx, input }) => {
      return openDocumentEdit(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        family: input.family,
        entityInstanceId: input.recordId,
      })
    }),

  /**
   * Bring the entry up to the document's current values, then drop the snapshot.
   * An unchanged document posts nothing; a refusal leaves entry, values and row
   * alone.
   */
  save: permissionProcedure(PermissionKey.ledgerPost)
    .input(target)
    .mutation(async ({ ctx, input }) => {
      return saveDocumentEdit(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        family: input.family,
        entityInstanceId: input.recordId,
      })
    }),

  /** Restore the snapshot and drop it. Deletes lines the edit added (66 §5). */
  cancel: permissionProcedure(PermissionKey.ledgerPost)
    .input(target)
    .mutation(async ({ ctx, input }) => {
      return cancelDocumentEdit(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        family: input.family,
        entityInstanceId: input.recordId,
      })
    }),
})
