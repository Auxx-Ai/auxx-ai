// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/set-agent-prompt.ts

import { updateAgent } from '../../../../../agents/agent-service'
import { findCachedResource, getCachedResources } from '../../../../../cache/org-cache-helpers'
import { mdToBlocks } from '../../../../../kb/markdown'
import type { Resource } from '../../../../../resources/registry/types'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'
import { buildAgentRailUpdate } from '../snapshot'

const MARKDOWN_MAX_BYTES = 20_000

/**
 * Replace the persona prompt of the agent bound to this builder session.
 *
 * The model authors markdown; the server expands it into the editor's block
 * shape (`mdToBlocks`) — same converter the KB write tools use. Wholesale
 * replace; to edit, fetch the current prompt from the active references,
 * splice locally, send the full markdown back.
 */
export function createSetAgentPromptTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_agent_prompt',
    displayName: 'Set agent prompt',
    description: `Replace the agent's persona prompt with a markdown document.

The persona prompt is the agent's instructions: tone, role, constraints,
escalation rules, and any \`@\`-references to tools / KB articles / people /
records that seed its knowledge scope. The doc is shown to admins in the
Prompt tab.

Use standard markdown — headings, paragraphs, bullet / numbered lists,
blockquotes, code fences, dividers. Inline \`@[<id>]\` syntax embeds a
reference chip. Supported ids:
  - \`@[tool:<name>]\` — a specific tool (e.g. \`@[tool:reply_to_thread]\`).
    Use these EAGERLY — referencing a tool by name in the prompt makes the
    chip render in the editor, and the runtime expands it to a backtick-quoted
    tool name when this agent runs.
  - \`@[entity:<entityDef>]\` — the entity *type* (e.g. \`@[entity:ticket]\`).
    Use in the Capabilities & Scope sentence instead of writing the entity name
    inline. Validated server-side; unknown entityDefs are rejected.
  - \`@[field:<entityDef>:<fieldId>]\` — a field on an entity (e.g.
    \`@[field:ticket:status]\`). Use whenever the prompt classifies, tags,
    routes, or branches by a record value. Validated server-side; unknown
    fields are rejected.
  - \`@[article:<recordId>]\` — KB article.
  - \`@[agent:<agentId>]\` — another agent in this workspace.
  - \`@[user:<userId>]\` — a workspace teammate (not the agent itself).
  - \`@[<defId>:<instId>]\` — any CRM record by its colon-joined recordId.

The previous prompt is replaced wholesale.`,
    parameters: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description:
            'Full persona prompt as markdown. Headings, paragraphs, lists, blockquotes, code fences, and inline `@[<id>]` references (`tool:`, `entity:`, `field:`, `article:`, `agent:`, `user:`, or a raw `<defId>:<instId>` record id) are supported. Replaces the previous prompt wholesale.',
          minLength: 1,
          maxLength: MARKDOWN_MAX_BYTES,
        },
      },
      required: ['markdown'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { sessionContext } = getDeps()
      const agentRef = findRef(sessionContext, 'agent')
      if (!agentRef?.id) {
        return {
          success: false,
          output: null,
          error: 'No agent in session context — this tool only runs on the builder page.',
        }
      }

      const markdown = typeof args.markdown === 'string' ? args.markdown : ''
      if (!markdown.trim()) {
        // Most common cause: max_tokens truncated the streamed tool_use input
        // mid-JSON, parseToolArgs returned `{}`, and we landed here with no
        // markdown. The runtime default is now 32K but very long personas can
        // still hit the cap — point the model at the most likely fix.
        const isEmpty = Object.keys(args).length === 0
        return {
          success: false,
          output: null,
          error: isEmpty
            ? 'No `markdown` argument received — the tool_use input was empty. This usually means the previous turn was truncated. Retry with a shorter prompt, fewer parallel tool calls, or break the prompt into sections.'
            : 'markdown must be a non-empty string. Pass the full persona prompt as markdown.',
        }
      }
      if (markdown.length > MARKDOWN_MAX_BYTES) {
        return {
          success: false,
          output: null,
          error: `markdown exceeds max ${MARKDOWN_MAX_BYTES} characters (got ${markdown.length})`,
        }
      }

      let blocks: ReturnType<typeof mdToBlocks>
      try {
        blocks = mdToBlocks(markdown)
      } catch (err) {
        return {
          success: false,
          output: null,
          error: `Failed to parse markdown: ${err instanceof Error ? err.message : String(err)}`,
        }
      }

      const doc = { type: 'doc', content: blocks } as Record<string, unknown>

      // Validate schema chips (`entity:` / `field:`) BEFORE persisting so the
      // model sees the failure in the next turn instead of saving a broken
      // prompt the admin can't run. Tools chips are validated by the toolset
      // reconciler — separate path.
      const validation = await validateSchemaReferences(doc, agentDeps.organizationId)
      if (validation.unresolvedReferences.length > 0) {
        return {
          success: false,
          output: {
            unresolvedReferences: validation.unresolvedReferences,
            warnings: validation.warnings,
          },
          error: validation.errorMessage,
        }
      }

      await updateAgent(agentRef.id, agentDeps.organizationId, { prompt: doc })

      const referenceCount = countReferences(doc)
      const byteLength = JSON.stringify(doc).length

      return {
        success: true,
        output: {
          agentId: agentRef.id,
          byteLength,
          referenceCount,
          warnings: validation.warnings,
          ...buildAgentRailUpdate({
            agentId: agentRef.id,
            changed: ['prompt'],
            summary: `prompt replaced (${byteLength} bytes, ${referenceCount} refs)`,
          }),
        },
      }
    },
  }
}

