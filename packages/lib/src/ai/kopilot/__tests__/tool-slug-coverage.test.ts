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
  'mail.threads',
  'mail.compose',
  'mail.drafts',
  'entities.search',
  'entities.write',
  'tasks.read',
  'tasks.write',
  'knowledge',
  'kb.read',
  'kb.write',
  'actors',
])

const ALWAYS_ON_TOOLS = new Set<string>(['plan_create', 'plan_update_step'])

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
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: classic regex loop
  while ((m = factoryRe.exec(src)) !== null) {
    const name = m[1]
    if (!name) continue
    // Scan the next ~400 chars (within the same factory) for `toolsetSlug:`.
    const window = src.slice(m.index, m.index + 600)
    const slugMatch = window.match(/\btoolsetSlug:\s*['"]([^'"]+)['"]/)
    out.push({
      file,
      name,
      toolsetSlug: slugMatch ? (slugMatch[1] ?? null) : null,
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
