// packages/lib/src/ai/kopilot/prompts/sections/agent-procedure-step.ts

import { docToText } from '../../../../tiptap'
import { ALL_MODES, type PromptSection } from './types'

/**
 * The active procedure step (v9 procedures, Phase 3). Injects ONLY the top frame's
 * current step — never the whole stack, never the whole procedure (PROCEDURE-STACK
 * "Prompt: top frame only"). `ctx.procedureStep` is populated by Phase 4 while a frame
 * is active and left unset on free-form turns, so this section returns `null` for
 * persona-only mode (#9) and the prompt is exactly today's persona-only prompt.
 *
 * `stability: 'turn'` — the cursor changes every turn → tier 3, never cached. **Phase 4
 * registers it in tier 3** (near `context` / `active-refs`), NOT adjacent to
 * `agentPersona` (tier 2), or `validateStabilityOrder` would throw. See
 * plans/chat/v9/phase-3-stepper-and-stack.md §6.
 */
export const agentProcedureStep: PromptSection = {
  id: 'agent-procedure-step',
  modes: ALL_MODES,
  stability: 'turn',
  render: (ctx) => {
    const proc = ctx.procedureStep
    if (!proc) return null

    const body = docToText(proc.activeStep.doc, {
      references: ctx.instructionsReferences,
      procedureMaps: proc.procedureMaps,
    })

    const lines: string[] = []
    if (proc.depth > 1) {
      // Thin stack breadcrumb — orient the model without dumping the whole stack.
      if (proc.topicLabel) lines.push(`You're handling a side request: ${proc.topicLabel}.`)
      if (proc.returnToLabel) lines.push(`You'll return to: ${proc.returnToLabel}.`)
      if (lines.length > 0) lines.push('')
    }
    if (proc.breadcrumb) lines.push(proc.breadcrumb, '')

    // Computed values (D4) — let the model speak the transformed result.
    for (const out of proc.codeOutputs ?? []) {
      lines.push(`Computed: \`${out.name}\` = \`${formatValue(out.value)}\``)
    }
    // Failure notes (D5) — the compute couldn't run; cope honestly, don't invent a value.
    for (const _err of proc.codeErrors ?? []) {
      lines.push(
        '⚠️ A computation for this step failed — explain you couldn’t verify it and offer to escalate rather than guessing.'
      )
    }
    if ((proc.codeOutputs?.length ?? 0) > 0 || (proc.codeErrors?.length ?? 0) > 0) lines.push('')

    lines.push(`Current step: ${body}`)
    return lines.join('\n').trim()
  },
}

/** Render a code output value compactly for the prompt — primitives verbatim, objects as JSON. */
function formatValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}