/**
 * Walk the doc and count `reference` inline nodes (the `@[id]` chips). The
 * exact reference → scope reconciliation lives in the prompt-mentions plan.
 */
function countReferences(doc: Record<string, unknown>): number {
  let count = 0
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; content?: unknown[] }
    if (n.type === 'reference') count++
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child)
    }
  }
  walk(doc)
  return count
}

/** Collect every `reference` chip id from the document. */
function collectReferenceIds(doc: Record<string, unknown>): string[] {
  const ids: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; attrs?: { id?: unknown }; content?: unknown[] }
    if (n.type === 'reference' && typeof n.attrs?.id === 'string') {
      ids.push(n.attrs.id)
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child)
    }
  }
  walk(doc)
  return ids
}

/** Extract plain text content from the doc for prose-mention scanning. */
function collectText(doc: Record<string, unknown>): string {
  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; text?: unknown; content?: unknown[] }
    if (typeof n.text === 'string') parts.push(n.text)
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child)
    }
  }
  walk(doc)
  return parts.join(' ')
}

interface SchemaValidationResult {
  unresolvedReferences: string[]
  warnings: string[]
  errorMessage?: string
}

/**
 * Validate `entity:` / `field:` reference chips against the org's cached
 * schema. Returns:
 *   - `unresolvedReferences`: chip ids that don't resolve (rejection condition)
 *   - `warnings`: non-blocking advisories (e.g. a field-bearing entity is
 *     mentioned in prose with zero `@[entity:…]` chips)
 *
 * Resource lookup matches `findCachedResource` (id / entityType / apiSlug).
 * Field lookup verifies the field exists on its declared entity by `id` or
 * `resourceFieldId`. Relationship-traversal paths (`a:b::c:d`) only validate
 * the root segment for v1; intermediate hops are not walked.
 */
