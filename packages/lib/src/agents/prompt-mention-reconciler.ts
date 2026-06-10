// packages/lib/src/agents/prompt-mention-reconciler.ts

import type { KnowledgeEntry, MentionSource, ToolsetEntry } from '@auxx/database'
import type { FlatToolCatalogEntry } from './toolset-catalog'

export type { KnowledgeEntry, MentionSource, ToolsetEntry }
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
 * Walk several Tiptap docs and return the union of their mentioned toolset slugs
 * and record ids. Used by the procedure side, where an agent's enabled attached
 * procedures contribute many docs (each procedure's draft + active version) that
 * collectively lock toolsets/knowledge. Pure.
 */
export function walkPromptDocs(
  docs: Record<string, unknown>[],
  toolCatalog: FlatToolCatalogEntry[]
): WalkedPrompt {
  const toolsetSlugs = new Set<string>()
  const recordIds = new Set<string>()
  for (const doc of docs) {
    const walk = walkPromptDoc(doc, toolCatalog)
    for (const slug of walk.toolsetSlugs) toolsetSlugs.add(slug)
    for (const id of walk.recordIds) recordIds.add(id)
  }
  return { toolsetSlugs, recordIds }
}

/** De-dupe + drop a tag from a `mentionedBy` set; returns a fresh minimal array. */
function withTag(mentionedBy: MentionSource[] | undefined, tag: MentionSource): MentionSource[] {
  return mentionedBy?.includes(tag) ? mentionedBy : [...(mentionedBy ?? []), tag]
}
function withoutTag(mentionedBy: MentionSource[] | undefined, tag: MentionSource): MentionSource[] {
  return (mentionedBy ?? []).filter((t) => t !== tag)
}

/**
 * Reconcile `Agent.toolsets` against the slugs mentioned by a **single input**
 * (`tag` = `'prompt'` or `'procedure'`). Touches only that tag's provenance and
 * leaves the other input's lock intact, so the two sources reconcile
 * independently — the prompt-autosave path can never drop a procedure-locked
 * toolset and vice-versa.
 *
 * - A mentioned slug ensures `tag ∈ mentionedBy`, promotes any manual/auto_default
 *   row to `source:'mention'`, and forces `enabled:true` (mentioned = locked).
 * - An un-mentioned `mention` row loses `tag`; it drops only when `mentionedBy`
 *   empties (the other tag may still hold it). Manual/auto_default rows are
 *   never touched when not mentioned.
 * - New mention rows are inserted for any slug not already covered.
 */
export function reconcileToolsetMentions(
  current: ToolsetEntry[],
  mentionedSlugs: Set<string>,
  tag: MentionSource
): ToolsetEntry[] {
  const next = current.map((t): ToolsetEntry => {
    const mentioned = mentionedSlugs.has(t.slug)
    if (t.source === 'mention') {
      return mentioned
        ? { ...t, enabled: true, mentionedBy: withTag(t.mentionedBy, tag) }
        : { ...t, mentionedBy: withoutTag(t.mentionedBy, tag) }
    }
    // manual / auto_default — promote to a mention lock while mentioned, else leave.
    return mentioned ? { ...t, source: 'mention', enabled: true, mentionedBy: [tag] } : t
  })
  const kept = next.filter((t) => t.source !== 'mention' || (t.mentionedBy?.length ?? 0) > 0)
  const known = new Set(kept.map((t) => t.slug))
  const added: ToolsetEntry[] = []
  for (const slug of mentionedSlugs) {
    if (known.has(slug)) continue
    added.push({ slug, config: {}, enabled: true, source: 'mention', mentionedBy: [tag] })
  }
  return [...kept, ...added]
}

/**
 * Reconcile `Agent.knowledge` against the recordIds mentioned by a **single
 * input** (`tag`). Symmetric to {@link reconcileToolsetMentions}: per-tag, the
 * other source's lock survives.
 *
 * - A mentioned `mention` row keeps/gains `tag`; an un-mentioned one loses `tag`
 *   and drops when `mentionedBy` empties.
 * - A manual `exclude` colliding with a mention is dropped (mention wins). Other
 *   manual entries survive and suppress the duplicate mention insert.
 * - New mention entries land with `mode='include_one'`, `source='mention'`.
 */
export function reconcileKnowledgeMentions(
  current: KnowledgeEntry[],
  mentionedRecordIds: Set<string>,
  tag: MentionSource
): KnowledgeEntry[] {
  const kept: KnowledgeEntry[] = []
  for (const k of current) {
    const mentioned = mentionedRecordIds.has(k.recordId)
    if (k.source === 'mention') {
      const mentionedBy = mentioned ? withTag(k.mentionedBy, tag) : withoutTag(k.mentionedBy, tag)
      if (mentionedBy.length > 0) kept.push({ ...k, mentionedBy })
      continue
    }
    // manual: an exclude colliding with a mention is dropped (mention wins).
    if (mentioned && k.mode === 'exclude') continue
    kept.push(k)
  }
  const known = new Set(kept.map((k) => k.recordId))
  const added: KnowledgeEntry[] = []
  for (const recordId of mentionedRecordIds) {
    if (known.has(recordId)) continue
    added.push({ recordId, mode: 'include_one', source: 'mention', mentionedBy: [tag] })
  }
  return [...kept, ...added]
}

/**
 * Reconcile both toolsets and knowledge against the **agent prompt** doc (the
 * `'prompt'` tag). Returns the next state for the agent row; caller writes one
 * UPDATE. The procedure side runs the same per-tag reconcilers under the
 * `'procedure'` tag — see `reconcileAgentProcedureMentions`.
 */
export function reconcilePromptMentions(input: ReconcileMentionsInput): ReconcileMentionsOutput {
  const walk = walkPromptDoc(input.prompt, input.toolCatalog)
  return {
    toolsets: reconcileToolsetMentions(input.current.toolsets, walk.toolsetSlugs, 'prompt'),
    knowledge: reconcileKnowledgeMentions(input.current.knowledge, walk.recordIds, 'prompt'),
  }
}
