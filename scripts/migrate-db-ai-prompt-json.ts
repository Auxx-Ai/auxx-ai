// scripts/migrate-db-ai-prompt-json.ts
//
// One-shot migration: convert AI-node `prompt_template[i].text: string` (legacy)
// to `prompt_template[i].json: TiptapDoc` for every workflow stored in the DB.
//
// The original Phase 4 migration (scripts/migrate-workflow-templates-prompt-json.ts)
// only rewrote the on-disk `plans/templates/*.json` files — it never touched the
// `Workflow.graph` rows in Postgres. Pre-existing AI nodes therefore still carry
// the legacy `.text` shape, which makes `valueJson` undefined in the panel editor
// (silent string-mode, no save) and resolves to an empty prompt at runtime.
//
// Idempotent: a template that already has a non-empty `.json` is left untouched.
//
// Run with: pnpm dotenv -- npx tsx scripts/migrate-db-ai-prompt-json.ts

import { closePools, database as db, schema } from '@auxx/database'
import { textToDoc } from '@auxx/lib/tiptap'
import { eq, sql } from 'drizzle-orm'

interface LegacyPromptTemplate {
  role?: string
  text?: string
  json?: unknown
  editorContent?: unknown
}

interface GraphNode {
  data?: { type?: string; prompt_template?: LegacyPromptTemplate[] } & Record<string, unknown>
  [key: string]: unknown
}

interface Graph {
  nodes?: GraphNode[]
  [key: string]: unknown
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set')
    process.exit(1)
  }

  const rows = await db
    .select({ id: schema.Workflow.id, name: schema.Workflow.name, graph: schema.Workflow.graph })
    .from(schema.Workflow)
    .where(sql`jsonb_typeof(${schema.Workflow.graph}) = 'object'`)

  let workflowsChanged = 0
  let templatesConverted = 0

  for (const row of rows) {
    const graph = row.graph as Graph | null
    const nodes = graph?.nodes
    if (!Array.isArray(nodes)) continue

    let changed = false

    for (const node of nodes) {
      if (node.data?.type !== 'ai') continue
      const pts = node.data.prompt_template
      if (!Array.isArray(pts)) continue

      node.data.prompt_template = pts.map((pt) => {
        // Already migrated — preserve byte-for-byte.
        if (pt && typeof pt === 'object' && 'json' in pt && pt.json) return pt
        const text = typeof pt?.text === 'string' ? pt.text : ''
        templatesConverted += 1
        changed = true
        return { role: pt?.role, json: textToDoc(text, { parseVariables: true }) }
      })
    }

    if (changed) {
      await db
        .update(schema.Workflow)
        .set({ graph: graph as Graph })
        .where(eq(schema.Workflow.id, row.id))
      workflowsChanged += 1
      console.log(`  updated: ${row.name} (${row.id})`)
    }
  }

  console.log('')
  console.log(
    `Done — ${workflowsChanged}/${rows.length} workflows changed, ${templatesConverted} templates rewritten.`
  )

  await closePools()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
