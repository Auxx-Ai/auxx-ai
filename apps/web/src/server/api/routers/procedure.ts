// apps/web/src/server/api/routers/procedure.ts

import {
  compileProcedure,
  countAgentsUsingProcedure,
  createProcedure,
  deleteProcedure,
  discardProcedureDraft,
  getProcedureById,
  getProcedureVersionById,
  listProcedures,
  listProcedureVersions,
  publishProcedure,
  revertProcedure,
  type TiptapDoc,
  updateDraftDoc,
  updateProcedure,
} from '@auxx/lib/agents/procedures'
import { onCacheEvent } from '@auxx/lib/cache'
import { FeaturePermissionService } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('procedure-router')

/** adminProcedure + a beta gate: requires the `agentProcedures` feature on the org's plan. */
const agentProceduresAdminProcedure = adminProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(
    ctx.session.organizationId,
    FeatureKey.agentProcedures
  )
  return next()
})

/** Unwrap a neverthrow Result, mapping an error to a TRPCError. */
function unwrap<T>(
  result: { isErr(): boolean; value?: T; error?: { message?: string } | Error },
  message: string
): T {
  if (result.isErr()) {
    const detail =
      (result.error as { message?: string } | undefined)?.message ?? String(result.error)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `${message}: ${detail}` })
  }
  return result.value as T
}

const triggerExampleSchema = z.object({
  text: z.string(),
  behavior: z.enum(['use', 'avoid']),
})

/**
 * Org-level standalone procedures (v9). The editor autosaves the DRAFT version's
 * `doc` + the procedure's trigger DEFAULTS here; `publish` snapshots an immutable
 * version and repoints the active pointer; `revert` repoints to an older version.
 *
 * Note: the org-cache `agents` projection + the `procedure.updated` cache bust are
 * Phase 4 (the live selection/stepper path). Until then publish/revert change only
 * the DB; nothing consumes the active version yet.
 */
