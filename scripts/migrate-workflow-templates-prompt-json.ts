// scripts/migrate-workflow-templates-prompt-json.ts

/**
 * Phase 4 — one-shot migration of `plans/templates/*.json` AI nodes from
 * the legacy `prompt_template[i].text: string` shape to the new
 * `prompt_template[i].json: TiptapDoc` shape.
 *
 * Run with:
 *   npx dotenv -- npx tsx scripts/migrate-workflow-templates-prompt-json.ts
 *
 * Non-AI nodes are left byte-identical; only AI nodes whose
 * `prompt_template[i]` still carry `.text` get rewritten. Idempotent: a
 * second run is a no-op.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { textToDoc } from '@auxx/lib/tiptap'

const TEMPLATES_DIR = join(process.cwd(), 'plans', 'templates')

interface PromptTemplateEntryLegacy {
  role: string
  text?: string
  json?: unknown
  editorContent?: unknown
}

interface NodeData {
  type?: string
  prompt_template?: PromptTemplateEntryLegacy[]
  [key: string]: unknown
}

interface GraphNode {
  data?: NodeData
  [key: string]: unknown
}

interface Template {
  graph?: { nodes?: GraphNode[] }
  [key: string]: unknown
}

async function migrateOne(path: string): Promise<{ changed: boolean; templatesUpdated: number }> {
  const raw = await readFile(path, 'utf8')
  let parsed: Template
  try {
    parsed = JSON.parse(raw) as Template
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`)
  }

  const nodes = parsed.graph?.nodes ?? []
  let templatesUpdated = 0
  let changed = false

  for (const node of nodes) {
    if (node.data?.type !== 'ai') continue
    const pts = node.data.prompt_template
    if (!Array.isArray(pts)) continue
    const next = pts.map((pt) => {
      if (pt && typeof pt === 'object' && 'json' in pt && pt.json) {
        // Already migrated — preserve byte-for-byte.
        return pt
      }
      const text = typeof pt?.text === 'string' ? pt.text : ''
      templatesUpdated += 1
      changed = true
      return {
        role: pt?.role,
        json: textToDoc(text, { parseVariables: true }),
      }
    })
    node.data.prompt_template = next
  }

  if (changed) {
    // Match the input formatting style (2-space indent + trailing newline).
    const out = `${JSON.stringify(parsed, null, 2)}\n`
    await writeFile(path, out, 'utf8')
  }

  return { changed, templatesUpdated }
}

async function main() {
  const entries = await readdir(TEMPLATES_DIR)
  const files = entries.filter((f) => f.endsWith('.json')).sort()

  let totalFiles = 0
  let totalChanged = 0
  let totalTemplates = 0

  for (const file of files) {
    const path = join(TEMPLATES_DIR, file)
    try {
      const { changed, templatesUpdated } = await migrateOne(path)
      totalFiles += 1
      if (changed) totalChanged += 1
      totalTemplates += templatesUpdated
      const status = changed ? `updated (${templatesUpdated} templates)` : 'unchanged'
      console.log(`  ${file}: ${status}`)
    } catch (err) {
      console.error(`  ${file}: FAILED — ${(err as Error).message}`)
      process.exitCode = 1
    }
  }

  console.log('')
  console.log(
    `Done — ${totalChanged}/${totalFiles} files changed, ${totalTemplates} templates rewritten.`
  )
}

void main()
