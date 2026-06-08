// packages/lib/src/agents/procedures/authoring/doc-to-dsl.ts

import { createHash } from 'node:crypto'
import { blocksToMd } from '../../../kb/markdown'
import { docToText } from '../../../tiptap'
import { PROCEDURE_NODE_TYPES, type TiptapDoc, type TiptapNode } from '../nodes'
import { segmentNodes } from '../segment'
import type { ProcedureDsl, ProcedureDslCase, ProcedureDslStep } from './dsl'
import { collectOpaqueOccurrences, type OpaqueOccurrence, occurrencesByContainer } from './opaque'

/**
 * Read a persisted draft doc back into the model-facing {@link ProcedureDsl} —
 * the read path for surgical edits. PURE. The model reads the current DSL (with
 * stable ids), changes only what's asked, and re-emits via `set_procedure_body`.
 *
 * Code blocks and rules-mode conditions surface as read-only `opaque` steps whose
 * ids are occurrence keys (resolved back to the original node by
 * `buildProcedureDoc`); their payloads — code source, output bindings, structured
 * `ConditionGroup`s, local attributes — never enter the DSL. Sub-procedure ids
 * round-trip verbatim (they're referenced by `call` steps).
 *
 * Instruction/condition/case ids are synthesized from a content hash for nicer
 * diffs across reads; they have NO runtime effect, so their stability is
 * best-effort only.
 */
export function docToDsl(doc: TiptapDoc): ProcedureDsl {
  const queues = occurrencesByContainer(collectOpaqueOccurrences(doc))
  const usedIds = new Set<string>()

  /** Deterministic, collision-free id from a content hash (best-effort stable). */
  const hashId = (kind: string, payload: string): string => {
    const base = createHash('sha256')
      .update(`${kind}|${payload}`, 'utf8')
      .digest('hex')
      .slice(0, 10)
    let id = `${kind[0]}_${base}`
    let n = 2
    while (usedIds.has(id)) id = `${kind[0]}_${base}-${n++}`
    usedIds.add(id)
    return id
  }

  const nextOpaque = (container: string): OpaqueOccurrence => {
    const occ = queues.get(container)?.shift()
    if (!occ) {
      // Unreachable: the walk visits opaque units in the same order
      // `collectOpaqueOccurrences` produced them. Guard defensively.
      throw new Error(`docToDsl: opaque occurrence queue underflow in container "${container}".`)
    }
    return occ
  }

  const walk = (nodes: TiptapNode[], container: string): ProcedureDslStep[] => {
    const out: ProcedureDslStep[] = []
    for (const unit of segmentNodes(nodes)) {
      if (unit.kind === 'prose') {
        const text = proseToMarkdown(unit.nodes)
        if (text.trim().length > 0) {
          out.push({ id: hashId('instruction', text), kind: 'instruction', text })
        }
      } else if (unit.kind === 'ownStep') {
        const badge = unit.badge
        if (badge.kind === 'code') {
          const occ = nextOpaque(container)
          out.push({ id: occ.key, kind: 'opaque', label: occ.label })
        } else if (badge.kind === 'subprocedure') {
          out.push({
            id: hashId('call', badge.subProcedureId),
            kind: 'call',
            subProcedureId: badge.subProcedureId,
          })
        } else if (badge.kind === 'route') {
          out.push(
            badge.outcome === 'switch'
              ? {
                  id: hashId('route', `switch:${badge.switchToProcedureId}`),
                  kind: 'route',
                  outcome: 'switch',
                  switchToProcedureId: badge.switchToProcedureId,
                }
              : { id: hashId('route', badge.outcome), kind: 'route', outcome: badge.outcome }
          )
        }
      } else {
        // condition block
        const mode = unit.node.attrs?.mode === 'structured' ? 'structured' : 'text'
        if (mode === 'structured') {
          const occ = nextOpaque(container)
          out.push({ id: occ.key, kind: 'opaque', label: occ.label })
        } else {
          out.push(buildTextCondition(unit.node, container, walk, hashId))
        }
      }
    }
    return out
  }

  const steps = walk(doc.content ?? [], 'body')
  const subProcedures = (doc.subProcedures ?? [])
    .filter((sp) => sp?.id)
    .map((sp) => ({
      id: sp.id,
      name: sp.name ?? '',
      steps: walk(sp.content ?? [], `sub:${sp.id}`),
    }))

  return subProcedures.length > 0 ? { steps, subProcedures } : { steps }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildTextCondition(
  node: TiptapNode,
  container: string,
  walk: (nodes: TiptapNode[], container: string) => ProcedureDslStep[],
  hashId: (kind: string, payload: string) => string
): Extract<ProcedureDslStep, { kind: 'condition' }> {
  const cases: ProcedureDslCase[] = []
  let elseSteps: ProcedureDslStep[] | undefined

  for (const child of node.content ?? []) {
    if (child.type === PROCEDURE_NODE_TYPES.conditionCase) {
      const predicate = (child.content ?? []).find(
        (c) => c.type === PROCEDURE_NODE_TYPES.conditionPredicate
      )
      const when = predicate ? docToText(predicate) : ''
      const body = (child.content ?? []).filter(
        (c) => c.type !== PROCEDURE_NODE_TYPES.conditionPredicate
      )
      cases.push({ id: hashId('case', when), when, steps: walk(body, container) })
    } else if (child.type === PROCEDURE_NODE_TYPES.conditionElse) {
      elseSteps = walk(child.content ?? [], container)
    }
  }

  const id = hashId('condition', cases.map((c) => c.when).join('|'))
  return elseSteps !== undefined
    ? { id, kind: 'condition', cases, else: elseSteps }
    : { id, kind: 'condition', cases }
}

/**
 * Serialize a contiguous prose run (KB `block` nodes) to markdown, emitting inline
 * `reference` chips as `@[<id>]` so `mdToBlocks` re-parses them on the write path.
 * Reuses the KB serializer rather than reimplementing the marker grammar.
 */
function proseToMarkdown(nodes: TiptapNode[]): string {
  const md = blocksToMd({ type: 'doc', content: nodes } as never, {
    references: (id: string) => `@[${id}]`,
  })
  return md.trimEnd()
}
