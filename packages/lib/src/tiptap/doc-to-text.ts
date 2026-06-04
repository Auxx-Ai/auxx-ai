// packages/lib/src/tiptap/doc-to-text.ts

import type { TiptapNode } from './types'

interface DocToTextOptions {
  /**
   * Optional resolver for inline `reference` nodes. Receives the `RecordId`
   * and returns the markdown text to inline (typically `[Title](recordId)`).
   * When unset, references render as `[reference](id)` — the same form used
   * by `blocksToMd`, so a re-paste round-trips.
   */
  references?: (id: string) => string
  /**
   * Optional resolver for inline `variable-node` chips. Receives the
   * `variableId` and returns the text to inline (typically the resolved
   * variable value, formatted for display). When unset, the chip renders
   * to `{{variableId}}` so a downstream regex-based interpolation pass
   * can pick it up — matches legacy behavior used by the 9 non-AI
   * workflow nodes.
   */
  variables?: (variableId: string) => string
}

/**
 * Naive walker that flattens a Tiptap JSON document into plain text. Text
 * nodes are concatenated with single spaces inside a block; block-level
 * nodes (paragraph, heading, list-item, code-block, etc.) are joined with
 * newlines.
 *
 * Inline `reference` nodes flow through the optional `references` resolver
 * — see `references/preresolve.ts` for the title-fetching pipeline.
 *
 * Phase 1: chip rendering for `agent` / `record` / `tool` mention nodes is
 * out of scope — they collapse to their `label` attr (or empty string) for
 * now. See `plans/kopilot/agents/prompt-mentions.md` for the eventual
 * full-fidelity renderer.
 *
 * Tolerant of malformed input: anything that's not the expected shape
 * yields an empty string rather than throwing.
 */
export function docToText(doc: unknown, options: DocToTextOptions = {}): string {
  if (!doc || typeof doc !== 'object') return ''
  return walkNode(doc as TiptapNode, options).trim()
}

// Block containers whose children are block-level siblings — join with '\n'.
const BLOCK_CONTAINER_TYPES = new Set([
  'doc',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  // KB block schema — `Doc -> block -> inline`. Each `block` is a block-
  // level container that should join its siblings with newlines.
  'block',
  // v9 procedure condition arms — `conditionBlock -> (conditionCase | conditionElse) -> block+`.
  // The arm bodies are block-level; join their children with newlines like any block container.
  'conditionCase',
  'conditionElse',
  // A named local sub-procedure body is block-level prose too.
  'subProcedure',
])

// Inline containers whose children are inline (text + chips) — join with ''.
const INLINE_CONTAINER_TYPES = new Set(['paragraph', 'heading', 'codeBlock', 'horizontalRule'])

/** Indent every line of `text` by two spaces (for nested condition-arm bodies). */
function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join('\n')
}

/**
 * Render a single {@link ConditionGroup} to a compact human predicate
 * (`field op value`, joined by the group's AND/OR). Tolerant of malformed
 * input — returns `''` rather than throwing, matching the file contract.
 * Execution NEVER reads this text; it's only for the overview / instruction
 * framing (the branch is taken deterministically from the compiled groups).
 */
function summarizeGroup(group: unknown): string {
  if (!group || typeof group !== 'object') return ''
  const conditions = (group as { conditions?: unknown }).conditions
  if (!Array.isArray(conditions) || conditions.length === 0) return ''
  const parts: string[] = []
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i] as Record<string, unknown> | null
    if (!c || typeof c !== 'object') continue
    const field = Array.isArray(c.fieldId)
      ? c.fieldId.join('.')
      : typeof c.fieldId === 'string'
        ? c.fieldId
        : ''
    if (!field) continue
    const op = typeof c.operator === 'string' ? c.operator : ''
    const value =
      c.value === undefined || c.value === null || c.value === ''
        ? ''
        : Array.isArray(c.value)
          ? c.value.join(', ')
          : String(c.value)
    const clause = [field, op, value].filter((s) => s.length > 0).join(' ')
    if (i > 0) {
      const joiner = c.logicalOperator === 'OR' ? 'OR' : 'AND'
      parts.push(joiner)
    }
    parts.push(clause)
  }
  return parts.join(' ')
}

function walkNode(node: TiptapNode, options: DocToTextOptions, caseIdx?: number): string {
  if (typeof node.text === 'string') return node.text
  if (node.type === 'mention' || node.type === 'mentionRecord' || node.type === 'mentionAgent') {
    const label = (node.attrs?.label as string | undefined) ?? ''
    return label
  }
  if (node.type === 'reference') {
    const id = typeof node.attrs?.id === 'string' ? (node.attrs.id as string) : ''
    if (!id) return ''
    return options.references ? options.references(id) : `[reference](${id})`
  }
  if (node.type === 'variable-node') {
    const variableId =
      typeof node.attrs?.variableId === 'string' ? (node.attrs.variableId as string) : ''
    if (!variableId) return ''
    return options.variables ? options.variables(variableId) : `{{${variableId}}}`
  }

  // ── v9 procedure control-flow nodes ──────────────────────────────────────
  // The IF / ELSE IF keyword comes from each `conditionCase`'s POSITION in the
  // block (there is no `kind` attr) — the block handler threads the running index.
  if (node.type === 'conditionBlock') {
    let idx = 0
    return (node.content ?? [])
      .map((arm) =>
        arm.type === 'conditionCase' ? walkNode(arm, options, idx++) : walkNode(arm, options)
      )
      .filter((s) => s.length > 0)
      .join('\n')
  }
  if (node.type === 'conditionCase') {
    const kw = (caseIdx ?? 0) === 0 ? 'IF' : 'ELSE IF'
    const pred = summarizeGroup(node.attrs?.group)
    const body = (node.content ?? [])
      .map((c) => walkNode(c, options))
      .filter((s) => s.length > 0)
      .join('\n')
    return `${kw} ${pred}:\n${indent(body)}`
  }
  if (node.type === 'conditionElse') {
    const body = (node.content ?? [])
      .map((c) => walkNode(c, options))
      .filter((s) => s.length > 0)
      .join('\n')
    return `ELSE:\n${indent(body)}`
  }
  // Step leaves — one-line markers for the read-only overview.
  if (node.type === 'routingStep') {
    const outcome = node.attrs?.outcome
    if (outcome === 'handoff') return '[handoff]'
    if (outcome === 'switch') return '[switch procedure]'
    if (outcome === 'call') return '[run sub-procedure]'
    return '[end]'
  }
  if (node.type === 'codeStep') return '[run code]'
  if (node.type === 'toolStep') {
    const toolName = typeof node.attrs?.toolName === 'string' ? node.attrs.toolName : ''
    return toolName ? `[call ${toolName}]` : '[call tool]'
  }

  if (Array.isArray(node.content)) {
    const parts = node.content.map((child) => walkNode(child, options)).filter((s) => s.length > 0)
    if (!node.type || BLOCK_CONTAINER_TYPES.has(node.type)) return parts.join('\n')
    if (INLINE_CONTAINER_TYPES.has(node.type)) return parts.join('')
    return parts.join(' ')
  }
  return ''
}
