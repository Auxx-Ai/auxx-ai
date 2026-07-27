// apps/web/src/server/api/routers/procedure.ts

import {
  compileProcedure,
  countAgentsUsingProcedure,
  createProcedure,
  deleteProcedure,
  discardProcedureDraft,
  getProcedureById,
  getProcedureVersionById,
  listAgentIdsForProcedure,
  listProcedures,
  listProcedureVersions,
  publishProcedure,
  reconcileProcedureMentionsForAgents,
  reconcileProcedureMentionsForAllAgents,
  renameProcedureVersion,
  restoreProcedureVersion,
  type TiptapDoc,
  updateDraftDoc,
  updateProcedure,
} from '@auxx/lib/agents/procedures'
import { onCacheEvent } from '@auxx/lib/cache'
import { FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure, protectedProcedure } from '../trpc'
import { unwrap } from '../unwrap'

const logger = createScopedLogger('procedure-router')

/** permissionProcedure(agentsManage) + a beta gate: requires the `agentProcedures` feature on the org's plan. */
const agentProceduresManageProcedure = permissionProcedure(PermissionKey.agentsManage).use(
  async ({ ctx, next }) => {
    await new FeaturePermissionService().requireAccess(
      ctx.session.organizationId,
      FeatureKey.agentProcedures
    )
    return next()
  }
)

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

  create: agentProceduresManageProcedure
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
  update: agentProceduresManageProcedure
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
        // A draft doc edit can add/remove `tool:`/record chips — fan the
        // `'procedure'` tag out to every agent this procedure is attached to.
        await reconcileProcedureMentionsForAllAgents(organizationId, id)
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

  delete: agentProceduresManageProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Capture the attached agents BEFORE the delete cascade-detaches the links,
      // then reconcile each AFTER so the gone procedure drops out of their tag.
      const agentIds = await listAgentIdsForProcedure(organizationId, input.id)
      unwrap(await deleteProcedure({ organizationId, procedureId: input.id }), 'delete procedure')
      await reconcileProcedureMentionsForAgents(organizationId, agentIds)
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
  discardDraft: agentProceduresManageProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const procedure = unwrap(
        await discardProcedureDraft({ organizationId, procedureId: input.id }),
        'discard procedure draft'
      )
      // Draft doc was rewritten back to the active version — the draft+active
      // union may have changed, so re-fan the `'procedure'` tag.
      await reconcileProcedureMentionsForAllAgents(organizationId, input.id)
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
        editorName: row.editorName,
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
  publish: agentProceduresManageProcedure
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
      // Publish moves the active version — fan the `'procedure'` tag out so the
      // runtime toolsets of every attached agent track the new active doc.
      await reconcileProcedureMentionsForAllAgents(organizationId, input.id)
      logger.info('Procedure published', {
        organizationId,
        procedureId: input.id,
        versionNumber: version.versionNumber,
      })
      return { versionNumber: version.versionNumber, procedureVersionId: version.id }
    }),

  // Restore-as-draft: load an older version into the draft + mark dirty. Does
  // NOT repoint the active version — live behavior is unchanged until publish.
  restoreVersion: agentProceduresManageProcedure
    .input(z.object({ id: z.string().min(1), toVersionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      unwrap(
        await restoreProcedureVersion({
          organizationId,
          procedureId: input.id,
          toVersionId: input.toVersionId,
        }),
        'restore procedure version'
      )
      await onCacheEvent('procedure.updated', { orgId: organizationId })
      // Restore rewrites the draft doc/criteria — re-fan the `'procedure'` tag so
      // attached agents' draft mention rows track the restored doc.
      await reconcileProcedureMentionsForAllAgents(organizationId, input.id)
      return { ok: true as const }
    }),

  // Rename a published version's label (annotation only).
  renameVersion: agentProceduresManageProcedure
    .input(
      z.object({
        id: z.string().min(1),
        versionId: z.string().min(1),
        label: z.string().max(120).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      unwrap(
        await renameProcedureVersion({
          organizationId,
          procedureId: input.id,
          versionId: input.versionId,
          label: input.label,
        }),
        'rename procedure version'
      )
      return { ok: true as const }
    }),
})
