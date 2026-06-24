// packages/lib/src/cache/providers/agents-provider.ts

import { type AgentConfig, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CompiledProcedure, TriggerExample } from '../../agents/procedures/types'
import type { ConditionGroup } from '../../conditions/types'
import { MediaAssetService } from '../../files'
import { createScopedLogger } from '../../logger'
import type { CachedAgent, CachedAgentProcedure, CachedAgentTrigger } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

const logger = createScopedLogger('agents-provider')

/**
 * Computes all agents for an organization (including archived; consumers filter).
 *
 * Under Option D draft agents have no backing User row — the join is a
 * LEFT JOIN and the presentation fields fall back to `Agent.config`:
 *
 *   - `name`:           `User.name ?? Agent.config.name ?? null`
 *   - `avatarAssetId`:  `User.avatarAssetId ?? Agent.config.avatarAssetId ?? null`
 *     (then resolved to a URL via the standard MediaAsset pipeline).
 *
 * Non-User-owned config keys (`color`, `iconId`) live only on `Agent.config`.
 * See plans/kopilot/agents/dm/option-d-defer-user-plan.md.
 *
 * Trigger rows are loaded in a second query and attached as `agent.triggers`;
 * the DM-derived fields (`dmEnabled`/`dmInstructions`/`dmTriggerId`) are
 * computed from that list. Hot-path consumers (worker dispatchers, jobs)
 * read triggers off the cached agent — see
 * plans/kopilot/agents/cache/plan.md.
 */
