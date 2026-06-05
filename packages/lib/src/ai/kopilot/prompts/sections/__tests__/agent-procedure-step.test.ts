// packages/lib/src/ai/kopilot/prompts/sections/__tests__/agent-procedure-step.test.ts

import { describe, expect, it } from 'vitest'
import { agentProcedureStep } from '../agent-procedure-step'
import type { ProcedureStepInput, PromptCtx } from '../types'

const frag = (text: string): unknown => ({
  type: 'fragment',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const ctxWith = (procedureStep?: ProcedureStepInput): PromptCtx =>
  ({ procedureStep, instructionsReferences: undefined }) as unknown as PromptCtx

describe('agentProcedureStep', () => {
  it('is a turn-stability section (registered in tier 3 by Phase 4)', () => {
    expect(agentProcedureStep.id).toBe('agent-procedure-step')
    expect(agentProcedureStep.stability).toBe('turn')
  })

  it('returns null when no procedure step is active → persona-only (#9)', () => {
    expect(agentProcedureStep.render(ctxWith(undefined))).toBeNull()
  })

  it('renders the active step text', () => {
    const out = agentProcedureStep.render(
      ctxWith({ activeStep: { doc: frag('Cancel the order.') }, depth: 1 })
    )
    expect(out).toBe('Current step: Cancel the order.')
  })

  it('prepends a re-anchor breadcrumb when present', () => {
    const out = agentProcedureStep.render(
      ctxWith({
        activeStep: { doc: frag('Pick a plan.') },
        depth: 1,
        breadcrumb: 'Back to your cancellation.',
      })
    )
    expect(out).toContain('Back to your cancellation.')
    expect(out).toContain('Current step: Pick a plan.')
  })

  it('renders the thin side-request breadcrumb at depth > 1', () => {
    const out = agentProcedureStep.render(
      ctxWith({
        activeStep: { doc: frag('Verify identity.') },
        depth: 2,
        topicLabel: 'a refund',
        returnToLabel: 'your cancellation',
      })
    )
    expect(out).toContain("You're handling a side request: a refund.")
    expect(out).toContain("You'll return to: your cancellation.")
    expect(out).toContain('Current step: Verify identity.')
  })

  it('surfaces code outputs as labeled context (D4)', () => {
    const out = agentProcedureStep.render(
      ctxWith({
        activeStep: { doc: frag('Offer the discount.') },
        depth: 1,
        codeOutputs: [
          { name: 'discountTier', value: 'gold' },
          { name: 'pct', value: 20 },
        ],
      })
    )
    expect(out).toContain('Computed: `discountTier` = `gold`')
    expect(out).toContain('Computed: `pct` = `20`')
    expect(out).toContain('Current step: Offer the discount.')
  })

  it('renders a caution note for a failed code step (D5)', () => {
    const out = agentProcedureStep.render(
      ctxWith({
        activeStep: { doc: frag('Confirm eligibility.') },
        depth: 1,
        codeErrors: [{ codeBlockId: 'c1', error: 'timeout' }],
      })
    )
    expect(out).toContain('⚠️')
    expect(out).toContain('offer to escalate')
    expect(out).toContain('Current step: Confirm eligibility.')
  })
})
