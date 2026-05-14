// packages/lib/src/agents/toolset-catalog.ts

import type { AgentToolDefinition } from '../ai/agent-framework/types'
import type { GetToolDeps, PageCapability } from '../ai/kopilot/capabilities'
import {
  createActorCapabilities,
  createEntityCapabilities,
  createKbCapabilities,
  createKbReadCapabilities,
  createKnowledgeCapabilities,
  createMailCapabilities,
  createTaskCapabilities,
} from '../ai/kopilot/capabilities'
import { NATIVE_DEFAULT_TOOLSETS } from './default-toolsets'

/**
 * Catalog entry describing a toolset and the tools it exposes. Read by the
 * admin Tools tab to render the per-agent toolset selector. Catalog-only —
 * per-agent enabled state lives on `agent.getById.toolsets`.
 */
export interface ToolCatalogEntry {
  name: string
  description: string
}

export interface ToolsetCatalogEntry {
  slug: string
  label: string
  group: 'native' | 'app'
  appId?: string
  isDefault: boolean
  tools: ToolCatalogEntry[]
}

/**
 * Human-readable labels for native toolset slugs. Unknown slugs fall back to
 * the slug itself — matches phase-1-ui-tabs.md §1.1.
 */
export const NATIVE_TOOLSET_LABELS: Record<string, string> = {
  'mail.threads': 'Mail — Threads',
  'mail.compose': 'Mail — Compose',
  'mail.drafts': 'Mail — Drafts',
  'entities.search': 'Entities — Search',
  'entities.write': 'Entities — Write',
  knowledge: 'Knowledge search',
  'kb.read': 'Knowledge base — Read',
  'kb.write': 'Knowledge base — Write',
  'tasks.read': 'Tasks — Read',
  'tasks.write': 'Tasks — Write',
  actors: 'Members & actors',
}

const DEFAULT_SLUGS = new Set<string>(NATIVE_DEFAULT_TOOLSETS)

/**
 * Stub `getDeps` for catalog enumeration. Tool factories capture `getDeps` in
 * a closure for `execute`-time use only — constructing the tool definition
 * (name, description, toolsetSlug) never invokes the factory.
 */
const catalogGetDeps: GetToolDeps = () => {
  throw new Error('toolset-catalog: getDeps is for metadata enumeration only')
}

function collectNativeCapabilities(): PageCapability[] {
  return [
    createMailCapabilities(catalogGetDeps),
    createEntityCapabilities(catalogGetDeps),
    createKnowledgeCapabilities(catalogGetDeps),
    createActorCapabilities(catalogGetDeps),
    createTaskCapabilities(catalogGetDeps),
    createKbCapabilities(catalogGetDeps),
    createKbReadCapabilities(catalogGetDeps),
  ]
}

/**
 * Walk every registered native capability, group tools by `toolsetSlug`, and
 * return one `ToolsetCatalogEntry` per slug. Tools without a `toolsetSlug`
 * (plan tools) are excluded — they're always-on per README §6.5.
 *
 * v1 returns only `group='native'`. The `app` group slot is reserved for the
 * apps track and stays empty until that catalog provider lands.
 */
export async function getOrgToolsetCatalog(
  _organizationId: string
): Promise<ToolsetCatalogEntry[]> {
  const bySlug = new Map<string, { tools: Map<string, ToolCatalogEntry> }>()

  for (const capability of collectNativeCapabilities()) {
    for (const tool of capability.tools as AgentToolDefinition[]) {
      const slug = tool.toolsetSlug
      if (!slug) continue
      let bucket = bySlug.get(slug)
      if (!bucket) {
        bucket = { tools: new Map() }
        bySlug.set(slug, bucket)
      }
      // Dedupe by tool name — a tool registered against more than one page
      // (rare, but possible) should still appear once per slug.
      if (!bucket.tools.has(tool.name)) {
        bucket.tools.set(tool.name, {
          name: tool.name,
          description: shortDescription(tool.description),
        })
      }
    }
  }

  const entries: ToolsetCatalogEntry[] = []
  for (const [slug, { tools }] of bySlug) {
    entries.push({
      slug,
      label: NATIVE_TOOLSET_LABELS[slug] ?? slug,
      group: 'native',
      isDefault: DEFAULT_SLUGS.has(slug),
      tools: [...tools.values()].sort((a, b) => a.name.localeCompare(b.name)),
    })
  }

  entries.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.label.localeCompare(b.label)
  })

  return entries
}

/**
 * Tool descriptions in the registry are LLM-facing and can run several
 * paragraphs. The Tools tab tooltip only needs a one-liner — take the first
 * sentence (up to 200 chars).
 */
function shortDescription(description: string): string {
  const trimmed = description.trim()
  const sentenceEnd = trimmed.search(/[.!?]\s/)
  const candidate = sentenceEnd > 0 ? trimmed.slice(0, sentenceEnd + 1) : trimmed
  return candidate.length > 200 ? `${candidate.slice(0, 197)}…` : candidate
}
