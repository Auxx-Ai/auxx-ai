// packages/lib/src/agents/procedures/re-anchor.ts

import { docToText } from '../../tiptap'
import type { ProcedureFrame, ProcedureStep } from './types'

/**
 * The one-line resume breadcrumb prepended to the active-step prompt section when
 * a frame is resumed after a child frame popped. **Topic** comes from the PARENT
 * step we're resuming (the first sentence of its `docToText`); **framing** comes
 * from the POPPED frame's `pushedBy`:
 *
 *   - `'digression'` → a customer-visible detour → `"Back to {topic}"`.
 *   - `'call'`       → an internal sub-procedure return the customer never saw →
 *                      `''` (resume silently, no breadcrumb).
 *
 * `'switch'` never pops (it replaces); `'selection'` is frame 0 (no parent). So a
 * non-digression pop yields `''` and the section renders no breadcrumb line.
 *
 * Pure — no DB/IO. See plans/chat/v9/phase-3-stepper-and-stack.md §5.
 */
export function buildReanchorBreadcrumb(
  parentStep: ProcedureStep,
  poppedFrame: ProcedureFrame
): string {
  if (poppedFrame.pushedBy !== 'digression') return ''
  const topic = firstSentence(parentStep.kind === 'instruction' ? docToText(parentStep.doc) : '')
  return topic ? `Back to ${lowerFirst(topic)}.` : 'Back to where we left off.'
}

/** The first sentence (up to the first `.!?` or newline) of a block of prose. */
function firstSentence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const match = trimmed.match(/^[^.!?\n]+/)
  return (match ? match[0] : trimmed).trim()
}

function lowerFirst(value: string): string {
  return value.length > 0 ? value[0]!.toLowerCase() + value.slice(1) : value
}