export const agentsProvider: CacheProvider<CachedAgent[]> = {
  async compute(orgId, db) {
    const [agents, triggers, procedures] = await Promise.all([
      db
        .select({
          id: schema.Agent.id,
          userId: schema.Agent.userId,
          createdById: schema.Agent.createdById,
          slug: schema.Agent.slug,
          description: schema.Agent.description,
          kind: schema.Agent.kind,
          prompt: schema.Agent.prompt,
          toolsets: schema.Agent.toolsets,
          knowledge: schema.Agent.knowledge,
          appAccounts: schema.Agent.appAccounts,
          toolRestrictions: schema.Agent.toolRestrictions,
          modelId: schema.Agent.modelId,
          mentionable: schema.Agent.mentionable,
          setupCompletedAt: schema.Agent.setupCompletedAt,
          archivedAt: schema.Agent.archivedAt,
          config: schema.Agent.config,
          createdAt: schema.Agent.createdAt,
          updatedAt: schema.Agent.updatedAt,
          userName: schema.User.name,
          userAvatarAssetId: schema.User.avatarAssetId,
          // Active-version view (LEFT join — pre-setup drafts have no active
          // version and must stay listable for the builder UI). When present,
          // these published columns override the row's draft behavior fields.
          activeVersionId: schema.Agent.activeVersionId,
          activeVersionNumber: schema.AgentVersion.versionNumber,
          versionPrompt: schema.AgentVersion.prompt,
          versionToolsets: schema.AgentVersion.toolsets,
          versionKnowledge: schema.AgentVersion.knowledge,
          versionAppAccounts: schema.AgentVersion.appAccounts,
          versionToolRestrictions: schema.AgentVersion.toolRestrictions,
          versionModelId: schema.AgentVersion.modelId,
        })
        .from(schema.Agent)
        .leftJoin(schema.User, eq(schema.User.id, schema.Agent.userId))
        .leftJoin(schema.AgentVersion, eq(schema.AgentVersion.id, schema.Agent.activeVersionId))
        .where(eq(schema.Agent.organizationId, orgId)),
      db
        .select({
          id: schema.AgentTrigger.id,
          agentId: schema.AgentTrigger.agentId,
          kind: schema.AgentTrigger.kind,
          enabled: schema.AgentTrigger.enabled,
          triggerType: schema.AgentTrigger.triggerType,
          entityDefinitionId: schema.AgentTrigger.entityDefinitionId,
          eventType: schema.AgentTrigger.eventType,
          triggerAppId: schema.AgentTrigger.triggerAppId,
          triggerAppTriggerId: schema.AgentTrigger.triggerAppTriggerId,
          triggerInstallationId: schema.AgentTrigger.triggerInstallationId,
          triggerConnectionId: schema.AgentTrigger.triggerConnectionId,
          triggerTopic: schema.AgentTrigger.triggerTopic,
          config: schema.AgentTrigger.config,
          instructions: schema.AgentTrigger.instructions,
        })
        .from(schema.AgentTrigger)
        .where(eq(schema.AgentTrigger.organizationId, orgId)),
      // Procedures projection: each AgentProcedure link → its Procedure → that
      // procedure's ACTIVE published version. The inner join on
      // `Procedure.activeVersionId` carries exactly the active version's
      // `compiled` and DROPS procedures never published (activeVersionId IS NULL
      // → no join row). Phase 4 §4.2.
      //
      // Selection criteria (whenToUse/triggerExamples/ruleset) are read off the
      // ACTIVE VERSION's snapshot, NOT the mutable `Procedure` draft row — so an
      // unpublished draft edit (which only touches the `Procedure` row) cannot
      // leak into the live runtime candidate until publish, even if an unrelated
      // `agents` cache rebuild fires in between. Phase 7 §4. Link overrides remain
      // mutable by design (an editor-only per-agent authoring surface).
      db
        .select({
          linkId: schema.AgentProcedure.id,
          agentId: schema.AgentProcedure.agentId,
          procedureId: schema.Procedure.id,
          enabled: schema.AgentProcedure.enabled,
          priority: schema.AgentProcedure.priority,
          // defaults (active ProcedureVersion snapshot) + overrides (link) — resolved `override ?? default` below
          whenToUseDefault: schema.ProcedureVersion.whenToUse,
          whenToUseOverride: schema.AgentProcedure.whenToUseOverride,
          examplesDefault: schema.ProcedureVersion.triggerExamples,
          examplesOverride: schema.AgentProcedure.triggerExamplesOverride,
          rulesetDefault: schema.ProcedureVersion.ruleset,
          rulesetOverride: schema.AgentProcedure.rulesetOverride,
          activeVersionId: schema.Procedure.activeVersionId,
          compiled: schema.ProcedureVersion.compiled,
        })
        .from(schema.AgentProcedure)
        .innerJoin(schema.Procedure, eq(schema.Procedure.id, schema.AgentProcedure.procedureId))
        .innerJoin(
          schema.ProcedureVersion,
          eq(schema.ProcedureVersion.id, schema.Procedure.activeVersionId)
        )
        .where(eq(schema.AgentProcedure.organizationId, orgId)),
    ])

    const triggersByAgent = new Map<string, CachedAgentTrigger[]>()
    for (const t of triggers) {
      const list = triggersByAgent.get(t.agentId) ?? []
      list.push({
        id: t.id,
        kind: t.kind as CachedAgentTrigger['kind'],
        enabled: t.enabled,
        triggerType: t.triggerType as CachedAgentTrigger['triggerType'],
        entityDefinitionId: t.entityDefinitionId,
        eventType: t.eventType,
        triggerAppId: t.triggerAppId,
        triggerAppTriggerId: t.triggerAppTriggerId,
        triggerInstallationId: t.triggerInstallationId,
        triggerConnectionId: t.triggerConnectionId,
        triggerTopic: t.triggerTopic,
        config: (t.config ?? null) as Record<string, unknown> | null,
        instructions: (t.instructions ?? null) as Record<string, unknown> | null,
      })
      triggersByAgent.set(t.agentId, list)
    }

    const proceduresByAgent = new Map<string, CachedAgentProcedure[]>()
    for (const p of procedures) {
      // The inner join guarantees a non-null active version for every row.
      if (!p.activeVersionId) continue
      const list = proceduresByAgent.get(p.agentId) ?? []
      list.push({
        linkId: p.linkId,
        procedureId: p.procedureId,
        enabled: p.enabled,
        priority: p.priority,
        // Resolve `override ?? default` here so consumers read a single value.
        whenToUse: p.whenToUseOverride ?? p.whenToUseDefault,
        triggerExamples: (p.examplesOverride ?? p.examplesDefault ?? []) as TriggerExample[],
        ruleset: (p.rulesetOverride ?? p.rulesetDefault ?? []) as ConditionGroup[],
        activeVersionId: p.activeVersionId,
        compiled: (p.compiled ?? {}) as unknown as CompiledProcedure,
      })
      proceduresByAgent.set(p.agentId, list)
    }

    return Promise.all(
      agents.map(async (row): Promise<CachedAgent> => {
        const config = (row.config ?? {}) as AgentConfig
        const name = row.userName ?? config.name ?? null
        const avatarAssetId = row.userAvatarAssetId ?? config.avatarAssetId ?? null

        let avatarUrl: string | null = null
        if (avatarAssetId) {
          // MediaAssetService scopes uploads under the owning user; for User-
          // owned assets we use `Agent.userId`. For config-only assets (draft)
          // we currently have no such writer (the v1 builder pool has assetId
          // null), so this branch is effectively unreachable until curated
          // illustrations land. Fall back to `row.userId` when set; otherwise
          // pass the orgId as the owner (the asset is org-scoped).
          const ownerId = row.userId ?? orgId
          const mediaAssetService = new MediaAssetService(orgId, ownerId, db)
          try {
            avatarUrl = await mediaAssetService.getDownloadUrl(avatarAssetId)
          } catch (error) {
            logger.warn(`Failed to fetch avatar URL for agent ${row.id}`, {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        const agentTriggers = triggersByAgent.get(row.id) ?? []
        const dm = agentTriggers.find((t) => t.kind === 'dm')

        // Active-version view: when the agent has an active version, ALL six
        // behavior fields come from that version (including a null `modelId`,
        // which means "inherit" — a per-field `?? row.modelId` would wrongly
        // resurrect the draft's value). Pre-setup drafts fall back to the row.
        const activeVersionId = row.activeVersionId ?? null
        const hasActiveVersion = activeVersionId !== null

        return {
          id: row.id,
          userId: row.userId,
          createdById: row.createdById,
          name,
          slug: row.slug,
          description: row.description ?? null,
          kind: row.kind,
          avatarUrl,
          prompt: ((hasActiveVersion ? row.versionPrompt : row.prompt) ?? {}) as Record<
            string,
            unknown
          >,
          toolsets: ((hasActiveVersion ? row.versionToolsets : row.toolsets) ??
            []) as CachedAgent['toolsets'],
          knowledge: ((hasActiveVersion ? row.versionKnowledge : row.knowledge) ??
            []) as CachedAgent['knowledge'],
          appAccounts: ((hasActiveVersion ? row.versionAppAccounts : row.appAccounts) ??
            {}) as CachedAgent['appAccounts'],
          toolRestrictions: ((hasActiveVersion
            ? row.versionToolRestrictions
            : row.toolRestrictions) ?? {}) as CachedAgent['toolRestrictions'],
          modelId: (hasActiveVersion ? row.versionModelId : row.modelId) ?? null,
          activeVersionId,
          activeVersionNumber: row.activeVersionNumber ?? null,
          mentionable: row.mentionable,
          setupCompletedAt: row.setupCompletedAt ? row.setupCompletedAt.toISOString() : null,
          archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
          triggers: agentTriggers,
          procedures: proceduresByAgent.get(row.id) ?? [],
          dmEnabled: dm?.enabled ?? false,
          dmInstructions: dm?.instructions ?? null,
          dmTriggerId: dm?.id ?? null,
          config: row.config ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }
      })
    )
  },
}
