// packages/lib/src/agents/prompt-mention-reconciler.ts

import type { KnowledgeEntry, MentionSource, ToolsetEntry, ToolsetMention } from '@auxx/database'
import type { AgentToolsetConfig } from './agent-toolset-types'
import type { FlatToolCatalogEntry } from './toolset-catalog'

export type { KnowledgeEntry, MentionSource, ToolsetEntry, ToolsetMention }
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

/**
 * Reconciler-private pre-image stored at `config.mentionOverrides` — what
 * mention passes overrode on an entry, applied back when the mentions covering
 * a target empty. Removing a mention must restore the world: a pre-chip
 * unchecked tool gets re-unchecked, a pre-chip disabled entry returns to
 * disabled. Valid by construction — the overridden bits are exactly the bits
 * the UI locks while mentioned. See plans/mcp/v4/tool-first-catalog.md.
 */
export interface MentionOverrides {
  /** The entry was disabled before a mention forced it on. */
  enabledWas?: false
  /** Names the reconciler added to `enabledTools` for tool-target locks. */
  addedNames?: string[]
}

/**
 * Resolved mention locks for one toolset slug: the lock targets (`'*'` and/or
 * registered tool names) plus the catalog context fresh inserts need.
 */
export interface WalkedToolsetLock {
  targets: Set<string>
  /** Every registered name the catalog currently lists for this slug. */
  allNames: string[]
  /** Implicit set (MCP server, ungrouped app tools) — fresh inserts get an allow-list snapshot. */
  implicit: boolean
}

