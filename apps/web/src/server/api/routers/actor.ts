// apps/web/src/server/api/routers/actor.ts

import { ActorService, GroupMemberService } from '@auxx/lib/actors'
import type { CapabilitySet } from '@auxx/lib/permissions/capabilities/capability-set'
import type { Actor, ActorContext, ActorId } from '@auxx/types/actor'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * Helper to create ActorContext from tRPC context
 */
function toActorContext(ctx: {
  db: any
  session: { organizationId: string; userId: string }
}): ActorContext {
  return {
    db: ctx.db,
    organizationId: ctx.session.organizationId,
    userId: ctx.session.userId,
  }
}

/**
 * Predicate over one agent id: may this member see it in a picker?
 *
 * Plan 25 §4.2 decision 1 — `view` means **usable** (chat, DM, @-mention,
 * assign). An actor picker that offers an agent the caller cannot use is a
 * broken affordance, and this router is the endpoint that fills those pickers,
 * so it has to agree with `assertViewInstance('agent', id)`.
 *
 * All three `instanceListScope` arms are handled: `'none'` (the area is shut and
 * the member holds no ≥`view` grant) hides every agent; `'include'` is the
 * `agents: None` + explicit-grants regime, where the allow-list is exactly what
 * they may see; `'exclude'` is the ordinary open-area regime, where the
 * deny-list is only the explicitly-restricted agents (`agent` is
 * `baselineAtCreate: false`, so restriction is the rare case and the list is
 * usually empty).
 */
function agentVisibility(capabilities: CapabilitySet): (agentId: string) => boolean {
  const scope = capabilities.instanceListScope('agent')
  if (scope.kind === 'none') return () => false
  if (scope.kind === 'include') {
    const allowed = new Set(scope.includeIds)
    return (agentId) => allowed.has(agentId)
  }
  const denied = new Set(scope.excludeIds)
  return (agentId) => !denied.has(agentId)
}

/**
 * Drop agents the caller may not view, leaving every other actor kind alone.
 *
 * **Filter, never assert.** These procedures also serve users, groups, workers
 * and permission profiles, so a coarse `agentsView` gate would 403 the whole
 * picker for a member who simply has no agents — the same mistake plan 30 §2.2
 * calls out for `workflow.list`.
 *
 * Keyed on `AgentActor.agentId`, not on the map key, because
 * `ActorService.getByIds` also stamps an AgentActor under the legacy
 * `user:<syntheticUserId>` spelling; matching on the VALUE covers both.
 */
function filterVisibleActors(actors: Actor[], capabilities: CapabilitySet): Actor[] {
  const canSee = agentVisibility(capabilities)
  return actors.filter((actor) => actor.type !== 'agent' || canSee(actor.agentId))
}

/**
 * TRPC router for actor operations.
 *
 * Actors are unified references to users or groups.
 * ActorId format: "user:abc123" or "group:xyz789"
 */
export const actorRouter = createTRPCRouter({
  // ═══════════════════════════════════════════════════════════════════════════
  // LISTING & QUERYING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List all available actors for the organization.
   * Used for preloading on page load.
   *
   * Unpaginated — it returns the whole org — so the agent filter has nothing to
   * run "before". `capabilityProcedure` (not `permissionProcedure`) because
   * nothing here is asserted: see {@link filterVisibleActors}.
   */
  list: capabilityProcedure
    .input(
      z
        .object({
          target: z.enum(['user', 'group', 'agent', 'worker', 'both', 'all']).optional(),
          roles: z.array(z.enum(['OWNER', 'ADMIN', 'USER'])).optional(),
          groupIds: z.array(z.string()).optional(),
          includeAgents: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const service = new ActorService(toActorContext(ctx))
      return filterVisibleActors(await service.listActors(input ?? {}), ctx.capabilities)
    }),

  /**
   * Get multiple actors by ActorId.
   * Used for batch hydration of ACTOR field values.
   *
   * Filtered too, and not only for tidiness: the ids arrive verbatim from the
   * client, so an unfiltered hydration hands back the name, avatar, slug and
   * synthetic user id of any agent in the org for the asking. A restricted
   * agent resolves to nothing here, exactly as if the row were dangling — which
   * is how every other unresolvable id already renders.
   */
  getByIds: capabilityProcedure
    .input(
      z.object({
        ids: z.array(z.string()),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new ActorService(toActorContext(ctx))
      const result = await service.getByIds(input.ids as ActorId[])

      const canSee = agentVisibility(ctx.capabilities)
      // Convert Map to object for JSON serialization
      return Object.fromEntries(
        [...result].filter(([, actor]) => actor.type !== 'agent' || canSee(actor.agentId))
      )
    }),

  /**
   * Search actors by name/email.
   * Used for typeahead in ACTOR field selectors.
   *
   * `limit` is a typeahead cap, not pagination — there is no offset, cursor,
   * `total` or `hasMore` — so filtering the result cannot produce the lying
   * `hasMore` / empty-page pathology that post-pagination filtering caused in
   * `dataset.list` (#1345). It can only make a capped page shorter, for the rare
   * member who is restricted from an agent that also matched their query.
   */
  search: capabilityProcedure
    .input(
      z.object({
        query: z.string().min(1),
        target: z.enum(['user', 'group', 'agent', 'worker', 'both', 'all']).optional(),
        roles: z.array(z.enum(['OWNER', 'ADMIN', 'USER'])).optional(),
        groupIds: z.array(z.string()).optional(),
        includeAgents: z.boolean().optional(),
        limit: z.number().min(1).max(50).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new ActorService(toActorContext(ctx))
      return filterVisibleActors(await service.searchActors(input), ctx.capabilities)
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP MEMBER OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get members of a specific group.
   */
  getGroupMembers: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new GroupMemberService(toActorContext(ctx))
      return service.getMembers(input.groupId)
    }),

  /**
   * Expand actors to user IDs (groups → their user members).
   * Useful for notifications, mentions, etc.
   */
  /**
   * Expand actor ids to the underlying user ids.
   *
   * `includeAgents` resolves `agent:<id>` to the agent's backing `User.id`, so
   * the same visibility filter as the read procedures applies: an agent the
   * caller cannot view is dropped from the input rather than resolved. Weakest
   * of the four agent-touching procedures here — it only echoes back ids the
   * caller already supplied — but leaving one unfiltered path in a router the
   * rest of which filters is how the next audit loses an hour.
   *
   * Filter, never assert: a caller expanding a list of USER ids must not 403
   * because they happen to have no agent access.
   */
  expandToUsers: capabilityProcedure
    .input(
      z.object({
        actorIds: z.array(z.string()),
        includeAgents: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const includeAgents = input.includeAgents ?? false
      const service = new GroupMemberService(toActorContext(ctx))
      return service.expandToUsers(input.actorIds as ActorId[], {
        includeAgents,
        // Filtering the INPUT here would be a phantom control: an agent reaches
        // the output through three doors — `agent:<id>`, the legacy
        // `user:<backingUserId>` spelling, and group membership — and only the
        // first is visible in the input array. The predicate goes to the service,
        // which is where all three converge on one `agentById` lookup.
        canSeeAgent: includeAgents ? agentVisibility(ctx.capabilities) : undefined,
      })
    }),
})
