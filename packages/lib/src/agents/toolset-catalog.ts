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
  shortLabel: string
  group: 'native' | 'app'
  parentGroup: string
  /** EntityIcon id (e.g. `'mail'`, `'send'`). */
  iconId: string
  /** EntityIcon color id (e.g. `'blue'`, `'green'`). */
  color: string
  appId?: string
  isDefault: boolean
  tools: ToolCatalogEntry[]
}

export interface ToolsetGroupCatalog {
  name: string
  iconId: string
  color: string
}

/**
 * Display metadata for parent groups — group header icon + color. App groups
 * (Phase 3) provide their own metadata via the app catalog.
 */
export const NATIVE_GROUP_CATALOG: Record<string, ToolsetGroupCatalog> = {
  Mail: { name: 'Mail', iconId: 'mail', color: 'blue' },
  Tasks: { name: 'Tasks', iconId: 'check-circle', color: 'green' },
  Entities: { name: 'Entities', iconId: 'boxes', color: 'purple' },
  Comments: { name: 'Comments', iconId: 'message-square', color: 'teal' },
  Knowledge: { name: 'Knowledge', iconId: 'book-open', color: 'orange' },
  Docs: { name: 'Docs', iconId: 'help-circle', color: 'gray' },
  Members: { name: 'Members', iconId: 'users', color: 'pink' },
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
  'comments.read': 'Comments — Read',
  'comments.write': 'Comments — Write',
  knowledge: 'Knowledge — Read',
  'kb.write': 'Knowledge — Write',
  'tasks.read': 'Tasks — Search',
  'tasks.write': 'Tasks — Write',
  docs: 'Docs — Search',
  actors: 'Members & actors',
}

/**
 * Parent group display names for native toolset slugs. Unknown slugs fall
 * back to `'Other'` (rendered in a trailing group at the bottom of the tab).
 * App toolsets use `app.displayName` as their parent group instead.
 */
export const NATIVE_TOOLSET_PARENT_GROUPS: Record<string, string> = {
  'mail.threads': 'Mail',
  'mail.compose': 'Mail',
  'mail.drafts': 'Mail',
  'entities.search': 'Entities',
  'entities.write': 'Entities',
  'comments.read': 'Comments',
  'comments.write': 'Comments',
  knowledge: 'Knowledge',
  'kb.write': 'Knowledge',
  'tasks.read': 'Tasks',
  'tasks.write': 'Tasks',
  docs: 'Docs',
  actors: 'Members',
}

/**
 * Short labels used inside a parent group — strip the redundant prefix that
 * the group header already provides.
 */
export const NATIVE_TOOLSET_SHORT_LABELS: Record<string, string> = {
  'mail.threads': 'Threads',
  'mail.compose': 'Compose',
  'mail.drafts': 'Drafts',
  'entities.search': 'Search',
  'entities.write': 'Write',
  'comments.read': 'Read',
  'comments.write': 'Write',
  knowledge: 'Read',
  'kb.write': 'Write',
  'tasks.read': 'Search',
  'tasks.write': 'Write',
  docs: 'Search',
  actors: 'Members & actors',
}

/**
 * EntityIcon `iconId` per native toolset slug. Falls back to a generic
 * `'wrench'` for unknown slugs (e.g. future app toolsets that haven't
 * supplied their own icon).
 */
export const NATIVE_TOOLSET_ICONS: Record<string, string> = {
  'mail.threads': 'mails',
  'mail.compose': 'send',
  'mail.drafts': 'file-text',
  'entities.search': 'search',
  'entities.write': 'edit',
  'comments.read': 'search',
  'comments.write': 'message-square',
  knowledge: 'book-open',
  'kb.write': 'edit',
  'tasks.read': 'search',
  'tasks.write': 'check-circle',
  docs: 'help-circle',
  actors: 'users',
}

/**
 * EntityIcon color per native toolset slug — picked to match the parent
 * group's color so a group reads as one visual cluster.
 */
export const NATIVE_TOOLSET_COLORS: Record<string, string> = {
  'mail.threads': 'blue',
  'mail.compose': 'blue',
  'mail.drafts': 'blue',
  'entities.search': 'purple',
  'entities.write': 'purple',
  'comments.read': 'teal',
  'comments.write': 'teal',
  knowledge: 'orange',
  'kb.write': 'orange',
  'tasks.read': 'green',
  'tasks.write': 'green',
  docs: 'gray',
  actors: 'pink',
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
    const label = NATIVE_TOOLSET_LABELS[slug] ?? slug
    entries.push({
      slug,
      label,
      shortLabel: NATIVE_TOOLSET_SHORT_LABELS[slug] ?? label,
      group: 'native',
      parentGroup: NATIVE_TOOLSET_PARENT_GROUPS[slug] ?? 'Other',
      iconId: NATIVE_TOOLSET_ICONS[slug] ?? 'wrench',
      color: NATIVE_TOOLSET_COLORS[slug] ?? 'gray',
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
