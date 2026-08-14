// packages/lib/src/ai/kopilot/__tests__/tool-slug-coverage.test.ts

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Anti-drift guard: every native tool factory must either set
 * `toolsetSlug: '<known-slug>'` or appear in the `ALWAYS_ON_TOOLS` allowlist.
 *
 * Implemented as a static text scan over the capability directories rather
 * than loading the tool factories. Loading the registry transitively pulls
 * `@auxx/config/urls` (via `search-docs.ts`), which does not resolve under
 * this package's vitest setup. A text scan also catches drift at edit time
 * without needing dependency injection scaffolding.
 */

const KNOWN_SLUGS = new Set<string>([
  'auxx:mail:threads',
  'auxx:mail:compose',
  'auxx:mail:drafts',
  'auxx:entities:search',
  'auxx:entities:write',
  'auxx:comments:read',
  'auxx:comments:write',
  'auxx:tasks:read',
  'auxx:tasks:write',
  'auxx:knowledge',
  'auxx:kb:write',
  'auxx:docs',
  'auxx:actors',
  'workflow.variable',
])

const ALWAYS_ON_TOOLS = new Set<string>([
  'plan_create',
  'plan_update_step',
  // Global chip-rendering tool (page `__global__`), reusable across every
  // Kopilot surface — not gated by an org toolset.
  'suggest_replies',
  // Learned-KB (AI memory) write door — registered only by the flag-gated
  // interactive registry and the headless extraction runner; approval-gated,
  // so not org-toolset-gated.
  'upsert_learned_article',
  // Records-page view tools — mounted by page context (record-view capability),
  // not gated by an org toolset.
  'create_table_view',
  'list_table_views',
  'preview_table_view',
  'set_default_table_view',
  'update_table_view',
  // Workflow-builder graph tools — mounted by page context
  // (`page: 'workflow.builder'`), never by an org toolset. A toolset grant
  // would be meaningless: no user-authored agent can run on the builder page,
  // and gating them on one silently stripped every tool (see the NOTE in
  // `workflow-builder/tools/graph-tool-helpers.ts`).
  'list_node_types',
  'describe_node_type',
  'find_workflow_templates',
  'get_workflow',
  'get_node',
  'add_node',
  'update_node',
  'delete_nodes',
  'connect_nodes',
  'disconnect_nodes',
  'set_trigger',
  'replace_graph',
  'apply_template',
  'validate_workflow',
  'run_node',
])

const CAPABILITIES_DIR = join(__dirname, '..', 'capabilities')

function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      out.push(...walkTsFiles(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

interface ToolDecl {
  file: string
  name: string
  toolsetSlug: string | null
  /** Builder-surface meta-tools configure another agent; they are NOT org-toolset-gated. */
  builderSurface: boolean
}

/**
 * Extract every `{ name: '...', toolsetSlug?: '...' }` literal sitting at the
 * top of a returned object literal. The format is uniform across all tool
 * factory files (see plans/kopilot/agents/phase-1-engine-and-api.md §1.2).
 */
function extractToolDecls(file: string): ToolDecl[] {
  const src = readFileSync(file, 'utf-8')
  const out: ToolDecl[] = []
  // Match the tool factory's literal `return { name: 'tool_name',` — `return {`
  // followed by whitespace then `name:`. This intentionally rejects nested
  // `name:` keys inside JSON Schema property descriptors (e.g. parseStringArg
  // args or zod schemas).
  const factoryRe = /return\s*\{\s*name:\s*['"]([a-z][a-z0-9_]*)['"]\s*,/g
  const matches: Array<{ index: number; name: string }> = []
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: classic regex loop
  while ((m = factoryRe.exec(src)) !== null) {
    if (m[1]) matches.push({ index: m.index, name: m[1] })
  }
  for (const [i, match] of matches.entries()) {
    // Scan from this factory's `return {` up to the NEXT factory in the file
    // (or EOF). A fixed char budget was the old bound, but declaration blocks
    // above `toolsetSlug` / `surfaces` — most recently `permission` (plan 19b
    // G9) — pushed them past it, which silently reclassified a builder tool.
    const end = matches[i + 1]?.index ?? src.length
    const window = src.slice(match.index, end)
    const slugMatch = window.match(/\btoolsetSlug:\s*['"]([^'"]+)['"]/)
    out.push({
      file,
      name: match.name,
      toolsetSlug: slugMatch ? (slugMatch[1] ?? null) : null,
      builderSurface: /surfaces:\s*\[\s*['"]builder['"]\s*\]/.test(window),
    })
  }
  return out
}

describe('tool slug coverage', () => {
  const files = walkTsFiles(CAPABILITIES_DIR).filter((f) => f.includes(`${'/'}tools${'/'}`))
  const decls = files.flatMap(extractToolDecls)

  it('discovered tool factories in every capability directory', () => {
    expect(decls.length).toBeGreaterThan(15)
  })

  it('every native tool carries a known toolsetSlug or is in the always-on allowlist', () => {
    const offenders: string[] = []
    for (const decl of decls) {
      // Builder-surface meta-tools (the agents.builder page capability) configure
      // ANOTHER agent and are mounted by page, not gated by an org toolset — they
      // legitimately carry no `toolsetSlug`.
      if (decl.builderSurface) continue
      if (decl.toolsetSlug === null) {
        if (!ALWAYS_ON_TOOLS.has(decl.name)) {
          offenders.push(`${decl.name} — no toolsetSlug and not in ALWAYS_ON_TOOLS`)
        }
        continue
      }
      if (!KNOWN_SLUGS.has(decl.toolsetSlug)) {
        offenders.push(`${decl.name} — unknown toolsetSlug "${decl.toolsetSlug}"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every name in ALWAYS_ON_TOOLS references a real tool', () => {
    const names = new Set(decls.map((d) => d.name))
    const missing: string[] = []
    for (const name of ALWAYS_ON_TOOLS) {
      if (!names.has(name)) missing.push(name)
    }
    expect(missing).toEqual([])
  })
})
