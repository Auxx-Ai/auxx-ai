// packages/lib/src/agents/procedures/segment.ts

import {
  isOwnStepBadge,
  type ParsedStepBadge,
  PROCEDURE_NODE_TYPES,
  parseStepBadgeId,
  type TiptapNode,
} from './nodes'

/**
 * Prose-vs-control segmentation for an authored procedure node list. This is the
 * single source of truth shared by the compiler (`compile.ts`, which lowers each
 * unit to a runtime step) and the authoring read path (`doc-to-dsl.ts`, which
 * lowers each unit to a model-facing DSL step). PURE.
 *
 * An own-step badge (`subprocedure:`/`route:`/`code:`) or a `conditionBlock` can
 * be nested anywhere in the prose tree (the `@` picker inserts inline references
 * mid-paragraph). {@link splitNode} hoists those out, re-wrapping the surrounding
 * prose in copies of the container so the prose keeps its block structure;
 * {@link segmentNodes} then coalesces contiguous prose into runs so a chain of
 * paragraphs/list-items between two control segments becomes one unit.
 */

/** One raw segment of a single node: a prose node, an own-step badge, or a condition block. */
export type ProcedureSegment =
  | { type: 'prose'; node: TiptapNode }
  | { type: 'ownStep'; badge: ParsedStepBadge }
  | { type: 'condition'; node: TiptapNode }

/** A coalesced unit of a node list: a contiguous prose run, an own-step badge, or a condition. */
export type ProcedureSegmentUnit =
  | { kind: 'prose'; nodes: TiptapNode[] }
  | { kind: 'ownStep'; badge: ParsedStepBadge }
  | { kind: 'condition'; node: TiptapNode }

/**
 * Hoist own-step badges and condition blocks out of one node, re-wrapping the
 * surrounding prose in copies of the container so the prose keeps its block
 * structure. A `reference` node that is NOT an own-step badge (a `field:` /
 * `entity:` / `tool:` / record-id chip) stays inline in prose.
 */
export function splitNode(node: TiptapNode): ProcedureSegment[] {
  if (node.type === PROCEDURE_NODE_TYPES.conditionBlock) {
    return [{ type: 'condition', node }]
  }
  if (node.type === 'reference') {
    const id = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
    if (id && isOwnStepBadge(id)) {
      const badge = parseStepBadgeId(id)
      if (badge) return [{ type: 'ownStep', badge }]
    }
    return [{ type: 'prose', node }] // plain reference / inline op stays in prose
  }
  if (!node.content || node.content.length === 0) return [{ type: 'prose', node }]

  const childSegments = node.content.flatMap(splitNode)
  if (childSegments.every((s) => s.type === 'prose')) return [{ type: 'prose', node }]

  const out: ProcedureSegment[] = []
  let buffer: TiptapNode[] = []
  const flush = () => {
    if (buffer.length > 0) {
      out.push({ type: 'prose', node: { ...node, content: buffer } })
      buffer = []
    }
  }
  for (const seg of childSegments) {
    if (seg.type === 'prose') {
      buffer.push(seg.node)
    } else {
      flush()
      out.push(seg)
    }
  }
  flush()
  return out
}

/**
 * Segment a linear node list into coalesced units: contiguous prose collapses
 * into one `prose` unit; an own-step badge or condition block breaks the run and
 * becomes its own unit. The order of units mirrors document order.
 */
export function segmentNodes(nodes: TiptapNode[]): ProcedureSegmentUnit[] {
  const segments = nodes.flatMap(splitNode)
  const units: ProcedureSegmentUnit[] = []
  let proseRun: TiptapNode[] = []
  const flushProse = () => {
    if (proseRun.length > 0) {
      units.push({ kind: 'prose', nodes: proseRun })
      proseRun = []
    }
  }
  for (const seg of segments) {
    if (seg.type === 'prose') {
      proseRun.push(seg.node)
    } else if (seg.type === 'ownStep') {
      flushProse()
      units.push({ kind: 'ownStep', badge: seg.badge })
    } else {
      flushProse()
      units.push({ kind: 'condition', node: seg.node })
    }
  }
  flushProse()
  return units
}
