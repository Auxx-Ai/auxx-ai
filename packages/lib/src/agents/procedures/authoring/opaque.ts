// packages/lib/src/agents/procedures/authoring/opaque.ts

import { PROCEDURE_NODE_TYPES, type TiptapDoc, type TiptapNode } from '../nodes'
import { segmentNodes } from '../segment'

/**
 * Lossless carry-through of code blocks and rules-mode conditions (plan §3.4).
 * The Kopilot may NOT author or edit either, but it must never destroy one that
 * already exists in a draft. Both `docToDsl` (read) and `buildProcedureDoc`
 * (rebuild) derive their opaque occurrences from THIS one walk so the keys can't
 * drift: `docToDsl` consumes the ordered occurrences to label its `opaque` steps;
 * `buildProcedureDoc` resolves each `opaque` step's key back to the original node
 * and splices it in verbatim. Because every opaque payload is reconstructed from
 * the persisted draft (never model output), code source / output bindings / rules
 * groups cannot be corrupted even if the model mangles its JSON.
 */

/** One read-only occurrence carried through a read/write cycle. */
export interface OpaqueOccurrence {
  /** Stable-for-one-cycle occurrence key (`opaque:<container>:#<n>`). */
  key: string
  /** Human-only label surfaced to the model (`code block: <name>` / `rules-based condition`). */
  label: string
  /**
   * The original node to splice back verbatim: a `code:<id>` reference marker
   * (bare — no other data in v9) or a `mode:'structured'` conditionBlock node.
   */
  node: TiptapNode
  /** Which container the occurrence lives in — `'body'` or `'sub:<subProcedureId>'`. */
  container: string
}

const opaqueKey = (container: string, ordinal: number): string => `opaque:${container}:#${ordinal}`

/**
 * Walk a draft doc and collect every opaque occurrence in document order,
 * location-aware across the main body and every sub-procedure body. Descends
 * into text-mode condition arms (their bodies may nest code badges / structured
 * conditions) but treats a structured conditionBlock as one opaque unit (does NOT
 * descend — the whole node is carried). PURE.
 */
export function collectOpaqueOccurrences(doc: TiptapDoc): OpaqueOccurrence[] {
  const out: OpaqueOccurrence[] = []
  const codeNameById = new Map(
    (doc.codeBlocks ?? []).filter((cb) => cb?.id).map((cb) => [cb.id, cb.name])
  )

  const walk = (nodes: TiptapNode[], container: string, counter: { n: number }): void => {
    for (const unit of segmentNodes(nodes)) {
      if (unit.kind === 'ownStep' && unit.badge.kind === 'code') {
        const codeBlockId = unit.badge.codeBlockId
        const name = codeNameById.get(codeBlockId) ?? codeBlockId
        out.push({
          key: opaqueKey(container, counter.n++),
          label: `code block: ${name}`,
          // The code marker is bare (no data beyond the prefixed id), so this
          // reconstruction is byte-equivalent to the original node.
          node: { type: 'reference', attrs: { id: `code:${codeBlockId}` } },
          container,
        })
      } else if (unit.kind === 'condition') {
        const mode = unit.node.attrs?.mode === 'structured' ? 'structured' : 'text'
        if (mode === 'structured') {
          out.push({
            key: opaqueKey(container, counter.n++),
            label: 'rules-based condition',
            node: unit.node,
            container,
          })
        } else {
          for (const child of unit.node.content ?? []) {
            if (child.type === PROCEDURE_NODE_TYPES.conditionCase) {
              const body = (child.content ?? []).filter(
                (c) => c.type !== PROCEDURE_NODE_TYPES.conditionPredicate
              )
              walk(body, container, counter)
            } else if (child.type === PROCEDURE_NODE_TYPES.conditionElse) {
              walk(child.content ?? [], container, counter)
            }
          }
        }
      }
      // prose / route / subprocedure units carry no opaque payload.
    }
  }

  walk(doc.content ?? [], 'body', { n: 0 })
  for (const sp of doc.subProcedures ?? []) {
    if (!sp?.id) continue
    walk(sp.content ?? [], `sub:${sp.id}`, { n: 0 })
  }
  return out
}

/** Group occurrences by container into ordered queues `docToDsl` can shift from. */
export function occurrencesByContainer(
  occurrences: OpaqueOccurrence[]
): Map<string, OpaqueOccurrence[]> {
  const byContainer = new Map<string, OpaqueOccurrence[]>()
  for (const occ of occurrences) {
    const list = byContainer.get(occ.container) ?? []
    list.push(occ)
    byContainer.set(occ.container, list)
  }
  return byContainer
}
