// apps/web/src/server/api/routers/document-edit.ts
//
// The edit-in-place lane for a finalized accounting document (74 §1.3). One set
// of procedures for every family; `routers/document.ts` is the dataset
// document pipeline and is unrelated.

import {
  cancelDocumentEdit,
  DOCUMENT_EDIT_FAMILIES,
  DOCUMENT_EDIT_REFUSED_IN,
  DOCUMENT_OPEN_STATUSES,
  type DocumentEditFamily,
  documentEditRow,
  openDocumentEdit,
  readDocumentEditState,
  readDocumentLockState,
  saveDocumentEdit,
} from '@auxx/lib/accounting/documents/edit-in-place'
import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import {
  type CapabilitySet,
  FeaturePermissionService,
  PERMISSION_REGISTRY_MAP,
  PermissionKey,
} from '@auxx/lib/permissions'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

const target = z.object({
  family: z.enum(DOCUMENT_EDIT_FAMILIES),
  /** The header's `EntityInstance` id. */
  recordId: z.string().min(1),
})

/**
 * A family that posts needs `ledgerPost`, like Post and Void: Save reverses
 * and re-posts its entry. A family with no entry needs only edit on its own def.
 */
async function assertMayEdit(
  ctx: {
    session: { organizationId: string }
    capabilities: Pick<CapabilitySet, 'assert' | 'assertEditEntity'>
  },
  family: DocumentEditFamily
): Promise<void> {
  const { organizationId } = ctx.session
  if (documentEditRow(family).ledger) {
    const featureKey = PERMISSION_REGISTRY_MAP.get(PermissionKey.ledgerPost)?.featureKey
    if (featureKey) await new FeaturePermissionService().requireAccess(organizationId, featureKey)
    ctx.capabilities.assert(PermissionKey.ledgerPost)
    return
  }
  const defId = await getCachedEntityDefId(organizationId, family)
  if (!defId) throw new NotFoundError(`This organization has no ${family} records yet.`)
  ctx.capabilities.assertEditEntity(defId)
}

export const documentEditRouter = createTRPCRouter({
  /** Is this document unlocked, and what does the ledger hold for it? */
  readState: permissionProcedure(PermissionKey.ledgerView)
    .input(target)
    .query(async ({ ctx, input }) => {
      return readDocumentEditState(ctx.db, {
        organizationId: ctx.session.organizationId,
        entityInstanceId: input.recordId,
      })
    }),

  /**
   * The lock the server enforces on a quote, purchase order or order, so the card
   * reads the same answer the pre-hooks give — an order's `synced` is a
   * `DataConnectorItem` read the client cannot make.
   */
  lockState: capabilityProcedure
    .input(
      z.object({
        family: z.enum(['quote', 'purchase_order', 'order']),
        recordId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const defId = await getCachedEntityDefId(organizationId, input.family)
      if (!defId) throw new NotFoundError(`This organization has no ${input.family} records yet.`)
      ctx.capabilities.assertViewEntity(defId)
      const state = await readDocumentLockState(
        ctx.db,
        organizationId,
        input.family,
        input.recordId
      )
      if (!state) return null
      return {
        status: state.status,
        /** Editable without the lane. */
        open: DOCUMENT_OPEN_STATUSES[input.family].includes(state.status),
        /** Edit will open. */
        editable: !DOCUMENT_EDIT_REFUSED_IN[input.family].includes(state.status),
      }
    }),

  /**
   * Unlock a finalized document: capture its snapshot, which IS the edit flag.
   * The ledger is untouched until Save.
   */
  open: capabilityProcedure.input(target).mutation(async ({ ctx, input }) => {
    await assertMayEdit(ctx, input.family)
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
  save: capabilityProcedure.input(target).mutation(async ({ ctx, input }) => {
    await assertMayEdit(ctx, input.family)
    return saveDocumentEdit(ctx.db, {
      organizationId: ctx.session.organizationId,
      userId: ctx.session.userId,
      family: input.family,
      entityInstanceId: input.recordId,
    })
  }),

  /** Restore the snapshot and drop it. Deletes lines the edit added (66 §5). */
  cancel: capabilityProcedure.input(target).mutation(async ({ ctx, input }) => {
    await assertMayEdit(ctx, input.family)
    return cancelDocumentEdit(ctx.db, {
      organizationId: ctx.session.organizationId,
      userId: ctx.session.userId,
      family: input.family,
      entityInstanceId: input.recordId,
    })
  }),
})
