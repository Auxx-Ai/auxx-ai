// packages/lib/src/agents/procedures/authoring/guard.ts

import type { TiptapDoc } from '../nodes'
import type { ProcedureDsl, ProcedureDslStep } from './dsl'
import { collectOpaqueOccurrences } from './opaque'

/**
 * Deletion guard (Phase 7 §3.4): the Kopilot must never destroy a code block, a
 * rules-mode condition, or an existing sub-procedure via a full-body rewrite.
 * v1 has no delete operation for any of them — that's editor-only. Compare the
 * exact opaque occurrence-key set and existing sub-procedure-id set from the
 * persisted draft against the re-emitted body; reject if any is missing,
 * duplicated, or unknown. This makes loss impossible by construction. PURE.
 */
export function checkBodyPreservation(
  draftDoc: TiptapDoc,
  body: ProcedureDsl
): { ok: true } | { ok: false; error: string } {
  const occurrences = collectOpaqueOccurrences(draftDoc)
  const draftKeys = new Set(occurrences.map((o) => o.key))
  const labelByKey = new Map(occurrences.map((o) => [o.key, o.label]))

  const { opaqueIds, subIds } = collectDslIds(body)

  // No opaque id may appear twice.
  const seen = new Set<string>()
  for (const id of opaqueIds) {
    if (seen.has(id)) {
      return {
        ok: false,
        error: `${describe(labelByKey.get(id))} can't be duplicated via chat — edit it in the procedure editor.`,
      }
    }
    seen.add(id)
  }

  // Every opaque id must resolve to a real draft occurrence.
  for (const id of seen) {
    if (!draftKeys.has(id)) {
      return {
        ok: false,
        error: `Unknown read-only step "${id}". Keep opaque steps exactly as read from read_procedure; don't invent or alter their ids.`,
      }
    }
  }

  // Every draft occurrence must survive the rewrite (no silent removal).
  for (const key of draftKeys) {
    if (!seen.has(key)) {
      return {
        ok: false,
        error: `${describe(labelByKey.get(key))} can't be removed via chat — edit it in the procedure editor.`,
      }
    }
  }

  // Existing sub-procedures: each must appear exactly once. New ones are allowed.
  const draftSubIds = (draftDoc.subProcedures ?? []).map((s) => s?.id).filter(Boolean) as string[]
  const bodySubCounts = new Map<string, number>()
  for (const id of subIds) bodySubCounts.set(id, (bodySubCounts.get(id) ?? 0) + 1)
  for (const id of draftSubIds) {
    const count = bodySubCounts.get(id) ?? 0
    if (count === 0) {
      return {
        ok: false,
        error: `Sub-procedure "${id}" can't be removed via chat — edit it in the procedure editor.`,
      }
    }
    if (count > 1) {
      return { ok: false, error: `Sub-procedure "${id}" appears more than once — keep one copy.` }
    }
  }

  return { ok: true }
}

function describe(label: string | undefined): string {
  return label ? `"${label}"` : 'A code block / rules condition'
}

/** Collect every opaque step id (with duplicates) and every sub-procedure id in a DSL body. */
function collectDslIds(body: ProcedureDsl): { opaqueIds: string[]; subIds: string[] } {
  const opaqueIds: string[] = []
  const walk = (steps: ProcedureDslStep[]): void => {
    for (const step of steps) {
      if (step.kind === 'opaque') {
        opaqueIds.push(step.id)
      } else if (step.kind === 'condition') {
        for (const c of step.cases) walk(c.steps)
        if (step.else) walk(step.else)
      }
    }
  }
  walk(body.steps)
  for (const sp of body.subProcedures ?? []) walk(sp.steps)
  return { opaqueIds, subIds: (body.subProcedures ?? []).map((s) => s.id) }
}