export const procedureRouter = createTRPCRouter({
  // Org-wide list — drives the routing-step `switch` picker + the library view.
  list: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const rows = unwrap(await listProcedures({ organizationId }), 'list procedures')
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      whenToUse: row.whenToUse,
      hasUnpublishedChanges: row.hasUnpublishedChanges,
      activeVersionId: row.activeVersionId,
      updatedAt: row.updatedAt.toISOString(),
    }))
  }),

  // Full procedure + its draft doc — the editor's load.
  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const procedure = unwrap(
        await getProcedureById({ organizationId, procedureId: input.id }),
        'get procedure'
      )
      if (!procedure) throw new TRPCError({ code: 'NOT_FOUND', message: 'Procedure not found' })
      const draft = procedure.draftVersionId
        ? unwrap(
            await getProcedureVersionById({
              organizationId,
              procedureVersionId: procedure.draftVersionId,
            }),
            'get draft version'
          )
        : null
      return {
        id: procedure.id,
        name: procedure.name,
        whenToUse: procedure.whenToUse,
        triggerExamples: procedure.triggerExamples,
        ruleset: procedure.ruleset,
        activeVersionId: procedure.activeVersionId,
        hasUnpublishedChanges: procedure.hasUnpublishedChanges,
        draftDoc: (draft?.doc ?? null) as Record<string, unknown> | null,
      }
    }),

  create: agentProceduresAdminProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const row = unwrap(
        await createProcedure({ organizationId, name: input.name }),
        'create procedure'
      )
      return { id: row.id }
    }),

  // DRAFT autosave target — patches the draft `doc` and/or trigger defaults.
  // Never touches the published `compiled`/`version` (STACK #10).
  update: agentProceduresAdminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        whenToUse: z.string().optional(),
        triggerExamples: z.array(triggerExampleSchema).optional(),
        ruleset: z.array(z.unknown()).optional(),
        doc: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { id, doc, ...meta } = input
      if (
        meta.name !== undefined ||
        meta.whenToUse !== undefined ||
        meta.triggerExamples !== undefined ||
        meta.ruleset !== undefined
      ) {
        unwrap(
          await updateProcedure({
            organizationId,
            procedureId: id,
            patch: {
              name: meta.name,
              whenToUse: meta.whenToUse,
              triggerExamples: meta.triggerExamples,
              ruleset: meta.ruleset,
            },
          }),
          'update procedure'
        )
      }
      if (doc !== undefined) {
        unwrap(
          await updateDraftDoc({ organizationId, procedureId: id, doc: doc as TiptapDoc }),
          'update draft doc'
        )
      }
      // Re-read and return the authoritative meta (same projection as getById
      // minus draftDoc) so the client's optimistic store settles on truth —
      // notably `hasUnpublishedChanges`, which flips on a doc save.
      const procedure = unwrap(
        await getProcedureById({ organizationId, procedureId: id }),
        'get procedure'
      )
      if (!procedure) throw new TRPCError({ code: 'NOT_FOUND', message: 'Procedure not found' })
      return {
        id: procedure.id,
        name: procedure.name,
        whenToUse: procedure.whenToUse,
        triggerExamples: procedure.triggerExamples,
        ruleset: procedure.ruleset,
        activeVersionId: procedure.activeVersionId,
        hasUnpublishedChanges: procedure.hasUnpublishedChanges,
      }
    }),

  delete: agentProceduresAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      unwrap(await deleteProcedure({ organizationId, procedureId: input.id }), 'delete procedure')
      return { ok: true as const }
    }),

  // How many agents have this procedure attached — drives the Delete blast-radius
  // confirm in the publish cluster (delete is org-wide + cascade-detaches).
  agentUsageCount: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      return unwrap(
        await countAgentsUsingProcedure({ organizationId, procedureId: input.id }),
        'count agents using procedure'
      )
    }),

  /**
   * Discard draft edits: copy the active version's `doc` back into the draft and
   * clear `hasUnpublishedChanges`. Returns the meta projection (same as `getById`
   * minus `draftDoc`) so the client settles its optimistic store on truth; the
   * caller invalidates `getById` to reload the rewritten draft doc.
   */
  discardDraft: agentProceduresAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const procedure = unwrap(
        await discardProcedureDraft({ organizationId, procedureId: input.id }),
        'discard procedure draft'
      )
      return {
        id: procedure.id,
        name: procedure.name,
        whenToUse: procedure.whenToUse,
        triggerExamples: procedure.triggerExamples,
        ruleset: procedure.ruleset,
        activeVersionId: procedure.activeVersionId,
        hasUnpublishedChanges: procedure.hasUnpublishedChanges,
      }
    }),

  // Published version history (newest first) for the revert UI.
  listVersions: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const rows = unwrap(
        await listProcedureVersions({ procedureId: input.id }),
        'list procedure versions'
      )
      return rows.map((row) => ({
        id: row.id,
        versionNumber: row.versionNumber,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
      }))
    }),

  /**
   * Compile the draft → snapshot an immutable version → repoint the active
   * pointer. Enforces non-empty `whenToUse` and surfaces compile errors. Busts
   * the `agents` org-cache projection so the next selection runs the new active
   * version (`procedure.updated → ['agents']`; only publish/revert bust — drafts
   * never affect live runs).
   */
  publish: agentProceduresAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const procedure = unwrap(
        await getProcedureById({ organizationId, procedureId: input.id }),
        'get procedure'
      )
      if (!procedure) throw new TRPCError({ code: 'NOT_FOUND', message: 'Procedure not found' })
      if (procedure.whenToUse.trim() === '') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Set "when to use" before publishing.',
        })
      }
      if (!procedure.draftVersionId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Procedure has no draft to publish.' })
      }
      const draft = unwrap(
        await getProcedureVersionById({
          organizationId,
          procedureVersionId: procedure.draftVersionId,
        }),
        'get draft version'
      )
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft version not found' })

      const { compiled, errors } = compileProcedure(draft.doc as TiptapDoc)
      if (errors && errors.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Procedure has errors: ${errors[0]!.message}`,
        })
      }

      const version = unwrap(
        await publishProcedure({
          organizationId,
          procedureId: input.id,
          doc: draft.doc as TiptapDoc,
          compiled,
          editorId: ctx.session.userId,
        }),
        'publish procedure'
      )
      await onCacheEvent('procedure.updated', { orgId: organizationId })
      logger.info('Procedure published', {
        organizationId,
        procedureId: input.id,
        versionNumber: version.versionNumber,
      })
      return { versionNumber: version.versionNumber, procedureVersionId: version.id }
    }),

  revert: agentProceduresAdminProcedure
    .input(z.object({ id: z.string().min(1), toVersionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      unwrap(
        await revertProcedure({
          organizationId,
          procedureId: input.id,
          toVersionId: input.toVersionId,
        }),
        'revert procedure'
      )
      await onCacheEvent('procedure.updated', { orgId: organizationId })
      return { ok: true as const }
    }),
})
