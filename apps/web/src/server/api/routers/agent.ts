// apps/web/src/server/api/routers/agent.ts

import {
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
import { ForbiddenError } from '@auxx/lib/errors'
import { FeatureKey, FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { getRealtimeService, publishAgentUpdated } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { assertAgentAccess } from '~/server/lib/agent-instance-access'
import { capabilityProcedure, createTRPCRouter, permissionProcedure } from '../trpc'
import { unwrap } from '../unwrap'

const logger = createScopedLogger('agent-router')

const promptSchema = z.record(z.string(), z.unknown())

/**
 * `agent.update` fields that are AGENT ADMINISTRATION rather than authoring, and
 * therefore sit on the Full rung (plan 25 §4.2: "admin = create, publish,
 * delete, archive, rename, `runAsUserId`, `permissionProfileId`, triggers").
 *
 * `update` is a single fat mutation fed by several surfaces — the persona
 * editor's autosave, the agents list's archive toggle, and the settings panels
 * that bind a run-as user or a permission profile — so the tier can't come from
 * the procedure alone. Presence of ANY of these keys escalates the assert from
 * `assertEditInstance` to `assertAdminInstance`. Everything else (`name`,
 * `slug`, `description`, `prompt`, `modelId`, `mentionable`, `appAccounts`) is
 * authoring and stays on the Edit rung.
 *
 * `runAsUserId` and `permissionProfileId` are the authority-shaped pair: they
 * decide whose capabilities a run resolves against and what the next publish
 * snapshots. `archivedAt` bans the agent's backing `User` (`agent-service.ts`
 * `updateAgent`), which is the soft-delete half of `delete`.
 *
 * Mirrors #1345's `ADMIN_ONLY_UPDATE_FIELDS` in `workflow.ts`, including the
 * `input[field] !== undefined` form — see the note on the escalation itself for
 * why that is safe here.
 */
const ADMIN_ONLY_UPDATE_FIELDS = ['runAsUserId', 'permissionProfileId', 'archivedAt'] as const

/**
 * CRUD for user-authored Kopilot agents. Toolset rows are managed via the
 * sibling `agentToolset.*` router. Archive is driven through `update`
 * (`archivedAt: Date | null`) per plans/kopilot/agents/phase-1-engine-and-api.md
 * §3.2. Reads flow through the org agents cache; writes go through
 * `@auxx/lib/agents` service functions — no raw SQL lives in this router.
 *
 * Per-agent instance access (plan 25 §4.2.DECIDED). `agent` is an
 * `INSTANCE_ACCESS_RESOURCES` key with `baselineAtCreate: false`, so an agent
 * with no explicit `ResourceAccess` row falls back to the member's `agents` area
 * level — Read ⇒ `view`, Edit ⇒ `edit`, Full ⇒ `admin`. `MEMBER_BASELINE_LEVELS`
 * puts members at `agents: Full`, so **restriction is the use case** and nobody
 * regresses.
 *
 * Tiers (plan 25 §4.2, user decision 2026-07-27/28):
 *  - **view** — *usable*: open the detail page, chat in Kopilot, DM, @-mention,
 *    assign work, appear in actor pickers, read version history.
 *  - **edit** — authoring: prompt, drafts, toolsets/bindings, knowledge scope,
 *    procedures, evals; RENAME (name + slug); discard draft edits; label a
 *    version; discard a draft agent that never completed setup. Rename is edit
 *    rather than admin (user decision 2026-07-28) — it is an authoring field,
 *    which is why it is absent from `ADMIN_ONLY_UPDATE_FIELDS`.
 *  - **admin** — create, complete setup, publish, restore a past version,
 *    delete, archive, `runAsUserId`, `permissionProfileId`.
 *  - `create` has no instance to key on, so it gates on the coarse
 *    `agentsManage` rung. `checkSlug` serves both callers and decides in its
 *    body — see its own doc.
 *
 * Base procedure: `permissionProcedure(agentsView)` everywhere the instance
 * assert does the real work — a member composing `agents: None` who holds one
 * explicit instance grant genuinely HOLDS `agentsView`, because
 * `composeUserCapabilities` derives that Read rung from their grants
 * (`deriveInstanceReadKeys`). **Every procedure on this base MUST assert on a
 * specific instance** and must not return org-wide data: the derived key says
 * only "this member has some agent access", never which agent.
 *
 * Every instance assert goes through {@link assertAgentAccess}, never
 * `ctx.capabilities.assert*Instance('agent', input.agentId)` directly:
 * `getById` accepts an id OR a slug (the detail page routes by slug) while
 * grants are keyed on `Agent.id`, so asserting on the raw input would find no
 * row, fall through to the area level, and hand over a restricted agent. It
 * also subsumes the `agentExistsInOrg` existence check these procedures used to
 * run — an unresolvable identifier is a `NotFoundError` BEFORE the capability
 * check, so a foreign-org id is indistinguishable from a restricted one.
 *
 * NOT gated by any of this: **headless agent runs**. Schedules, record events,
 * app triggers, webhooks and evals pass no `invokerUserId`, so a restricted
 * agent still runs. And instance access is the TRANSPOSE of agent policy: this
 * is what USERS may do to the agent, not what the agent may do (plan 25 §4.2).
 */
export const agentRouter = createTRPCRouter({
  // `capabilityProcedure`, NOT `permissionProcedure(agentsView)` — matching
  // `kb.list` / `dataset.list` / `dashboard.list` / `workflow.list`, all four of
  // which resolve the capability set without asserting any coarse key. A coarse
  // assert here would 403 a member composing `agents: None` with no grants
  // instead of handing them an empty list, and the surface that breaks is the
  // permission grid's own Agents row (`use-instance-resource-lists.ts`), where a
  // permissions admin who happens to compose `agents: None` would get a broken
  // row rather than an empty one.
  //
  // The known cost, identical to the one #1345 accepted for `workflow.list`
  // (plan 30 §8 item 3): `capabilityProcedure` skips the `FeatureKey.agents`
  // plan-AND, so an org on a plan without agents can still enumerate agent
  // names. Read-only and low severity, but real and undocumented at the other
  // call sites — recorded here rather than rediscovered.
  list: capabilityProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      // FILTER, never assert — a member restricted from one agent gets a
      // shorter list, not a 403 on the whole page (`kb.list` precedent).
      //
      // `instanceListScope` is three-way because plan 25 §2 gave the view gate
      // two regimes and no single id list expresses both:
      //  - open `agents` area → `exclude`, near-empty in practice (`agent` is
      //    `baselineAtCreate: false`, so the only exclusions are agents someone
      //    deliberately restricted);
      //  - `agents: None` + explicit grants → `include`, naming exactly the
      //    agents shared with this member. Returning everything here would
      //    contradict `getById`, which lets them open only those.
      //  - `none` → nothing is visible; return early WITHOUT the cache read.
      //
      // Unlike `workflow.list` this is unpaginated (`agent-service.ts`
      // `listAgents` returns the whole org cache slice), so filtering the array
      // is exact — there is no `total`/`hasMore` for it to desynchronize.
      const scope = ctx.capabilities.instanceListScope('agent')
      if (scope.kind === 'none') return []

      const agents = await listAgents(ctx.session.organizationId, {
        includeArchived: input?.includeArchived ?? false,
      })

      if (scope.kind === 'include') {
        const allowed = new Set(scope.includeIds)
        return agents.filter((agent) => allowed.has(agent.id))
      }
      if (scope.excludeIds.length === 0) return agents
      const excluded = new Set(scope.excludeIds)
      return agents.filter((agent) => !excluded.has(agent.id))
    }),

  /**
   * Resolve an agent by id or slug. The input field is named `agentId` for
   * backward compatibility with existing callers, but accepts either form —
   * the service helper checks both columns against the org agents cache.
   */
  getById: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // Read — opening an agent (read-only at `view`, editable at `edit`).
      // The assert MUST run on the RESOLVED id: this is the one procedure that
      // is routinely called with a slug, and a slug matches no `ResourceAccess`
      // row. `assertAgentAccess` resolves first and hands the id back.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: input.agentId,
        tier: 'view',
      })
      const detail = await getAgentDetailByIdOrSlug(ctx.session.organizationId, agentId)
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

      // Full — no instance exists yet to key on, so the coarse `agentsManage`
      // rung is the gate. That rung is never derived from instance grants, so a
      // member holding one shared agent cannot mint new ones.

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
  completeSetup: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      // Full — completing setup auto-publishes v1 and turns a draft into a live
      // agent with a backing `User`. Same rung as `publish`, which it performs.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'admin',
      })
      // `completedByUserId` bounds the auto-published v1 policy by this user's own
      // authority (doc 19 §2.4a) — instance `admin` is grantable to non-admins, so
      // a member completing setup must not mint an agent stronger than themselves.
      await completeAgentSetup(agentId, organizationId, undefined, {
        force: true,
        completedByUserId: userId,
      })
    }),

  /**
   * Hard-delete a draft agent (`setupCompletedAt IS NULL`). Powers the
   * agents-list "Discard draft" overflow item. Refuses to touch completed
   * agents — use the archive path for those.
   */
  deleteDraft: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Write — a draft has never been published and has no backing `User`, so
      // discarding it destroys unpublished authoring, not a live agent. That is
      // the Edit rung; `delete` (any state) is the Full one.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'edit',
      })
      const result = await deleteDraftAgent(agentId, organizationId)
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
  delete: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Full — destroying the agent, its synthetic `User` and every version
      // (KB / dataset / dashboard / workflow delete precedent).
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: input.agentId,
        tier: 'admin',
      })
      const result = await deleteAgentService(agentId, ctx.session.organizationId)
      if (!result.deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
    }),

  update: permissionProcedure(PermissionKey.agentsView)
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
      const { agentId: agentIdOrSlug, ...patch } = input

      // Write — authoring the agent (persona, model, toolset bindings).
      // ESCALATES to Full when the payload also carries an administration field
      // (see `ADMIN_ONLY_UPDATE_FIELDS`): run-as delegation, the draft
      // permission-profile binding, and archive/unarchive.
      //
      // The escalation test is `input[field] !== undefined`, not key presence.
      // That is safe ONLY because the payload builder below guards each of the
      // three with the SAME `!== undefined` check, so an explicitly-`undefined`
      // key is dropped before `updateAgent` ever sees it and cannot change
      // anything either. The two must stay in lockstep — if a field ever starts
      // being forwarded on presence alone (`'archivedAt' in patch`, which is
      // exactly how `updateAgent` detects an archive transition), this check has
      // to become key-presence-based too.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: agentIdOrSlug,
        tier: 'edit',
      })
      if (ADMIN_ONLY_UPDATE_FIELDS.some((field) => patch[field] !== undefined)) {
        ctx.capabilities.assertAdminInstance('agent', agentId)
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

  /**
   * Is this slug free? Serves two callers with two different authorities, which
   * is why the gate is inside the body rather than on the procedure.
   *
   * - **Create dialog** (no `excludeAgentId`): there is no instance to key on,
   *   so it answers a question about the org's slug namespace and needs the same
   *   coarse `agentsManage` rung as `create` itself.
   * - **Rename hint** (`excludeAgentId` present — `agent-hero.tsx` polls this
   *   live as you type): this is a question about ONE agent, so it is an
   *   instance `edit` check on that agent. Gating the whole procedure on the
   *   coarse rung instead would take the hint away from every instance-`edit`
   *   holder below coarse Full, while `update` still let them rename — an
   *   affordance that vanishes for no reason the user can see.
   */
  checkSlug: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ slug: agentSlugSchema, excludeAgentId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.excludeAgentId) {
        await assertAgentAccess({
          capabilities: ctx.capabilities,
          organizationId: ctx.session.organizationId,
          idOrSlug: input.excludeAgentId,
          tier: 'edit',
        })
      } else if (!ctx.capabilities.can(PermissionKey.agentsManage)) {
        // `ForbiddenError`, not `TRPCError` — every other permission denial in
        // this router comes from the `CapabilitySet` as an `AuxxError` and is
        // mapped by `auxxErrorMiddleware`. A raw `TRPCError` here would be the
        // one denial with a different cause shape.
        throw new ForbiddenError('You don’t have permission to create agents.')
      }

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
  setToolBindings: permissionProcedure(PermissionKey.agentsView)
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
      // Write — toolset bindings are authoring (plan 25 §4.2's "toolsets").
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'edit',
      })
      await setAgentToolBindings({
        organizationId,
        agentId,
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
  publish: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ agentId: z.string().min(1), label: z.string().max(120).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      // Full — publishing promotes the draft into PRODUCTION and snapshots the
      // resolved permission policy that every subsequent run executes under
      // (plan 25 §4.2: "admin = create, publish, delete"). Note this is the one
      // place where the agent tiers deliberately part company with workflows,
      // where publish is Edit: a published agent acts with authority.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'admin',
      })
      const { version, reductions } = unwrap(
        await publishAgent({
          organizationId,
          agentId,
          editorId: userId,
          label: input.label ?? null,
          // The AUTHOR CLAMP (doc 19 §2.4a): the published policy is
          // `min(profilePolicy, this user's own effective capabilities)`.
          publishedByUserId: userId,
        }),
        'publish agent'
      )
      await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
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
  discardChanges: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Write — throwing away UNPUBLISHED authoring and reloading the active
      // version. Production is untouched, so it never reaches the Full rung.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'edit',
      })
      unwrap(await discardAgentDraft({ organizationId, agentId }), 'discard agent draft')
      await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
      return { ok: true as const }
    }),

  /** Restore-as-draft: load a past version into the draft + mark dirty. */
  restoreVersion: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ agentId: z.string().min(1), toVersionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Full — restoring rewinds the draft to a past version wholesale,
      // including its permission-profile binding, and is the setup half of a
      // publish-to-roll-back. It sits with `publish`, not with `discardChanges`.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'admin',
      })
      unwrap(
        await restoreAgentVersion({
          organizationId,
          agentId,
          toVersionId: input.toVersionId,
        }),
        'restore agent version'
      )
      await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
      return { ok: true as const }
    }),

  /** Rename a published version's label (annotation only). */
  renameVersion: permissionProcedure(PermissionKey.agentsView)
    .input(
      z.object({
        agentId: z.string().min(1),
        versionId: z.string().min(1),
        label: z.string().max(120).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Write — labelling a VERSION is an annotation, not renaming the agent
      // (that is `update` with `name`, which stays on Edit as well). Mirrors
      // `workflow.renameVersion`.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'edit',
      })
      unwrap(
        await renameAgentVersion({
          organizationId,
          agentId,
          versionId: input.versionId,
          label: input.label,
        }),
        'rename agent version'
      )
      return { ok: true as const }
    }),

  /** Published version history (newest first) with editor names. */
  listVersions: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // Read — the history list is visible at `view`; restore is the Full half
      // and rename the Edit half.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        idOrSlug: input.agentId,
        tier: 'view',
      })
      const rows = unwrap(
        await listAgentVersions({
          organizationId: ctx.session.organizationId,
          agentId,
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
