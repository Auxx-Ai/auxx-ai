// apps/worker/scripts/convert-mentionedby-to-mentions.ts
/**
 * One-time conversion for unified mention locks
 * (plans/mcp/v4/tool-first-catalog.md Phase 3).
 *
 * Rewrites every `Agent.toolsets[*]` / `AgentVersion.toolsets[*]` entry that
 * carries the old `mentionedBy: MentionSource[]` tag list into the new
 * `mentions: ToolsetMention[]` shape: `mentionedBy: ['prompt']` →
 * `mentions: [{ target: '*', source: 'prompt' }]`. All pre-existing locks were
 * toolset-granular, so `'*'` is the faithful conversion; tool-target locks
 * only start appearing once the new reconcilers run.
 *
 * `Agent.knowledge` keeps `mentionedBy` (records have no sub-granularity) and
 * is not touched. Idempotent: only entries with a `mentionedBy` key are
 * rewritten; the key is removed after conversion.
 *
 * Run (from repo root) under the worker runtime so the @auxx/lib import chain
 * resolves its native ESM deps:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/convert-mentionedby-to-mentions.ts
 */

import { database } from '@auxx/database'
import { sql } from 'drizzle-orm'

async function convertColumn(table: string): Promise<void> {
  const result = await database.execute(sql`
    UPDATE ${sql.identifier(table)}
    SET toolsets = COALESCE((
      SELECT jsonb_agg(
        CASE
          WHEN jsonb_exists(elem, 'mentionedBy')
          THEN (elem - 'mentionedBy') || jsonb_build_object(
            'mentions',
            (
              SELECT COALESCE(
                jsonb_agg(jsonb_build_object('target', '*', 'source', tag)),
                '[]'::jsonb
              )
              FROM jsonb_array_elements_text(elem->'mentionedBy') AS tag
            )
          )
          ELSE elem
        END
      )
      FROM jsonb_array_elements(toolsets) AS elem
    ), toolsets)
    WHERE toolsets::text LIKE '%mentionedBy%'
  `)
  console.log(`  ${table} rows updated:`, result.rowCount)
}

async function main() {
  try {
    console.log('Converting toolsets mentionedBy → mentions...')
    await convertColumn('Agent')
    await convertColumn('AgentVersion')
    console.log('Conversion complete. (Agent.knowledge keeps mentionedBy by design.)')
    process.exit(0)
  } catch (err) {
    console.error('Conversion failed:', err)
    process.exit(1)
  }
}

main()
