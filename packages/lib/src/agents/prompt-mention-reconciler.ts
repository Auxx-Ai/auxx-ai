// packages/lib/src/agents/prompt-mention-reconciler.ts

import type { KnowledgeEntry, ToolsetEntry } from '@auxx/database'
import type { FlatToolCatalogEntry } from './toolset-catalog'

export type { KnowledgeEntry, ToolsetEntry }
export type ToolsetSource = ToolsetEntry['source']
export type KnowledgeMode = KnowledgeEntry['mode']
export type KnowledgeSource = KnowledgeEntry['source']

export interface ReconcileMentionsInput {
  prompt: Record<string, unknown>
  current: { toolsets: ToolsetEntry[]; knowledge: KnowledgeEntry[] }
  toolCatalog: FlatToolCatalogEntry[]
}

export interface ReconcileMentionsOutput {
  toolsets: ToolsetEntry[]
  knowledge: KnowledgeEntry[]
}

interface WalkedPrompt {
  /** Toolset slugs referenced by `tool:<name>` chips, mapped via the catalog. */
  toolsetSlugs: Set<string>
  /** RecordIds referenced by record chips (`article:<id>`, `entity:<id>`, …). */
  recordIds: Set<string>
}

/**
 * Tiptap inline `reference` node prefixes that point at records (not at
 * tools/people/etc.). Anything matching one of these prefixes gets reconciled
 * into `Agent.knowledge`. Tool chips use the `tool:` prefix and reconcile into
 * `Agent.toolsets` instead.
 *
 * Kept conservative on purpose — unknown prefixes are ignored so that adding a
 * new reference kind never inadvertently writes a knowledge row.
 */
const RECORD_PREFIXES = new Set<string>(['article', 'kb', 'ticket', 'dataset', 'meeting', 'entity'])

/**
 * Walk a Tiptap prompt doc, returning the set of mentioned toolset slugs (via
 * `tool:<name>` chips resolved against `toolCatalog`) and the set of record
 * RecordIds (via `article:<id>` / `entity:<id>` / etc. chips).
 *
 * Unknown chips are silently dropped. Pure function — does not mutate input.
 */
export function walkPromptDoc(
  prompt: Record<string, unknown>,
  toolCatalog: FlatToolCatalogEntry[]
): WalkedPrompt {
  const toolsetSlugs = new Set<string>()
  const recordIds = new Set<string>()

  const toolToToolset = new Map<string, string>()
  for (const entry of toolCatalog) toolToToolset.set(entry.name, entry.toolsetSlug)

  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; attrs?: { id?: unknown }; content?: unknown[] }
    if (n.type === 'reference' && typeof n.attrs?.id === 'string') {
      const id = n.attrs.id
      const colon = id.indexOf(':')
      if (colon > 0) {
        const prefix = id.slice(0, colon)
        const rest = id.slice(colon + 1)
        if (prefix === 'tool') {
          const slug = toolToToolset.get(rest)
          if (slug) toolsetSlugs.add(slug)
        } else if (prefix === 'toolset') {
          if (rest.length > 0) toolsetSlugs.add(rest)
        } else if (RECORD_PREFIXES.has(prefix) && rest.length > 0) {
          recordIds.add(id)
        }
      }
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) visit(child)
    }
  }

  visit(prompt)
  return { toolsetSlugs, recordIds }
}

/**
 * Reconcile `Agent.toolsets` against the set of mentioned toolset slugs.
 *
 * - Stale `mention` rows (slug no longer mentioned) are dropped.
 * - When a slug is mentioned, the row is promoted to `source: 'mention'` and
 *   `enabled: true`, regardless of whether a prior manual / auto_default row
 *   existed (including one left at `enabled: false` from a previous trash).
 *   This makes "mentioned in prompt = locked" hold unconditionally.
 * - New mention rows are inserted when no row covers the slug.
 */
export function reconcileToolsets(
  current: ToolsetEntry[],
  mentionedSlugs: Set<string>
): ToolsetEntry[] {
  const kept = current
    .filter((t) => t.source !== 'mention' || mentionedSlugs.has(t.slug))
    .map((t) =>
      mentionedSlugs.has(t.slug) ? { ...t, source: 'mention' as const, enabled: true } : t
    )
  const known = new Set(kept.map((t) => t.slug))
  const added: ToolsetEntry[] = []
  for (const slug of mentionedSlugs) {
    if (known.has(slug)) continue
    added.push({ slug, config: {}, enabled: true, source: 'mention' })
  }
  return [...kept, ...added]
}

/**
 * Reconcile `Agent.knowledge` against the set of mentioned recordIds.
 *
 * - Existing `mention` entries are dropped — the walked set is authoritative.
 * - Manual `exclude` entries that collide with a mention are dropped (mention
 *   wins, per locked-from-prompt §3.3).
 * - Surviving manual entries suppress the duplicate mention insert.
 * - New mention entries land with `mode='include_one'`, `source='mention'`.
 */
export function reconcileKnowledge(
  current: KnowledgeEntry[],
  mentionedRecordIds: Set<string>
): KnowledgeEntry[] {
  const manualOrDefault = current.filter((k) => k.source !== 'mention')
  const mentionEntries: KnowledgeEntry[] = [...mentionedRecordIds].map((recordId) => ({
    recordId,
    mode: 'include_one',
    source: 'mention',
  }))
  const mentionKeys = new Set(mentionEntries.map((m) => m.recordId))
  const survivors = manualOrDefault.filter(
    (k) => !(k.mode === 'exclude' && mentionKeys.has(k.recordId))
  )
  const survivorKeys = new Set(survivors.map((k) => k.recordId))
  const newMentionEntries = mentionEntries.filter((m) => !survivorKeys.has(m.recordId))
  return [...survivors, ...newMentionEntries]
}

/**
 * Reconcile both toolsets and knowledge against a prompt doc. Returns the next
 * state for the agent row; caller writes one UPDATE.
 */
export function reconcilePromptMentions(input: ReconcileMentionsInput): ReconcileMentionsOutput {
  const walk = walkPromptDoc(input.prompt, input.toolCatalog)
  return {
    toolsets: reconcileToolsets(input.current.toolsets, walk.toolsetSlugs),
    knowledge: reconcileKnowledge(input.current.knowledge, walk.recordIds),
  }
}
