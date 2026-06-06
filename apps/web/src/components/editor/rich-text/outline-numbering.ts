// apps/web/src/components/editor/rich-text/outline-numbering.ts

import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Engine output → formatter input. The engine computes the outline `path`; the
 * formatter is the per-surface rendering policy that turns it into a gutter
 * string (or `null` for "draw no number").
 */
export interface LineNumberContext {
  /**
   * 0-based outline path; `[]` = not numbered. e.g. `[5, 0]` → renders `6.1`
   * (arm), `[5, 0, 1]` → inner instruction `2`. The formatter adds `+1` on
   * every element, so the engine emits 0-based indices.
   */
  path: number[]
  /** PM node type: 'block' | 'conditionBlock' | 'conditionCase' | 'conditionElse'. */
  nodeName: string
  /** For a `block`: its blockType ('text' | 'heading' | …). */
  blockType?: string
  /** 0 = top level. */
  depth: number
}

export type LineNumberFormatter = (ctx: LineNumberContext) => string | null

/**
 * Engine-side counting policy. Scheme C (the chosen procedure scheme) only needs
 * to know which sibling nodes are *skipped* — i.e. the `conditionPredicate`, which
 * is condition text, not a numbered instruction. There are no transparent
 * containers and nested conditions are a permanent non-goal, so every structural
 * level is a numbered level and the path is at most 3 deep.
 */
export interface NumberPolicy {
  /** Skipped sibling — not counted toward indices, never numbered. */
  isSkipped: (node: PMNode) => boolean
}

/** KB / persona / triggers — nothing is skipped (flat top-level numbering). */
export const defaultNumberPolicy: NumberPolicy = {
  isSkipped: () => false,
}

/** Procedures — the leading `conditionPredicate` of each arm doesn't count. */
export const procedureNumberPolicy: NumberPolicy = {
  isSkipped: (node) => node.type.name === 'conditionPredicate',
}

/**
 * Walk from the doc root down to the node at `pos`, returning the 0-based,
 * skip-adjusted index at each depth. Returns `[]` when `pos` can't be resolved.
 *
 * e.g. an instruction inside the first arm of the 6th top-level node →
 * `[5, 0, 0]` (top-level index 5 = the condition block, arm 0, instruction 0).
 */
export function computeOutlinePath(doc: PMNode, pos: number, policy: NumberPolicy): number[] {
  let $pos: ReturnType<PMNode['resolve']>
  try {
    $pos = doc.resolve(pos)
  } catch {
    return []
  }
  const path: number[] = []
  for (let depth = 0; depth <= $pos.depth; depth++) {
    const parent = $pos.node(depth)
    const rawIndex = $pos.index(depth)
    let adjusted = 0
    for (let i = 0; i < rawIndex; i++) {
      if (!policy.isSkipped(parent.child(i))) adjusted++
    }
    path.push(adjusted)
  }
  return path
}

/** Today's behavior — the flat, top-level number (e.g. `7`). */
export const flatLineNumberFormatter: LineNumberFormatter = ({ path }) =>
  path.length ? String((path[0] ?? 0) + 1) : null

/**
 * Procedures — Scheme C (plan §3 DECIDED box). The `conditionBlock` draws no
 * number of its own; each arm shows `{blockNum}.{armNum}` (`6.1`); instruction
 * blocks inside an arm restart at a plain `1, 2, 3`; the top-level sequence
 * resumes after the block. The path is at most `[block, arm, instruction]`.
 */
export const procedureLineNumberFormatter: LineNumberFormatter = ({ nodeName, path }) => {
  switch (nodeName) {
    case 'conditionBlock': // the construct draws no number of its own
    case 'conditionPredicate': // condition text, never numbered
      return null
    case 'conditionCase': // arm = {blockNum}.{armNum} → "6.1"
    case 'conditionElse': {
      const armIdx = path[path.length - 1] ?? 0
      const ownerIdx = path[path.length - 2] ?? 0 // the conditionBlock's top-level index
      return `${ownerIdx + 1}.${armIdx + 1}`
    }
    case 'block': // top-level → "6"; nested in an arm → plain restart "1"
      return path.length ? String((path[path.length - 1] ?? 0) + 1) : null
    default:
      return null
  }
}
