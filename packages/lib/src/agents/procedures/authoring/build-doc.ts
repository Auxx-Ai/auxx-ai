// packages/lib/src/agents/procedures/authoring/build-doc.ts

import { generateId } from '@auxx/utils'
import { mdToBlocks } from '../../../kb/markdown'
import { PROCEDURE_NODE_TYPES, type TiptapDoc, type TiptapNode } from '../nodes'
import type { ProcedureDsl, ProcedureDslStep } from './dsl'
import { collectOpaqueOccurrences } from './opaque'

/**
 * Lower a model-authored {@link ProcedureDsl} to the editor's TipTap doc — the
 * inverse of `docToDsl` and the input contract of `compileProcedure`. PURE.
 *
 * `draftDoc` is the current persisted draft: its server-owned payloads
 * (`codeBlocks`, `localAttributes`) are copied byte-for-byte, and every `opaque`
 * step's occurrence key is resolved back to the original node and spliced in
 * verbatim (§3.4) — code source / output bindings / rules groups never round-trip
 * through the model. For a create with no prior draft, pass {@link emptyDoc}.
 *
 * Throws {@link ProcedureBuildError} when an `opaque` step references an unknown
 * occurrence key or uses one more than once. The caller validates the DSL shape
 * with `validateProcedureDsl` first; this only re-checks opaque resolution.
 */
export function buildProcedureDoc(dsl: ProcedureDsl, draftDoc: TiptapDoc): TiptapDoc {
  const occByKey = new Map(collectOpaqueOccurrences(draftDoc).map((o) => [o.key, o.node]))
  const usedKeys = new Set<string>()

  const resolveOpaque = (key: string): TiptapNode => {
    const node = occByKey.get(key)
    if (!node) {
      throw new ProcedureBuildError(
        `Unknown opaque occurrence "${key}". Opaque steps are read-only — keep the exact id you read from \`read_procedure\`.`
      )
    }
    if (usedKeys.has(key)) {
      throw new ProcedureBuildError(
        `Opaque occurrence "${key}" used more than once. Each code block / rules condition occurrence appears exactly once.`
      )
    }
    usedKeys.add(key)
    // A code occurrence is a bare inline `reference` marker — wrap it in a block
    // so the doc is structurally valid at the level it's spliced into. A
    // structured conditionBlock is already block-level; splice as-is.
    return node.type === 'reference' ? proseBlock([node]) : node
  }

  const lowerSteps = (steps: ProcedureDslStep[]): TiptapNode[] => {
    const out: TiptapNode[] = []
    for (const step of steps) {
      switch (step.kind) {
        case 'instruction':
          out.push(...(mdToBlocks(step.text) as unknown as TiptapNode[]))
          break
        case 'route':
          out.push(proseBlock([{ type: 'reference', attrs: { id: routeBadgeId(step) } }]))
          break
        case 'call':
          out.push(
            proseBlock([
              { type: 'reference', attrs: { id: `subprocedure:${step.subProcedureId}` } },
            ])
          )
          break
        case 'opaque':
          out.push(resolveOpaque(step.id))
          break
        case 'condition':
          out.push(lowerCondition(step, lowerSteps))
          break
      }
    }
    return out
  }

  const content = lowerSteps(dsl.steps)
  const subProcedures = (dsl.subProcedures ?? []).map((sp) => ({
    id: sp.id,
    name: sp.name,
    content: lowerSteps(sp.steps),
  }))

  return {
    type: 'doc',
    content,
    // Server-owned payloads are copied verbatim from the persisted draft — never
    // reconstructed from model output.
    ...(draftDoc.localAttributes !== undefined
      ? { localAttributes: draftDoc.localAttributes }
      : {}),
    codeBlocks: draftDoc.codeBlocks ?? [],
    subProcedures,
  }
}

/** A fresh, empty draft doc — the `draftDoc` arg for a create with no prior draft. */
export function emptyDoc(): TiptapDoc {
  return { type: 'doc', content: [], subProcedures: [], codeBlocks: [], localAttributes: [] }
}

/** Thrown when an `opaque` step can't be resolved against the persisted draft. */
export class ProcedureBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProcedureBuildError'
  }
}

// ── lowering helpers ─────────────────────────────────────────────────────────

function lowerCondition(
  step: Extract<ProcedureDslStep, { kind: 'condition' }>,
  lowerSteps: (steps: ProcedureDslStep[]) => TiptapNode[]
): TiptapNode {
  const cases: TiptapNode[] = step.cases.map((c) => ({
    type: PROCEDURE_NODE_TYPES.conditionCase,
    attrs: { id: generateId() },
    content: [
      // Text-mode predicate: a single text node so `docToText` reads back `when`
      // verbatim (the compiler stores the predicate as that text).
      {
        type: PROCEDURE_NODE_TYPES.conditionPredicate,
        attrs: { mode: 'text' },
        content: c.when ? [{ type: 'text', text: c.when }] : [],
      },
      ...lowerSteps(c.steps),
    ],
  }))

  const content: TiptapNode[] = [...cases]
  if (step.else !== undefined) {
    content.push({ type: PROCEDURE_NODE_TYPES.conditionElse, content: lowerSteps(step.else) })
  }

  return {
    type: PROCEDURE_NODE_TYPES.conditionBlock,
    attrs: { id: generateId(), mode: 'text' },
    content,
  }
}

/** A KB text block wrapping inline content — the prose container the editor uses. */
function proseBlock(inline: TiptapNode[]): TiptapNode {
  return { type: 'block', attrs: { blockType: 'text' }, content: inline }
}

function routeBadgeId(step: Extract<ProcedureDslStep, { kind: 'route' }>): string {
  if (step.outcome === 'switch') return `route:switch:${step.switchToProcedureId}`
  return `route:${step.outcome}`
}