async function validateSchemaReferences(
  doc: Record<string, unknown>,
  organizationId: string
): Promise<SchemaValidationResult> {
  const ids = collectReferenceIds(doc)
  const entityChips = ids.filter((id) => id.startsWith('entity:'))
  const fieldChips = ids.filter((id) => id.startsWith('field:'))

  const unresolved: string[] = []
  const warnings: string[] = []

  // Resolve unique entityDef keys once.
  const entityKeys = new Set<string>()
  for (const chip of entityChips) entityKeys.add(chip.slice('entity:'.length))
  for (const chip of fieldChips) {
    const payload = chip.slice('field:'.length)
    const head = payload.split('::')[0] ?? payload
    const entityKey = head.split(':')[0]
    if (entityKey) entityKeys.add(entityKey)
  }

  const resolvedByKey = new Map<string, Resource | null>()
  for (const key of entityKeys) {
    resolvedByKey.set(key, await findCachedResource(organizationId, key))
  }

  for (const chip of entityChips) {
    const key = chip.slice('entity:'.length)
    if (!resolvedByKey.get(key)) {
      unresolved.push(chip)
    }
  }

  for (const chip of fieldChips) {
    const payload = chip.slice('field:'.length)
    const head = payload.split('::')[0] ?? payload
    const parts = head.split(':')
    const entityKey = parts[0]
    const fieldKey = parts[1]
    if (!entityKey || !fieldKey) {
      unresolved.push(chip)
      continue
    }
    const resource = resolvedByKey.get(entityKey)
    if (!resource) {
      unresolved.push(chip)
      continue
    }
    const found = resource.fields.some(
      (f) => f.id === fieldKey || f.resourceFieldId === `${entityKey}:${fieldKey}`
    )
    if (!found) unresolved.push(chip)
  }

  // Warning: field-bearing entity mentioned in prose, no @[entity:…] chip.
  // Match resource labels (and plurals where available) case-insensitively
  // against the doc's plain text. Skip when an `@[entity:<id>]` chip is
  // already present for that entity.
  const chippedEntityKeys = new Set<string>()
  for (const chip of entityChips) {
    const key = chip.slice('entity:'.length)
    const resolved = resolvedByKey.get(key)
    if (resolved) {
      chippedEntityKeys.add(resolved.id)
      if (resolved.entityType) chippedEntityKeys.add(resolved.entityType)
      if (resolved.apiSlug) chippedEntityKeys.add(resolved.apiSlug)
    }
  }

  const allResources = await getCachedResources(organizationId)
  const text = collectText(doc).toLowerCase()
  const mentionedWithoutChip: string[] = []
  for (const r of allResources) {
    const alreadyChipped =
      chippedEntityKeys.has(r.id) ||
      (r.entityType ? chippedEntityKeys.has(r.entityType) : false) ||
      (r.apiSlug ? chippedEntityKeys.has(r.apiSlug) : false)
    if (alreadyChipped) continue
    const label = r.label?.toLowerCase()
    if (!label) continue
    const labelMatcher = new RegExp(`\\b${escapeRegex(label)}\\b`, 'i')
    if (labelMatcher.test(text)) {
      mentionedWithoutChip.push(r.label)
    }
  }
  if (mentionedWithoutChip.length > 0) {
    warnings.push(
      `Prose mentions ${mentionedWithoutChip.map((l) => `"${l}"`).join(', ')} but no \`@[entity:…]\` chip is present. Wrap the entity noun with \`@[entity:<apiSlug>]\` so admins can audit scope at a glance.`
    )
  }

  if (unresolved.length === 0) {
    return { unresolvedReferences: [], warnings }
  }

  const slugList = allResources.map((r) => r.apiSlug).join(', ')
  const errorMessage = `Rejected — ${unresolved.length} unresolved schema chip(s): ${unresolved.map((c) => `\`${c}\``).join(', ')}. For \`@[entity:<key>]\` chips, key must be one of the apiSlugs: ${slugList}. For \`@[field:<entityDef>:<fieldId>]\` chips, call \`list_entity_fields\` on the entityDef first and use a real field id from the response. Fix and retry.`

  return { unresolvedReferences: unresolved, warnings, errorMessage }
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
