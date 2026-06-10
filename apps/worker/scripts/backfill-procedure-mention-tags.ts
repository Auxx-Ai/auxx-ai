// apps/worker/scripts/backfill-procedure-mention-tags.ts
/**
 * One-time backfill for the procedure-doc → toolset reconciliation feature.
 *
 * Step 1 (pure jsonb): tag every existing `source:'mention'` toolset/knowledge
 *   row with `mentionedBy:['prompt']` — today all mentions originate from the
 *   agent prompt. Idempotent: only rows missing `mentionedBy` are touched.
 *
 * Step 2 (lib reconcile): for every agent with an enabled attached procedure,
 *   run `reconcileAgentProcedureMentions` to add the `'procedure'` tag from the
 *   procedure docs (draft + active). This also fixes agents whose prompt-only
 *   reconcile previously dropped a procedure-referenced toolset.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/backfill-procedure-mention-tags.ts
 */

import { database, schema } from '@auxx/database'
import { reconcileAgentProcedureMentions } from '@auxx/lib/agents/procedures'
import { eq, sql } from 'drizzle-orm'

async function backfillPromptTags() {
  console.log('Step 1: tagging existing mention rows with ["prompt"]...')

  // jsonb_set per element: add mentionedBy:['prompt'] to mention rows that lack
  // it; leave manual/auto_default rows and already-tagged rows untouched.
  const toolsets = await database.execute(sql`
    UPDATE "Agent"
    SET toolsets = COALESCE((
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'source' = 'mention' AND NOT jsonb_exists(elem, 'mentionedBy')
          THEN elem || '{"mentionedBy":["prompt"]}'::jsonb
          ELSE elem
        END
      )
      FROM jsonb_array_elements(toolsets) AS elem
    ), toolsets)
    WHERE toolsets @> '[{"source":"mention"}]'::jsonb
  `)
  console.log('  toolsets rows updated:', toolsets.rowCount)

  const knowledge = await database.execute(sql`
    UPDATE "Agent"
    SET knowledge = COALESCE((
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'source' = 'mention' AND NOT jsonb_exists(elem, 'mentionedBy')
          THEN elem || '{"mentionedBy":["prompt"]}'::jsonb
          ELSE elem
        END
      )
      FROM jsonb_array_elements(knowledge) AS elem
    ), knowledge)
    WHERE knowledge @> '[{"source":"mention"}]'::jsonb
  `)
  console.log('  knowledge rows updated:', knowledge.rowCount)
}

async function backfillProcedureTags() {
  console.log('Step 2: reconciling the "procedure" tag for agents with enabled procedures...')

  const links = await database
    .selectDistinct({
      organizationId: schema.AgentProcedure.organizationId,
      agentId: schema.AgentProcedure.agentId,
    })
    .from(schema.AgentProcedure)
    .where(eq(schema.AgentProcedure.enabled, true))

  console.log(`  ${links.length} agent(s) with enabled procedures`)
  let ok = 0
  for (const { organizationId, agentId } of links) {
    try {
      await reconcileAgentProcedureMentions(organizationId, agentId)
      ok++
    } catch (err) {
      console.error(`  reconcile failed for agent ${agentId}:`, err)
    }
  }
  console.log(`  reconciled ${ok}/${links.length} agents`)
}

async function main() {
  try {
    await backfillPromptTags()
    await backfillProcedureTags()
    console.log('Backfill complete.')
    process.exit(0)
  } catch (err) {
    console.error('Backfill failed:', err)
    process.exit(1)
  }
}

main()
