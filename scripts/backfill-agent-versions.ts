// scripts/backfill-agent-versions.ts
//
// One-time backfill: publish v1 for every set-up agent that predates agent
// versioning (`setupCompletedAt IS NOT NULL` AND `activeVersionId IS NULL`), so
// production always runs a frozen version. Idempotent — re-running skips agents
// that already have an active version. Pre-setup drafts are untouched (they are
// not production-reachable). See plans/agents/agent-versions/build-plan.md §8.
//
// Self-contained on purpose: it does NOT import `@auxx/lib/agents` (that barrel
// triggers a require(esm) cycle under the script runtime). The v1 snapshot shape
// + `stableHash` below MUST stay byte-identical to `snapshotAgentConfig` /
// `hashAgentConfig` in `packages/lib/src/agents/agent-config-snapshot.ts`, so the
// no-op-republish check matches a freshly-published v1.
//
// Run under the worker runtime (the @auxx/database chain pulls `file-type`):
//   cd apps/worker && node --conditions source --import tsx/esm \
//     ../../scripts/backfill-agent-versions.ts

import { database, schema } from '@auxx/database'
import { stableHash } from '@auxx/utils/hash'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'

async function main(): Promise<void> {
  const agents = await database
    .select({
      id: schema.Agent.id,
      organizationId: schema.Agent.organizationId,
      prompt: schema.Agent.prompt,
      toolsets: schema.Agent.toolsets,
      knowledge: schema.Agent.knowledge,
      appAccounts: schema.Agent.appAccounts,
      toolRestrictions: schema.Agent.toolRestrictions,
      modelId: schema.Agent.modelId,
    })
    .from(schema.Agent)
    .where(and(isNotNull(schema.Agent.setupCompletedAt), isNull(schema.Agent.activeVersionId)))

  console.log(`Found ${agents.length} set-up agent(s) without an active version.`)

  let published = 0
  for (const agent of agents) {
    // Mirror of snapshotAgentConfig — keep field order/defaults in lockstep.
    const snapshot = {
      prompt: agent.prompt ?? {},
      toolsets: agent.toolsets ?? [],
      knowledge: agent.knowledge ?? [],
      appAccounts: agent.appAccounts ?? {},
      toolRestrictions: agent.toolRestrictions ?? {},
      modelId: agent.modelId ?? null,
    }
    const configHash = stableHash(snapshot)

    try {
      await database.transaction(async (tx) => {
        const [version] = await tx
          .insert(schema.AgentVersion)
          .values({
            organizationId: agent.organizationId,
            agentId: agent.id,
            versionNumber: 1,
            label: 'Initial version',
            prompt: snapshot.prompt,
            toolsets: snapshot.toolsets,
            knowledge: snapshot.knowledge,
            appAccounts: snapshot.appAccounts,
            toolRestrictions: snapshot.toolRestrictions,
            modelId: snapshot.modelId,
            configHash,
          })
          .returning({ id: schema.AgentVersion.id })
        if (!version) throw new Error('insert returned no row')

        await tx
          .update(schema.Agent)
          .set({ activeVersionId: version.id, hasUnpublishedChanges: false, updatedAt: new Date() })
          .where(eq(schema.Agent.id, agent.id))
      })
      published++
    } catch (error) {
      console.error(`  ✗ Failed to backfill agent ${agent.id}:`, error)
    }
  }

  console.log(`Done. Published v1 for ${published}/${agents.length} agent(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
