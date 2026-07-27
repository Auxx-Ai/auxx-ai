// apps/web/src/server/api/routers/agent.ts

import {
  agentExistsInOrg,
  agentSlugSchema,
  completeAgentSetup,
  createAgent as createAgentService,
  deleteAgent as deleteAgentService,
  deleteDraftAgent,
  discardAgentDraft,
  getAgentDetailByIdOrSlug,
  isAgentSlugTaken,
  listAgents,
  listAgentVersions,
  publishAgent,
  renameAgentVersion,
  restoreAgentVersion,
  setAgentToolBindings,
  updateAgent as updateAgentService,
} from '@auxx/lib/agents'
import { FeatureKey, FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { getRealtimeService, publishAgentUpdated } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '../trpc'
import { unwrap } from '../unwrap'

const logger = createScopedLogger('agent-router')

const promptSchema = z.record(z.string(), z.unknown())

/**
 * Admin-only CRUD for user-authored Kopilot agents. Toolset rows are managed
 * via the sibling `agentToolset.*` router. Archive is driven through `update`
 * (`archivedAt: Date | null`) per plans/kopilot/agents/phase-1-engine-and-api.md
 * §3.2. Reads flow through the org agents cache; writes go through
 * `@auxx/lib/agents` service functions — no raw SQL lives in this router.
 */
export const agentRouter = createTRPCRouter({
  list: permissionProcedure(PermissionKey.agentsManage)
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(({ ctx, input }) =>
      listAgents(ctx.session.organizationId, {
        includeArchived: input?.includeArchived ?? false,
      })
    ),

  /**
   * Resolve an agent by id or slug. The input field is named `agentId` for
   * backward compatibility with existing callers, but accepts either form —
   * the service helper checks both columns against the org agents cache.
   */
  getById: permissionProcedure(PermissionKey.agentsManage)
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const detail = await getAgentDetailByIdOrSlug(ctx.session.organizationId, input.agentId)
      if (!detail) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
      return detail
    }),

  create: permissionProcedure(PermissionKey.agentsManage)
    .input(
      z
        .object({
          /** Omit for chat-driven creation; backing User.name stays null. */
          name: z.string().min(1).max(120).optional(),
          /**
           * Omit for chat-driven creation; the service writes `slug = id`
           * so the (orgId, slug) unique index holds without slug-generation.
           */
          slug: agentSlugSchema.optional(),
          description: z.string().max(500).optional().nullable(),
          prompt: promptSchema.optional(),
          modelId: z.string().max(120).optional().nullable(),
          mentionable: z.boolean().optional(),
          /**
           * Invocation surface. Chosen once at creation and immutable
           * thereafter (`update` has no `kind` field). Defaults to
           * `'internal'`; the Create dropdown sends `'chat'` for chat agents.
           */
          kind: z.enum(['internal', 'chat']).default('internal'),
          /**
           * Initial toolset slugs to enable. When omitted, `createAgent`
           * resolves defaults and tags the rows `source='auto_default'`. When
           * provided, every slug lands as `source='manual'`.
           */
          toolsetSlugs: z.array(z.string().min(1).max(120)).optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const args = input ?? {}

      // Gate creation on the plan's agent allowance (0 on Free).
      await new FeaturePermissionService().requireLimit(
        organizationId,
        FeatureKey.agentsLimit,
        async () => (await listAgents(organizationId)).length
      )

      if (args.slug && (await isAgentSlugTaken(organizationId, args.slug))) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Slug already in use' })
      }

      const created = await createAgentService({
        organizationId,
        createdById: userId,
        name: args.name,
        slug: args.slug,
        description: args.description ?? null,
        prompt: args.prompt,
        modelId: args.modelId ?? null,
        mentionable: args.mentionable ?? true,
        kind: args.kind ?? 'internal',
        toolsetSlugs: args.toolsetSlugs,
      })

      logger.info('Agent created', {
        organizationId,
        agentId: created.agentId,
        toolsetCount: created.toolsetSlugs.length,
        source: created.toolsetSource,
      })

      return { agentId: created.agentId, userId: created.userId }
    }),

  /**
   * Flip an agent from setup mode → live tabs. Idempotent: re-calls on an
   * already-completed agent no-op. Powers the rail's "Configure manually…"
   * escape hatch, so it forces past the persona/toolset/name quality gates —
   * the user finishes configuration in the live tabs. The AI chat-builder
   * tool calls `completeAgentSetup` directly and keeps those gates.
   */
  completeSetup: permissionProcedure(PermissionKey.agentsManage)
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      if (!(await agentExistsInOrg(organizationId, input.agentId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
      // `completedByUserId` bounds the auto-published v1 policy by this user's own
      // authority (doc 19 §2.4a) — `agentsManage` is grantable to non-admins, so a
      // member completing setup must not mint an agent stronger than themselves.
      await completeAgentSetup(input.agentId, organizationId, undefined, {
        force: true,
        completedByUserId: userId,
      })
    }),

  /**
   * Hard-delete a draft agent (`setupCompletedAt IS NULL`). Powers the
   * agents-list "Discard draft" overflow item. Refuses to touch completed
   * agents — use the archive path for those.
   */
  deleteDraft: permissionProcedure(PermissionKey.agentsManage)
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const result = await deleteDraftAgent(input.agentId, organizationId)
      if (!result.deleted) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Agent is not a draft or does not exist',
        })
      }
    }),

  /**
   * Permanently delete an agent in any state (active or archived). Drops the
   * `Agent` row and its synthetic `User`; conversation history is preserved
   * orphaned. Use `deleteDraft` only for incomplete drafts.
   */
  delete: permissionProcedure(PermissionKey.agentsManage)
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteAgentService(input.agentId, ctx.session.organizationId)
      if (!result.deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
    }),

  update: permissionProcedure(PermissionKey.agentsManage)
    .input(
      z.object({
        agentId: z.string(),
        name: z.string().min(1).max(120).optional(),
        slug: agentSlugSchema.optional(),
        description: z.string().max(500).optional().nullable(),
        prompt: promptSchema.optional(),
        modelId: z.string().max(120).optional().nullable(),
        mentionable: z.boolean().optional(),
        /** Date archives; null unarchives; omit to leave unchanged. */
        archivedAt: z.date().nullable().optional(),
        /**
         * Per-app account bindings keyed by app id. Each entry is merged
         * into `Agent.appAccounts` — pass `null` for an entry to clear it.
         * See plans/kopilot/apps/agent-credentials.md §5.5.
         */
        appAccounts: z
          .record(z.string().min(1), z.object({ credId: z.string().min(1) }).nullable())
          .optional(),
        /**
         * Run-as delegation (capability layer v2 §0.6). A user id makes every
         * run resolve capabilities from that member instead of the agent's own
         * profile; `null` clears it; omit to leave unchanged. The service
         * validates the target is an ACTIVE `userType:'USER'` member.
         */
        runAsUserId: z.string().nullable().optional(),
        /**
         * The DRAFT permission-profile binding (capability layer v2 §0.16).
         * `null` unbinds (falls back to the system profile for the agent's
         * kind); omit to leave unchanged. The service validates the profile is
         * in this org and admits agents. Production is unaffected until the
         * agent is published.
         */
        permissionProfileId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { agentId, ...patch } = input

      if (!(await agentExistsInOrg(organizationId, agentId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      if (patch.slug !== undefined) {
        const taken = await isAgentSlugTaken(organizationId, patch.slug, {
          excludeAgentId: agentId,
        })
        if (taken) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Slug already in use' })
        }
      }

      const updatePayload: Parameters<typeof updateAgentService>[2] = {}
      if (patch.name !== undefined) updatePayload.name = patch.name
      if (patch.slug !== undefined) updatePayload.slug = patch.slug
      if (patch.description !== undefined) updatePayload.description = patch.description
      if (patch.prompt !== undefined) updatePayload.prompt = patch.prompt
      if (patch.modelId !== undefined) updatePayload.modelId = patch.modelId
      if (patch.mentionable !== undefined) updatePayload.mentionable = patch.mentionable
      if (patch.archivedAt !== undefined) updatePayload.archivedAt = patch.archivedAt
      if (patch.appAccounts !== undefined) updatePayload.appAccounts = patch.appAccounts
      if (patch.runAsUserId !== undefined) updatePayload.runAsUserId = patch.runAsUserId
      if (patch.permissionProfileId !== undefined) {
        updatePayload.permissionProfileId = patch.permissionProfileId
      }

      // Exclude the writer's own socket from the `agent:updated` broadcast so
      // the persona editor's autosave doesn't echo back and remount over the
      // author's in-flight edits. Kopilot writes are server-originated (no
      // socket) and still reach the open editor.
      const excludeSocketId = ctx.headers.get('x-realtime-socket-id') ?? undefined
      await updateAgentService(agentId, organizationId, updatePayload, { excludeSocketId })
    }),

  checkSlug: permissionProcedure(PermissionKey.agentsManage)
    .input(z.object({ slug: agentSlugSchema, excludeAgentId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const taken = await isAgentSlugTaken(ctx.session.organizationId, input.slug, {
        excludeAgentId: input.excludeAgentId,
      })
      return { available: !taken }
    }),

  /**
   * Full-replace write of an agent's `toolRestrictions` **override** map (the
   * Bindings section). The client sends only the deliberate overrides (tool →
   * input → VarSource); the service overwrites the column wholesale and busts
   * the org agents cache. An empty map means "everything runs on author
   * defaults". See plans/chat/v8 phase-5.
   */
  setToolBindings: permissionProcedure(PermissionKey.agentsManage)
    .input(
      z.object({
        agentId: z.string().min(1),
        bindings: z.record(
          z.string(),
          z.record(
            z.string(),
            z.discriminatedUnion('kind', [
              z.object({
                kind: z.literal('var'),
                ref: z.union([z.string(), z.array(z.string())]),
              }),
              z.object({ kind: z.literal('const'), value: z.unknown() }),
              z.object({ kind: z.literal('model') }),
            ])
          )
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      if (!(await agentExistsInOrg(organizationId, input.agentId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
      await setAgentToolBindings({
        organizationId,
        agentId: input.agentId,
        bindings: input.bindings,
      })
    }),

  // ── Versions (draft / publish lifecycle) ──────────────────────────────
  // Mirror the procedure version endpoints. The Agent row IS the draft;
  // publishing snapshots its six behavior fields into a numbered AgentVersion.
  // `getById` already returns `activeVersionId`/`hasUnpublishedChanges`/active
  // `versionNumber` via `getAgentDetail`. See
  // plans/agents/agent-versions/build-plan.md §6.

  /** Snapshot the draft as a new version (or no-op republish). Human-only. */
  publish: permissionProcedure(PermissionKey.agentsManage)
    .input(z.object({ agentId: z.string().min(1), label: z.string().max(120).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      if (!(await agentExistsInOrg(organizationId, input.agentId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
      const { version, reductions } = unwrap(
        await publishAgent({
          organizationId,
          agentId: input.agentId,
          editorId: userId,
          label: input.label ?? null,
          // The AUTHOR CLAMP (doc 19 §2.4a): the published policy is
          // `min(profilePolicy, this user's own effective capabilities)`.
          publishedByUserId: userId,
        }),
        'publish agent'
      )
      await publishAgentUpdated(getRealtimeService(), organizationId, { agentId: input.agentId })
      // `reductions` is returned, never swallowed: publish must be able to say
      // "Deals reduced from Full to Read — you hold Read" rather than silently
      // downgrading what the admin configured (§2.4a). Rendering it is step 8's.
      return {
        versionId: version.id,
        versionNumber: version.versionNumber,
        clampReductions: reductions,
      }
    }),

  /** Discard draft edits — restore the active version onto the row. */
  discardChanges: permissionProcedure(PermissionKey.agentsManage)
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      if (!(await agentExistsInOrg(organizationId, input.agentId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
      unwrap(
        await discardAgentDraft({ organizationId, agentId: input.agentId }),
        'discard agent draft'
      )
      await publishAgentUpdated(getRealtimeService(), organizationId, { agentId: input.agentId })
      return { ok: true as const }
    }),

  /** Restore-as-draft: load a past version into the draft + mark dirty. */
  restoreVersion: permissionProcedure(PermissionKey.agentsManage)
    .input(z.object({ agentId: z.string().min(1), toVersionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      if (!(await agentExistsInOrg(organizationId, input.agentId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
      unwrap(
        await restoreAgentVersion({
          organizationId,
          agentId: input.agentId,
          toVersionId: input.toVersionId,
        }),
        'restore agent version'
      )
      await publishAgentUpdated(getRealtimeService(), organizationId, { agentId: input.agentId })
      return { ok: true as const }
    }),

  /** Rename a published version's label (annotation only). */
  renameVersion: permissionProcedure(PermissionKey.agentsManage)
    .input(
      z.object({
        agentId: z.string().min(1),
        versionId: z.string().min(1),
        label: z.string().max(120).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      if (!(await agentExistsInOrg(organizationId, input.agentId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
      unwrap(
        await renameAgentVersion({
          organizationId,
          agentId: input.agentId,
          versionId: input.versionId,
          label: input.label,
        }),
        'rename agent version'
      )
      return { ok: true as const }
    }),

  /** Published version history (newest first) with editor names. */
  listVersions: permissionProcedure(PermissionKey.agentsManage)
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = unwrap(
        await listAgentVersions({
          organizationId: ctx.session.organizationId,
          agentId: input.agentId,
        }),
        'list agent versions'
      )
      return rows.map((row) => ({
        id: row.id,
        versionNumber: row.versionNumber,
        label: row.label,
        editorName: row.editorName,
        createdAt: row.createdAt.toISOString(),
      }))
    }),
})
