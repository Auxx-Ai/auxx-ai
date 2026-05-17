// packages/lib/src/ai/kopilot/prompts/sections/run-mode-banner.ts

import { renderTriggerRunModeBanner } from '../trigger-context'
import { AUTONOMOUS_ONLY, type PromptSection } from './types'

/**
 * "## Run mode" banner — same prose every autonomous fire of a given kind.
 * Static across orgs.
 */
export const runModeBanner: PromptSection = {
  id: 'run-mode-banner',
  modes: AUTONOMOUS_ONLY,
  stability: 'static',
  render: (ctx) => {
    if (!ctx.triggerContext) return null
    return renderTriggerRunModeBanner(ctx.triggerContext.kind)
  },
}