interface WalkedPrompt {
  /**
   * Resolved locks per toolset slug. A `tool:<name>` chip resolves to the
   * tool's own name when its toolset is implicit (locks just that tool) and to
   * `'*'` when the toolset is an explicit bundle (the whole bundle pins —
   * atomic rule). `toolset:<slug>` chips always resolve to `'*'`.
   */
  toolsetLocks: Map<string, WalkedToolsetLock>
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

function addLock(
  locks: Map<string, WalkedToolsetLock>,
  slug: string,
  target: string,
  catalogBySlug: Map<string, FlatToolCatalogEntry[]>
): void {
  let lock = locks.get(slug)
  if (!lock) {
    const tools = catalogBySlug.get(slug) ?? []
    lock = {
      targets: new Set<string>(),
      allNames: tools.map((t) => t.name),
      implicit: tools[0]?.toolsetImplicit ?? false,
    }
    locks.set(slug, lock)
  }
  lock.targets.add(target)
}

/**
 * Walk a Tiptap prompt doc, returning the resolved toolset locks (via
 * `tool:<name>` / `toolset:<slug>` chips resolved against `toolCatalog`) and
 * the set of record RecordIds (via `article:<id>` / `entity:<id>` / … chips).
 *
 * Unknown chips are silently dropped. Pure function — does not mutate input.
 */
export function walkPromptDoc(
  prompt: Record<string, unknown>,
  toolCatalog: FlatToolCatalogEntry[]
): WalkedPrompt {
  const toolsetLocks = new Map<string, WalkedToolsetLock>()
  const recordIds = new Set<string>()

  const byName = new Map<string, FlatToolCatalogEntry>()
  const catalogBySlug = new Map<string, FlatToolCatalogEntry[]>()
  for (const entry of toolCatalog) {
    byName.set(entry.name, entry)
    const arr = catalogBySlug.get(entry.toolsetSlug) ?? []
    arr.push(entry)
    catalogBySlug.set(entry.toolsetSlug, arr)
  }

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
          const tool = byName.get(rest)
          if (tool) {
            // Implicit toolset → lock just this tool; explicit bundle → the
            // whole bundle pins (atomic rule).
            addLock(
              toolsetLocks,
              tool.toolsetSlug,
              tool.toolsetImplicit ? tool.name : '*',
              catalogBySlug
            )
          }
        } else if (prefix === 'toolset') {
          if (rest.length > 0) addLock(toolsetLocks, rest, '*', catalogBySlug)
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
  return { toolsetLocks, recordIds }
}

/**
 * Walk several Tiptap docs and return the union of their resolved toolset
 * locks and record ids. Used by the procedure side, where an agent's enabled
 * attached procedures contribute many docs (each procedure's draft + active
 * version) that collectively lock toolsets/knowledge. Pure.
 */
export function walkPromptDocs(
  docs: Record<string, unknown>[],
  toolCatalog: FlatToolCatalogEntry[]
): WalkedPrompt {
  const toolsetLocks = new Map<string, WalkedToolsetLock>()
  const recordIds = new Set<string>()
  for (const doc of docs) {
    const walk = walkPromptDoc(doc, toolCatalog)
    for (const [slug, lock] of walk.toolsetLocks) {
      const merged = toolsetLocks.get(slug)
      if (merged) {
        for (const target of lock.targets) merged.targets.add(target)
      } else {
        toolsetLocks.set(slug, lock)
      }
    }
    for (const id of walk.recordIds) recordIds.add(id)
  }
  return { toolsetLocks, recordIds }
}

/** De-dupe + drop a tag from a `mentionedBy` set; returns a fresh minimal array. */
function withTag(mentionedBy: MentionSource[] | undefined, tag: MentionSource): MentionSource[] {
  return mentionedBy?.includes(tag) ? mentionedBy : [...(mentionedBy ?? []), tag]
}
function withoutTag(mentionedBy: MentionSource[] | undefined, tag: MentionSource): MentionSource[] {
  return (mentionedBy ?? []).filter((t) => t !== tag)
}

/** Read the entry's config with its reconciler-private fields, never mutating. */
function readConfig(
  entry: ToolsetEntry
): AgentToolsetConfig & { mentionOverrides?: MentionOverrides } {
  return (entry.config ?? {}) as AgentToolsetConfig & { mentionOverrides?: MentionOverrides }
}

/**
 * Apply the current `mentions` to one entry: force `enabled`, assert
 * tool-target names into `enabledTools` (recording reconciler-added names in
 * the pre-image), and restore the pre-image for targets no mention covers
 * anymore. `prevHadMentions` distinguishes first lock acquisition (record the
 * pre-image) from re-healing an already-locked row someone disabled out of
 * band (force enabled, but the original pre-image stands). Pure — returns a
 * fresh entry. Idempotent per pass.
 */
function settleEntry(
  entry: ToolsetEntry,
  mentions: ToolsetMention[],
  prevHadMentions: boolean
): ToolsetEntry {
  const config = { ...readConfig(entry) }
  const overrides: MentionOverrides = { ...(config.mentionOverrides ?? {}) }
  let enabled = entry.enabled

  const hasStar = mentions.some((m) => m.target === '*')
  const coveredNames = new Set(mentions.filter((m) => m.target !== '*').map((m) => m.target))

  if (mentions.length > 0 && !enabled) {
    // Record the pre-image only on first lock acquisition — a disabled row
    // that already carried mentions was disabled out of band (no server-side
    // guard); re-heal it without clobbering the original pre-image.
    if (!prevHadMentions && overrides.enabledWas === undefined) overrides.enabledWas = false
    enabled = true
  }

  // Tool-target locks must be available: assert their names into the
  // allow-list (when one exists — an absent list already passes everything),
  // recording what we added so unmention can restore it.
  if (coveredNames.size > 0 && Array.isArray(config.enabledTools)) {
    const missing = [...coveredNames].filter((name) => !config.enabledTools?.includes(name))
    if (missing.length > 0) {
      config.enabledTools = [...config.enabledTools, ...missing]
      const added = new Set(overrides.addedNames ?? [])
      for (const name of missing) added.add(name)
      overrides.addedNames = [...added]
    }
  }

  // Restore reconciler-added names no current mention covers.
  if (overrides.addedNames?.length) {
    const stillCovered = overrides.addedNames.filter((n) => hasStar || coveredNames.has(n))
    const toRestore = overrides.addedNames.filter((n) => !(hasStar || coveredNames.has(n)))
    if (toRestore.length > 0 && Array.isArray(config.enabledTools)) {
      config.enabledTools = config.enabledTools.filter((n) => !toRestore.includes(n))
    }
    if (stillCovered.length > 0) overrides.addedNames = stillCovered
    else delete overrides.addedNames
  }

  // All locks released — restore the enabled pre-image.
  if (mentions.length === 0 && overrides.enabledWas === false) {
    enabled = false
    delete overrides.enabledWas
  }

  if (Object.keys(overrides).length > 0) config.mentionOverrides = overrides
  else delete config.mentionOverrides

  return {
    ...entry,
    enabled,
    config,
    ...(mentions.length > 0 ? { mentions } : { mentions: undefined }),
  }
}

/**
 * Reconcile `Agent.toolsets` against the locks resolved from a **single
 * input** (`tag` = `'prompt'` or `'procedure'`). Per source tag, every
 * `{ source: tag }` mention is dropped and the freshly resolved set appended —
 * one filter + one concat, idempotent — so the two inputs reconcile
 * independently: the prompt-autosave path can never drop a procedure lock and
 * vice-versa.
 *
 * - `source` is **never mutated** — it stays pure creation provenance.
 * - A row is forced `enabled: true` while `mentions` is non-empty; what a pass
 *   overrode is recorded in the `config.mentionOverrides` pre-image and
 *   applied back when the covering mentions empty (see {@link MentionOverrides}).
 * - A fresh entry created by tool-target mentions installs with
 *   `enabledTools = mentionedNames` — mentioning 1 of 40 server tools enables
 *   just that tool. A `'*'` insert on an implicit set snapshots the catalog
 *   (`allNames`); on an explicit bundle it carries no per-tool config.
 * - On unmention, a `source === 'mention'` row drops only once its restored
 *   allow-list is empty/absent — user-customized siblings keep the row alive.
 */
export function reconcileToolsetMentions(
  current: ToolsetEntry[],
  toolsetLocks: Map<string, WalkedToolsetLock>,
  tag: MentionSource
): ToolsetEntry[] {
  const next: ToolsetEntry[] = []
  for (const entry of current) {
    const kept = (entry.mentions ?? []).filter((m) => m.source !== tag)
    const lock = toolsetLocks.get(entry.slug)
    const fresh: ToolsetMention[] = lock
      ? [...lock.targets].map((target) => ({ target, source: tag }))
      : []
    const mentions = [...kept, ...fresh]
    const settled = settleEntry(entry, mentions, (entry.mentions?.length ?? 0) > 0)

    if (mentions.length === 0 && entry.source === 'mention') {
      // Mention-created row with no remaining locks: restored to "nothing
      // existed" unless the user customized siblings (non-empty allow-list).
      const enabledTools = readConfig(settled).enabledTools
      if (!Array.isArray(enabledTools) || enabledTools.length === 0) continue
    }
    next.push(settled)
  }

  const known = new Set(next.map((t) => t.slug))
  for (const [slug, lock] of toolsetLocks) {
    if (known.has(slug)) continue
    const targets = [...lock.targets]
    const names = targets.filter((t) => t !== '*')
    const hasStar = targets.includes('*')
    // '*' on an implicit set snapshots the catalog ("everything it has
    // today"); tool targets enable exactly themselves; explicit bundles carry
    // no per-tool config.
    const enabledTools = hasStar
      ? lock.implicit && lock.allNames.length > 0
        ? [...lock.allNames]
        : undefined
      : names
    const config: Record<string, unknown> = {}
    if (enabledTools !== undefined) {
      config.enabledTools = enabledTools
      config.mentionOverrides = { addedNames: [...enabledTools] } satisfies MentionOverrides
    }
    next.push({
      slug,
      config,
      enabled: true,
      source: 'mention',
      mentions: targets.map((target) => ({ target, source: tag })),
    })
  }
  return next
}

/**
 * Reconcile `Agent.knowledge` against the recordIds mentioned by a **single
 * input** (`tag`). Records have no sub-granularity, so knowledge keeps the
 * original `mentionedBy` tag-list semantics:
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
    toolsets: reconcileToolsetMentions(input.current.toolsets, walk.toolsetLocks, 'prompt'),
    knowledge: reconcileKnowledgeMentions(input.current.knowledge, walk.recordIds, 'prompt'),
  }
}
